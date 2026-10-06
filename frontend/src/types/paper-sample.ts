export const EVENNESS_LEVELS = ['均匀', '略花', '花'] as const
export type EvennessLevel = (typeof EVENNESS_LEVELS)[number]

/**
 * 成纸样本复检状态。
 * - archived 已归档，结论有效
 * - pending  因关联工序偏差被重算而下架待复检；原归档位与历史结论保留，
 *            复检没通过前不得恢复归档
 */
export const SAMPLE_REVIEW_STATUSES = ['archived', 'pending'] as const
export type SampleReviewStatus = (typeof SAMPLE_REVIEW_STATUSES)[number]

export interface PaperSample {
  id?: number
  sampleNo: string
  runId: number
  sizeMm: number
  stripeCount: number
  evenness: EvennessLevel
  /** 当前归档位；待复检期间仍保留原位置 */
  archiveBin: string
  reviewStatus: SampleReviewStatus
  /** 转待复检时冻结的历史结论（合格/超差描述与偏差），复检期间保留 */
  archivedConclusion?: string
  archivedDeviation?: number | null
  /** 触发待复检的重算批次号 */
  pendingBatchId?: string | null
  /** 最近一次复检记录 id */
  lastReviewId?: number | null
  schemaRev?: number
}

export type PaperSampleInput = Omit<
  PaperSample,
  'id' | 'schemaRev' | 'reviewStatus' | 'archivedConclusion' | 'archivedDeviation' | 'pendingBatchId' | 'lastReviewId'
>
