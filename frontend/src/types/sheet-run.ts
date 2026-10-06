export const STRIPE_DIRECTIONS = ['竖帘纹', '横帘纹'] as const
export type StripeDirection = (typeof STRIPE_DIRECTIONS)[number]

export const DRY_METHODS = ['火墙', '日晒'] as const
export type DryMethod = (typeof DRY_METHODS)[number]

/**
 * 工序帘纹参数状态。
 * - qualified   已按工序日期匹配到当天以前最近一版纸帘参数，偏差在允许范围
 * - exceeded    已匹配版本，但偏差绝对值超出 ±0.2 mm
 * - pendingData 工序日期早于任何一版纸帘参数（缺失参数），待补录，不能算合格
 */
export const RUN_PARAM_STATUSES = ['qualified', 'exceeded', 'pendingData'] as const
export type RunParamStatus = (typeof RUN_PARAM_STATUSES)[number]

export interface SheetRun {
  id?: number
  runNo: string
  mouldId: number
  batchId: number
  runDate: string
  operator: string
  stripeDirection: StripeDirection
  dipCount: number
  stackHeight: number
  dryMethod: DryMethod
  grammage: number
  measuredGap: number
  /** 实测间距相对所匹配版本标准间距的偏差；无版本可匹配时为 null */
  deviation: number | null
  /** 时点匹配命中的纸帘版本快照 id；无匹配为 null（待补录） */
  matchedVersionId: number | null
  /** 命中版本当时的标准帘纹间距快照，保留冗余数值以支撑导出与留痕 */
  standardGap: number | null
  paramStatus: RunParamStatus
  /** 最近一次重算该工序的批次号，未重算过为 null */
  recalcBatchId?: string | null
  schemaRev?: number
}

export type SheetRunInput = Omit<
  SheetRun,
  'id' | 'schemaRev' | 'deviation' | 'matchedVersionId' | 'standardGap' | 'paramStatus' | 'recalcBatchId'
>
