import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { REPAIR_REASONS, type MouldRepair, type MouldRepairInput, type RepairReason } from '../../types/mould-repair'
import type { Mould } from '../../types/mould'
import type { MouldVersion } from '../../types/mould-version'
import type { SheetRun } from '../../types/sheet-run'
import { calculateMeshDensity } from '../../utils/stripe'
import { formatNullableMm } from '../../utils/status-view'

interface RepairArchiveDialogProps {
  open: boolean
  mould: Mould | null
  repairs: MouldRepair[]
  versions: MouldVersion[]
  runs: SheetRun[]
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (input: MouldRepairInput, repairId?: number) => Promise<boolean>
  onDelete: (repairId: number) => Promise<boolean>
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function suggestRepairNo(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  const suffix = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`.slice(0, 6)
  return `WX-${String(now.getFullYear()).slice(2)}${month}${day}-${suffix}`
}

interface RepairForm {
  repairNo: string
  repairDate: string
  wireDiameterText: string
  stripeGapText: string
  reason: RepairReason | string
  technician: string
  note: string
}

const emptyForm = (mould: Mould): RepairForm => ({
  repairNo: suggestRepairNo(),
  repairDate: todayIso(),
  wireDiameterText: mould.wireDiameter === null ? '' : String(mould.wireDiameter),
  stripeGapText: mould.stripeGap === null ? '' : String(mould.stripeGap),
  reason: '调校间距',
  technician: mould.weaver,
  note: '',
})

function toNumberOrNull(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export function RepairArchiveDialog({
  open,
  mould,
  repairs,
  versions,
  runs,
  saving,
  error,
  onClose,
  onSave,
  onDelete,
}: RepairArchiveDialogProps) {
  const [editingId, setEditingId] = useState<number | undefined>(undefined)
  const [form, setForm] = useState<RepairForm | null>(null)

  useEffect(() => {
    if (open && mould) {
      setEditingId(undefined)
      setForm(emptyForm(mould))
    }
  }, [open, mould])

  const mouldVersions = useMemo(
    () => (mould ? versions.filter((version) => version.mouldId === mould.id).sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : b.versionNo - a.versionNo)) : []),
    [mould, versions],
  )
  const mouldRepairs = useMemo(
    () => (mould ? repairs.filter((repair) => repair.mouldId === mould.id) : []),
    [mould, repairs],
  )
  const mouldRuns = useMemo(
    () => (mould ? runs.filter((run) => run.mouldId === mould.id).sort((a, b) => (a.runDate < b.runDate ? 1 : -1)) : []),
    [mould, runs],
  )

  if (!mould || !form) return null

  const parsedWire = toNumberOrNull(form.wireDiameterText)
  const parsedGap = toNumberOrNull(form.stripeGapText)
  const density = calculateMeshDensity(parsedWire, parsedGap)

  // 保存后会重算：工序日期不早于维修日期、且使用该纸帘的工序
  const affectedRuns = mouldRuns.filter((run) => run.runDate >= form.repairDate)
  const missingParamCount = mouldRuns.filter((run) => run.paramStatus === 'missing-param').length

  const startEdit = (repair: MouldRepair) => {
    if (repair.id === undefined) return
    setEditingId(repair.id)
    setForm({
      repairNo: repair.repairNo,
      repairDate: repair.repairDate,
      wireDiameterText: repair.wireDiameter === null ? '' : String(repair.wireDiameter),
      stripeGapText: repair.stripeGap === null ? '' : String(repair.stripeGap),
      reason: repair.reason,
      technician: repair.technician,
      note: repair.note,
    })
  }

  const resetForm = () => {
    setEditingId(undefined)
    setForm(emptyForm(mould))
  }

  const handleSave = async () => {
    if (!form.repairNo.trim() || !form.repairDate || !form.technician.trim()) return
    const ok = await onSave({
      repairNo: form.repairNo.trim(),
      mouldId: mould.id!,
      repairDate: form.repairDate,
      wireDiameter: parsedWire,
      stripeGap: parsedGap,
      meshDensity: density,
      reason: form.reason,
      technician: form.technician.trim(),
      note: form.note.trim(),
    }, editingId)
    if (ok) resetForm()
  }

  const handleDelete = async (repairId: number) => {
    const ok = await onDelete(repairId)
    if (ok && editingId === repairId) resetForm()
  }

  const setField = <K extends keyof RepairForm,>(key: K, value: RepairForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current))
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth data-testid="repair-dialog">
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography variant="h5">{mould.mouldNo} 维修档案与版本快照</Typography>
          <IconButton aria-label="关闭" onClick={onClose} size="small" data-testid="repair-close">×</IconButton>
        </Box>
        <Typography variant="body2" color="text.secondary">
          维修登记修后丝径与帘纹间距；补录或改日期后，其后工序按版本链重算，不会拿当前档案回算。
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="warning" data-testid="repair-error">{error}</Alert>}

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              {editingId === undefined ? '登记本次维修' : `修改维修 ${form.repairNo}`}
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <TextField fullWidth size="small" label="维修单号" value={form.repairNo} onChange={(event) => setField('repairNo', event.target.value)} inputProps={{ 'data-testid': 'repair-no' }} />
              </Grid>
              <Grid item xs={6} md={2.5}>
                <TextField fullWidth size="small" type="date" label="维修日期" value={form.repairDate} onChange={(event) => setField('repairDate', event.target.value)} InputLabelProps={{ shrink: true }} inputProps={{ 'data-testid': 'repair-date' }} />
              </Grid>
              <Grid item xs={6} md={2.5}>
                <TextField fullWidth size="small" label="丝径" value={form.wireDiameterText} onChange={(event) => setField('wireDiameterText', event.target.value)} helperText="留空表示待补录" inputProps={{ step: 0.01, min: 0.05, 'data-testid': 'repair-wireDiameter' }} />
              </Grid>
              <Grid item xs={6} md={2}>
                <TextField fullWidth size="small" label="修后帘纹间距" value={form.stripeGapText} onChange={(event) => setField('stripeGapText', event.target.value)} helperText={density === null ? '待补录' : `密度 ${density.toFixed(1)} 根/cm`} inputProps={{ step: 0.01, min: 0.1, 'data-testid': 'repair-stripeGap' }} />
              </Grid>
              <Grid item xs={6} md={2}>
                <TextField fullWidth size="small" select label="维修类型" value={form.reason} onChange={(event) => setField('reason', event.target.value)} SelectProps={{ native: true }} inputProps={{ 'data-testid': 'repair-reason' }}>
                  {REPAIR_REASONS.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField fullWidth size="small" label="维修匠人" value={form.technician} onChange={(event) => setField('technician', event.target.value)} inputProps={{ 'data-testid': 'repair-technician' }} />
              </Grid>
              <Grid item xs={12} md={9}>
                <TextField fullWidth size="small" label="备注" value={form.note} onChange={(event) => setField('note', event.target.value)} inputProps={{ 'data-testid': 'repair-note' }} />
              </Grid>
            </Grid>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1.5, gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="caption" color={affectedRuns.length ? 'warning.dark' : 'text.secondary'}>
                保存后将连带重算 {affectedRuns.length} 槽该日期（含当天）之后的工序；其已归档样本会保留原位并标记待复检。
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {editingId !== undefined && <Button size="small" onClick={resetForm}>放弃修改</Button>}
                <Button size="small" variant="contained" disabled={saving || !form.repairNo.trim() || !form.technician.trim()} onClick={handleSave} data-testid="repair-save">
                  {saving ? '保存并重算中…' : editingId === undefined ? '保存并重算' : '保存修改并重算'}
                </Button>
              </Box>
            </Box>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>维修登记记录（{mouldRepairs.length}）</Typography>
            <Stack spacing={1}>
              {mouldRepairs.length === 0 && <Typography variant="body2" color="text.secondary">尚无维修登记，当前仅有建帘初始版本。</Typography>}
              {mouldRepairs.map((repair) => (
                <Box key={repair.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, p: 1.25, borderRadius: 1.5, bgcolor: '#f7f2e6', border: '1px solid #e2d7c0' }} data-testid={`repair-row-${repair.id}`}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{repair.repairNo} · {repair.repairDate} · {repair.reason}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      修后丝径 {formatNullableMm(repair.wireDiameter)} · 修后间距 {formatNullableMm(repair.stripeGap)}
                      {repair.meshDensity !== null ? ` · ${repair.meshDensity.toFixed(1)} 根/cm` : ''}
                      {' '}· {repair.technician}{repair.note ? ` · ${repair.note}` : ''}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                    <Button size="small" onClick={() => startEdit(repair)} data-testid={`repair-edit-${repair.id}`}>修改</Button>
                    <Button size="small" color="error" onClick={() => void handleDelete(repair.id!)} data-testid={`repair-delete-${repair.id}`}>删除</Button>
                  </Box>
                </Box>
              ))}
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              版本快照链（{mouldVersions.length} 版）
              {missingParamCount > 0 && <Chip size="small" color="info" sx={{ ml: 1 }} label={`${missingParamCount} 槽工序待补录`} />}
            </Typography>
            <Stack spacing={1}>
              {mouldVersions.map((version, index) => (
                <Box key={version.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, p: 1.25, borderRadius: 1.5, bgcolor: index === 0 ? '#eef4ea' : '#faf7ef', border: '1px solid #e0d8c4' }} data-testid={`version-row-${version.id}`}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      v{version.versionNo} · 生效于 {version.effectiveDate}
                      {index === 0 && <Chip size="small" color="success" sx={{ ml: 1 }} label="当前版本" />}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{version.note}</Typography>
                  </Box>
                  <Typography variant="body2" sx={{ flexShrink: 0 }}>
                    {version.wireDiameter === null || version.stripeGap === null
                      ? <Chip size="small" color="info" label="参数待补录" />
                      : <>丝径 {version.wireDiameter.toFixed(2)} · 间距 {version.stripeGap.toFixed(2)} mm{version.meshDensity !== null ? ` · ${version.meshDensity.toFixed(1)} 根/cm` : ''}</>}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
