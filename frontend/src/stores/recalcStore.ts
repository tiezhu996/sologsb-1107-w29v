import { create } from 'zustand'
import type { RecalcBatch } from '../types/recalc-batch'
import { registerRefreshable } from '../utils/dataBus'
import { db } from '../utils/db'

interface RecalcStore {
  batches: RecalcBatch[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadBatches: () => Promise<void>
  reloadBatches: () => Promise<void>
}

export const useRecalcStore = create<RecalcStore>((set, get) => ({
  batches: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadBatches: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const batches = await db.recalcBatches.orderBy('createdAt').reverse().toArray()
      set({ batches, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '重算批次读取失败' })
    }
  },
  reloadBatches: async () => {
    try {
      const batches = await db.recalcBatches.orderBy('createdAt').reverse().toArray()
      set({ batches, error: null, loaded: true })
    } catch {
      set({ error: '重算批次刷新失败' })
    }
  },
}))

void registerRefreshable(() => useRecalcStore.getState().reloadBatches())
