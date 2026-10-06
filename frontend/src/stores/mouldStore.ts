import { create } from 'zustand'
import type { Mould, MouldInput, MouldStateValue } from '../types/mould'
import { registerRefreshable } from '../utils/dataBus'
import { db, plain, SCHEMA_REV } from '../utils/db'
import { calculateMeshDensity } from '../utils/stripe'

interface MouldStore {
  moulds: Mould[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  notice: string | null
  loadMoulds: () => Promise<void>
  reloadMoulds: () => Promise<void>
  addMould: (input: MouldInput, baselineDate: string) => Promise<Mould | null>
  setMouldState: (id: number, state: MouldStateValue) => Promise<void>
  clearNotice: () => void
}

export const useMouldStore = create<MouldStore>((set, get) => ({
  moulds: [],
  isLoading: false,
  loaded: false,
  error: null,
  notice: null,
  loadMoulds: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const moulds = await db.moulds.orderBy('mouldNo').toArray()
      set({ moulds, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '纸帘台帐读取失败，请检查浏览器存储权限' })
    }
  },
  reloadMoulds: async () => {
    try {
      const moulds = await db.moulds.orderBy('mouldNo').toArray()
      set({ moulds, error: null, loaded: true })
    } catch {
      set({ error: '纸帘台帐刷新失败' })
    }
  },
  addMould: async (input, baselineDate) => {
    set({ error: null, notice: null })
    try {
      const payload = plain(input)
      // 新纸帘与其建帘基线版本必须同事务落库
      const createdId = await db.transaction('rw', db.moulds, db.mouldVersions, async () => {
        const id = Number(await db.moulds.add({ ...payload, recalcPending: false, schemaRev: SCHEMA_REV }))
        await db.mouldVersions.add({
          mouldId: id,
          seq: 1,
          versionDate: baselineDate,
          wireDiameter: payload.wireDiameter,
          stripeGap: payload.stripeGap,
          meshDensity: payload.meshDensity ?? calculateMeshDensity(payload.wireDiameter, payload.stripeGap),
          origin: '建帘',
          operator: payload.weaver,
          note: '建帘基线参数',
          schemaRev: SCHEMA_REV,
        })
        return id
      })
      const created: Mould = { ...payload, id: createdId, recalcPending: false, schemaRev: SCHEMA_REV }
      set((state) => ({ moulds: [created, ...state.moulds] }))
      return created
    } catch {
      set({ error: '纸帘登记失败，请检查编号是否重复' })
      return null
    }
  },
  setMouldState: async (id, nextState) => {
    try {
      await db.moulds.update(id, { state: nextState, schemaRev: SCHEMA_REV })
      set((state) => ({
        moulds: state.moulds.map((mould) => (mould.id === id ? { ...mould, state: nextState, schemaRev: SCHEMA_REV } : mould)),
        error: null,
      }))
    } catch {
      set({ error: '纸帘状态更新失败' })
    }
  },
  clearNotice: () => set({ notice: null }),
}))

void registerRefreshable(() => useMouldStore.getState().reloadMoulds())
