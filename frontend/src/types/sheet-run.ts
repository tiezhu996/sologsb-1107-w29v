export const STRIPE_DIRECTIONS = ['竖帘纹', '横帘纹'] as const
export type StripeDirection = (typeof STRIPE_DIRECTIONS)[number]

export const DRY_METHODS = ['火墙', '日晒'] as const
export type DryMethod = (typeof DRY_METHODS)[number]

/** 工序参数完备性：版本缺失或版本/实测间距缺参时只能待补录，不得判合格 */
export type RunParamStatus = 'complete' | 'missing-param'

/** 重算状态：保存失败后整批复旧并标记 pending */
export type RunRecalcState = 'stable' | 'pending'

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
  /** 实测帘纹间距，历史数据可能缺失 */
  measuredGap: number | null
  /** 以工序日期匹配到的历史版本间距计算，缺参或未实测时为 null */
  deviation: number | null
  /** 实际采用的纸帘版本快照 */
  versionId: number | null
  versionNo: number | null
  paramStatus: RunParamStatus
  recalcState: RunRecalcState
  /** 最近一次重算前的偏差，供导出留痕 */
  deviationBefore: number | null
  recalculatedAt: string | null
  schemaRev?: number
}

export type SheetRunInput = Omit<
  SheetRun,
  | 'id'
  | 'schemaRev'
  | 'deviation'
  | 'versionId'
  | 'versionNo'
  | 'paramStatus'
  | 'recalcState'
  | 'deviationBefore'
  | 'recalculatedAt'
>
