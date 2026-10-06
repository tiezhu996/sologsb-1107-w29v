export const RECHECK_RESULTS = ['passed', 'failed'] as const
export type RecheckResult = (typeof RECHECK_RESULTS)[number]

/**
 * 成纸样本复检记录。
 * 样本因重算转待复检后，每次人工复检都留一条记录；
 * passed 才允许恢复归档，failed 继续待复检。
 */
export interface RecheckRecord {
  id?: number
  sampleId: number
  sampleNo: string
  runId: number
  /** 复检时实测帘纹条数 */
  stripeCount: number
  evenness: string
  /** 复检时该工序偏差（来自最近重算结果） */
  deviation: number | null
  result: RecheckResult
  reviewer: string
  reviewedAt: string
  /** 关联的待复检重算批次号 */
  batchId?: string | null
  note?: string
  schemaRev?: number
}
