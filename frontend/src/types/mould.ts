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
  /** 当前丝径，取最近生效的维修版本；可能待补录 */
  wireDiameter: number | null
  /** 当前帘纹间距，取最近生效的维修版本；可能待补录 */
  stripeGap: number | null
  meshDensity: number | null
  weaver: string
  state: MouldStateValue
  /** 当前参数对应的版本快照编号 */
  currentVersionId: number | null
  schemaRev?: number
}

export type MouldInput = Omit<Mould, 'id' | 'schemaRev' | 'currentVersionId' | 'wireDiameter' | 'stripeGap' | 'meshDensity'> & {
  wireDiameter: number
  stripeGap: number
  meshDensity?: number
}
