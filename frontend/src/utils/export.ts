import { db, plain, SCHEMA_REV } from './db'
import type { RecalcBatch, RunRecalcChange } from '../types/recalc-batch'

function formatDev(value: number | null | undefined): string {
  if (value === null || value === undefined) return '待补录'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} mm`
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '待补录' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/** 重算批次明细（重算前后结果）导出为 CSV，便于与 JSON 一起留档 */
function buildRecalcCsv(batches: RecalcBatch[]): string {
  const header = [
    '批次号', '纸帘', '原因', '状态', '触发人', '时间',
    '工序号', '匹配版本(前)', '标准间距(前)', '偏差(前)', '状态(前)',
    '匹配版本(后)', '标准间距(后)', '偏差(后)', '状态(后)', '受影响样本',
  ]
  const reasonLabel: Record<string, string> = {
    'repair-create': '补录维修',
    'repair-edit': '修改维修',
    'upgrade-backfill': '升级回填',
    'manual-retry': '手动重试',
  }
  const statusLabel: Record<string, string> = { qualified: '合格', exceeded: '超差', pendingData: '待补录' }
  const rows: string[] = [header.map(csvEscape).join(',')]

  const pushChange = (batch: RecalcBatch, change: RunRecalcChange, saved: boolean) => {
    rows.push([
      batch.batchId,
      batch.mouldNo,
      `${reasonLabel[batch.reason] ?? batch.reason}${saved ? '' : '(未保存)'}`,
      batch.status === 'success' ? '成功' : '失败回滚',
      batch.triggeredBy,
      batch.createdAt,
      change.runNo,
      change.before.matchedVersionId ?? '待补录',
      change.before.standardGap,
      formatDev(change.before.deviation),
      statusLabel[change.before.paramStatus] ?? change.before.paramStatus,
      change.after.matchedVersionId ?? '待补录',
      change.after.standardGap,
      formatDev(change.after.deviation),
      statusLabel[change.after.paramStatus] ?? change.after.paramStatus,
      change.affectedSampleIds.join(' '),
    ].map(csvEscape).join(','))
  }

  for (const batch of batches) {
    batch.changes.forEach((change) => pushChange(batch, change, true))
    batch.attemptedChanges?.forEach((change) => pushChange(batch, change, false))
  }
  return '﻿' + rows.join('\n')
}

/** 触发浏览器下载一个文本文件（JSON 与 CSV 复用） */
function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function exportDatabaseJson(): Promise<string> {
  const [moulds, mouldVersions, fiberBatches, sheetRuns, paperSamples, recheckRecords, recalcBatches] = await Promise.all([
    db.moulds.toArray(),
    db.mouldVersions.toArray(),
    db.fiberBatches.toArray(),
    db.sheetRuns.toArray(),
    db.paperSamples.toArray(),
    db.recheckRecords.toArray(),
    db.recalcBatches.toArray(),
  ])
  const datePart = new Date().toISOString().slice(0, 10)
  const filename = `gbpapermill-backup-${datePart}.json`
  const backup = plain({
    database: 'gbpapermill-db',
    version: SCHEMA_REV,
    exportedAt: new Date().toISOString(),
    // 维修版本快照：纸帘每一次建帘/维修的日期、修后丝径与帘纹间距
    mouldVersions,
    moulds,
    fiberBatches,
    sheetRuns,
    paperSamples,
    // 成纸样本的复检记录（通过/未通过、复检人、时间）
    recheckRecords,
    // 批量重算批次：含每个工序的重算前/后结果，失败批次附 attemptedChanges
    recalcBatches,
  })
  downloadFile(JSON.stringify(backup, null, 2), filename, 'application/json;charset=utf-8')

  // 同步导出重算前后对照 CSV，便于不打开 JSON 也能核对级联重算
  if (recalcBatches.length > 0) {
    downloadFile(buildRecalcCsv(recalcBatches), `gbpapermill-recalc-${datePart}.csv`, 'text/csv;charset=utf-8')
  }
  return filename
}
