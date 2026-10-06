import { create } from 'zustand'
import type { PaperSample, PaperSampleInput } from '../types/paper-sample'
import { registerRefreshable } from '../utils/dataBus'
import { db, plain, SCHEMA_REV } from '../utils/db'
import { getGapConclusion, isGapOutOfTolerance } from '../utils/stripe'

interface SampleStore {
  paperSamples: PaperSample[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadSamples: () => Promise<void>
  reloadSamples: () => Promise<void>
  addSample: (input: PaperSampleInput) => Promise<PaperSample | null>
}

export const useSampleStore = create<SampleStore>((set, get) => ({
  paperSamples: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadSamples: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const paperSamples = await db.paperSamples.orderBy('sampleNo').toArray()
      set({ paperSamples, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '样本档案读取失败，请检查浏览器存储权限' })
    }
  },
  reloadSamples: async () => {
    try {
      const paperSamples = await db.paperSamples.orderBy('sampleNo').toArray()
      set({ paperSamples, error: null, loaded: true })
    } catch {
      set({ error: '样本档案刷新失败' })
    }
  },
  addSample: async (input) => {
    set({ error: null })
    try {
      const payload = plain(input)
      // 登记即按关联工序当前（时点匹配）偏差判断是否需要待复检
      const run = await db.sheetRuns.get(payload.runId)
      const deviation = run?.deviation ?? null
      const needsReview = payload.evenness !== '均匀' || (deviation !== null && isGapOutOfTolerance(deviation))
      const extra = {
        reviewStatus: needsReview ? 'pending' as const : 'archived' as const,
        archivedConclusion: deviation !== null ? getGapConclusion(deviation) : undefined,
        archivedDeviation: deviation,
        pendingBatchId: null as string | null,
        lastReviewId: null as number | null,
      }
      const id = Number(await db.paperSamples.add({
        ...payload,
        ...extra,
        schemaRev: SCHEMA_REV,
      }))
      const created: PaperSample = { ...payload, ...extra, id, schemaRev: SCHEMA_REV }
      set((state) => ({ paperSamples: [created, ...state.paperSamples] }))
      return created
    } catch {
      set({ error: '样本登记失败，请检查样本编号是否重复' })
      return null
    }
  },
}))

void registerRefreshable(() => useSampleStore.getState().reloadSamples())
