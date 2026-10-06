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
  FormControlLabel,
  Grid,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import type { Mould } from '../../types/mould'
import type { MouldVersion } from '../../types/mould-version'
import { RulerInput } from '../common/RulerInput'
import { refreshAll } from '../../utils/dataBus'
import { calculateMeshDensity } from '../../utils/stripe'
import { setFailNextRecalc, submitRepairAndRecalc } from '../../utils/recalc'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface RepairDialogProps {
  open: boolean
  mould: Mould | null
  versions: MouldVersion[]
  /** 修改既有维修版本时传入 */
  editVersion: MouldVersion | null
  onClose: () => void
}

export function RepairDialog({ open, mould, versions, editVersion, onClose }: RepairDialogProps) {
  const [versionDate, setVersionDate] = useState(todayIso())
  const [wireDiameter, setWireDiameter] = useState(0.3)
  const [stripeGap, setStripeGap] = useState(1.1)
  const [operator, setOperator] = useState('')
  const [note, setNote] = useState('')
  const [simulateFail, setSimulateFail] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ severity: 'success' | 'warning' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!open || !mould) return
    setMessage(null)
    setSimulateFail(false)
    if (editVersion) {
      setVersionDate(editVersion.versionDate)
      setWireDiameter(editVersion.wireDiameter)
      setStripeGap(editVersion.stripeGap)
      setOperator(editVersion.operator)
      setNote(editVersion.note ?? '')
    } else {
      setVersionDate(todayIso())
      setWireDiameter(mould.wireDiameter)
      setStripeGap(mould.stripeGap)
      setOperator(mould.weaver)
      setNote('')
    }
  }, [open, mould, editVersion])

  const density = useMemo(() => calculateMeshDensity(wireDiameter, stripeGap), [wireDiameter, stripeGap])

  if (!mould) return null

  const valid = versionDate && wireDiameter > 0 && stripeGap > 0 && operator.trim()

  const handleSubmit = async () => {
    if (!valid || mould.id === undefined) return
    setSubmitting(true)
    setMessage(null)
    setFailNextRecalc(simulateFail)
    const outcome = await submitRepairAndRecalc({
      mould,
      editVersionId: editVersion?.id,
      versionDate,
      wireDiameter,
      stripeGap,
      meshDensity: density,
      operator: operator.trim(),
      note: note.trim() || undefined,
      triggeredBy: operator.trim(),
      reason: editVersion ? 'repair-edit' : 'repair-create',
    })
    setSubmitting(false)
    // 无论成功或失败回滚，都全量刷新，保证各页面仍读同一版数据（不出现半批结果）
    await refreshAll()
    if (outcome) {
      const runChanged = outcome.changes.length
      const sampleChanged = outcome.affectedSampleIds.length
      setMessage({
        severity: 'success',
        text: `${editVersion ? '维修修改' : '维修登记'}已保存（批次 ${outcome.batchId}），连带重算 ${runChanged} 槽工序，${sampleChanged} 个成纸样本转待复检。`,
      })
      if (!simulateFail) {
        window.setTimeout(onClose, 1600)
      }
    } else {
      setMessage({
        severity: 'error',
        text: '批量重算保存失败，已整体回滚并恢复上次结果；该纸帘已标记待重算，可在台帐重试。',
      })
    }
  }

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth data-testid="repair-dialog">
      <DialogTitle sx={{ pb: 1 }}>
        {editVersion ? '修改早期维修记录' : '登记纸帘维修'} · {mould.mouldNo}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {editVersion
            ? '改动早期版本后，该日期之后的工序将按新版本重新匹配并连带重算偏差，受影响样本转待复检。'
            : '维修登记保存修后丝径与帘纹间距，作为新版本快照；历史工序按各自日期匹配对应版本，不会用现值回算。'}
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              type="date"
              label="维修日期"
              value={versionDate}
              onChange={(event) => setVersionDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'repair-date' }}
            />
          </Grid>
          <Grid item xs={12} md={6} sx={{ display: 'flex', alignItems: 'center' }}>
            <Chip color="success" label={`修后密度 ${density.toFixed(1)} 根/cm`} />
          </Grid>
          <Grid item xs={12} md={6}>
            <RulerInput label="修后丝径" value={wireDiameter} onChange={setWireDiameter} min={0.05} max={2} step={0.01} testId="repair-wireDiameter" />
          </Grid>
          <Grid item xs={12} md={6}>
            <RulerInput label="修后帘纹间距" value={stripeGap} onChange={setStripeGap} min={0.1} max={5} step={0.01} testId="repair-stripeGap" />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth label="维修匠人" value={operator} onChange={(event) => setOperator(event.target.value)} inputProps={{ 'data-testid': 'repair-operator' }} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth label="备注" value={note} onChange={(event) => setNote(event.target.value)} inputProps={{ 'data-testid': 'repair-note' }} />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={<Switch size="small" checked={simulateFail} onChange={(event) => setSimulateFail(event.target.checked)} data-testid="repair-simulate-fail" />}
              label={<Typography variant="caption" color="text.secondary">演示：本次批量保存失败（验证整体回滚、恢复上次结果并留待重算标记）</Typography>}
            />
          </Grid>
        </Grid>

        {message && (
          <Alert severity={message.severity} sx={{ mt: 2 }} data-testid="repair-message">
            {message.text}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>关闭</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting || !valid} data-testid="repair-submit">
          {submitting ? '保存并重算中…' : editVersion ? '保存修改并重算' : '保存维修并重算'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
