import { useEffect, useMemo, useState } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, Grid, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { StatBadge } from '../components/common/StatBadge'
import { useRecheckStore } from '../stores/recheckStore'
import { useRecalcStore } from '../stores/recalcStore'
import type { RecalcBatch, RunRecalcChange } from '../types/recalc-batch'

const reasonLabel: Record<string, string> = {
  'repair-create': '补录维修',
  'repair-edit': '修改维修',
  'upgrade-backfill': '升级回填',
  'manual-retry': '手动重试',
}
const statusLabel: Record<string, { label: string; color: 'success' | 'warning' | 'info' }> = {
  qualified: { label: '合格', color: 'success' },
  exceeded: { label: '超差', color: 'warning' },
  pendingData: { label: '待补录', color: 'info' },
}

function devText(value: number | null): string {
  if (value === null) return '待补录'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

function ChangeTable({ changes }: { changes: RunRecalcChange[] }) {
  return (
    <Table size="small" sx={{ mt: 1 }}>
      <TableHead>
        <TableRow>
          <TableCell>工序</TableCell>
          <TableCell>重算前（版本 / 标准 / 偏差 / 状态）</TableCell>
          <TableCell>重算后（版本 / 标准 / 偏差 / 状态）</TableCell>
          <TableCell>受影响样本</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {changes.map((change) => (
          <TableRow key={`${change.runId}-${change.after.matchedVersionId}-${change.after.deviation}`} data-testid="recalc-change-row">
            <TableCell sx={{ fontWeight: 700 }}>{change.runNo}</TableCell>
            <TableCell>
              v{change.before.matchedVersionId ?? '—'} · {change.before.standardGap ?? '—'} mm · {devText(change.before.deviation)} · {statusLabel[change.before.paramStatus]?.label ?? change.before.paramStatus}
            </TableCell>
            <TableCell>
              v{change.after.matchedVersionId ?? '—'} · {change.after.standardGap ?? '—'} mm · {devText(change.after.deviation)} ·{' '}
              <Chip component="span" size="small" color={statusLabel[change.after.paramStatus]?.color ?? 'default'} label={statusLabel[change.after.paramStatus]?.label ?? change.after.paramStatus} sx={{ height: 18 }} />
            </TableCell>
            <TableCell>{change.affectedSampleIds.length ? `#${change.affectedSampleIds.join('、#')}` : '—'}</TableCell>
          </TableRow>
        ))}
        {changes.length === 0 && (
          <TableRow><TableCell colSpan={4} align="center">本批次未改变任何工序判定（无变化）。</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  )
}

export default function RecalcTrail() {
  const batches = useRecalcStore((state) => state.batches)
  const batchError = useRecalcStore((state) => state.error)
  const loadBatches = useRecalcStore((state) => state.loadBatches)
  const records = useRecheckStore((state) => state.records)
  const recordError = useRecheckStore((state) => state.error)
  const loadRecords = useRecheckStore((state) => state.loadRecords)
  const [expanded, setExpanded] = useState<string | false>(false)

  useEffect(() => {
    void loadBatches()
    void loadRecords()
  }, [loadBatches, loadRecords])

  const successCount = useMemo(() => batches.filter((batch) => batch.status === 'success').length, [batches])
  const failedCount = batches.length - successCount
  const passedCount = records.filter((record) => record.result === 'passed').length
  const failedRecheck = records.length - passedCount

  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h1" variant="h3" color="#344a34">维修重算与复检追溯</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
          每个批次完整保留工序重算前/后结果；失败批次只记录未保存的尝试，数据已回滚。导出 JSON/CSV 含同样内容。
        </Typography>
      </Box>

      {(batchError || recordError) && <Alert severity="warning">{batchError ?? recordError}</Alert>}

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <StatBadge label="成功重算批次" value={successCount} detail="已整体保存" tone="bamboo" />
        <StatBadge label="失败回滚批次" value={failedCount} detail="结果已恢复，留待重算标记" tone={failedCount ? 'warning' : 'neutral'} />
        <StatBadge label="复检通过" value={passedCount} detail="已恢复归档" tone={passedCount ? 'bamboo' : 'neutral'} />
        <StatBadge label="复检未通过" value={failedRecheck} detail="继续待复检" tone={failedRecheck ? 'warning' : 'neutral'} />
      </Box>

      <Typography variant="h5">重算批次（重算前后结果）</Typography>
      {batches.map((batch: RecalcBatch) => {
        const failed = batch.status === 'failed'
        return (
          <Accordion
            key={batch.batchId}
            expanded={expanded === batch.batchId}
            onChange={(_, isExpanded) => setExpanded(isExpanded ? batch.batchId : false)}
            disableGutters
            data-testid={`recalc-batch-${batch.batchId}`}
            sx={{ bgcolor: failed ? '#fdecec' : '#fffdf7' }}
          >
            <AccordionSummary>
              <Grid container spacing={1} alignItems="center">
                <Grid item xs={12} md={3}>
                  <Typography sx={{ fontWeight: 700 }}>{batch.batchId}</Typography>
                  <Typography variant="caption" color="text.secondary">{batch.createdAt.replace('T', ' ').slice(0, 19)}</Typography>
                </Grid>
                <Grid item xs={6} md={2}>{batch.mouldNo}</Grid>
                <Grid item xs={6} md={2}>{reasonLabel[batch.reason] ?? batch.reason} · {batch.triggeredBy}</Grid>
                <Grid item xs={6} md={2}>
                  <Chip size="small" color={failed ? 'error' : 'success'} label={failed ? '失败已回滚' : '成功保存'} />
                </Grid>
                <Grid item xs={6} md={3}>
                  <Typography variant="caption" color="text.secondary">
                    改变工序 {batch.changes.length} 槽 · 下架样本 {batch.affectedSampleIds.length} 个
                    {failed && batch.attemptedChanges ? ` · 尝试 ${batch.attemptedChanges.length} 槽（未保存）` : ''}
                  </Typography>
                </Grid>
              </Grid>
            </AccordionSummary>
            <AccordionDetails>
              {failed && (
                <Alert severity="error" sx={{ mb: 1 }}>失败原因：{batch.errorMessage ?? '未知'}。该批写入已整体回滚，纸帘已标记待重算。</Alert>
              )}
              <Typography variant="subtitle2">{failed ? '未保存的尝试明细' : '已保存的重算明细'}</Typography>
              <ChangeTable changes={failed ? (batch.attemptedChanges ?? []) : batch.changes} />
            </AccordionDetails>
          </Accordion>
        )
      })}
      {batches.length === 0 && <Alert severity="info">尚无重算批次。补录或修改纸帘维修后会自动生成。</Alert>}

      <Typography variant="h5" sx={{ mt: 2 }}>复检记录</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>时间</TableCell>
            <TableCell>样本</TableCell>
            <TableCell>工序</TableCell>
            <TableCell align="right">帘纹条数</TableCell>
            <TableCell>匀度</TableCell>
            <TableCell>当时偏差</TableCell>
            <TableCell>结果</TableCell>
            <TableCell>复检人/备注</TableCell>
            <TableCell>批次</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id} data-testid="recheck-record-row">
              <TableCell>{record.reviewedAt.replace('T', ' ').slice(0, 16)}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{record.sampleNo}</TableCell>
              <TableCell>{record.runId}</TableCell>
              <TableCell align="right">{record.stripeCount}</TableCell>
              <TableCell>{record.evenness}</TableCell>
              <TableCell>{devText(record.deviation)}</TableCell>
              <TableCell><Chip size="small" color={record.result === 'passed' ? 'success' : 'warning'} label={record.result === 'passed' ? '通过·恢复归档' : '未通过·继续待复检'} /></TableCell>
              <TableCell>{record.reviewer}{record.note ? ` · ${record.note}` : ''}</TableCell>
              <TableCell>{record.batchId ?? '—'}</TableCell>
            </TableRow>
          ))}
          {records.length === 0 && (
            <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4 }}>尚无复检记录。</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Stack>
  )
}
