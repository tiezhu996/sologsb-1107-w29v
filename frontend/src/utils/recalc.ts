import type { Mould } from '../types/mould'
import type { MouldVersion } from '../types/mould-version'
import type { PaperSample } from '../types/paper-sample'
import type { RecalcBatch, RunRecalcChange } from '../types/recalc-batch'
import type { SheetRun } from '../types/sheet-run'
import { getGapConclusion } from './stripe'
import { db } from './db'
import { resolveRunParam } from './mouldVersion'

/**
 * 失败注入：仅用于演示“批量重算保存失败后整体回滚、恢复上次结果并留待重算标记”。
 * 置为 true 后下一次提交的维修重算会在事务内、任何写入之前抛错并整体回滚。
 */
let failNextRecalc = false
export function setFailNextRecalc(value: boolean): void {
  failNextRecalc = value
}

function generateBatchId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  const rand = Math.floor(Math.random() * 9000 + 1000)
  return `RC-${stamp}-${rand}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function snapshotRun(run: SheetRun): RunRecalcChange['before'] {
  return {
    matchedVersionId: run.matchedVersionId ?? null,
    standardGap: run.standardGap ?? null,
    deviation: run.deviation ?? null,
    paramStatus: run.paramStatus,
  }
}

export interface RecalcOutcome {
  batchId: string
  changes: RunRecalcChange[]
  affectedSampleIds: number[]
}

export interface SubmitRepairInput {
  mould: Mould
  /** 编辑既有版本时传入其 id；补录新维修不传 */
  editVersionId?: number
  versionDate: string
  wireDiameter: number
  stripeGap: number
  meshDensity: number
  operator: string
  note?: string
  triggeredBy: string
  reason: 'repair-create' | 'repair-edit'
}

const RW_TABLES = [db.moulds, db.mouldVersions, db.sheetRuns, db.paperSamples, db.recalcBatches] as const

/**
 * 提交一次维修登记/修改，并在同一个事务内连带重算该帘之后的工序偏差与样本复检状态。
 *
 * 原子性保证：版本写入、工序重算、样本下架、批次记录全部处于同一 IndexedDB 事务，
 * 任一步失败则整体回滚——数据库不会留下半批结果。失败后单独（独立事务）
 * 在纸帘上置 recalcPending 待重算标记，并返回 null 供调用方恢复内存中的上次结果。
 */
export async function submitRepairAndRecalc(input: SubmitRepairInput): Promise<RecalcOutcome | null> {
  const { mould } = input
  const mouldId = mould.id as number
  const batchId = generateBatchId()

  try {
    const outcome = await db.transaction('rw', ...RW_TABLES, async () => {
      // 失败注入点：在任何写入之前抛错，保证整批 abort、不留下半批结果
      if (failNextRecalc) throw new Error('模拟批量保存失败（存储不可用）')

      const versions = await db.mouldVersions.where('mouldId').equals(mouldId).toArray()
      const runs = await db.sheetRuns.where('mouldId').equals(mouldId).toArray()
      const samples = await db.paperSamples.toArray()

      let seq = versions.reduce((max, version) => Math.max(max, version.seq), 0)

      if (input.editVersionId !== undefined) {
        const existing = versions.find((version) => version.id === input.editVersionId)
        if (!existing) throw new Error('待修改的维修版本不存在')
        await db.mouldVersions.update(input.editVersionId, {
          versionDate: input.versionDate,
          wireDiameter: input.wireDiameter,
          stripeGap: input.stripeGap,
          meshDensity: input.meshDensity,
          operator: input.operator,
          note: input.note,
        })
      } else {
        seq += 1
        await db.mouldVersions.add({
          mouldId,
          seq,
          versionDate: input.versionDate,
          wireDiameter: input.wireDiameter,
          stripeGap: input.stripeGap,
          meshDensity: input.meshDensity,
          origin: '维修',
          operator: input.operator,
          note: input.note,
          recalcBatchId: batchId,
          schemaRev: 3,
        })
      }

      const nextVersions = await db.mouldVersions.where('mouldId').equals(mouldId).toArray()
      const changes = await recalcRunsInTx(runs, nextVersions, samples, batchId)

      // 纸帘当前缓存参数刷新为最新一版，并清除待重算标记
      const latest = [...nextVersions].sort((a, b) => {
        if (a.versionDate !== b.versionDate) return a.versionDate < b.versionDate ? 1 : -1
        return b.seq - a.seq
      })[0]
      await db.moulds.update(mouldId, {
        wireDiameter: latest?.wireDiameter ?? input.wireDiameter,
        stripeGap: latest?.stripeGap ?? input.stripeGap,
        meshDensity: latest?.meshDensity ?? input.meshDensity,
        recalcPending: false,
        recalcError: '',
      })

      const affectedSampleIds = Array.from(new Set(changes.flatMap((change) => change.affectedSampleIds)))
      const batch: RecalcBatch = {
        batchId,
        mouldId,
        mouldNo: mould.mouldNo,
        reason: input.reason,
        status: 'success',
        triggeredBy: input.triggeredBy,
        createdAt: nowIso(),
        changes,
        affectedSampleIds,
        schemaRev: 3,
      }
      await db.recalcBatches.add(batch)

      return { batchId, changes, affectedSampleIds }
    })
    failNextRecalc = false
    return outcome
  } catch (error) {
    // 整批已回滚：记录失败批次（含未保存的尝试明细）并在纸帘上留待重算标记。
    // 这些写入在独立事务中，绝不影响上面的回滚结果。
    const attemptedVersions = await db.mouldVersions.where('mouldId').equals(mouldId).toArray()
    const attemptedRuns = await db.sheetRuns.where('mouldId').equals(mouldId).toArray()
    const attemptedSamples = await db.paperSamples.toArray()
    const attemptedChanges = computeChanges(attemptedRuns, attemptedVersions, attemptedSamples).changes
    const errorMessage = error instanceof Error ? error.message : '批量重算保存失败'
    await db.recalcBatches.add({
      batchId,
      mouldId,
      mouldNo: mould.mouldNo,
      reason: input.reason,
      status: 'failed',
      triggeredBy: input.triggeredBy,
      createdAt: nowIso(),
      errorMessage,
      changes: [],
      affectedSampleIds: [],
      attemptedChanges,
      schemaRev: 3,
    })
    await db.moulds.update(mouldId, { recalcPending: true, recalcError: errorMessage })
    failNextRecalc = false
    return null
  }
}

/**
 * 重试重算：不改动版本，仅按现有版本快照重新匹配该帘工序并刷新样本状态。
 * 同样在单事务内原子提交，失败维持 recalcPending。
 */
export async function retryRecalc(mould: Mould, triggeredBy: string): Promise<RecalcOutcome | null> {
  const mouldId = mould.id as number
  const batchId = generateBatchId()
  try {
    const outcome = await db.transaction('rw', ...RW_TABLES, async () => {
      if (failNextRecalc) throw new Error('模拟批量保存失败（存储不可用）')
      const versions = await db.mouldVersions.where('mouldId').equals(mouldId).toArray()
      const runs = await db.sheetRuns.where('mouldId').equals(mouldId).toArray()
      const samples = await db.paperSamples.toArray()
      const changes = await recalcRunsInTx(runs, versions, samples, batchId)
      await db.moulds.update(mouldId, { recalcPending: false, recalcError: '' })
      const affectedSampleIds = Array.from(new Set(changes.flatMap((change) => change.affectedSampleIds)))
      await db.recalcBatches.add({
        batchId,
        mouldId,
        mouldNo: mould.mouldNo,
        reason: 'manual-retry',
        status: 'success',
        triggeredBy,
        createdAt: nowIso(),
        changes,
        affectedSampleIds,
        schemaRev: 3,
      })
      return { batchId, changes, affectedSampleIds }
    })
    failNextRecalc = false
    return outcome
  } catch (error) {
    await db.moulds.update(mouldId, {
      recalcPending: true,
      recalcError: error instanceof Error ? error.message : '批量重算保存失败',
    })
    failNextRecalc = false
    return null
  }
}

/** 纯计算：给定旧工序与新版本，算出所有工序的变更（不改库），供失败批次留痕 */
function computeChanges(runs: SheetRun[], versions: MouldVersion[], samples: PaperSample[]): { changes: RunRecalcChange[]; affectedSampleIds: number[] } {
  const changes: RunRecalcChange[] = []
  const affectedSampleIds = new Set<number>()
  for (const run of runs) {
    const before = snapshotRun(run)
    const after = resolveRunParam(versions, run.mouldId, run.runDate, run.measuredGap)
    if (!hasChanged(before, after)) continue
    const linkedSampleIds = samples.filter((sample) => sample.runId === run.id).map((sample) => sample.id as number)
    changes.push({ runId: run.id as number, runNo: run.runNo, before, after: { ...after }, affectedSampleIds: linkedSampleIds })
    linkedSampleIds.forEach((id) => affectedSampleIds.add(id))
  }
  return { changes, affectedSampleIds: Array.from(affectedSampleIds) }
}

function hasChanged(before: RunRecalcChange['before'], after: RunRecalcChange['after']): boolean {
  return (
    before.matchedVersionId !== after.matchedVersionId ||
    before.standardGap !== after.standardGap ||
    before.deviation !== after.deviation ||
    before.paramStatus !== after.paramStatus
  )
}

/**
 * 事务内执行：重算工序、级联下架受影响样本。
 * 仅当匹配结果真的改变时才记一条变更；受影响样本一律冻结历史结论后转待复检。
 */
async function recalcRunsInTx(
  runs: SheetRun[],
  versions: MouldVersion[],
  samples: PaperSample[],
  batchId: string,
): Promise<RunRecalcChange[]> {
  const changes: RunRecalcChange[] = []
  for (const run of runs) {
    const before = snapshotRun(run)
    const after = resolveRunParam(versions, run.mouldId, run.runDate, run.measuredGap)
    if (!hasChanged(before, after)) continue

    await db.sheetRuns.update(run.id as number, {
      matchedVersionId: after.matchedVersionId,
      standardGap: after.standardGap,
      deviation: after.deviation,
      paramStatus: after.paramStatus,
      recalcBatchId: batchId,
      schemaRev: 3,
    })

    const linkedSamples = samples.filter((sample) => sample.runId === run.id)
    const affectedSampleIds: number[] = []
    for (const sample of linkedSamples) {
      affectedSampleIds.push(sample.id as number)
      // 已归档样本：先保留原位置与历史结论，再标记待复检；复检通过前不恢复归档
      await db.paperSamples.update(sample.id as number, {
        reviewStatus: 'pending',
        archivedConclusion: sample.archivedConclusion ?? freezeConclusion(before.deviation),
        archivedDeviation: before.deviation ?? sample.archivedDeviation ?? null,
        pendingBatchId: batchId,
        schemaRev: 3,
      })
    }

    changes.push({ runId: run.id as number, runNo: run.runNo, before, after: { ...after }, affectedSampleIds })
  }
  return changes
}

function freezeConclusion(deviation: number | null | undefined): string {
  if (deviation === null || deviation === undefined) return '历史结论（参数待补录）'
  return getGapConclusion(deviation)
}
