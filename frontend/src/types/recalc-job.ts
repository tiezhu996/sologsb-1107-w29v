export const RECALC_JOB_STATUSES = ['pending', 'done'] as const
export type RecalcJobStatus = (typeof RECALC_JOB_STATUSES)[number]

/**
 * 批量重算任务。批量重算的保存必须整体成功或整体回滚：
 * 保存失败时恢复上一次结果，并留下 pending 任务作为待重算标记。
 */
export interface RecalcJob {
  id?: number
  status: RecalcJobStatus
  trigger: string
  reason: string
  mouldIds: number[]
  runIds: number[]
  createdAt: string
  resolvedAt: string | null
  schemaRev?: number
}
