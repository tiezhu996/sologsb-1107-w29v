/**
 * 跨表数据刷新总线。
 *
 * 批量重算会同时改动纸帘、维修版本、工序、样本、复检记录、重算批次。
 * 提交完成（或失败回滚）后统一触发一次全量刷新，保证工作台、抄纸工序、
 * 样本卡读到同一版数据，避免部分页面显示半批结果。
 */
type RefreshListener = () => Promise<void> | void

const listeners = new Set<RefreshListener>()
let refreshing = false

export function registerRefreshable(listener: RefreshListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function refreshAll(): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    await Promise.all(Array.from(listeners).map((listener) => listener()))
  } finally {
    refreshing = false
  }
}
