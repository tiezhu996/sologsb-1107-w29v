import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { GrainStripePreview } from '../components/common/GrainStripePreview'
import { RulerInput } from '../components/common/RulerInput'
import { StatBadge } from '../components/common/StatBadge'
import { useUnitConvert } from '../hooks/useUnitConvert'
import { useMouldStore } from '../stores/mouldStore'
import { useRunStore } from '../stores/runStore'
import { useSampleStore } from '../stores/sampleStore'
import { subscribeSync } from '../stores/syncBus'
import type { EvennessLevel, PaperSample, PaperSampleInput } from '../types/paper-sample'
import { EVENNESS_LEVELS } from '../types/paper-sample'
import type { SampleReview } from '../types/sample-review'
import { buildSampleConclusion, isGapOutOfTolerance } from '../utils/stripe'
import { describeSampleStatus, formatNullableMm } from '../utils/status-view'

const emptySampleForm: PaperSampleInput = {
  sampleNo: '',
  runId: 1,
  sizeMm: 210,
  stripeCount: 45,
  evenness: '均匀',
  archiveBin: '待归档-01',
}

function stripeTier(count: number): { label: string; color: 'success' | 'info' | 'warning' } {
  if (count >= 50) return { label: '密纹档', color: 'success' }
  if (count >= 40) return { label: '中密档', color: 'info' }
  return { label: '疏纹档', color: 'warning' }
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 16).replace('T', ' ')
}

export default function SampleCards() {
  const samples = useSampleStore((state) => state.paperSamples)
  const reviews = useSampleStore((state) => state.reviews)
  const error = useSampleStore((state) => state.error)
  const loadSamples = useSampleStore((state) => state.loadSamples)
  const reloadSamples = useSampleStore((state) => state.reload)
  const addSample = useSampleStore((state) => state.addSample)
  const reviewSample = useSampleStore((state) => state.reviewSample)
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const reloadRuns = useRunStore((state) => state.reload)
  const moulds = useMouldStore((state) => state.moulds)
  const versions = useMouldStore((state) => state.versions)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const reloadMoulds = useMouldStore((state) => state.reload)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<PaperSampleInput>(emptySampleForm)
  const [evennessFilter, setEvennessFilter] = useState<EvennessLevel | '全部'>('全部')
  const [stripeFloor, setStripeFloor] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<PaperSample | null>(null)
  const [reviewer, setReviewer] = useState('罗青禾')
  const [reviewBusy, setReviewBusy] = useState(false)
  const { mmToCm, formatGrammage } = useUnitConvert()

  useEffect(() => {
    void loadSamples()
    void loadRuns()
    void loadMoulds()
    const unsubscribe = subscribeSync((topics) => {
      if (topics.includes('samples')) void reloadSamples()
      if (topics.includes('runs')) void reloadRuns()
      if (topics.includes('moulds')) void reloadMoulds()
    })
    return unsubscribe
  }, [loadMoulds, loadRuns, loadSamples, reloadMoulds, reloadRuns, reloadSamples])

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
  const versionById = useMemo(() => new Map(versions.map((version) => [version.id, version])), [versions])
  const mouldById = useMemo(() => new Map(moulds.map((mould) => [mould.id, mould])), [moulds])
  const reviewsBySample = useMemo(() => {
    const map = new Map<number, SampleReview[]>()
    for (const review of reviews) {
      const list = map.get(review.sampleId) ?? []
      list.push(review)
      map.set(review.sampleId, list)
    }
    return map
  }, [reviews])
  const filteredSamples = useMemo(
    () => samples.filter((sample) => (evennessFilter === '全部' || sample.evenness === evennessFilter) && sample.stripeCount >= stripeFloor),
    [evennessFilter, samples, stripeFloor],
  )
  const denseCount = samples.filter((sample) => sample.stripeCount >= 50).length
  const pendingCount = samples.filter((sample) => sample.reviewStatus === 'pending').length
  const failedCount = samples.filter((sample) => sample.reviewStatus === 'failed').length

  const updateForm = <K extends keyof PaperSampleInput,>(key: K, value: PaperSampleInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!form.sampleNo.trim() || !form.archiveBin.trim() || form.sizeMm <= 0 || form.stripeCount <= 0) return
    setSubmitting(true)
    const created = await addSample({ ...form, sampleNo: form.sampleNo.trim(), archiveBin: form.archiveBin.trim() })
    setSubmitting(false)
    if (created) {
      setForm(emptySampleForm)
      setShowForm(false)
    }
  }

  const handleReview = async (kind: 'pass' | 'fail') => {
    if (reviewTarget?.id === undefined) return
    setReviewBusy(true)
    const outcome = await reviewSample(reviewTarget.id, kind, reviewer)
    setReviewBusy(false)
    if (outcome.status === 'archived' || kind === 'fail') setReviewTarget(null)
  }

  const errorMessage = error ?? runError ?? mouldError
  const reviewRun = reviewTarget ? runById.get(reviewTarget.runId) : undefined
  const reviewConclusion = reviewTarget ? buildSampleConclusion(reviewTarget, reviewRun?.deviation ?? null) : ''

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">成纸样本与透光检验卡</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>维修重算后已归档样本保留原位与历史结论、标记待复检；复检未通过前不得恢复归档。</Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => setShowForm((current) => !current)} data-testid="new-sample">
          {showForm ? '收起登记' : '新建样本'}
        </Button>
      </Box>

      {errorMessage && <Alert severity="warning">{errorMessage}</Alert>}

      {showForm && (
        <Card data-testid="form-sample" sx={{ borderColor: '#9eb096' }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h5" sx={{ mb: 2 }}>登记成纸样本（先入待复检，通过后归档）</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}><TextField fullWidth label="样本编号" value={form.sampleNo} onChange={(event) => updateForm('sampleNo', event.target.value)} inputProps={{ 'data-testid': 'field-sampleNo' }} /></Grid>
              <Grid item xs={12} md={4}>
                <TextField select fullWidth label="对应工序" value={form.runId} onChange={(event) => updateForm('runId', Number(event.target.value))} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-runId' } }}>
                  {!runs.some((run) => run.id === form.runId) && <option value={form.runId}>工序数据载入中</option>}
                  {runs.map((run) => <option key={run.id} value={run.id}>{run.runNo} · {run.runDate}{run.deviation === null ? ' · 工序待补录' : ''}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="样本尺寸" value={form.sizeMm} onChange={(event) => updateForm('sizeMm', Number(event.target.value))} inputProps={{ min: 20, max: 1000, step: 1, 'data-testid': 'field-sizeMm' }} InputProps={{ endAdornment: 'mm' }} /></Grid>
              <Grid item xs={6} md={3}><TextField fullWidth type="number" label="帘纹条数" value={form.stripeCount} onChange={(event) => updateForm('stripeCount', Number(event.target.value))} inputProps={{ min: 1, max: 300, step: 1, 'data-testid': 'field-stripeCount' }} /></Grid>
              <Grid item xs={6} md={3}>
                <TextField select fullWidth label="匀度" value={form.evenness} onChange={(event) => updateForm('evenness', event.target.value as EvennessLevel)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-evenness' } }}>
                  {EVENNESS_LEVELS.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={5}><TextField fullWidth label="拟归档位置（复检通过前保留不入库）" value={form.archiveBin} onChange={(event) => updateForm('archiveBin', event.target.value)} inputProps={{ 'data-testid': 'field-archiveBin' }} /></Grid>
            </Grid>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 2.5 }}>
              <Button onClick={() => setShowForm(false)}>取消</Button>
              <Button variant="contained" onClick={handleSubmit} disabled={submitting} data-testid="submit-sample">保存样本</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <StatBadge label="样本总数" value={samples.length} detail="档案柜入库数量" />
        <StatBadge label="密纹样本" value={denseCount} detail="帘纹条数不少于 50" tone="bamboo" />
        <StatBadge label="待复检" value={pendingCount} detail="含重算后被标记的归档样本" tone={pendingCount ? 'warning' : 'neutral'} />
        <StatBadge label="复检未通过" value={failedCount} detail="未通过前不得恢复归档" tone={failedCount ? 'warning' : 'neutral'} />
      </Box>

      <Card>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={5} md={3}>
              <TextField select fullWidth size="small" label="匀度筛选" value={evennessFilter} onChange={(event) => setEvennessFilter(event.target.value as EvennessLevel | '全部')} SelectProps={{ native: true }}>
                <option value="全部">全部匀度</option>
                {EVENNESS_LEVELS.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={7} md={4}>
              <RulerInput label="最低帘纹条数" value={stripeFloor} onChange={(value) => setStripeFloor(value ?? 0)} unit="条" min={0} max={300} step={1} compact />
            </Grid>
            <Grid item xs={6} md={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Typography variant="body2" color="text.secondary">当前记录</Typography><Typography variant="h5" data-testid="count-sample">{filteredSamples.length}</Typography></Box>
            </Grid>
            <Grid item xs={6} md={3}><Button fullWidth variant="outlined" onClick={() => { setEvennessFilter('全部'); setStripeFloor(0) }}>重置分档</Button></Grid>
          </Grid>
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
        {filteredSamples.map((sample) => {
          const run = runById.get(sample.runId)
          const version = run && run.versionId !== null ? versionById.get(run.versionId) : undefined
          const mould = run ? mouldById.get(run.mouldId) : undefined
          const tier = stripeTier(sample.stripeCount)
          const gap = run?.measuredGap ?? version?.stripeGap ?? mould?.stripeGap ?? 1
          const wire = version?.wireDiameter ?? mould?.wireDiameter ?? 0.25
          const afterDeviation = run?.deviation ?? null
          const status = describeSampleStatus(sample.reviewStatus)
          const sampleReviews = reviewsBySample.get(sample.id ?? -1) ?? []
          const deviationExceeded = run ? isGapOutOfTolerance(run.deviation) : false
          const cardBg = sample.reviewStatus === 'archived' ? '#fffdf7' : sample.reviewStatus === 'failed' ? '#fdecea' : '#fff9e8'
          return (
            <Card key={sample.id ?? sample.sampleNo} data-testid="row-sample" sx={{ bgcolor: cardBg }}>
              <CardContent sx={{ p: 2.25 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'flex-start', mb: 1.5 }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{sample.sampleNo}</Typography>
                    <Typography variant="caption" color="text.secondary">工序 {run?.runNo ?? '待关联'} · {run?.runDate ?? '日期待补'}{run?.versionNo !== null && run?.versionNo !== undefined ? ` · v${run.versionNo}` : ''}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
                    <Chip size="small" color={tier.color} label={tier.label} />
                    <Chip size="small" color={status.chipColor} label={status.label} data-testid={`sample-status-${sample.id}`} />
                  </Box>
                </Box>
                <GrainStripePreview
                  gap={gap ?? 1}
                  wireDiameter={wire ?? 0.25}
                  density={version?.meshDensity ?? mould?.meshDensity ?? undefined}
                  stripeCount={sample.stripeCount}
                  direction={run?.stripeDirection === '横帘纹' ? 'horizontal' : 'vertical'}
                />
                <Grid container spacing={1} sx={{ mt: 1 }}>
                  <Grid item xs={6}><Typography variant="caption" color="text.secondary">帘纹条数</Typography><Typography sx={{ fontWeight: 700 }}>{sample.stripeCount} 条</Typography></Grid>
                  <Grid item xs={6}><Typography variant="caption" color="text.secondary">匀度</Typography><Typography sx={{ fontWeight: 700, color: sample.evenness === '均匀' ? 'success.dark' : 'warning.dark' }}>{sample.evenness}</Typography></Grid>
                  <Grid item xs={6}><Typography variant="caption" color="text.secondary">样本尺寸</Typography><Typography>{sample.sizeMm} mm · {mmToCm(sample.sizeMm)} cm</Typography></Grid>
                  <Grid item xs={6}><Typography variant="caption" color="text.secondary">纸页克重</Typography><Typography>{run ? formatGrammage(run.grammage) : '待补'}</Typography></Grid>
                </Grid>
                <Box sx={{ mt: 1.25, p: 1.25, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,.55)', border: '1px dashed #d8c9a8' }}>
                  <Typography variant="caption" color="text.secondary" display="block">原归档位置（待复检期间保留）</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{sample.archiveBin}</Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    历史结论：{sample.historyConclusion}
                    {sample.lastReviewedAt && ` · ${formatTime(sample.lastReviewedAt)}`}
                  </Typography>
                  {sample.historyDeviation !== null && (
                    <Chip size="small" sx={{ mt: 0.75 }} color={isGapOutOfTolerance(sample.historyDeviation) ? 'warning' : 'default'} variant="outlined" label={`归档时偏差 ${sample.historyDeviation > 0 ? '+' : ''}${sample.historyDeviation.toFixed(2)} mm`} />
                  )}
                  {afterDeviation !== null && afterDeviation !== sample.historyDeviation && (
                    <Chip size="small" sx={{ mt: 0.75, ml: 0.5 }} color={deviationExceeded ? 'error' : 'success'} label={`重算后 ${afterDeviation > 0 ? '+' : ''}${afterDeviation.toFixed(2)} mm`} />
                  )}
                </Box>
                {sampleReviews.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    {sampleReviews.slice(0, 2).map((review) => (
                      <Typography key={review.id} variant="caption" color="text.secondary" display="block" data-testid={`review-${sample.id}-${review.id}`}>
                        · {formatTime(review.createdAt)} {review.kind === 'flagged' ? '标记待复检' : review.kind === 'pass' ? '复检通过' : '复检未通过'}：{review.reason}
                      </Typography>
                    ))}
                  </Box>
                )}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', mt: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {run?.deviation === null ? '工序偏差待补录，不能判合格' : ''}
                  </Typography>
                  {sample.reviewStatus !== 'archived' && (
                    <Button size="small" variant="contained" color="warning" onClick={() => setReviewTarget(sample)} data-testid={`review-open-${sample.id}`}>
                      执行复检
                    </Button>
                  )}
                </Box>
              </CardContent>
            </Card>
          )
        })}
        {filteredSamples.length === 0 && (
          <Card sx={{ gridColumn: '1 / -1' }}><CardContent sx={{ textAlign: 'center', py: 7 }}><Typography color="text.secondary">没有符合当前匀度与帘纹条数分档的样本</Typography></CardContent></Card>
        )}
      </Box>

      <Dialog open={reviewTarget !== null} onClose={() => setReviewTarget(null)} maxWidth="sm" fullWidth data-testid="review-dialog">
        <DialogTitle>样本复检 · {reviewTarget?.sampleNo}</DialogTitle>
        <DialogContent>
          {reviewTarget && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                原归档位置 <b>{reviewTarget.archiveBin}</b> 在复检期间保留；仅当匀度“均匀”且帘纹偏差在 ±0.2 mm 内才能通过并恢复归档。
              </Typography>
              <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: '#faf6ec' }}>
                <Typography variant="body2">匀度：{reviewTarget.evenness}</Typography>
                <Typography variant="body2">
                  当前工序偏差：{formatNullableMm(reviewRun?.deviation ?? null)}
                  {reviewRun?.versionNo !== null && reviewRun?.versionNo !== undefined ? `（采用 v${reviewRun.versionNo}）` : ''}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700 }}>本次判定：{reviewConclusion}</Typography>
              </Box>
              <TextField fullWidth size="small" label="复检人" value={reviewer} onChange={(event) => setReviewer(event.target.value)} inputProps={{ 'data-testid': 'review-reviewer' }} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewTarget(null)}>取消</Button>
          <Button color="error" variant="outlined" disabled={reviewBusy} onClick={() => void handleReview('fail')} data-testid="review-fail">复检不通过</Button>
          <Button color="success" variant="contained" disabled={reviewBusy} onClick={() => void handleReview('pass')} data-testid="review-pass">复检通过并归档</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
