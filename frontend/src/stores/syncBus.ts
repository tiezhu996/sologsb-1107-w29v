/**
 * 轻量同步总线：批量重算事务提交成功后统一触发各仓库重载。
 * 保存失败时事务整体回滚，不发同步事件，界面继续显示上一次结果。
 */
export type SyncTopic = 'moulds' | 'runs' | 'samples'

type SyncListener = () => void | Promise<void>

const listeners = new Set<(topics: SyncTopic[]) => void>()

export function subscribeSync(listener: (topics: SyncTopic[]) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitSync(topics: SyncTopic[]): void {
  listeners.forEach((listener) => listener(topics))
}

export type { SyncListener }
