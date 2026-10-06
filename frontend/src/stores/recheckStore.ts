import { create } from 'zustand'
import type { RecheckRecord } from '../types/recheck-record'
import { registerRefreshable } from '../utils/dataBus'
import { db } from '../utils/db'

interface RecheckStore {
  records: RecheckRecord[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadRecords: () => Promise<void>
  reloadRecords: () => Promise<void>
}

export const useRecheckStore = create<RecheckStore>((set, get) => ({
  records: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadRecords: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const records = await db.recheckRecords.orderBy('reviewedAt').reverse().toArray()
      set({ records, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '复检记录读取失败' })
    }
  },
  reloadRecords: async () => {
    try {
      const records = await db.recheckRecords.orderBy('reviewedAt').reverse().toArray()
      set({ records, error: null, loaded: true })
    } catch {
      set({ error: '复检记录刷新失败' })
    }
  },
}))

void registerRefreshable(() => useRecheckStore.getState().reloadRecords())
