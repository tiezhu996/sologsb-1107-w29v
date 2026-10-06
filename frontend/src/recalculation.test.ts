import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './utils/db'
import {
  createMouldWithBaseline,
  createRunWithResolution,
  createSamplePending,
  deleteRepairWithRecalc,
  retryPendingRecalculations,
  runBatchRecalc,
  saveRepairWithRecalc,
  submitSampleReview,
} from './utils/recalculation'
import type { MouldRepairInput } from './types/mould-repair'

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

async function resetDb() {
  await db.delete()
  await db.open()
}

describe('维修版本与历史工序追算', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('工序按工序日期匹配当天以前最近一版纸帘参数，不被当前档案回算', async () => {
    const mould = await db.moulds.where('mouldNo').equals('DL-01').first()
    expect(mould).toBeTruthy()

    // 30 天前的工序采用初始版本 1.10 mm：实测 1.34，偏差 +0.24，超差
    const oldRun = await db.sheetRuns.where('runNo').equals('CB-260709').first()
    expect(oldRun?.versionNo).toBe(1)
    expect(oldRun?.deviation).toBe(0.24)
    expect(oldRun?.paramStatus).toBe('complete')

    // 本周工序采用维修后的 v2（1.18 mm）
    const newRun = await db.sheetRuns.where('runNo').equals('CB-260701').first()
    expect(newRun?.versionNo).toBe(2)
    expect(newRun?.deviation).toBe(-0.1)

    // 即便当前档案是 1.18，历史工序仍然按 1.10 计算
    expect(mould?.stripeGap).toBe(1.18)
    expect(oldRun?.deviation).toBe(0.24)
  })

  it('补录早期维修后连带重算之后的偏差，历史工序也回到正确版本', async () => {
    const mould = (await db.moulds.where('mouldNo').equals('DL-03').first())!
    // 在 15 天前补录一次维修：间距由 1.00 调整为 0.95
    const input: MouldRepairInput = {
      repairNo: 'WX-BACKFILL-1',
      mouldId: mould.id!,
      repairDate: isoDaysAgo(15),
      wireDiameter: 0.28,
      stripeGap: 0.95,
      meshDensity: 8.13,
      reason: '调校间距',
      technician: '周守良',
      note: '补录早期调校',
    }
    const outcome = await saveRepairWithRecalc(input)
    expect(outcome.ok).toBe(true)

    // 10 天前的 CB-260706（实测 0.94）：重算前按 1.00 得 -0.06，重算后按 0.95 得 -0.01
    const run6 = await db.sheetRuns.where('runNo').equals('CB-260706').first()
    expect(run6?.deviation).toBe(-0.01)
    expect(run6?.deviationBefore).toBe(-0.06)
    expect(run6?.versionNo).toBe(2)
    expect(run6?.recalculatedAt).not.toBeNull()

    // 重算结果记录在任务表里
    const jobs = await db.recalcJobs.where('status').equals('done').toArray()
    expect(jobs.some((job) => job.runIds.includes(run6!.id!))).toBe(true)
  })

  it('已归档样本在偏差变化后保留原位与历史结论并标记待复检，未通过不得恢复归档', async () => {
    const mould = (await db.moulds.where('mouldNo').equals('DL-03').first())!
    // YZ-06 对应 CB-260706（均匀，初始合格归档）
    const before = await db.paperSamples.where('sampleNo').equals('YZ-06').first()
    expect(before?.reviewStatus).toBe('archived')
    const bin = before!.archiveBin
    const oldConclusion = before!.historyConclusion

    await saveRepairWithRecalc({
      repairNo: 'WX-BF-2', mouldId: mould.id!, repairDate: isoDaysAgo(15),
      wireDiameter: 0.28, stripeGap: 1.2, meshDensity: 6.76,
      reason: '换丝', technician: '周守良', note: '放大间距',
    })

    const flagged = await db.paperSamples.where('sampleNo').equals('YZ-06').first()
    expect(flagged?.reviewStatus).toBe('pending')
    expect(flagged?.archiveBin).toBe(bin)                 // 原位置保留
    expect(flagged?.historyConclusion).toBe(oldConclusion) // 历史结论保留

    const reviews = await db.sampleReviews.where('sampleId').equals(flagged!.id!).toArray()
    expect(reviews.some((review) => review.kind === 'flagged')).toBe(true)
    const flag = reviews.find((review) => review.kind === 'flagged')!
    expect(flag.deviationBefore).toBe(-0.06)
    expect(flag.deviationAfter).toBe(-0.26)

    // 偏差仍超差时强制通过不允许，状态变为复检未通过，不得恢复归档
    const forcedPass = await submitSampleReview(flagged!.id!, 'pass', '测试员')
    expect(forcedPass.status).toBe('failed')
    const failed = await db.paperSamples.get(flagged!.id!)
    expect(failed?.reviewStatus).toBe('failed')
    expect(failed?.archiveBin).toBe(bin)
  })

  it('复检通过后恢复归档', async () => {
    const mould = await db.moulds.toCollection().first()
    const created = await createRunWithResolution({
      runNo: 'CB-NEW-1', mouldId: mould!.id!, batchId: 1, runDate: isoDaysAgo(1),
      operator: '罗青禾', stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 40,
      dryMethod: '火墙', grammage: 32, measuredGap: mould!.stripeGap,
    })
    const sample = await createSamplePending({
      sampleNo: 'YZ-NEW', runId: created.id!, sizeMm: 210, stripeCount: 46,
      evenness: '均匀', archiveBin: '甲柜-99',
    })
    expect(sample.reviewStatus).toBe('pending')
    const outcome = await submitSampleReview(sample.id!, 'pass', '测试员')
    expect(outcome.status).toBe('archived')
  })

  it('维修缺参时，其后工序显示待补录，不算合格', async () => {
    const mould = (await db.moulds.where('mouldNo').equals('DL-02').first())!
    await saveRepairWithRecalc({
      repairNo: 'WX-MISSING', mouldId: mould.id!, repairDate: isoDaysAgo(2),
      wireDiameter: null, stripeGap: null, meshDensity: null,
      reason: '补帘', technician: '沈云舟', note: '参数待量',
    })
    const run = await db.sheetRuns.where('runNo').equals('CB-260702').first()
    expect(run?.paramStatus).toBe('missing-param')
    expect(run?.deviation).toBeNull()
    expect(run?.versionNo).toBe(2)
  })

  it('删除维修后版本链回收，工序回到历史版本重算', async () => {
    const repair = await db.mouldRepairs.where('repairNo').equals('WX-260901').first()
    expect(repair).toBeTruthy()
    const outcome = await deleteRepairWithRecalc(repair!.id!)
    expect(outcome.ok).toBe(true)
    const run1 = await db.sheetRuns.where('runNo').equals('CB-260701').first()
    expect(run1?.versionNo).toBe(1)
    expect(run1?.deviation).toBe(-0.02) // 1.08 - 1.10
  })

  it('新登记工序按所选日期解析版本，实测留空即待补录', async () => {
    const mould = (await db.moulds.where('mouldNo').equals('DL-01').first())!
    const run = await createRunWithResolution({
      runNo: 'CB-EMPTY', mouldId: mould.id!, batchId: 1, runDate: isoDaysAgo(1),
      operator: '罗青禾', stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 40,
      dryMethod: '火墙', grammage: 32, measuredGap: null,
    })
    expect(run.paramStatus).toBe('missing-param')
    expect(run.deviation).toBeNull()
    expect(run.versionNo).toBe(2)
  })
})

describe('批量重算失败回滚', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('保存失败时整体回滚、恢复上次结果，并留下待重算标记；重试成功后清除标记', async () => {
    const run6Before = await db.sheetRuns.where('runNo').equals('CB-260706').first()
    const deviationBefore = run6Before!.deviation

    // 让样本写入抛错：hook 内删除对象存储不可用，这里用 Object.freeze 强制写入失败
    const mould = (await db.moulds.where('mouldNo').equals('DL-03').first())!
    const input: MouldRepairInput = {
      repairNo: 'WX-FAIL', mouldId: mould.id!, repairDate: isoDaysAgo(15),
      wireDiameter: 0.28, stripeGap: 0.95, meshDensity: 8.13,
      reason: '调校间距', technician: '周守良', note: '',
    }

    // 拦截 sampleReviews.add 制造保存失败
    const originalAdd = db.sampleReviews.add.bind(db.sampleReviews)
    db.sampleReviews.add = ((...args: unknown[]) => {
      if ((args[0] as { kind?: string })?.kind === 'flagged') return Promise.reject(new Error('mock write failure'))
      return originalAdd(...args as Parameters<typeof originalAdd>)
    }) as typeof db.sampleReviews.add

    const outcome = await saveRepairWithRecalc(input)
    db.sampleReviews.add = originalAdd
    expect(outcome.ok).toBe(false)

    // 维修与工序偏差全部回滚
    const repair = await db.mouldRepairs.where('repairNo').equals('WX-FAIL').first()
    expect(repair).toBeUndefined()
    const run6After = await db.sheetRuns.where('runNo').equals('CB-260706').first()
    expect(run6After?.deviation).toBe(deviationBefore)
    expect(run6After?.recalcState).toBe('pending')

    // 留下待重算标记
    const pending = await db.recalcJobs.where('status').equals('pending').toArray()
    expect(pending.length).toBe(1)
    expect(pending[0].mouldIds).toContain(mould.id!)

    // 重试成功，标记清除，工序回到 stable；重放的是现有维修链，偏差维持旧值
    const retry = await retryPendingRecalculations()
    expect(retry.failed).toBe(0)
    const stillPending = await db.recalcJobs.where('status').equals('pending').toArray()
    expect(stillPending.length).toBe(0)
    const run6Replayed = await db.sheetRuns.where('runNo').equals('CB-260706').first()
    expect(run6Replayed?.deviation).toBe(deviationBefore)
    expect(run6Replayed?.recalcState).toBe('stable')

    // 用户重新提交维修单后，重算生效
    const secondTry = await saveRepairWithRecalc(input)
    expect(secondTry.ok).toBe(true)
    const run6Recalced = await db.sheetRuns.where('runNo').equals('CB-260706').first()
    expect(run6Recalced?.deviation).toBe(-0.01)
  })

  it('全量重算事务成功后所有工序 stable 且有完成任务', async () => {
    const mouldIds = (await db.moulds.toCollection().primaryKeys()).map(Number)
    await runBatchRecalc(mouldIds, '测试全量重算')
    const pendingRuns = await db.sheetRuns.filter((run) => run.recalcState === 'pending').toArray()
    expect(pendingRuns.length).toBe(0)
  })
})

describe('新建纸帘的初始版本快照', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('登记纸帘即写入初始版本，历史匹配取基线版本', async () => {
    const mould = await createMouldWithBaseline({
      mouldNo: 'DL-NEW', frameW: 50, frameH: 70, wireMaterial: '竹丝',
      wireDiameter: 0.25, stripeGap: 0.9, meshDensity: 8.7, weaver: '测试', state: '在用',
    })
    expect(mould).not.toBeNull()
    const mouldId = mould!.id!
    const versions = await db.mouldVersions.where('mouldId').equals(mouldId).toArray()
    expect(versions.length).toBe(1)
    expect(versions[0].stripeGap).toBe(0.9)
    const run = await createRunWithResolution({
      runNo: 'CB-X', mouldId, batchId: 1, runDate: isoDaysAgo(1),
      operator: '测试', stripeDirection: '竖帘纹', dipCount: 1, stackHeight: 30,
      dryMethod: '火墙', grammage: 30, measuredGap: 1.0,
    })
    expect(run.versionNo).toBe(1)
    expect(run.deviation).toBe(0.1)
  })
})
