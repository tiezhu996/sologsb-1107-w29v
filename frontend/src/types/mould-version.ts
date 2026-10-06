export const INITIAL_VERSION_NOTE = '建帘初始参数'
export const BASELINE_EFFECTIVE_DATE = '2000-01-01'

/**
 * 纸帘参数版本快照。每张纸帘始终保留一条 repairId 为空的初始版本，
 * 每次维修登记追加一条快照。抄纸工序按工序日期匹配当天（含）以前
 * 最近生效的一版，禁止用当前档案回算历史工序。
 */
export interface MouldVersion {
  id?: number
  versionNo: number
  mouldId: number
  repairId: number | null
  effectiveDate: string
  wireDiameter: number | null
  stripeGap: number | null
  meshDensity: number | null
  note: string
  schemaRev?: number
}
