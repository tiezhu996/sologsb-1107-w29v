export const EVENNESS_LEVELS = ['均匀', '略花', '花'] as const
export type EvennessLevel = (typeof EVENNESS_LEVELS)[number]

export const SAMPLE_REVIEW_STATUSES = ['archived', 'pending', 'failed'] as const
export type SampleReviewStatus = (typeof SAMPLE_REVIEW_STATUSES)[number]

export interface PaperSample {
  id?: number
  sampleNo: string
  runId: number
  sizeMm: number
  stripeCount: number
  evenness: EvennessLevel
  /** 原归档位置：待复检期间保留，不移动、不清空 */
  archiveBin: string
  /** archived 已归档 / pending 待复检 / failed 复检未通过，不得恢复归档 */
  reviewStatus: SampleReviewStatus
  /** 历史结论（首次归档或升级时写入，复检期间保留） */
  historyConclusion: string
  /** 最近一次判定依据的偏差值，便于追溯 */
  historyDeviation: number | null
  lastReviewedAt: string | null
  schemaRev?: number
}

export type PaperSampleInput = Omit<
  PaperSample,
  'id' | 'schemaRev' | 'reviewStatus' | 'historyConclusion' | 'historyDeviation' | 'lastReviewedAt'
>
