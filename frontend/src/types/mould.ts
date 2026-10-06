export const WIRE_MATERIALS = ['竹丝', '铜丝', '马尾丝'] as const
export type WireMaterial = (typeof WIRE_MATERIALS)[number]

export const MOULD_STATES = ['在用', '待修补', '退役'] as const
export type MouldStateValue = (typeof MOULD_STATES)[number]

export interface Mould {
  id?: number
  mouldNo: string
  frameW: number
  frameH: number
  wireMaterial: WireMaterial
  /** 当前丝径，等于最新一版维修（或建帘）快照的丝径，仅作缓存展示 */
  wireDiameter: number
  /** 当前帘纹间距，等于最新一版维修（或建帘）快照的间距，仅作缓存展示 */
  stripeGap: number
  meshDensity: number
  weaver: string
  state: MouldStateValue
  /** 批量重算保存失败后置为 true，重试成功前保留，提示存在待重算批次 */
  recalcPending?: boolean
  /** 最近一次重算失败原因，成功重算后清空 */
  recalcError?: string
  schemaRev?: number
}

export type MouldInput = Omit<Mould, 'id' | 'schemaRev' | 'recalcPending' | 'recalcError'>
