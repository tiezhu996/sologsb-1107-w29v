import { useEffect, useMemo } from 'react'
import { Alert, Box, Card, CardContent, Chip, Divider, Grid, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { ProcessTimeline, type ProcessStep } from '../components/common/ProcessTimeline'
import { StatBadge } from '../components/common/StatBadge'
import { useMouldFilter } from '../hooks/useMouldFilter'
import { useFiberStore } from '../stores/fiberStore'
import { useMouldStore } from '../stores/mouldStore'
import { useRecalcStore } from '../stores/recalcStore'
import { useRunStore } from '../stores/runStore'
import { useSampleStore } from '../stores/sampleStore'

function startOfCurrentWeek(): Date {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()
  const distance = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + distance)
  return date
}

function isInCurrentWeek(value: string): boolean {
  const start = startOfCurrentWeek()
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  const date = new Date(`${value}T00:00:00`)
  return date >= start && date < end
}

const processSteps: ProcessStep[] = [
  { label: '纤维蒸煮', detail: '石灰或纯碱处理，按料批记录时长。', status: 'done' },
  { label: '清浆打浆', detail: '校核打浆度，为抄纸提供稳定浆料。', status: 'done' },
  { label: '帘槽抄纸', detail: '按工序日期命中对应维修版本，控制帘纹方向与次数。', status: 'active' },
  { label: '压榨干燥', detail: '火墙或日晒定形，记录克重与叠高。', status: 'pending' },
  { label: '透光复检', detail: '重算下架样本复检通过后才恢复归档。', status: 'pending' },
]

function formatDev(value: number | null | undefined): string {
  if (value === null || value === undefined) return '待补录'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} mm`
}

export default function Dashboard() {
  const moulds = useMouldStore((state) => state.moulds)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const batches = useFiberStore((state) => state.fiberBatches)
  const batchError = useFiberStore((state) => state.error)
  const loadBatches = useFiberStore((state) => state.loadFiberBatches)
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const samples = useSampleStore((state) => state.paperSamples)
  const sampleError = useSampleStore((state) => state.error)
  const loadSamples = useSampleStore((state) => state.loadSamples)
  const recalcBatches = useRecalcStore((state) => state.batches)
  const recalcError = useRecalcStore((state) => state.error)
  const loadRecalcBatches = useRecalcStore((state) => state.loadBatches)

  useEffect(() => {
    void loadMoulds()
    void loadBatches()
    void loadRuns()
    void loadSamples()
    void loadRecalcBatches()
  }, [loadBatches, loadMoulds, loadRecalcBatches, loadRuns, loadSamples])

  const { filteredMoulds: activeMoulds } = useMouldFilter(moulds, '', '在用')
  const currentWeekRuns = useMemo(() => runs.filter((run) => isInCurrentWeek(run.runDate)), [runs])
  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
  // 待复检以样本复检状态为准（含重算下架与匀度/偏差不达标），且参数待补录的工序样本也算待处理
  const pendingSamples = useMemo(
    () => samples.filter((sample) => {
      if (sample.reviewStatus === 'pending') return true
      const run = runById.get(sample.runId)
      return run ? run.paramStatus === 'pendingData' : false
    }),
    [runById, samples],
  )
  const pendingDataRuns = useMemo(() => runs.filter((run) => run.paramStatus === 'pendingData'), [runs])
  const recalcPendingMoulds = useMemo(() => moulds.filter((mould) => mould.recalcPending), [moulds])
  const lastFailedBatch = recalcBatches.find((batch) => batch.status === 'failed')
  const activeRate = moulds.length ? Math.round((activeMoulds.length / moulds.length) * 100) : 0
  const error = mouldError ?? batchError ?? runError ?? sampleError ?? recalcError

  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h1" variant="h3" color="#344a34">
          工作台
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
          汇总纸帘状态、料批与本周工序，优先处理待重算纸帘、参数待补录工序和待复检样本。
        </Typography>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}
      {recalcPendingMoulds.length > 0 && (
        <Alert severity="error" data-testid="dashboard-recalc-alert">
          纸帘 {recalcPendingMoulds.map((mould) => mould.mouldNo).join('、')} 存在未完成的批量重算（上一批保存失败，结果已回滚恢复），请前往纸帘台帐“重试重算”，在此之前相关页面仍显示上次结果。
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <StatBadge label="在册纸帘" value={moulds.length} detail={`在用 ${activeMoulds.length} 张`} />
        <StatBadge label="纤维料批" value={batches.length} detail="覆盖四类造纸纤维" tone="bamboo" />
        <StatBadge label="本周工序" value={currentWeekRuns.length} detail="按自然周统计" tone="bamboo" />
        <StatBadge label="待复检样本" value={pendingSamples.length} detail="复检通过前不恢复归档" tone={pendingSamples.length ? 'warning' : 'neutral'} />
        <StatBadge label="待补录工序" value={pendingDataRuns.length} detail="日期早于纸帘版本，不算合格" tone={pendingDataRuns.length ? 'warning' : 'neutral'} />
        <StatBadge label="待重算纸帘" value={recalcPendingMoulds.length} detail="批次保存失败待重试" tone={recalcPendingMoulds.length ? 'warning' : 'neutral'} />
      </Box>

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={7}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: { xs: 2, md: 3 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2.5 }}>
                <Box>
                  <Typography variant="h5">纸帘配比与使用状态</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    在用率 {activeRate}%，竹丝帘适合常规书写纸，铜丝帘用于细密帘纹。
                  </Typography>
                </Box>
                <Chip label={`${activeMoulds.length}/${moulds.length} 在用`} color="success" variant="outlined" />
              </Box>
              <Stack spacing={2}>
                {['在用', '待修补', '退役'].map((status) => {
                  const count = moulds.filter((mould) => mould.state === status).length
                  const percentage = moulds.length ? (count / moulds.length) * 100 : 0
                  return (
                    <Box key={status}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 650 }}>{status}</Typography>
                        <Typography variant="body2" color="text.secondary">{count} 张</Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={percentage}
                        color={status === '在用' ? 'success' : status === '待修补' ? 'warning' : 'inherit'}
                        sx={{ height: 8, borderRadius: 5, bgcolor: '#e8e1d4' }}
                      />
                    </Box>
                  )
                })}
              </Stack>
              <Divider sx={{ my: 2.5 }} />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {activeMoulds.map((mould) => (
                  <Chip
                    key={mould.id ?? mould.mouldNo}
                    label={`${mould.mouldNo} · ${mould.wireMaterial} · ${mould.meshDensity} 根/cm${mould.recalcPending ? ' · 待重算' : ''}`}
                    color={mould.recalcPending ? 'error' : 'default'}
                    variant={mould.recalcPending ? 'filled' : 'outlined'}
                  />
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: { xs: 2, md: 3 } }}>
              <Typography variant="h5" sx={{ mb: 2 }}>标准工序路径</Typography>
              <ProcessTimeline steps={processSteps} compact />
              {lastFailedBatch && (
                <Box sx={{ mt: 2.5 }}>
                  <Divider sx={{ mb: 1.5 }} />
                  <Typography variant="subtitle2" color="error.main">最近一次失败重算</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {lastFailedBatch.batchId} · {lastFailedBatch.mouldNo} · {lastFailedBatch.errorMessage ?? '保存失败'}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 1.5 }}>
            <Box>
              <Typography variant="h5">待复检样本</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                维修重算后下架的样本先保留原归档位与历史结论；复检没通过前不得恢复归档。
              </Typography>
            </Box>
            <Chip label={`${pendingSamples.length} 条待复检`} color={pendingSamples.length ? 'warning' : 'success'} />
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 820 }}>
              <TableHead>
                <TableRow>
                  <TableCell>样本号</TableCell>
                  <TableCell>对应工序</TableCell>
                  <TableCell>匀度</TableCell>
                  <TableCell align="right">帘纹条数</TableCell>
                  <TableCell>当前偏差</TableCell>
                  <TableCell>原归档位</TableCell>
                  <TableCell>触发批次</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pendingSamples.map((sample) => {
                  const run = runById.get(sample.runId)
                  const deviation = run?.deviation ?? null
                  return (
                    <TableRow key={sample.id ?? sample.sampleNo} sx={{ bgcolor: '#fff8df' }}>
                      <TableCell sx={{ fontWeight: 700 }}>{sample.sampleNo}</TableCell>
                      <TableCell>{run?.runNo ?? '工序待关联'}</TableCell>
                      <TableCell>{sample.evenness}</TableCell>
                      <TableCell align="right">{sample.stripeCount}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={deviation === null ? 'info' : Math.abs(deviation) > 0.2 ? 'warning' : 'default'}
                          label={deviation === null ? '待补录' : formatDev(deviation)}
                        />
                      </TableCell>
                      <TableCell>{sample.archiveBin}（保留）</TableCell>
                      <TableCell>{sample.pendingBatchId ?? '—'}</TableCell>
                    </TableRow>
                  )
                })}
                {pendingSamples.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4 }}>当前没有待复检样本</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  )
}
