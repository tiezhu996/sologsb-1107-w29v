import { create } from 'zustand'
import type { Mould, MouldStateValue } from '../types/mould'
import type { MouldRepair } from '../types/mould-repair'
import type { MouldVersion } from '../types/mould-version'
import { db, plain } from '../utils/db'
import { createMouldWithBaseline } from '../utils/recalculation'

interface MouldStore {
  moulds: Mould[]
  repairs: MouldRepair[]
  versions: MouldVersion[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadMoulds: () => Promise<void>
  reload: () => Promise<void>
  addMould: (input: Parameters<typeof createMouldWithBaseline>[0]) => Promise<Mould | null>
  setMouldState: (id: number, state: MouldStateValue) => Promise<void>
}

export const useMouldStore = create<MouldStore>((set, get) => ({
  moulds: [],
  repairs: [],
  versions: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadMoulds: async () => {
    if (get().loaded) return
    await get().reload()
  },
  reload: async () => {
    set({ isLoading: true, error: null })
    try {
      const [moulds, repairs, versions] = await Promise.all([
        db.moulds.orderBy('mouldNo').toArray(),
        db.mouldRepairs.orderBy('repairDate').reverse().toArray(),
        db.mouldVersions.toArray(),
      ])
      set({ moulds, repairs, versions, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '纸帘台帐读取失败，请检查浏览器存储权限' })
    }
  },
  addMould: async (input) => {
    set({ error: null })
    try {
      const created = await createMouldWithBaseline(plain(input))
      await get().reload()
      return created
    } catch {
      set({ error: '纸帘登记失败，请检查编号是否重复' })
      return null
    }
  },
  setMouldState: async (id, nextState) => {
    try {
      await db.moulds.update(id, { state: nextState })
      set((state) => ({
        moulds: state.moulds.map((mould) => (mould.id === id ? { ...mould, state: nextState } : mould)),
        error: null,
      }))
    } catch {
      set({ error: '纸帘状态更新失败' })
    }
  },
}))
