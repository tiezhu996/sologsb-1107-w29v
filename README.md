# 手工造纸帘纹与工序档案

围绕手工造纸的纸帘、纤维料批、抄纸工序与成纸样本建立一体化档案。界面可登记纸帘维修（日期、修后丝径与帘纹间距）并形成可追溯的版本快照链；抄纸工序按工序日期匹配当天以前最近一版纸帘参数追算偏差，补录或修改早期维修会级联重算之后的工序与成纸样本复检状态。所有业务数据保存在浏览器 IndexedDB 中，无需后端服务。

## Docker 一键启动

```bash
cp .env.example .env && docker compose up -d --build
```

默认映射端口为 `21807`。启动后访问 `http://localhost:21807`。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端框架 | React 18 + TypeScript 5 |
| 构建工具 | Vite 5 |
| 界面组件 | MUI 5 + Emotion |
| 路由 | React Router 6 |
| 状态管理 | Zustand 4 |
| 本地数据库 | Dexie 4 + IndexedDB |
| 部署 | Nginx + Docker Compose |

## 访问地址

`http://localhost:21807`

## 本地开发方式

```bash
cd frontend
npm install
npm run dev
```

本地开发服务器默认运行在 `http://localhost:5173`。

```bash
npm test        # 运行版本追算、级联重算、回滚与复检流程的集成测试（vitest + fake-indexeddb）
```

## 目录结构

```text
.
├── docker-compose.yml
├── .env.example
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── src/
│       ├── components/common/  公共可视化组件
│       ├── hooks/              筛选与单位换算
│       ├── pages/              五个业务页面
│       ├── router/             路由表
│       ├── stores/             Zustand 状态与持久化动作
│       ├── types/              四类业务模型
│       └── utils/              Stripe 计算、Dexie 与 JSON 导出
└── README.md
```

## 数据存储说明

数据存储使用 IndexedDB，Dexie 数据库名为 `gbpapermill-db`。

- `version(1)`：建立 `moulds`、`fiberBatches`、`sheetRuns`、`paperSamples` 四张表及编号、日期、状态等索引。
- `version(2)`：为四张表加入 `schemaRev` 索引，并通过 `upgrade` 将存量记录回填为版本 `2`。
- `version(3)`：新增 `mouldRepairs`（维修登记）、`mouldVersions`（纸帘参数版本快照）、`sampleReviews`（复检流水）、`recalcJobs`（批量重算任务）四张表；升级时为每张纸帘补齐初始版本快照，为存量工序按日期回填匹配版本（缺参数的旧工序标记为待补录，不算合格），为存量样本写入历史结论与复检状态。

### 维修版本与级联重算规则

1. 每次维修登记（日期、修后丝径、修后帘纹间距）都会生成一条版本快照；丝径或间距留空表示待补录。
2. 抄纸工序按**工序日期**匹配当天（含）以前最近生效的一版参数计算偏差，不会拿当前档案回算历史工序。
3. 补录或修改早期维修后，其后的工序连带重算：工序保留 `deviationBefore`（重算前）与 `deviation`（重算后）；偏差发生变化的已归档样本保留原归档位置与历史结论，并写入一条 `flagged` 复检流水、状态置为待复检。
4. 复检必须匀度“均匀”且偏差在 ±0.2 mm 内才能通过并恢复归档；不通过则维持待处理，不得恢复归档。
5. 批量重算在单个 Dexie 事务内完成；保存失败整体回滚、恢复上次结果，受影响工序置为 `recalcState = pending` 并留下待重算任务，工作台显示横幅并支持一键重试——界面不会出现半批结果。
6. 页面顶部的“导出 JSON”同时包含维修登记、版本快照、工序重算前后偏差、样本复检流水与重算任务记录。

数据库首次创建时通过 `populate` 写入 5 张纸帘（含 1 次维修与两版快照）、5 个纤维料批、9 槽抄纸工序和 6 个成纸样本。
页面顶部的“导出 JSON”可下载全部表的完整备份。

## 核心功能与路由表

| 路由 | 页面标题 | 核心功能 |
| --- | --- | --- |
| `/` | 工作台 | 查看纸帘状态分布、本周工序数、待补录工序与待复检样本，处理待重算标记及全量重算 |
| `/moulds` | 纸帘台帐 | 筛选纸帘，登记新纸帘（自动生成初始版本），维修档案登记/修改/删除与版本快照链 |
| `/fibers` | 纤维料批台账 | 按原料和打浆度筛选、比较，展开查看关联抄纸工序 |
| `/runs` | 抄纸工序记录台 | 按日期和帘号筛选，登记工序时按日期解析版本，行内复测显示版本号、待补录与判定 |
| `/samples` | 成纸样本与透光检验卡 | 按匀度与帘纹条数分档，查看重算前后偏差，执行复检（通过才恢复归档） |

未匹配的地址会回到工作台。
