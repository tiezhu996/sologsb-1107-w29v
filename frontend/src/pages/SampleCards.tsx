import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, Stack, TextField, Typography } from '@mui/material'
import { GrainStripePreview } from '../components/common/GrainStripePreview'
import { RulerInput } from '../components/common/RulerInput'
import { StatBadge } from '../components/common/StatBadge'
import { RecheckDialog } from '../components/sample/RecheckDialog'
import { useUnitConvert } from '../hooks/useUnitConvert'
import { useMouldStore } from '../stores/mouldStore'
import { useRecheckStore } from '../stores/recheckStore'
import { useRunStore } from '../stores/runStore'
import { useSampleStore } from '../stores/sampleStore'
import type { PaperSample, PaperSampleInput } from '../types/paper-sample'
import { EVENNESS_LEVELS, type EvennessLevel } from '../types/paper-sample'

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

function formatDev(value: number | null | undefined): string {
  if (value === null || value === undefined) return '待补录'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} mm`
}

export default function SampleCards() {
  const samples = useSampleStore((state) => state.paperSamples)
  const error = useSampleStore((state) => state.error)
  const loadSamples = useSampleStore((state) => state.loadSamples)
  const addSample = useSampleStore((state) => state.addSample)
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const moulds = useMouldStore((state) => state.moulds)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const records = useRecheckStore((state) => state.records)
  const loadRecords = useRecheckStore((state) => state.loadRecords)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<PaperSampleInput>(emptySampleForm)
  const [evennessFilter, setEvennessFilter] = useState<EvennessLevel | '全部'>('全部')
  const [reviewFilter, setReviewFilter] = useState<'全部' | 'pending' | 'archived'>('全部')
  const [stripeFloor, setStripeFloor] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [recheckSample, setRecheckSample] = useState<PaperSample | null>(null)
  const { mmToCm, formatGrammage } = useUnitConvert()

  useEffect(() => {
    void loadSamples()
    void loadRuns()
    void loadMoulds()
    void loadRecords()
  }, [loadMoulds, loadRecords, loadRuns, loadSamples])

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
  const mouldById = useMemo(() => new Map(moulds.map((mould) => [mould.id, mould])), [moulds])
  const lastRecordBySample = useMemo(() => {
    const map = new Map<number, (typeof records)[number]>()
    for (const record of records) {
      if (!map.has(record.sampleId)) map.set(record.sampleId, record)
    }
    return map
  }, [records])
  const filteredSamples = useMemo(
    () => samples.filter((sample) => {
      const matchesEvenness = evennessFilter === '全部' || sample.evenness === evennessFilter
      const matchesReview = reviewFilter === '全部' || sample.reviewStatus === reviewFilter
      return matchesEvenness && matchesReview && sample.stripeCount >= stripeFloor
    }),
    [evennessFilter, reviewFilter, samples, stripeFloor],
  )
  const denseCount = samples.filter((sample) => sample.stripeCount >= 50).length
  const pendingCount = samples.filter((sample) => sample.reviewStatus === 'pending').length

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

  const errorMessage = error ?? runError ?? mouldError
  const recheckRun = recheckSample ? runById.get(recheckSample.runId) : undefined

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">成纸样本与透光检验卡</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>按匀度与帘纹条数分档；维修重算下架的样本保留原位与历史结论，复检通过前不恢复归档。</Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => setShowForm((current) => !current)} data-testid="new-sample">
          {showForm ? '收起登记' : '新建样本'}
        </Button>
      </Box>

      {errorMessage && <Alert severity="warning">{errorMessage}</Alert>}

      {showForm && (
        <Card data-testid="form-sample" sx={{ borderColor: '#9eb096' }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h5" sx={{ mb: 2 }}>登记成纸样本</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}><TextField fullWidth label="样本编号" value={form.sampleNo} onChange={(event) => updateForm('sampleNo', event.target.value)} inputProps={{ 'data-testid': 'field-sampleNo' }} /></Grid>
              <Grid item xs={12} md={4}>
                <TextField select fullWidth label="对应工序" value={form.runId} onChange={(event) => updateForm('runId', Number(event.target.value))} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-runId' } }}>
                  {!runs.some((run) => run.id === form.runId) && <option value={form.runId}>工序数据载入中</option>}
                  {runs.map((run) => <option key={run.id} value={run.id}>{run.runNo} · {run.runDate}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="样本尺寸" value={form.sizeMm} onChange={(event) => updateForm('sizeMm', Number(event.target.value))} inputProps={{ min: 20, max: 1000, step: 1, 'data-testid': 'field-sizeMm' }} InputProps={{ endAdornment: 'mm' }} /></Grid>
              <Grid item xs={6} md={3}><TextField fullWidth type="number" label="帘纹条数" value={form.stripeCount} onChange={(event) => updateForm('stripeCount', Number(event.target.value))} inputProps={{ min: 1, max: 300, step: 1, 'data-testid': 'field-stripeCount' }} /></Grid>
              <Grid item xs={6} md={3}>
                <TextField select fullWidth label="匀度" value={form.evenness} onChange={(event) => updateForm('evenness', event.target.value as EvennessLevel)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-evenness' } }}>
                  {EVENNESS_LEVELS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={5}><TextField fullWidth label="存档位" value={form.archiveBin} onChange={(event) => updateForm('archiveBin', event.target.value)} inputProps={{ 'data-testid': 'field-archiveBin' }} /></Grid>
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
        <StatBadge label="待复检" value={pendingCount} detail="重算下架或匀度不达标，未恢复归档" tone={pendingCount ? 'warning' : 'neutral'} />
      </Box>

      <Card>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4} md={3}>
              <TextField select fullWidth size="small" label="匀度筛选" value={evennessFilter} onChange={(event) => setEvennessFilter(event.target.value as EvennessLevel | '全部')} SelectProps={{ native: true }}>
                <option value="全部">全部匀度</option>
                {EVENNESS_LEVELS.map((option) => <option key={option} value={option}>{option}</option>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4} md={3}>
              <TextField select fullWidth size="small" label="复检状态" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as '全部' | 'pending' | 'archived')} SelectProps={{ native: true }} inputProps={{ 'data-testid': 'filter-reviewStatus' }}>
                <option value="全部">全部状态</option>
                <option value="pending">待复检</option>
                <option value="archived">已归档</option>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4} md={3}>
              <RulerInput label="最低帘纹条数" value={stripeFloor} onChange={setStripeFloor} unit="条" min={0} max={300} step={1} compact />
            </Grid>
            <Grid item xs={6} md={1.5}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Typography variant="body2" color="text.secondary">当前记录</Typography><Typography variant="h5" data-testid="count-sample">{filteredSamples.length}</Typography></Box>
            </Grid>
            <Grid item xs={6} md={1.5}><Button fullWidth variant="outlined" onClick={() => { setEvennessFilter('全部'); setReviewFilter('全部'); setStripeFloor(0) }}>重置</Button></Grid>
          </Grid>
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
        {filteredSamples.map((sample) => {
          const run = runById.get(sample.runId)
          const mould = run ? mouldById.get(run.mouldId) : undefined
          const tier = stripeTier(sample.stripeCount)
          const gap = run?.measuredGap ?? mould?.stripeGap ?? 1
          const pending = sample.reviewStatus === 'pending'
          const lastRecord = sample.id !== undefined ? lastRecordBySample.get(sample.id) : undefined
          return (
            <Card
              key={sample.id ?? sample.sampleNo}
              data-testid="row-sample"
              sx={{
                bgcolor: pending ? '#fff3cd' : '#fffdf7',
                border: pending ? '1px solid #d9a928' : undefined,
                position: 'relative',
              }}
            >
              <CardContent sx={{ p: 2.25 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'flex-start', mb: 1.5 }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{sample.sampleNo}</Typography>
                    <Typography variant="caption" color="text.secondary">工序 {run?.runNo ?? '待关联'} · {run?.runDate ?? '日期待补'}</Typography>
                  </Box>
                  <Stack spacing={0.5} alignItems="flex-end">
                    <Chip size="small" color={tier.color} label={tier.label} />
                    <Chip
                      size="small"
                      color={pending ? 'warning' : 'success'}
                      variant={pending ? 'filled' : 'outlined'}
                      label={pending ? '待复检' : '已归档'}
                      data-testid={`review-status-${sample.id}`}
                    />
                  </Stack>
                </Box>
                <GrainStripePreview
                  gap={gap}
                  wireDiameter={mould?.wireDiameter ?? 0.25}
                  density={mould?.meshDensity}
                  stripeCount={sample.stripeCount}
                  direction={run?.stripeDirection === '横帘纹' ? 'horizontal' : 'vertical'}
                />
                <Grid container spacing={1} sx={{ mt: 1 }}>
                  <Grid item xs={6}><Typography variant="caption" color="text.secondary">帘纹条数</Typography><Typography sx={{ fontWeight: 700 }}>{sample.stripeCount} 条</Typography></Grid>
                  <Grid item xs={6}><Typography variant="caption" color="text.secondary">匀度</Typography><Typography sx={{ fontWeight: 700, color: sample.evenness === '均匀' ? 'success.dark' : 'warning.dark' }}>{sample.evenness}</Typography></Grid>
                  <Grid item xs={6}><Typography variant="caption" color="text.secondary">样本尺寸</Typography><Typography>{sample.sizeMm} mm · {mmToCm(sample.sizeMm)} cm</Typography></Grid>
                  <Grid item xs={6}><Typography variant="caption" color="text.secondary">纸页克重</Typography><Typography>{run ? formatGrammage(run.grammage) : '待补'}</Typography></Grid>
                </Grid>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', mt: 1.5, flexWrap: 'wrap' }}>
                  <Chip size="small" variant="outlined" label={`原归档位 ${sample.archiveBin}${pending ? '（保留）' : ''}`} />
                  {run && run.deviation !== null && (
                    <Chip size="small" color={Math.abs(run.deviation) > 0.2 ? 'warning' : 'default'} label={`偏差 ${formatDev(run.deviation)}`} />
                  )}
                  {run && run.paramStatus === 'pendingData' && <Chip size="small" color="info" variant="outlined" label="参数待补录" />}
                </Box>
                {pending && sample.archivedConclusion && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    历史结论（冻结）：{sample.archivedConclusion}，归档时偏差 {formatDev(sample.archivedDeviation)}
                    {sample.pendingBatchId ? ` · 批次 ${sample.pendingBatchId}` : ''}
                  </Typography>
                )}
                {lastRecord && (
                  <Typography variant="caption" color={lastRecord.result === 'passed' ? 'success.dark' : 'warning.dark'} sx={{ display: 'block', mt: 0.5 }}>
                    最近复检：{lastRecord.result === 'passed' ? '通过' : '未通过'} · {lastRecord.reviewer} · {lastRecord.reviewedAt.slice(0, 10)}
                  </Typography>
                )}
                <Box sx={{ mt: 1.75, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    size="small"
                    variant={pending ? 'contained' : 'outlined'}
                    color={pending ? 'warning' : 'primary'}
                    disabled={sample.id === undefined}
                    onClick={() => setRecheckSample(sample)}
                    data-testid={`recheck-${sample.id}`}
                  >
                    {pending ? '执行复检' : '查看/复检'}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )
        })}
        {filteredSamples.length === 0 && (
          <Card sx={{ gridColumn: '1 / -1' }}><CardContent sx={{ textAlign: 'center', py: 7 }}><Typography color="text.secondary">没有符合当前匀度、复检状态与帘纹条数分档的样本</Typography></CardContent></Card>
        )}
      </Box>

      <RecheckDialog
        open={recheckSample !== null}
        sample={recheckSample}
        run={recheckRun}
        onClose={() => setRecheckSample(null)}
      />
    </Stack>
  )
}
