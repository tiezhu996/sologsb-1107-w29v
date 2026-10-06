import { create } from 'zustand'
import type { SheetRun, SheetRunInput } from '../types/sheet-run'
import { db } from '../utils/db'
import { createRunWithResolution, saveMeasuredGapForRun } from '../utils/recalculation'
import { useSampleStore } from './sampleStore'

interface RunStore {
  sheetRuns: SheetRun[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadRuns: () => Promise<void>
  reload: () => Promise<void>
  addRun: (input: SheetRunInput) => Promise<SheetRun | null>
  updateMeasuredGap: (id: number, measuredGap: number | null) => Promise<void>
}

export const useRunStore = create<RunStore>((set, get) => ({
  sheetRuns: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadRuns: async () => {
    if (get().loaded) return
    await get().reload()
  },
  reload: async () => {
    set({ isLoading: true, error: null })
    try {
      const sheetRuns = await db.sheetRuns.orderBy('runDate').reverse().toArray()
      set({ sheetRuns, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '抄纸工序读取失败，请检查浏览器存储权限' })
    }
  },
  addRun: async (input) => {
    set({ error: null })
    try {
      const created = await createRunWithResolution(input)
      await get().reload()
      return created
    } catch {
      set({ error: '工序登记失败，请检查工序编号是否重复' })
      return null
    }
  },
  updateMeasuredGap: async (id, measuredGap) => {
    try {
      await saveMeasuredGapForRun(id, measuredGap)
      // 行内复测可能级联样本复检状态，两个仓库一起换血，避免半批结果
      const [sheetRuns, paperSamples] = await Promise.all([
        db.sheetRuns.orderBy('runDate').reverse().toArray(),
        db.paperSamples.toArray(),
      ])
      set({ sheetRuns, error: null })
      useSampleStore.setState({ paperSamples })
    } catch {
      set({ error: '实测间距保存失败，已恢复上次结果' })
    }
  },
}))
