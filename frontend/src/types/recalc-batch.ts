/**
 * 批量重算批次记录。
 *
 * 补录或修改早期维修后，连带重算该纸帘之后工序的偏差与样本复检状态。
 * 一次重算保存为一个批次，完整保留“重算前/后结果”，供导出追溯。
 * 保存失败时不产生 success 批次（整体回滚），由纸帘 recalcPending 标记待重算。
 */
export const RECALC_REASONS = ['repair-create', 'repair-edit', 'upgrade-backfill', 'manual-retry'] as const
export type RecalcReason = (typeof RECALC_REASONS)[number]

export const RECALC_BATCH_STATUSES = ['success', 'failed'] as const
export type RecalcBatchStatus = (typeof RECALC_BATCH_STATUSES)[number]

/** 单条工序的重算前后对照 */
export interface RunRecalcChange {
  runId: number
  runNo: string
  before: {
    matchedVersionId: number | null
    standardGap: number | null
    deviation: number | null
    paramStatus: string
  }
  after: {
    matchedVersionId: number | null
    standardGap: number | null
    deviation: number | null
    paramStatus: string
  }
  /** 该工序关联样本因此转待复检的样本 id */
  affectedSampleIds: number[]
}

export interface RecalcBatch {
  id?: number
  batchId: string
  mouldId: number
  mouldNo: string
  reason: RecalcReason
  status: RecalcBatchStatus
  triggeredBy: string
  createdAt: string
  /** 失败原因（status=failed 时） */
  errorMessage?: string
  /** 涉及并实际改判/重算的工序变更明细 */
  changes: RunRecalcChange[]
  /** 转待复检的样本 id 列表 */
  affectedSampleIds: number[]
  /** 失败尝试时仍保留当时算出的变更，供导出核对“未保存的半批结果” */
  attemptedChanges?: RunRecalcChange[]
  schemaRev?: number
}
