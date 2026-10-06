import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { ProcessTimeline, type ProcessStep } from '../components/common/ProcessTimeline'
import { RulerInput } from '../components/common/RulerInput'
import { useUnitConvert } from '../hooks/useUnitConvert'
import { useFiberStore } from '../stores/fiberStore'
import { useMouldStore } from '../stores/mouldStore'
import { useMouldVersionStore } from '../stores/mouldVersionStore'
import { useRunStore } from '../stores/runStore'
import { DRY_METHODS, STRIPE_DIRECTIONS, type DryMethod, type SheetRunInput, type StripeDirection } from '../types/sheet-run'
import { getGapConclusion } from '../utils/stripe'
import { findEffectiveVersion } from '../utils/mouldVersion'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const emptyRunForm: SheetRunInput = {
  runNo: '',
  mouldId: 1,
  batchId: 1,
  runDate: todayIso(),
  operator: '罗青禾',
  stripeDirection: '竖帘纹',
  dipCount: 2,
  stackHeight: 42,
  dryMethod: '火墙',
  grammage: 32,
  measuredGap: 1.1,
}

const processSteps: ProcessStep[] = [
  { label: '浆料复核', detail: '核对料批打浆度与漂洗状态。', status: 'done' },
  { label: '帘床就位', detail: '确认纸帘方向与框架张力。', status: 'done' },
  { label: '入槽抄纸', detail: '按设定次数完成荡料与提帘。', status: 'active' },
  { label: '压榨定形', detail: '控制叠高后转火墙或日晒。', status: 'pending' },
  { label: '量纹偏差', detail: '实测间距并与工序当日命中的纸帘版本比较。', status: 'pending' },
]

const PARAM_CHIP: Record<string, { color: 'success' | 'warning' | 'info'; label: string }> = {
  qualified: { color: 'success', label: '合格' },
  exceeded: { color: 'warning', label: '超差' },
  pendingData: { color: 'info', label: '待补录' },
}

function formatDev(value: number | null): string {
  if (value === null) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} mm`
}

export default function RunBoard() {
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const addRun = useRunStore((state) => state.addRun)
  const updateMeasuredGap = useRunStore((state) => state.updateMeasuredGap)
  const moulds = useMouldStore((state) => state.moulds)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const versions = useMouldVersionStore((state) => state.versions)
  const loadVersions = useMouldVersionStore((state) => state.loadVersions)
  const batches = useFiberStore((state) => state.fiberBatches)
  const batchError = useFiberStore((state) => state.error)
  const loadBatches = useFiberStore((state) => state.loadFiberBatches)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<SheetRunInput>(emptyRunForm)
  const [dateFilter, setDateFilter] = useState('')
  const [mouldFilter, setMouldFilter] = useState('全部')
  const [draftGaps, setDraftGaps] = useState<Record<number, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const { formatGrammage, cmToMm } = useUnitConvert()

  useEffect(() => {
    void loadRuns()
    void loadMoulds()
    void loadVersions()
    void loadBatches()
  }, [loadBatches, loadMoulds, loadRuns, loadVersions])

  const mouldById = useMemo(() => new Map(moulds.map((mould) => [mould.id, mould])), [moulds])
  const versionById = useMemo(() => new Map(versions.map((version) => [version.id, version])), [versions])
  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches])
  const filteredRuns = useMemo(
    () => runs.filter((run) => {
      const mould = mouldById.get(run.mouldId)
      const matchesDate = !dateFilter || run.runDate === dateFilter
      const matchesMould = mouldFilter === '全部' || mould?.mouldNo === mouldFilter
      return matchesDate && matchesMould
    }),
    [dateFilter, mouldById, mouldFilter, runs],
  )

  // 表单预览：严格按所选工序日期匹配当天以前最近一版，绝不取当前值
  const formVersion = useMemo(
    () => findEffectiveVersion(versions, form.mouldId, form.runDate || '1970-01-01'),
    [versions, form.mouldId, form.runDate],
  )
  const formStandardGap = formVersion?.stripeGap ?? null
  const formDeviation = formStandardGap === null ? null : Number((form.measuredGap - formStandardGap).toFixed(2))
  const formStatus = formStandardGap === null ? 'pendingData' : Math.abs(formDeviation ?? 0) > 0.2 ? 'exceeded' : 'qualified'
  const latestRun = runs[0]

  const updateForm = <K extends keyof SheetRunInput,>(key: K, value: SheetRunInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleMouldOrDateChange = (patch: Partial<SheetRunInput>) => {
    setForm((current) => {
      const next = { ...current, ...patch }
      const effective = findEffectiveVersion(versions, next.mouldId, next.runDate || '1970-01-01')
      // 命中版本时把实测预置为该版标准间距，便于录入；无版本则保留原值并提示待补录
      if (effective) next.measuredGap = effective.stripeGap
      return next
    })
  }

  const handleSubmit = async () => {
    if (!form.runNo.trim() || !form.operator.trim() || form.measuredGap <= 0 || form.grammage <= 0) return
    setSubmitting(true)
    const created = await addRun({ ...form, runNo: form.runNo.trim(), operator: form.operator.trim() })
    setSubmitting(false)
    if (created) {
      setForm(emptyRunForm)
      setShowForm(false)
    }
  }

  const error = runError ?? mouldError ?? batchError
  const formChip = PARAM_CHIP[formStatus]

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">抄纸工序记录台</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>关联纸帘与料批，按工序日期匹配当天以前最近一版纸帘参数，行内复测帘纹偏差。</Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => setShowForm((current) => !current)} data-testid="new-run">
          {showForm ? '收起登记' : '新建工序'}
        </Button>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}

      {showForm && (
        <Card data-testid="form-run" sx={{ borderColor: '#9eb096' }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Typography variant="h5">登记抄纸工序</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip size="small" variant="outlined" label={formVersion ? `命中 v${formVersion.seq} · ${formVersion.versionDate}` : '无历史版本，待补录'} data-testid="form-matched-version" />
                <Chip size="small" color={formChip.color} label={formDeviation === null ? '待补录（缺失参数）' : `偏差 ${formatDev(formDeviation)}`} />
              </Stack>
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}><TextField fullWidth label="工序编号" value={form.runNo} onChange={(event) => updateForm('runNo', event.target.value)} inputProps={{ 'data-testid': 'field-runNo' }} /></Grid>
              <Grid item xs={6} md={2.5}>
                <TextField select fullWidth label="纸帘" value={form.mouldId} onChange={(event) => handleMouldOrDateChange({ mouldId: Number(event.target.value) })} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-mouldId' } }}>
                  {!moulds.some((mould) => mould.id === form.mouldId) && <option value={form.mouldId}>纸帘数据载入中</option>}
                  {moulds.filter((mould) => mould.state !== '退役').map((mould) => <option key={mould.id} value={mould.id}>{mould.mouldNo} · 当前 {mould.stripeGap} mm</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2.5}>
                <TextField select fullWidth label="纤维料批" value={form.batchId} onChange={(event) => updateForm('batchId', Number(event.target.value))} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-batchId' } }}>
                  {!batches.some((batch) => batch.id === form.batchId) && <option value={form.batchId}>料批数据载入中</option>}
                  {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batchNo} · {batch.material}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={2}><TextField fullWidth type="date" label="抄纸日期" value={form.runDate} onChange={(event) => handleMouldOrDateChange({ runDate: event.target.value })} InputLabelProps={{ shrink: true }} inputProps={{ 'data-testid': 'field-runDate' }} /></Grid>
              <Grid item xs={12} md={2}><TextField fullWidth label="操作人" value={form.operator} onChange={(event) => updateForm('operator', event.target.value)} inputProps={{ 'data-testid': 'field-operator' }} /></Grid>
              <Grid item xs={6} md={2}>
                <TextField select fullWidth label="帘纹方向" value={form.stripeDirection} onChange={(event) => updateForm('stripeDirection', event.target.value as StripeDirection)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-stripeDirection' } }}>
                  {STRIPE_DIRECTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="荡料次数" value={form.dipCount} onChange={(event) => updateForm('dipCount', Number(event.target.value))} inputProps={{ min: 1, max: 8, step: 1, 'data-testid': 'field-dipCount' }} /></Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="叠高" value={form.stackHeight} onChange={(event) => updateForm('stackHeight', Number(event.target.value))} inputProps={{ min: 10, max: 120, step: 1, 'data-testid': 'field-stackHeight' }} /></Grid>
              <Grid item xs={6} md={2}>
                <TextField select fullWidth label="干燥方式" value={form.dryMethod} onChange={(event) => updateForm('dryMethod', event.target.value as DryMethod)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-dryMethod' } }}>
                  {DRY_METHODS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="克重" value={form.grammage} onChange={(event) => updateForm('grammage', Number(event.target.value))} inputProps={{ min: 10, max: 200, step: 1, 'data-testid': 'field-grammage' }} InputProps={{ endAdornment: 'g/m²' }} /></Grid>
              <Grid item xs={12} md={4}>
                <RulerInput
                  label="实测帘纹间距"
                  value={form.measuredGap}
                  onChange={(value) => updateForm('measuredGap', value)}
                  min={0.1}
                  max={5}
                  step={0.01}
                  testId="field-measuredGap"
                  helperText={formStandardGap === null
                    ? <Typography component="span" variant="caption" color="info.main">该日期早于任何纸帘版本，参数待补录，不能算合格。允许偏差 ±0.2 mm</Typography>
                    : <Typography component="span" variant="caption" color={formStatus === 'exceeded' ? 'warning.dark' : 'text.secondary'}>{formStatus === 'exceeded' ? '超差：' : '合格：'}{getGapConclusion(formDeviation ?? 0)}（{formatDev(formDeviation)}，标准 {formStandardGap.toFixed(2)} mm）</Typography>}
                />
              </Grid>
            </Grid>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 2.5 }}>
              <Button onClick={() => setShowForm(false)}>取消</Button>
              <Button variant="contained" onClick={handleSubmit} disabled={submitting} data-testid="submit-run">保存工序</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>最近一槽的工序进程</Typography>
              {latestRun ? (
                <>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                    <Chip size="small" label={latestRun.runNo} />
                    <Chip size="small" variant="outlined" label={formatGrammage(latestRun.grammage)} />
                    <Chip size="small" color={PARAM_CHIP[latestRun.paramStatus].color} label={PARAM_CHIP[latestRun.paramStatus].label} />
                  </Box>
                  <ProcessTimeline steps={processSteps} compact />
                </>
              ) : (
                <Typography color="text.secondary">等待工序数据。</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={8}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
              <Grid container spacing={1.5} alignItems="center">
                <Grid item xs={12} sm={5} md={4}><TextField fullWidth size="small" type="date" label="按日期筛选" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} InputLabelProps={{ shrink: true }} /></Grid>
                <Grid item xs={8} sm={5} md={4}>
                  <TextField select fullWidth size="small" label="按帘号筛选" value={mouldFilter} onChange={(event) => setMouldFilter(event.target.value)} SelectProps={{ native: true }}>
                    <option value="全部">全部纸帘</option>
                    {moulds.map((mould) => <option key={mould.id} value={mould.mouldNo}>{mould.mouldNo}</option>)}
                  </TextField>
                </Grid>
                <Grid item xs={4} md={2}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">记录数</Typography>
                    <Typography variant="h5" data-testid="count-run">{filteredRuns.length}</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={2}><Button fullWidth variant="outlined" onClick={() => { setDateFilter(''); setMouldFilter('全部') }}>重置</Button></Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <TableContainer component={Card}>
        <Table sx={{ minWidth: 1180 }}>
          <TableHead>
            <TableRow>
              <TableCell>工序 / 日期</TableCell>
              <TableCell>纸帘与料批</TableCell>
              <TableCell>抄纸参数</TableCell>
              <TableCell align="right">克重</TableCell>
              <TableCell>命中版本与标准</TableCell>
              <TableCell>实测间距与偏差</TableCell>
              <TableCell align="right">保存实测</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredRuns.map((run) => {
              const mould = mouldById.get(run.mouldId)
              const batch = batchById.get(run.batchId)
              const matchedVersion = run.matchedVersionId !== null ? versionById.get(run.matchedVersionId) : undefined
              // 行内复测一律以该工序保存的历史标准值比对，缺失参数则待补录
              const standardGap = run.standardGap
              const draftGap = run.id === undefined ? run.measuredGap : draftGaps[run.id] ?? run.measuredGap
              const draftDeviation = standardGap === null ? null : Number((draftGap - standardGap).toFixed(2))
              const status = standardGap === null ? 'pendingData' : Math.abs(draftDeviation ?? 0) > 0.2 ? 'exceeded' : 'qualified'
              const chip = PARAM_CHIP[status]
              const rowBg = status === 'exceeded' ? '#fff7d9' : status === 'pendingData' ? '#eef4fb' : undefined
              return (
                <TableRow key={run.id ?? run.runNo} data-testid="row-run" hover sx={{ bgcolor: rowBg }}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 750 }}>{run.runNo}</Typography>
                    <Typography variant="caption" color="text.secondary">{run.runDate} · {run.operator}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{mould?.mouldNo ?? '未关联纸帘'}</Typography>
                    <Typography variant="caption" color="text.secondary">{batch?.batchNo ?? '未关联料批'} · {batch?.material ?? '待补'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{run.stripeDirection} · 荡料 {run.dipCount} 次</Typography>
                    <Typography variant="caption" color="text.secondary">叠高 {run.stackHeight} 张 · {run.dryMethod} · 帘框 {cmToMm(mould?.frameW ?? 0)} × {cmToMm(mould?.frameH ?? 0)} mm</Typography>
                  </TableCell>
                  <TableCell align="right">{run.grammage} g/m²</TableCell>
                  <TableCell>
                    {matchedVersion ? (
                      <>
                        <Chip size="small" variant="outlined" label={`v${matchedVersion.seq} · ${matchedVersion.versionDate}`} />
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.4 }}>
                          标准 {standardGap?.toFixed(2)} mm{matchedVersion.origin === '维修' ? ' · 维修版' : ' · 建帘版'}
                        </Typography>
                      </>
                    ) : (
                      <Chip size="small" color="info" variant="outlined" label="缺失参数 · 待补录" data-testid={`pending-run-${run.id}`} />
                    )}
                    {run.recalcBatchId && (
                      <Typography variant="caption" color="warning.dark" sx={{ display: 'block', mt: 0.3 }}>重算 {run.recalcBatchId}</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ minWidth: 270 }}>
                    <RulerInput
                      label="帘纹间距"
                      value={draftGap}
                      onChange={(value) => {
                        if (run.id !== undefined) setDraftGaps((current) => ({ ...current, [run.id as number]: value }))
                      }}
                      min={0.1}
                      max={5}
                      step={0.01}
                      disabled={standardGap === null}
                      testId={run.id === undefined ? undefined : `row-measuredGap-${run.id}`}
                      helperText={
                        <Typography component="span" variant="caption" color={status === 'exceeded' ? 'warning.dark' : status === 'pendingData' ? 'info.main' : 'text.secondary'}>
                          <Chip component="span" size="small" color={chip.color} label={chip.label} sx={{ mr: 0.75, height: 18 }} />
                          {status === 'pendingData'
                            ? '工序日期早于纸帘版本，补齐维修版本后自动重算'
                            : `${status === 'exceeded' ? '超差：' : '合格：'}${getGapConclusion(draftDeviation ?? 0)}（${formatDev(draftDeviation)}）`}
                        </Typography>
                      }
                      compact
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant={status === 'exceeded' ? 'contained' : 'outlined'}
                      color={status === 'exceeded' ? 'warning' : 'primary'}
                      disabled={run.id === undefined || standardGap === null || draftGap === run.measuredGap}
                      onClick={() => {
                        if (run.id !== undefined) void updateMeasuredGap(run.id, draftGap, standardGap, run.matchedVersionId)
                      }}
                    >
                      {draftGap === run.measuredGap ? '已记录' : '保存实测'}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
            {filteredRuns.length === 0 && (
              <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5 }}>没有符合日期与帘号条件的工序</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  )
}
