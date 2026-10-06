import { db } from './db'
import { BASELINE_EFFECTIVE_DATE, INITIAL_VERSION_NOTE } from '../types/mould-version'
import type { Mould } from '../types/mould'
import type { MouldInput } from '../types/mould'
import type { MouldRepair, MouldRepairInput } from '../types/mould-repair'
import type { MouldVersion } from '../types/mould-version'
import type { PaperSample, PaperSampleInput } from '../types/paper-sample'
import type { RecalcJob } from '../types/recalc-job'
import type { SampleReview } from '../types/sample-review'
import type { SheetRun, SheetRunInput } from '../types/sheet-run'
import {
  buildSampleConclusion,
  calculateDeviation,
  calculateMeshDensity,
  isSamplePassing,
  resolveMouldVersion,
} from './stripe'

export const CURRENT_SCHEMA_REV = 3

export interface RecalcResult {
  mouldIds: number[]
  changedRunIds: number[]
  flaggedSampleIds: number[]
}

export interface RepairOutcome {
  ok: boolean
  error?: string
  repairId?: number
  result?: RecalcResult
}

function nowIso(): string {
  return new Date().toISOString()
}

function formatDeviation(value: number | null): string {
  if (value === null) return '缺参'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} mm`
}

/** 依据维修登记重建一张纸帘的版本快照链，并同步纸帘当前参数 */
async function rebuildMouldVersions(mouldId: number): Promise<MouldVersion[]> {
  const mould = await db.moulds.get(mouldId)
  if (!mould) throw new Error(`纸帘 ${mouldId} 不存在`)

  const repairs = (await db.mouldRepairs.where('mouldId').equals(mouldId).toArray())
    .sort((a, b) => (a.repairDate < b.repairDate ? -1 : a.repairDate > b.repairDate ? 1 : (a.id ?? 0) - (b.id ?? 0)))

  const existing = await db.mouldVersions.where('mouldId').equals(mouldId).toArray()
  const baseline = existing.find((version) => version.repairId === null)

  // 初始版本始终保留且只保留一条，维修版本由维修登记重放生成
  let baselineVersion: MouldVersion
  if (baseline) {
    baselineVersion = { ...baseline, versionNo: 1, effectiveDate: BASELINE_EFFECTIVE_DATE, note: baseline.note || INITIAL_VERSION_NOTE, schemaRev: CURRENT_SCHEMA_REV }
    await db.mouldVersions.put(baselineVersion)
  } else {
    baselineVersion = {
      versionNo: 1,
      mouldId,
      repairId: null,
      effectiveDate: BASELINE_EFFECTIVE_DATE,
      wireDiameter: mould.wireDiameter,
      stripeGap: mould.stripeGap,
      meshDensity: mould.meshDensity,
      note: INITIAL_VERSION_NOTE,
      schemaRev: CURRENT_SCHEMA_REV,
    }
    const baselineId = await db.mouldVersions.add(baselineVersion)
    baselineVersion = { ...baselineVersion, id: baselineId }
  }

  // 维修版本与维修登记对账：保留可复用的版本 ID，避免无关重算把全部工序判为变更
  const repairIds = new Set(repairs.map((repair) => repair.id!))
  const staleRepairVersionIds = existing
    .filter((version) => version.repairId !== null && !repairIds.has(version.repairId))
    .map((version) => version.id!)
  if (staleRepairVersionIds.length) await db.mouldVersions.bulkDelete(staleRepairVersionIds)

  const versions: MouldVersion[] = [baselineVersion]
  for (const [index, repair] of repairs.entries()) {
    const reusable = repair.id === undefined ? undefined : existing.find((version) => version.repairId === repair.id)
    const created: MouldVersion = {
      versionNo: index + 2,
      mouldId,
      repairId: repair.id!,
      effectiveDate: repair.repairDate,
      wireDiameter: repair.wireDiameter,
      stripeGap: repair.stripeGap,
      meshDensity: repair.meshDensity,
      note: `${repair.repairNo} ${repair.reason}`,
      schemaRev: CURRENT_SCHEMA_REV,
    }
    if (reusable?.id !== undefined) {
      await db.mouldVersions.put({ ...created, id: reusable.id })
      versions.push({ ...created, id: reusable.id })
    } else {
      const versionId = await db.mouldVersions.add(created)
      versions.push({ ...created, id: versionId })
    }
  }

  // 纸帘当前参数取最近生效的一版（可能缺参，则当前档案也显示待补录）
  const current = [...versions].sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? 1 : -1
    return b.versionNo - a.versionNo
  })[0]
  await db.moulds.update(mouldId, {
    wireDiameter: current.wireDiameter,
    stripeGap: current.stripeGap,
    meshDensity: current.meshDensity,
    currentVersionId: current.id ?? null,
  })

  return versions
}

/**
 * 级联重算：重建版本快照 → 工序按工序日期匹配当天以前最近一版 →
 * 偏差变化的工序连带把已归档样本标记待复检。
 * 必须在调用方的 db.transaction 内执行，保证整批原子提交。
 */
export async function recalcMoulds(
  mouldIds: number[],
  context: { trigger: string; reason: string },
): Promise<RecalcResult> {
  const stamp = nowIso()
  const changedRunIds: number[] = []
  const flaggedSampleIds: number[] = []
  const versionsByMould = new Map<number, MouldVersion[]>()

  for (const mouldId of mouldIds) {
    versionsByMould.set(mouldId, await rebuildMouldVersions(mouldId))
  }

  for (const mouldId of mouldIds) {
    const versions = versionsByMould.get(mouldId)!
    const runs = await db.sheetRuns.where('mouldId').equals(mouldId).toArray()

    for (const run of runs) {
      const matched = resolveMouldVersion(versions, mouldId, run.runDate)
      const deviation = calculateDeviation(run.measuredGap, matched?.stripeGap ?? null)
      const complete = run.measuredGap !== null && matched !== null && matched.stripeGap !== null
      const previousDeviation = run.deviation
      const changed = previousDeviation !== deviation || run.versionId !== (matched?.id ?? null) || run.paramStatus !== (complete ? 'complete' : 'missing-param')

      const updatedRun: SheetRun = {
        ...run,
        deviation,
        versionId: matched?.id ?? null,
        versionNo: matched?.versionNo ?? null,
        paramStatus: complete ? 'complete' : 'missing-param',
        recalcState: 'stable',
        deviationBefore: previousDeviation,
        recalculatedAt: stamp,
        schemaRev: CURRENT_SCHEMA_REV,
      }
      await db.sheetRuns.put(updatedRun)

      if (!changed || run.id === undefined) continue
      changedRunIds.push(run.id)

      // 偏差变化连带样本复检状态：只动已归档样本，原位置与历史结论保留
      if (previousDeviation !== deviation) {
        const samples = await db.paperSamples.where('runId').equals(run.id).toArray()
        for (const sample of samples) {
          if (sample.reviewStatus !== 'archived' || sample.id === undefined) continue
          const review: SampleReview = {
            sampleId: sample.id,
            runId: run.id,
            kind: 'flagged',
            reason: `${context.trigger === 'repair-edit' ? '维修补录/修改' : '维修档案重算'}，帘纹偏差由 ${formatDeviation(previousDeviation)} 变为 ${formatDeviation(deviation)}；原归档位置与历史结论保留`,
            deviationBefore: previousDeviation,
            deviationAfter: deviation,
            createdAt: stamp,
            schemaRev: CURRENT_SCHEMA_REV,
          }
          await db.sampleReviews.add(review)
          await db.paperSamples.update(sample.id, {
            reviewStatus: 'pending',
            lastReviewedAt: stamp,
            schemaRev: CURRENT_SCHEMA_REV,
          })
          flaggedSampleIds.push(sample.id)
        }
      }
    }
  }

  return { mouldIds: [...mouldIds], changedRunIds, flaggedSampleIds }
}

async function readRunIdsOfMoulds(mouldIds: number[]): Promise<number[]> {
  const runChunks = await Promise.all(mouldIds.map((mouldId) => db.sheetRuns.where('mouldId').equals(mouldId).primaryKeys()))
  return runChunks.flat().map((id) => Number(id))
}

/**
 * 重算事务失败回滚后：偏差等字段已随事务恢复为上次结果，
 * 这里仅把受影响工序标为待重算并登记 pending 任务，
 * 让工作台、抄纸工序和样本卡显示明确的待重算标记，而不是半批结果。
 */
async function markPendingAfterRollback(
  mouldIds: number[],
  job: Omit<RecalcJob, 'id' | 'runIds'>,
): Promise<void> {
  try {
    const runIds = mouldIds.length ? await readRunIdsOfMoulds(mouldIds) : []
    await db.transaction('rw', db.sheetRuns, db.recalcJobs, async () => {
      if (runIds.length) {
        await db.sheetRuns.bulkUpdate(runIds.map((runId) => ({
          key: runId,
          changes: { recalcState: 'pending' as const },
        })))
      }
      await db.recalcJobs.add({ ...job, runIds })
    })
  } catch {
    // 连标记都写不进时静默：业务数据本身已经随主事务回滚
  }
}

/** 批量重算整体失败后的对外标记入口（回滚后调用） */
export function flagPendingRecalculation(mouldIds: number[], job: Omit<RecalcJob, 'id' | 'runIds'>): Promise<void> {
  return markPendingAfterRollback(mouldIds, job)
}

/** 登记新维修并级联重算；整批保存失败时回滚并留下待重算标记 */
export async function saveRepairWithRecalc(input: MouldRepairInput, repairId?: number): Promise<RepairOutcome> {
  const payload: MouldRepair = { ...input, schemaRev: CURRENT_SCHEMA_REV }
  let persistedRepairId = repairId
  try {
    const result = await db.transaction('rw', [db.moulds, db.mouldRepairs, db.mouldVersions, db.sheetRuns, db.paperSamples, db.sampleReviews, db.recalcJobs], async () => {
      if (persistedRepairId === undefined) {
        persistedRepairId = Number(await db.mouldRepairs.add(payload))
      } else {
        await db.mouldRepairs.put({ ...payload, id: persistedRepairId })
      }
      const recalc = await recalcMoulds([payload.mouldId], { trigger: repairId === undefined ? 'repair-add' : 'repair-edit', reason: `维修 ${payload.repairNo}` })
      const job: RecalcJob = {
        status: 'done',
        trigger: repairId === undefined ? 'repair-add' : 'repair-edit',
        reason: `维修登记 ${payload.repairNo}（${payload.repairDate}）级联重算`,
        mouldIds: [payload.mouldId],
        runIds: recalc.changedRunIds,
        createdAt: nowIso(),
        resolvedAt: nowIso(),
        schemaRev: CURRENT_SCHEMA_REV,
      }
      await db.recalcJobs.add(job)
      return recalc
    })
    return { ok: true, repairId: persistedRepairId, result }
  } catch (error) {
    // 事务已整体回滚，偏差等业务字段恢复上次结果；另开事务挂待重算标记
    await markPendingAfterRollback([payload.mouldId], {
      status: 'pending',
      trigger: repairId === undefined ? 'repair-add' : 'repair-edit',
      reason: `维修登记 ${payload.repairNo} 保存失败已回滚：${error instanceof Error ? error.message : '未知错误'}`,
      mouldIds: [payload.mouldId],
      createdAt: nowIso(),
      resolvedAt: null,
      schemaRev: CURRENT_SCHEMA_REV,
    })
    return { ok: false, error: '维修保存失败，已恢复上次结果并标记待重算' }
  }
}

/** 删除维修并重算；失败同样回滚并留待重算标记 */
export async function deleteRepairWithRecalc(repairId: number): Promise<RepairOutcome> {
  const repair = await db.mouldRepairs.get(repairId)
  if (!repair) return { ok: false, error: '维修记录不存在' }
  try {
    const result = await db.transaction('rw', [db.moulds, db.mouldRepairs, db.mouldVersions, db.sheetRuns, db.paperSamples, db.sampleReviews, db.recalcJobs], async () => {
      await db.mouldRepairs.delete(repairId)
      const recalc = await recalcMoulds([repair.mouldId], { trigger: 'repair-delete', reason: `删除维修 ${repair.repairNo}` })
      await db.recalcJobs.add({
        status: 'done',
        trigger: 'repair-delete',
        reason: `删除维修 ${repair.repairNo} 后级联重算`,
        mouldIds: [repair.mouldId],
        runIds: recalc.changedRunIds,
        createdAt: nowIso(),
        resolvedAt: nowIso(),
        schemaRev: CURRENT_SCHEMA_REV,
      })
      return recalc
    })
    return { ok: true, repairId, result }
  } catch (error) {
    await markPendingAfterRollback([repair.mouldId], {
      status: 'pending',
      trigger: 'repair-delete',
      reason: `删除维修 ${repair.repairNo} 失败已回滚：${error instanceof Error ? error.message : '未知错误'}`,
      mouldIds: [repair.mouldId],
      createdAt: nowIso(),
      resolvedAt: null,
      schemaRev: CURRENT_SCHEMA_REV,
    })
    return { ok: false, error: '删除维修失败，已恢复上次结果并标记待重算' }
  }
}

/** 手动批量重算（工作台一键处理待重算标记） */
export async function runBatchRecalc(mouldIds: number[], reason: string): Promise<RecalcResult> {
  return db.transaction('rw', [db.moulds, db.mouldRepairs, db.mouldVersions, db.sheetRuns, db.paperSamples, db.sampleReviews, db.recalcJobs], async () => {
    const result = await recalcMoulds(mouldIds, { trigger: 'manual', reason })
    await db.recalcJobs.add({
      status: 'done',
      trigger: 'manual',
      reason,
      mouldIds,
      runIds: result.changedRunIds,
      createdAt: nowIso(),
      resolvedAt: nowIso(),
      schemaRev: CURRENT_SCHEMA_REV,
    })
    return result
  })
}

/** 重试所有待重算任务：单任务失败保留其 pending 标记，不影响其他任务 */
export async function retryPendingRecalculations(): Promise<{ resolved: number; failed: number; jobs: RecalcJob[] }> {
  const pending = await db.recalcJobs.where('status').equals('pending').toArray()
  let resolved = 0
  let failed = 0
  for (const job of pending) {
    if (job.id === undefined) continue
    try {
      await db.transaction('rw', [db.moulds, db.mouldRepairs, db.mouldVersions, db.sheetRuns, db.paperSamples, db.sampleReviews, db.recalcJobs], async () => {
        const result = await recalcMoulds(job.mouldIds, { trigger: 'retry', reason: `重试：${job.reason}` })
        await db.recalcJobs.update(job.id!, {
          status: 'done',
          reason: `${job.reason}（手动重试完成）`,
          runIds: Array.from(new Set([...job.runIds, ...result.changedRunIds])),
          resolvedAt: nowIso(),
        })
      })
      resolved += 1
    } catch {
      failed += 1
    }
  }
  const jobs = await db.recalcJobs.where('status').equals('pending').toArray()
  return { resolved, failed, jobs }
}

/** 登记新纸帘并写入初始版本快照 */
export async function createMouldWithBaseline(input: MouldInput): Promise<Mould | null> {
  const meshDensity = input.meshDensity ?? calculateMeshDensity(input.wireDiameter, input.stripeGap)
  const mould: Mould = {
    mouldNo: input.mouldNo,
    frameW: input.frameW,
    frameH: input.frameH,
    wireMaterial: input.wireMaterial,
    wireDiameter: input.wireDiameter,
    stripeGap: input.stripeGap,
    meshDensity,
    weaver: input.weaver,
    state: input.state,
    currentVersionId: null,
    schemaRev: CURRENT_SCHEMA_REV,
  }
  const id = Number(await db.moulds.add(mould))
  const versionId = Number(await db.mouldVersions.add({
    versionNo: 1,
    mouldId: id,
    repairId: null,
    effectiveDate: BASELINE_EFFECTIVE_DATE,
    wireDiameter: input.wireDiameter,
    stripeGap: input.stripeGap,
    meshDensity,
    note: INITIAL_VERSION_NOTE,
    schemaRev: CURRENT_SCHEMA_REV,
  }))
  await db.moulds.update(id, { currentVersionId: versionId })
  return { ...mould, id, currentVersionId: versionId }
}

/** 登记新工序：按工序日期匹配历史版本，缺参则待补录，不算合格 */
export async function createRunWithResolution(input: SheetRunInput): Promise<SheetRun> {
  return db.transaction('rw', db.sheetRuns, db.mouldVersions, async () => {
    const versions = await db.mouldVersions.where('mouldId').equals(input.mouldId).toArray()
    const matched = resolveMouldVersion(versions, input.mouldId, input.runDate)
    const deviation = calculateDeviation(input.measuredGap, matched?.stripeGap ?? null)
    const complete = input.measuredGap !== null && matched !== null && matched.stripeGap !== null
    const run: SheetRun = {
      ...input,
      deviation,
      versionId: matched?.id ?? null,
      versionNo: matched?.versionNo ?? null,
      paramStatus: complete ? 'complete' : 'missing-param',
      recalcState: 'stable',
      deviationBefore: null,
      recalculatedAt: null,
      schemaRev: CURRENT_SCHEMA_REV,
    }
    const id = Number(await db.sheetRuns.add(run))
    return { ...run, id }
  })
}

/** 行内复测：以该工序日期对应的历史版本重算偏差，禁止拿当前档案计算 */
export async function saveMeasuredGapForRun(runId: number, measuredGap: number | null): Promise<void> {
  await db.transaction('rw', db.sheetRuns, db.mouldVersions, db.paperSamples, db.sampleReviews, async () => {
    const run = await db.sheetRuns.get(runId)
    if (!run) throw new Error('工序不存在')
    const versions = await db.mouldVersions.where('mouldId').equals(run.mouldId).toArray()
    const matched = resolveMouldVersion(versions, run.mouldId, run.runDate)
    const deviation = calculateDeviation(measuredGap, matched?.stripeGap ?? null)
    const complete = measuredGap !== null && matched !== null && matched.stripeGap !== null
    const stamp = nowIso()
    await db.sheetRuns.update(runId, {
      measuredGap,
      deviation,
      versionId: matched?.id ?? run.versionId ?? null,
      versionNo: matched?.versionNo ?? run.versionNo ?? null,
      paramStatus: complete ? 'complete' : 'missing-param',
      deviationBefore: run.deviation,
      recalculatedAt: stamp,
      schemaRev: CURRENT_SCHEMA_REV,
    })
    if (run.deviation !== deviation) {
      const samples = await db.paperSamples.where('runId').equals(runId).toArray()
      for (const sample of samples) {
        if (sample.reviewStatus !== 'archived' || sample.id === undefined) continue
        await db.sampleReviews.add({
          sampleId: sample.id,
          runId,
          kind: 'flagged',
          reason: `行内复测使帘纹偏差由 ${formatDeviation(run.deviation)} 变为 ${formatDeviation(deviation)}；原归档位置与历史结论保留`,
          deviationBefore: run.deviation,
          deviationAfter: deviation,
          createdAt: stamp,
          schemaRev: CURRENT_SCHEMA_REV,
        })
        await db.paperSamples.update(sample.id, { reviewStatus: 'pending', lastReviewedAt: stamp })
      }
    }
  })
}

/** 登记新样本：先以待复检进入档案，复检通过后才归档 */
export async function createSamplePending(input: PaperSampleInput): Promise<PaperSample> {
  return db.transaction('rw', db.paperSamples, db.sheetRuns, async () => {
    const run = await db.sheetRuns.get(input.runId)
    const deviation = run?.deviation ?? null
    const sample: PaperSample = {
      ...input,
      reviewStatus: 'pending',
      historyConclusion: buildSampleConclusion(input, deviation),
      historyDeviation: deviation,
      lastReviewedAt: null,
      schemaRev: CURRENT_SCHEMA_REV,
    }
    const id = Number(await db.paperSamples.add(sample))
    return { ...sample, id }
  })
}

export interface SampleReviewOutcome {
  ok: boolean
  status: PaperSample['reviewStatus']
  conclusion: string
  error?: string
}

/** 样本复检：通过才恢复归档；不通过维持待处理，不得恢复归档 */
export async function submitSampleReview(sampleId: number, kind: 'pass' | 'fail', reviewer: string): Promise<SampleReviewOutcome> {
  const sample = await db.paperSamples.get(sampleId)
  if (!sample) return { ok: false, status: 'pending', conclusion: '', error: '样本不存在' }
  const run = await db.sheetRuns.get(sample.runId)
  const deviation = run?.deviation ?? null
  const objectivelyPassing = isSamplePassing(sample, deviation)

  // 强行“通过”但匀度/偏差仍不达标时不允许恢复归档
  const effectiveKind: 'pass' | 'fail' = kind === 'pass' && !objectivelyPassing ? 'fail' : kind
  const nextStatus: PaperSample['reviewStatus'] = effectiveKind === 'pass' ? 'archived' : 'failed'
  const stamp = nowIso()
  const conclusion = buildSampleConclusion(sample, deviation)

  await db.transaction('rw', db.paperSamples, db.sampleReviews, db.sheetRuns, async () => {
    const review: SampleReview = {
      sampleId,
      runId: sample.runId,
      kind: effectiveKind,
      reason: effectiveKind === 'pass'
        ? `复检通过，恢复归档于 ${sample.archiveBin}：${conclusion}`
        : `复检未通过，维持待处理、不得恢复归档：${conclusion}`,
      deviationBefore: sample.historyDeviation,
      deviationAfter: deviation,
      reviewer: reviewer.trim() || undefined,
      createdAt: stamp,
      schemaRev: CURRENT_SCHEMA_REV,
    }
    await db.sampleReviews.add(review)
    await db.paperSamples.update(sampleId, {
      reviewStatus: nextStatus,
      historyConclusion: conclusion,
      historyDeviation: deviation,
      lastReviewedAt: stamp,
      schemaRev: CURRENT_SCHEMA_REV,
    })
  })

  return {
    ok: effectiveKind === kind,
    status: nextStatus,
    conclusion,
    ...(effectiveKind !== kind ? { error: '匀度或帘纹偏差仍不达标，无法通过复检' } : {}),
  }
}
