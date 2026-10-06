export const SAMPLE_REVIEW_KINDS = ['flagged', 'pass', 'fail'] as const
export type SampleReviewKind = (typeof SAMPLE_REVIEW_KINDS)[number]

/**
 * 成纸样本复检流水。
 * - flagged：维修档案重算导致工序偏差变化，已归档样本被标记待复检
 * - pass：复检通过，恢复归档
 * - fail：复检未通过，维持待处理，不得恢复归档
 */
export interface SampleReview {
  id?: number
  sampleId: number
  runId: number
  kind: SampleReviewKind
  reason: string
  deviationBefore: number | null
  deviationAfter: number | null
  reviewer?: string
  createdAt: string
  schemaRev?: number
}
