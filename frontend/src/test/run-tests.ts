import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'

import { db } from '../utils/db'
import { findEffectiveVersion, resolveRunParam } from '../utils/mouldVersion'
import { retryRecalc, setFailNextRecalc, submitRepairAndRecalc } from '../utils/recalc'
import { submitRecheck } from '../utils/recheck'

/**
 * 每个用例都在独立子进程中运行（见 run-all.mjs），因此这里使用固定库名即可，
 * Dexie 首次 open 绑定的 fake-indexeddb 工厂随进程退出而销毁，用例间完全隔离。
 */
const cases: Array<{ name: string; fn: () => Promise<void> }> = [
  {
    name: '历史工序按日期命中当时版本，不用当前值',
    fn: async () => {
      const versions = await db.mouldVersions.where('mouldId').equals(1).toArray()
      const run4 = (await db.sheetRuns.get(4))!
      const run1 = (await db.sheetRuns.get(1))!
      assert.equal(run4.standardGap, 1.22)
      assert.equal(run4.deviation, 0.14)
      assert.equal(run4.paramStatus, 'qualified')
      assert.equal(run1.standardGap, 1.22)
      assert.equal(run1.deviation, -0.14)
      assert.ok(versions.length >= 2)
    },
  },
  {
    name: '早于任何版本的日期解析为待补录',
    fn: async () => {
      const versions = await db.mouldVersions.toArray()
      const v = findEffectiveVersion(versions, 1, new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10))
      assert.equal(v?.origin, '建帘')
      assert.equal(v?.stripeGap, 1.1)
      const param = resolveRunParam(versions, 1, '1900-01-01', 1.1)
      assert.equal(param.paramStatus, 'pendingData')
      assert.equal(param.deviation, null)
    },
  },
  {
    name: '补录早期维修连带重算之后工序并下架样本，保留原位',
    fn: async () => {
      const mould3 = (await db.moulds.get(3))!
      const beforeRun8 = { ...(await db.sheetRuns.get(8))! }
      const outcome = await submitRepairAndRecalc({
        mould: mould3,
        versionDate: new Date(Date.now() - 15 * 864e5).toISOString().slice(0, 10),
        wireDiameter: 0.28, stripeGap: 1.1, meshDensity: 7.2,
        operator: '测试工', note: '补录早期维修', triggeredBy: '测试工', reason: 'repair-create',
      })
      assert.ok(outcome)
      const run3 = (await db.sheetRuns.get(3))!
      assert.equal(run3.standardGap, 1.1)
      assert.equal(run3.deviation, -0.07)
      assert.equal(run3.paramStatus, 'qualified')
      assert.equal(run3.recalcBatchId, outcome!.batchId)
      const run6 = (await db.sheetRuns.get(6))!
      assert.equal(run6.standardGap, 1.1)
      const s3 = (await db.paperSamples.get(3))!
      assert.equal(s3.reviewStatus, 'pending')
      assert.equal(s3.archiveBin, '乙柜-02')
      assert.ok(s3.archivedConclusion)
      assert.equal(s3.pendingBatchId, outcome!.batchId)
      const afterRun8 = await db.sheetRuns.get(8)
      assert.equal(afterRun8!.standardGap, beforeRun8.standardGap)
      assert.equal((await db.moulds.get(3))!.stripeGap, 1.1)
    },
  },
  {
    name: '批量保存失败整体回滚、恢复上次结果并标待重算',
    fn: async () => {
      const mould3 = (await db.moulds.get(3))!
      assert.equal(await db.mouldVersions.where('mouldId').equals(3).count(), 1)
      const run3Before = { ...(await db.sheetRuns.get(3))! }
      const s3Before = { ...(await db.paperSamples.get(3))! }

      setFailNextRecalc(true)
      const outcome = await submitRepairAndRecalc({
        mould: mould3,
        versionDate: new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10),
        wireDiameter: 0.28, stripeGap: 1.3, meshDensity: 6,
        operator: '测试工', triggeredBy: '测试工', reason: 'repair-create',
      })
      assert.equal(outcome, null)

      const versions = await db.mouldVersions.where('mouldId').equals(3).toArray()
      assert.equal(versions.length, 1)
      const run3After = (await db.sheetRuns.get(3))!
      assert.equal(run3After.standardGap, run3Before.standardGap)
      assert.equal(run3After.deviation, run3Before.deviation)
      assert.equal(run3After.paramStatus, run3Before.paramStatus)
      const s3After = (await db.paperSamples.get(3))!
      assert.equal(s3After.reviewStatus, s3Before.reviewStatus)
      const mouldAfter = (await db.moulds.get(3))!
      assert.equal(mouldAfter.recalcPending, true)
      const failed = await db.recalcBatches.where('mouldId').equals(3).filter((b) => b.status === 'failed').first()
      assert.ok(failed)
      assert.ok((failed!.attemptedChanges?.length ?? 0) > 0)

      const retry = await retryRecalc(mouldAfter, '测试工')
      assert.ok(retry)
      assert.equal((await db.moulds.get(3))!.recalcPending, false)
    },
  },
  {
    name: '复检门控：不通过保持待复检，通过才恢复归档且原位不变',
    fn: async () => {
      const mould3 = (await db.moulds.get(3))!
      await submitRepairAndRecalc({
        mould: mould3,
        versionDate: new Date(Date.now() - 15 * 864e5).toISOString().slice(0, 10),
        wireDiameter: 0.28, stripeGap: 1.1, meshDensity: 7.2,
        operator: '工', triggeredBy: '工', reason: 'repair-create',
      })
      const sample = (await db.paperSamples.get(3))!
      const run3 = (await db.sheetRuns.get(3))!
      assert.equal(sample.reviewStatus, 'pending')

      const failedId = await submitRecheck({
        sampleId: 3, stripeCount: sample.stripeCount, evenness: '花',
        deviation: run3.deviation, result: 'failed', reviewer: '复检员',
      })
      assert.ok(failedId)
      assert.equal((await db.paperSamples.get(3))!.reviewStatus, 'pending')

      const passedId = await submitRecheck({
        sampleId: 3, stripeCount: 40, evenness: '均匀',
        deviation: 0, result: 'passed', reviewer: '复检员',
      })
      assert.ok(passedId)
      const restored = (await db.paperSamples.get(3))!
      assert.equal(restored.reviewStatus, 'archived')
      assert.equal(restored.archiveBin, '乙柜-02')
      const records = await db.recheckRecords.where('sampleId').equals(3).toArray()
      assert.equal(records.length, 2)
    },
  },
  {
    name: '早于版本的旧工序登记为待补录，不算合格',
    fn: async () => {
      await db.sheetRuns.add({
        runNo: 'CB-OLD', mouldId: 2, batchId: 1, runDate: '1900-01-01', operator: 'x',
        stripeDirection: '竖帘纹', dipCount: 1, stackHeight: 10, dryMethod: '火墙',
        grammage: 30, measuredGap: 0.85,
        deviation: null, matchedVersionId: null, standardGap: null,
        paramStatus: 'pendingData', recalcBatchId: null, schemaRev: 3,
      })
      const r = await db.sheetRuns.where('runNo').equals('CB-OLD').first()
      assert.equal(r!.paramStatus, 'pendingData')
    },
  },
  {
    name: '升级语义：所有真实日期工序都能命中版本并解析状态',
    fn: async () => {
      const versions = await db.mouldVersions.toArray()
      for (const run of await db.sheetRuns.toArray()) {
        const p = resolveRunParam(versions, run.mouldId, run.runDate, run.measuredGap)
        assert.ok(['qualified', 'exceeded', 'pendingData'].includes(p.paramStatus))
      }
    },
  },
]

const index = Number(process.argv[2] ?? -1)
if (index >= 0) {
  await db.open()
  await cases[index].fn()
  await db.close()
  console.log('ok')
} else {
  // 直接整体顺序执行（无并发时的便捷入口）
  let passed = 0
  for (const c of cases) {
    setFailNextRecalc(false)
    try {
      await c.fn()
      passed += 1
      console.log(`  ok - ${c.name}`)
    } catch (error) {
      console.error(`  FAIL - ${c.name}`)
      console.error(error)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed}/${cases.length} 个用例通过`)
}
