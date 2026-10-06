import type { RecheckRecord, RecheckResult } from '../types/recheck-record'
import { db } from './db'

export interface RecheckInput {
  sampleId: number
  stripeCount: number
  evenness: string
  deviation: number | null
  result: RecheckResult
  reviewer: string
  note?: string
  batchId?: string | null
}

/**
 * 提交一次样本复检。
 * - passed：复检通过，样本恢复 archived；原归档位一直保留，恢复后可继续陈列。
 * - failed：维持 pending，不得恢复归档，仅追加复检记录。
 * 复检记录与样本状态更新在同一事务内提交。
 */
export async function submitRecheck(input: RecheckInput): Promise<number | null> {
  return db.transaction('rw', db.paperSamples, db.recheckRecords, async () => {
    const sample = await db.paperSamples.get(input.sampleId)
    if (!sample) throw new Error('样本不存在')
    const record: RecheckRecord = {
      sampleId: input.sampleId,
      sampleNo: sample.sampleNo,
      runId: sample.runId,
      stripeCount: input.stripeCount,
      evenness: input.evenness,
      deviation: input.deviation,
      result: input.result,
      reviewer: input.reviewer,
      reviewedAt: new Date().toISOString(),
      batchId: input.batchId ?? sample.pendingBatchId ?? null,
      note: input.note,
      schemaRev: 3,
    }
    const recordId = Number(await db.recheckRecords.add(record))
    if (input.result === 'passed') {
      await db.paperSamples.update(input.sampleId, {
        reviewStatus: 'archived',
        lastReviewId: recordId,
        pendingBatchId: null,
        schemaRev: 3,
      })
    } else {
      await db.paperSamples.update(input.sampleId, {
        reviewStatus: 'pending',
        lastReviewId: recordId,
        schemaRev: 3,
      })
    }
    return recordId
  })
}
