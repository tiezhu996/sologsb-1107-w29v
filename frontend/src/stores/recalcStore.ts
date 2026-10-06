import { create } from 'zustand'
import type { RecalcJob } from '../types/recalc-job'
import { db } from '../utils/db'
import { emitSync } from './syncBus'
import { flagPendingRecalculation, retryPendingRecalculations, runBatchRecalc } from '../utils/recalculation'

interface RecalcStore {
  jobs: RecalcJob[]
  isRecalculating: boolean
  notice: string | null
  loadJobs: () => Promise<void>
  retryPending: () => Promise<void>
  recalcAll: () => Promise<void>
}

async function fetchJobs(): Promise<RecalcJob[]> {
  return db.recalcJobs.orderBy('createdAt').reverse().toArray()
}

export const useRecalcStore = create<RecalcStore>((set) => ({
  jobs: [],
  isRecalculating: false,
  notice: null,
  loadJobs: async () => {
    try {
      set({ jobs: await fetchJobs() })
    } catch {
      // v3 升级前或存储不可用时静默
    }
  },
  retryPending: async () => {
    set({ isRecalculating: true, notice: null })
    try {
      const { resolved, failed } = await retryPendingRecalculations()
      set({
        isRecalculating: false,
        jobs: await fetchJobs(),
        notice: failed > 0
          ? `部分待重算仍失败：成功 ${resolved} 条，剩余 ${failed} 条继续挂起`
          : `待重算任务已全部恢复完成（${resolved} 条）`,
      })
      emitSync(['moulds', 'runs', 'samples'])
    } catch {
      set({ isRecalculating: false, notice: '批量重算保存失败，已恢复上次结果并保留待重算标记' })
      set({ jobs: await fetchJobs() })
    }
  },
  recalcAll: async () => {
    set({ isRecalculating: true, notice: null })
    try {
      const mouldIds = (await db.moulds.toCollection().primaryKeys()).map((id) => Number(id))
      await runBatchRecalc(mouldIds, '工作台手动全量重算')
      set({ isRecalculating: false, jobs: await fetchJobs(), notice: '批量重算已完成并整体保存' })
      emitSync(['moulds', 'runs', 'samples'])
    } catch {
      // 事务回滚，不刷新业务仓库，避免界面显示半批结果；把工序挂待重算标记
      const mouldIds = await db.moulds.toCollection().primaryKeys().then((keys) => keys.map(Number)).catch(() => [])
      await flagPendingRecalculation(mouldIds, {
        status: 'pending',
        trigger: 'manual',
        reason: '工作台全量重算保存失败，已恢复上次结果',
        mouldIds,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        schemaRev: 3,
      })
      set({ isRecalculating: false, jobs: await fetchJobs(), notice: '批量重算保存失败，已恢复上次结果并标记待重算' })
    }
  },
}))
