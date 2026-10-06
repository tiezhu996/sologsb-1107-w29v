// 逐个子进程运行用例，保证每个用例拥有全新的 Dexie/fake-indexeddb 环境
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const target = path.join(__dirname, 'run-tests.ts')
const COUNT = 7

const names = [
  '历史工序按日期命中当时版本，不用当前值',
  '早于任何版本的日期解析为待补录',
  '补录早期维修连带重算之后工序并下架样本',
  '批量保存失败整体回滚并标待重算',
  '复检门控：不通过保持待复检、通过恢复归档',
  '早于版本旧工序为待补录不算合格',
  '升级语义：工序版本匹配可回填',
]

let failures = 0
for (let i = 0; i < COUNT; i += 1) {
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', target, String(i)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        console.log(`  ok - ${names[i]}`)
      } else {
        failures += 1
        console.error(`  FAIL - ${names[i]}`)
        console.error(stderr.split('\n').slice(0, 12).join('\n'))
      }
      resolve(exitCode ?? 1)
    })
  })
  void code
}

if (failures > 0) {
  console.error(`\n${failures}/${COUNT} 个用例失败`)
  process.exit(1)
}
console.log(`\n${COUNT}/${COUNT} 个用例通过`)
