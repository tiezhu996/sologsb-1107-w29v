import { create } from 'zustand'
import type { MouldVersion } from '../types/mould-version'
import { registerRefreshable } from '../utils/dataBus'
import { db } from '../utils/db'

interface MouldVersionStore {
  versions: MouldVersion[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadVersions: () => Promise<void>
  reloadVersions: () => Promise<void>
}

function sortVersions(versions: MouldVersion[]): MouldVersion[] {
  return [...versions].sort((a, b) => {
    if (a.mouldId !== b.mouldId) return a.mouldId - b.mouldId
    if (a.versionDate !== b.versionDate) return a.versionDate < b.versionDate ? 1 : -1
    return b.seq - a.seq
  })
}

export const useMouldVersionStore = create<MouldVersionStore>((set, get) => ({
  versions: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadVersions: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const versions = await db.mouldVersions.toArray()
      set({ versions: sortVersions(versions), isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '维修版本档案读取失败，请检查浏览器存储权限' })
    }
  },
  reloadVersions: async () => {
    try {
      const versions = await db.mouldVersions.toArray()
      set({ versions: sortVersions(versions), error: null, loaded: true })
    } catch {
      set({ error: '维修版本档案刷新失败' })
    }
  },
}))

void registerRefreshable(() => useMouldVersionStore.getState().reloadVersions())
