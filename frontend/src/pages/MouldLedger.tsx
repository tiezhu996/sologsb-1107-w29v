import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { GrainStripePreview } from '../components/common/GrainStripePreview'
import { RulerInput } from '../components/common/RulerInput'
import { MouldHistoryDialog } from '../components/mould/MouldHistoryDialog'
import { RepairDialog } from '../components/mould/RepairDialog'
import { useMouldFilter } from '../hooks/useMouldFilter'
import { useUnitConvert } from '../hooks/useUnitConvert'
import { useMouldStore } from '../stores/mouldStore'
import { useMouldVersionStore } from '../stores/mouldVersionStore'
import { useRunStore } from '../stores/runStore'
import { MOULD_STATES, WIRE_MATERIALS, type Mould, type MouldInput, type MouldStateValue, type WireMaterial } from '../types/mould'
import type { MouldVersion } from '../types/mould-version'
import { refreshAll } from '../utils/dataBus'
import { calculateMeshDensity } from '../utils/stripe'
import { retryRecalc } from '../utils/recalc'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface MouldFormState extends MouldInput {
  baselineDate: string
}

const emptyMouldForm: MouldFormState = {
  mouldNo: '',
  frameW: 60,
  frameH: 90,
  wireMaterial: '竹丝',
  wireDiameter: 0.3,
  stripeGap: 1.1,
  meshDensity: calculateMeshDensity(0.3, 1.1),
  weaver: '周守良',
  state: '在用',
  baselineDate: todayIso(),
}

export default function MouldLedger() {
  const moulds = useMouldStore((state) => state.moulds)
  const error = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const addMould = useMouldStore((state) => state.addMould)
  const setMouldState = useMouldStore((state) => state.setMouldState)
  const runs = useRunStore((state) => state.sheetRuns)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const versions = useMouldVersionStore((state) => state.versions)
  const loadVersions = useMouldVersionStore((state) => state.loadVersions)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<MouldFormState>(emptyMouldForm)
  const [submitting, setSubmitting] = useState(false)
  const [historyMould, setHistoryMould] = useState<Mould | null>(null)
  const [repairTarget, setRepairTarget] = useState<{ mould: Mould; edit: MouldVersion | null } | null>(null)
  const [retryingId, setRetryingId] = useState<number | null>(null)
  const { mmPitchToThreadsPerCm } = useUnitConvert()
  const {
    mouldNo,
    state: stateFilter,
    wireMaterial,
    filteredMoulds,
    setMouldNo,
    setState,
    setWireMaterial,
    resetFilters,
  } = useMouldFilter(moulds)

  useEffect(() => {
    void loadMoulds()
    void loadRuns()
    void loadVersions()
  }, [loadMoulds, loadRuns, loadVersions])

  const calculatedDensity = useMemo(
    () => calculateMeshDensity(form.wireDiameter, form.stripeGap),
    [form.stripeGap, form.wireDiameter],
  )

  const versionsByMould = useMemo(() => {
    const map = new Map<number, MouldVersion[]>()
    for (const version of versions) {
      const list = map.get(version.mouldId) ?? []
      list.push(version)
      map.set(version.mouldId, list)
    }
    return map
  }, [versions])

  const updateForm = <K extends keyof MouldFormState,>(key: K, value: MouldFormState[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      next.meshDensity = calculateMeshDensity(next.wireDiameter, next.stripeGap)
      return next
    })
  }

  const handleSubmit = async () => {
    if (!form.mouldNo.trim() || !form.weaver.trim() || !form.baselineDate || form.frameW <= 0 || form.frameH <= 0 || form.wireDiameter <= 0 || form.stripeGap <= 0) return
    setSubmitting(true)
    const { baselineDate, ...input } = { ...form, mouldNo: form.mouldNo.trim(), weaver: form.weaver.trim(), meshDensity: calculatedDensity }
    const created = await addMould(input, baselineDate)
    setSubmitting(false)
    if (created) {
      await refreshAll()
      setForm(emptyMouldForm)
      setShowForm(false)
    }
  }

  const handleRetry = async (mould: Mould) => {
    if (mould.id === undefined) return
    setRetryingId(mould.id)
    await retryRecalc(mould, mould.weaver)
    setRetryingId(null)
    await refreshAll()
  }

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">纸帘台帐</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>维护帘框尺寸、丝材与帘纹密度；每次维修形成版本快照，历史工序按日期匹配对应版本。</Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => setShowForm((current) => !current)} data-testid="new-mould">
          {showForm ? '收起登记' : '新建纸帘'}
        </Button>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}

      {showForm && (
        <Card data-testid="form-mould" sx={{ borderColor: '#9eb096' }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box>
                <Typography variant="h5">登记新纸帘</Typography>
                <Typography variant="body2" color="text.secondary">建帘日期与初始丝径、间距作为第 1 版基线快照；丝径或间距变化时密度即时重算。</Typography>
              </Box>
              <Chip color="success" label={`${calculatedDensity.toFixed(1)} 根/厘米`} />
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <TextField fullWidth label="纸帘编号" value={form.mouldNo} onChange={(event) => updateForm('mouldNo', event.target.value)} inputProps={{ 'data-testid': 'field-mouldNo' }} />
              </Grid>
              <Grid item xs={6} md={2}>
                <TextField fullWidth type="date" label="建帘日期" value={form.baselineDate} onChange={(event) => updateForm('baselineDate', event.target.value)} InputLabelProps={{ shrink: true }} inputProps={{ 'data-testid': 'field-baselineDate' }} />
              </Grid>
              <Grid item xs={6} md={2}>
                <TextField fullWidth type="number" label="帘框宽" value={form.frameW} onChange={(event) => updateForm('frameW', Number(event.target.value))} inputProps={{ min: 1, step: 1, 'data-testid': 'field-frameW' }} InputProps={{ endAdornment: 'cm' }} />
              </Grid>
              <Grid item xs={6} md={2}>
                <TextField fullWidth type="number" label="帘框高" value={form.frameH} onChange={(event) => updateForm('frameH', Number(event.target.value))} inputProps={{ min: 1, step: 1, 'data-testid': 'field-frameH' }} InputProps={{ endAdornment: 'cm' }} />
              </Grid>
              <Grid item xs={6} md={3}>
                <TextField
                  select
                  fullWidth
                  label="帘丝材质"
                  value={form.wireMaterial}
                  onChange={(event) => updateForm('wireMaterial', event.target.value as WireMaterial)}
                  SelectProps={{ native: true, inputProps: { 'data-testid': 'field-wireMaterial' } }}
                >
                  {WIRE_MATERIALS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={4}>
                <RulerInput label="初始丝径" value={form.wireDiameter} onChange={(value) => updateForm('wireDiameter', value)} min={0.05} max={2} step={0.01} testId="field-wireDiameter" />
              </Grid>
              <Grid item xs={12} md={4}>
                <RulerInput label="初始帘纹间距" value={form.stripeGap} onChange={(value) => updateForm('stripeGap', value)} min={0.1} max={5} step={0.01} testId="field-stripeGap" />
              </Grid>
              <Grid item xs={6} md={2}>
                <TextField fullWidth label="编帘匠人" value={form.weaver} onChange={(event) => updateForm('weaver', event.target.value)} inputProps={{ 'data-testid': 'field-weaver' }} />
              </Grid>
              <Grid item xs={6} md={2}>
                <TextField
                  select
                  fullWidth
                  label="状态"
                  value={form.state}
                  onChange={(event) => updateForm('state', event.target.value as MouldStateValue)}
                  SelectProps={{ native: true, inputProps: { 'data-testid': 'field-state' } }}
                >
                  {MOULD_STATES.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={8} sx={{ display: 'flex', alignItems: 'stretch' }}>
                <Box sx={{ width: '100%' }}>
                  <GrainStripePreview gap={form.stripeGap} wireDiameter={form.wireDiameter} density={calculatedDensity} direction={form.wireMaterial === '马尾丝' ? 'horizontal' : 'vertical'} />
                </Box>
              </Grid>
            </Grid>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 2.5 }}>
              <Button onClick={() => setShowForm(false)}>取消</Button>
              <Button variant="contained" onClick={handleSubmit} disabled={submitting} data-testid="submit-mould">
                保存纸帘
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Grid container spacing={1.5} alignItems="center">
            <Grid item xs={12} sm={6} md={3}>
              <TextField fullWidth size="small" label="筛选帘号" value={mouldNo} onChange={(event) => setMouldNo(event.target.value)} />
            </Grid>
            <Grid item xs={6} md={2.5}>
              <TextField select fullWidth size="small" label="状态" value={stateFilter} onChange={(event) => setState(event.target.value as MouldStateValue | '全部')} SelectProps={{ native: true }}>
                <option value="全部">全部</option>
                {MOULD_STATES.map((option) => <option key={option} value={option}>{option}</option>)}
              </TextField>
            </Grid>
            <Grid item xs={6} md={2.5}>
              <TextField select fullWidth size="small" label="帘丝材质" value={wireMaterial} onChange={(event) => setWireMaterial(event.target.value as WireMaterial | '全部')} SelectProps={{ native: true }}>
                <option value="全部">全部</option>
                {WIRE_MATERIALS.map((option) => <option key={option} value={option}>{option}</option>)}
              </TextField>
            </Grid>
            <Grid item xs={12} md={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                <Typography variant="body2" color="text.secondary">当前记录</Typography>
                <Typography variant="h5" data-testid="count-mould">{filteredMoulds.length}</Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={2}>
              <Button fullWidth variant="outlined" onClick={resetFilters}>重置筛选</Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <TableContainer component={Card}>
        <Table sx={{ minWidth: 1040 }}>
          <TableHead>
            <TableRow>
              <TableCell>帘号 / 尺寸</TableCell>
              <TableCell>材质与当前丝径</TableCell>
              <TableCell>当前间距 / 密度</TableCell>
              <TableCell>版本档案</TableCell>
              <TableCell>工序引用</TableCell>
              <TableCell>状态 / 重算</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredMoulds.map((mould) => {
              const relatedRuns = runs.filter((run) => run.mouldId === mould.id)
              const latestRun = relatedRuns[0]
              const mouldVersionList = versionsByMould.get(mould.id ?? -1) ?? []
              const repairCount = mouldVersionList.filter((version) => version.origin === '维修').length
              const pendingRuns = relatedRuns.filter((run) => run.paramStatus === 'pendingData').length
              return (
                <TableRow key={mould.id ?? mould.mouldNo} data-testid="row-mould" hover sx={{ bgcolor: mould.recalcPending ? '#fdecec' : undefined }}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 750 }}>{mould.mouldNo}</Typography>
                    <Typography variant="caption" color="text.secondary">{mould.frameW} × {mould.frameH} cm · {(mould.frameW * mould.frameH / 10000).toFixed(3)} 平方米</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={mould.wireMaterial} variant="outlined" />
                    <Typography variant="body2" sx={{ mt: 0.6 }}>{mould.wireDiameter.toFixed(2)} mm</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography>{mould.stripeGap.toFixed(2)} mm</Typography>
                    <Typography variant="caption" color="text.secondary">{mould.meshDensity.toFixed(1)} 根/cm · 推算 {mmPitchToThreadsPerCm(mould.wireDiameter + mould.stripeGap).toFixed(1)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{mouldVersionList.length} 版 · 维修 {repairCount} 次</Typography>
                    {pendingRuns > 0 && (
                      <Typography variant="caption" color="warning.dark">{pendingRuns} 槽工序待补录</Typography>
                    )}
                    <Box sx={{ mt: 0.5 }}>
                      <Button size="small" onClick={() => setHistoryMould(mould)} data-testid={`history-${mould.id}`}>查看版本</Button>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{relatedRuns.length} 槽工序</Typography>
                    <Typography variant="caption" color="text.secondary">{latestRun ? `最近 ${latestRun.runDate}` : '尚无关联'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={mould.state === '在用' ? 'success' : mould.state === '待修补' ? 'warning' : 'default'} label={mould.state} />
                    {mould.recalcPending && (
                      <Box sx={{ mt: 0.75 }}>
                        <Chip size="small" color="error" variant="outlined" label="待重算" data-testid={`recalc-pending-${mould.id}`} />
                        <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>{mould.recalcError ?? '上一批保存失败，结果已回滚'}</Typography>
                      </Box>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack spacing={0.75} alignItems="flex-end">
                      <Button
                        size="small"
                        variant="contained"
                        color="primary"
                        disabled={mould.state === '退役' || mould.id === undefined}
                        onClick={() => setRepairTarget({ mould, edit: null })}
                        data-testid={`register-repair-${mould.id}`}
                      >
                        登记维修
                      </Button>
                      {mould.recalcPending && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          disabled={retryingId === mould.id}
                          onClick={() => void handleRetry(mould)}
                          data-testid={`retry-recalc-${mould.id}`}
                        >
                          {retryingId === mould.id ? '重算中…' : '重试重算'}
                        </Button>
                      )}
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={mould.id === undefined}
                        onClick={() => {
                          if (mould.id !== undefined) void setMouldState(mould.id, mould.state === '待修补' ? '在用' : '待修补')
                        }}
                      >
                        {mould.state === '待修补' ? '完成修补' : '标记待修补'}
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              )
            })}
            {filteredMoulds.length === 0 && (
              <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5 }}>没有符合筛选条件的纸帘</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <MouldHistoryDialog
        open={historyMould !== null}
        mould={historyMould}
        versions={versions}
        onClose={() => setHistoryMould(null)}
        onEdit={(version) => {
          if (historyMould) setRepairTarget({ mould: historyMould, edit: version })
        }}
        onRegisterRepair={() => {
          if (historyMould) {
            const mould = historyMould
            setHistoryMould(null)
            setRepairTarget({ mould, edit: null })
          }
        }}
      />
      <RepairDialog
        open={repairTarget !== null}
        mould={repairTarget?.mould ?? null}
        versions={versions}
        editVersion={repairTarget?.edit ?? null}
        onClose={() => {
          setRepairTarget(null)
        }}
      />
    </Stack>
  )
}
