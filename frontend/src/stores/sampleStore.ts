import { create } from 'zustand'
import type { PaperSample, PaperSampleInput } from '../types/paper-sample'
import type { SampleReview } from '../types/sample-review'
import { db } from '../utils/db'
import { createSamplePending, submitSampleReview, type SampleReviewOutcome } from '../utils/recalculation'

interface SampleStore {
  paperSamples: PaperSample[]
  reviews: SampleReview[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadSamples: () => Promise<void>
  reload: () => Promise<void>
  addSample: (input: PaperSampleInput) => Promise<PaperSample | null>
  reviewSample: (id: number, kind: 'pass' | 'fail', reviewer: string) => Promise<SampleReviewOutcome>
}

export const useSampleStore = create<SampleStore>((set, get) => ({
  paperSamples: [],
  reviews: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadSamples: async () => {
    if (get().loaded) return
    await get().reload()
  },
  reload: async () => {
    set({ isLoading: true, error: null })
    try {
      const [paperSamples, reviews] = await Promise.all([
        db.paperSamples.orderBy('sampleNo').toArray(),
        db.sampleReviews.orderBy('createdAt').reverse().toArray(),
      ])
      set({ paperSamples, reviews, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '样本档案读取失败，请检查浏览器存储权限' })
    }
  },
  addSample: async (input) => {
    set({ error: null })
    try {
      const created = await createSamplePending(input)
      await get().reload()
      return created
    } catch {
      set({ error: '样本登记失败，请检查样本编号是否重复' })
      return null
    }
  },
  reviewSample: async (id, kind, reviewer) => {
    set({ error: null })
    const outcome = await submitSampleReview(id, kind, reviewer)
    if (!outcome.ok && outcome.error) {
      set({ error: outcome.error })
    }
    await get().reload()
    return outcome
  },
}))
