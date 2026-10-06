import { useEffect, useMemo } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Grid, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { ProcessTimeline, type ProcessStep } from '../components/common/ProcessTimeline'
import { StatBadge } from '../components/common/StatBadge'
import { useMouldFilter } from '../hooks/useMouldFilter'
import { useFiberStore } from '../stores/fiberStore'
import { useMouldStore } from '../stores/mouldStore'
import { useRecalcStore } from '../stores/recalcStore'
import { useRunStore } from '../stores/runStore'
import { useSampleStore } from '../stores/sampleStore'
import { subscribeSync } from '../stores/syncBus'
import { isGapOutOfTolerance } from '../utils/stripe'
import { formatNullableMm } from '../utils/status-view'

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
  { label: '帘槽抄纸', detail: '按工序日期匹配纸帘版本控制帘纹。', status: 'active' },
  { label: '压榨干燥', detail: '火墙或日晒定形，记录克重与叠高。', status: 'pending' },
  { label: '透光复检', detail: '核对匀度、帘纹条数与历史偏差。', status: 'pending' },
]

export default function Dashboard() {
  const moulds = useMouldStore((state) => state.moulds)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const reloadMoulds = useMouldStore((state) => state.reload)
  const batches = useFiberStore((state) => state.fiberBatches)
  const batchError = useFiberStore((state) => state.error)
  const loadBatches = useFiberStore((state) => state.loadFiberBatches)
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const reloadRuns = useRunStore((state) => state.reload)
  const samples = useSampleStore((state) => state.paperSamples)
  const sampleError = useSampleStore((state) => state.error)
  const loadSamples = useSampleStore((state) => state.loadSamples)
  const reloadSamples = useSampleStore((state) => state.reload)
  const jobs = useRecalcStore((state) => state.jobs)
  const notice = useRecalcStore((state) => state.notice)
  const isRecalculating = useRecalcStore((state) => state.isRecalculating)
  const loadJobs = useRecalcStore((state) => state.loadJobs)
  const retryPending = useRecalcStore((state) => state.retryPending)
  const recalcAll = useRecalcStore((state) => state.recalcAll)

  useEffect(() => {
    void loadMoulds()
    void loadBatches()
    void loadRuns()
    void loadSamples()
    void loadJobs()
    const unsubscribe = subscribeSync((topics) => {
      if (topics.includes('moulds')) void reloadMoulds()
      if (topics.includes('runs')) void reloadRuns()
      if (topics.includes('samples')) void reloadSamples()
      void loadJobs()
    })
    return unsubscribe
  }, [loadBatches, loadJobs, loadMoulds, loadRuns, loadSamples, reloadMoulds, reloadRuns, reloadSamples])

  const { filteredMoulds: activeMoulds } = useMouldFilter(moulds, '', '在用')
  const currentWeekRuns = useMemo(() => runs.filter((run) => isInCurrentWeek(run.runDate)), [runs])
  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
  const pendingSamples = useMemo(
    () => samples.filter((sample) => sample.reviewStatus === 'pending' || sample.reviewStatus === 'failed'),
    [samples],
  )
  const pendingJobs = useMemo(() => jobs.filter((job) => job.status === 'pending'), [jobs])
  const missingParamRuns = useMemo(() => runs.filter((run) => run.paramStatus === 'missing-param'), [runs])
  const activeRate = moulds.length ? Math.round((activeMoulds.length / moulds.length) * 100) : 0
  const error = mouldError ?? batchError ?? runError ?? sampleError

  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h1" variant="h3" color="#344a34">
          工作台
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
          汇总纸帘版本、本周工序与待复检样本；偏差按工序日期对应的历史版本追算。
        </Typography>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}
      {notice && <Alert severity={notice.includes('失败') ? 'error' : 'success'}>{notice}</Alert>}
      {pendingJobs.length > 0 && (
        <Alert
          severity="error"
          data-testid="pending-recalc-banner"
          action={<Button color="inherit" size="small" disabled={isRecalculating} onClick={() => void retryPending()} data-testid="retry-recalc">{isRecalculating ? '重算中…' : '立即重算'}</Button>}
        >
          有 {pendingJobs.length} 条批量重算保存失败，已恢复上次结果并挂起待重算标记；处理前台面不显示半批结果。
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <StatBadge label="在册纸帘" value={moulds.length} detail={`在用 ${activeMoulds.length} 张`} />
        <StatBadge label="纤维料批" value={batches.length} detail="覆盖四类造纸纤维" tone="bamboo" />
        <StatBadge label="本周工序" value={currentWeekRuns.length} detail="按自然周统计" tone="bamboo" />
        <StatBadge label="待复检样本" value={pendingSamples.length} detail="复检未通过前不得归档" tone={pendingSamples.length ? 'warning' : 'neutral'} />
        <StatBadge label="待补录工序" value={missingParamRuns.length} detail="缺参数不算合格" tone={missingParamRuns.length ? 'warning' : 'neutral'} />
      </Box>

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={7}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: { xs: 2, md: 3 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2.5 }}>
                <Box>
                  <Typography variant="h5">纸帘配比与使用状态</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    在用率 {activeRate}%，当前间距取最近生效的维修版本。
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Chip label={`${activeMoulds.length}/${moulds.length} 在用`} color="success" variant="outlined" />
                  <Button size="small" variant="outlined" disabled={isRecalculating} onClick={() => void recalcAll()} data-testid="recalc-all">
                    {isRecalculating ? '重算中…' : '全量重算'}
                  </Button>
                </Box>
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
                  <Chip key={mould.id ?? mould.mouldNo} label={`${mould.mouldNo} · ${mould.wireMaterial} · ${mould.meshDensity !== null ? `${mould.meshDensity} 根/cm` : '参数待补录'}`} variant="outlined" />
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h5" sx={{ mb: 2 }}>标准工序路径</Typography>
              <ProcessTimeline steps={processSteps} compact />
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
                匀度不达“均匀”、帘纹超差，或维修重算后偏差发生变化的已归档样本；原归档位置与历史结论保留。
              </Typography>
            </Box>
            <Chip label={`${pendingSamples.length} 条提醒`} color={pendingSamples.length ? 'warning' : 'success'} />
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 780 }}>
              <TableHead>
                <TableRow>
                  <TableCell>样本号</TableCell>
                  <TableCell>对应工序</TableCell>
                  <TableCell>匀度</TableCell>
                  <TableCell align="right">帘纹条数</TableCell>
                  <TableCell>帘纹偏差</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>原存档位</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pendingSamples.map((sample) => {
                  const run = runById.get(sample.runId)
                  const deviation = run?.deviation ?? null
                  const deviationBefore = run?.deviationBefore ?? null
                  return (
                    <TableRow key={sample.id ?? sample.sampleNo} sx={{ bgcolor: sample.reviewStatus === 'failed' ? '#fdecea' : '#fff8df' }} data-testid="pending-sample-row">
                      <TableCell sx={{ fontWeight: 700 }}>{sample.sampleNo}</TableCell>
                      <TableCell>{run?.runNo ?? '工序待关联'}{run?.versionNo !== null && run?.versionNo !== undefined ? ` · v${run.versionNo}` : ''}</TableCell>
                      <TableCell>{sample.evenness}</TableCell>
                      <TableCell align="right">{sample.stripeCount}</TableCell>
                      <TableCell>
                        {deviation === null
                          ? <Chip size="small" color="info" label="待补录" />
                          : <Chip size="small" color={isGapOutOfTolerance(deviation) ? 'warning' : 'default'} label={`${deviation > 0 ? '+' : ''}${deviation.toFixed(2)} mm`} />}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" color={sample.reviewStatus === 'failed' ? 'error' : 'warning'} label={sample.reviewStatus === 'failed' ? '复检未通过' : '待复检'} />
                        {deviationBefore !== null && (
                          <Typography variant="caption" color="text.secondary" display="block">重算前 {formatNullableMm(deviationBefore)}</Typography>
                        )}
                      </TableCell>
                      <TableCell>{sample.archiveBin}</TableCell>
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
