import { create } from 'zustand'
import type { SheetRun, SheetRunInput } from '../types/sheet-run'
import { registerRefreshable } from '../utils/dataBus'
import { db, plain, SCHEMA_REV } from '../utils/db'
import { resolveRunParam } from '../utils/mouldVersion'
import { calculateDeviation } from '../utils/stripe'

interface RunStore {
  sheetRuns: SheetRun[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  notice: string | null
  loadRuns: () => Promise<void>
  reloadRuns: () => Promise<void>
  addRun: (input: SheetRunInput) => Promise<SheetRun | null>
  updateMeasuredGap: (id: number, measuredGap: number, standardGap: number | null, matchedVersionId: number | null) => Promise<void>
}

export const useRunStore = create<RunStore>((set, get) => ({
  sheetRuns: [],
  isLoading: false,
  loaded: false,
  error: null,
  notice: null,
  loadRuns: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const sheetRuns = await db.sheetRuns.orderBy('runDate').reverse().toArray()
      set({ sheetRuns, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '抄纸工序读取失败，请检查浏览器存储权限' })
    }
  },
  reloadRuns: async () => {
    try {
      const sheetRuns = await db.sheetRuns.orderBy('runDate').reverse().toArray()
      set({ sheetRuns, error: null, notice: null, loaded: true })
    } catch {
      set({ error: '抄纸工序刷新失败' })
    }
  },
  addRun: async (input) => {
    set({ error: null })
    try {
      // 按工序日期匹配当天以前最近一版纸帘参数；缺失参数则待补录，不算合格
      const versions = await db.mouldVersions.toArray()
      const param = resolveRunParam(versions, input.mouldId, input.runDate, input.measuredGap)
      const base = plain(input)
      const id = Number(await db.sheetRuns.add({
        ...base,
        deviation: param.deviation,
        matchedVersionId: param.matchedVersionId,
        standardGap: param.standardGap,
        paramStatus: param.paramStatus,
        recalcBatchId: null,
        schemaRev: SCHEMA_REV,
      }))
      const created: SheetRun = {
        ...base,
        id,
        deviation: param.deviation,
        matchedVersionId: param.matchedVersionId,
        standardGap: param.standardGap,
        paramStatus: param.paramStatus,
        recalcBatchId: null,
        schemaRev: SCHEMA_REV,
      }
      set((state) => ({ sheetRuns: [created, ...state.sheetRuns] }))
      return created
    } catch {
      set({ error: '工序登记失败，请检查工序编号是否重复' })
      return null
    }
  },
  updateMeasuredGap: async (id, measuredGap, standardGap, matchedVersionId) => {
    // 行内复测仍以该工序命中的历史版本标准值比对，不能拿当前档案值
    const deviation = matchedVersionId === null || standardGap === null
      ? null
      : calculateDeviation(measuredGap, standardGap)
    const paramStatus: SheetRun['paramStatus'] = deviation === null
      ? 'pendingData'
      : Math.abs(deviation) > 0.2 ? 'exceeded' : 'qualified'
    try {
      await db.sheetRuns.update(id, { measuredGap, deviation, standardGap, matchedVersionId, paramStatus, schemaRev: SCHEMA_REV })
      set((state) => ({
        sheetRuns: state.sheetRuns.map((run) => (
          run.id === id ? { ...run, measuredGap, deviation, standardGap, matchedVersionId, paramStatus, schemaRev: SCHEMA_REV } : run
        )),
        error: null,
      }))
    } catch {
      set({ error: '实测间距更新失败' })
    }
  },
}))

void registerRefreshable(() => useRunStore.getState().reloadRuns())
