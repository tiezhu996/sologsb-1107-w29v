export const REPAIR_REASONS = ['换丝', '整经', '补帘', '调校间距', '其他'] as const
export type RepairReason = (typeof REPAIR_REASONS)[number]

/**
 * 纸帘维修登记：记录维修日期与修后丝径、修后帘纹间距。
 * 修后参数允许为空，表示该次维修的参数尚待补录；
 * 缺参版本不能作为合格工序的判定依据。
 */
export interface MouldRepair {
  id?: number
  repairNo: string
  mouldId: number
  repairDate: string
  wireDiameter: number | null
  stripeGap: number | null
  meshDensity: number | null
  reason: RepairReason | string
  technician: string
  note: string
  schemaRev?: number
}

export type MouldRepairInput = Omit<MouldRepair, 'id' | 'schemaRev'>
