/**
 * 纸帘维修版本快照。
 *
 * 每条记录是一次“建帘基线”或“维修登记”的不可变参数快照：
 * 登记日期、修后丝径、修后帘纹间距。抄纸工序按自己的工序日期，
 * 匹配当天以前最近一版快照，绝不能拿现在的档案回头计算历史工序。
 */
export const VERSION_ORIGINS = ['建帘', '维修'] as const
export type VersionOrigin = (typeof VERSION_ORIGINS)[number]

export interface MouldVersion {
  id?: number
  mouldId: number
  /** 版本序号，同一纸帘内从 1 递增，便于导出与档案追溯 */
  seq: number
  /** 维修（或建帘）登记日期，ISO yyyy-mm-dd */
  versionDate: string
  /** 该版的丝径 mm */
  wireDiameter: number
  /** 该版修后的帘纹间距 mm，是历史工序偏差比对的标准值 */
  stripeGap: number
  /** 由丝径与间距推算的网目密度 根/cm */
  meshDensity: number
  origin: VersionOrigin
  /** 维修匠人 / 登记人 */
  operator: string
  note?: string
  /** 由批量重算生成（如升级回填）时记录批次号，便于留痕 */
  recalcBatchId?: string
  schemaRev?: number
}

export type MouldVersionInput = Omit<
  MouldVersion,
  'id' | 'seq' | 'meshDensity' | 'schemaRev' | 'recalcBatchId'
>
