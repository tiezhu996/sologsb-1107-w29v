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
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { PaperSample } from '../../types/paper-sample'
import type { RecheckResult } from '../../types/recheck-record'
import type { SheetRun } from '../../types/sheet-run'
import { submitRecheck } from '../../utils/recheck'
import { refreshAll } from '../../utils/dataBus'

interface RecheckDialogProps {
  open: boolean
  sample: PaperSample | null
  run: SheetRun | undefined
  onClose: () => void
}

function formatDev(value: number | null): string {
  if (value === null) return '待补录'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} mm`
}

/**
 * 成纸样本复检对话框。
 * 待复检样本保留原归档位与历史结论；复检通过才恢复归档，未通过继续待复检。
 */
export function RecheckDialog({ open, sample, run, onClose }: RecheckDialogProps) {
  const [stripeCount, setStripeCount] = useState(0)
  const [evenness, setEvenness] = useState('均匀')
  const [reviewer, setReviewer] = useState('罗青禾')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ severity: 'success' | 'warning' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!open || !sample) return
    setStripeCount(sample.stripeCount)
    setEvenness(sample.evenness)
    setNote('')
    setMessage(null)
  }, [open, sample])

  const deviation = run?.deviation ?? null
  const gapOk = deviation !== null && Math.abs(deviation) <= 0.2
  const canPass = gapOk && evenness === '均匀'

  const handleSubmit = async (result: RecheckResult) => {
    if (!sample?.id) return
    if (result === 'passed' && !canPass) {
      setMessage({ severity: 'error', text: '偏差仍超 ±0.2 mm 或匀度不为“均匀”，复检不能判定通过。' })
      return
    }
    if (!reviewer.trim()) return
    setSubmitting(true)
    setMessage(null)
    try {
      const recordId = await submitRecheck({
        sampleId: sample.id,
        stripeCount,
        evenness,
        deviation,
        result,
        reviewer: reviewer.trim(),
        note: note.trim() || undefined,
      })
      await refreshAll()
      setSubmitting(false)
      if (result === 'passed') {
        setMessage({ severity: 'success', text: `复检通过（记录 #${recordId}），样本已恢复归档，归档位仍为 ${sample.archiveBin}。` })
        window.setTimeout(onClose, 1500)
      } else {
        setMessage({ severity: 'warning', text: `复检未通过（记录 #${recordId}），样本继续待复检，不恢复归档。` })
      }
    } catch {
      setSubmitting(false)
      setMessage({ severity: 'error', text: '复检记录保存失败，请重试。' })
    }
  }

  const historyHint = useMemo(() => (
    sample?.archivedConclusion ? `${sample.archivedConclusion}（归档时偏差 ${formatDev(sample.archivedDeviation ?? null)}）` : ''
  ), [sample])

  if (!sample) return null

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth data-testid="recheck-dialog">
      <DialogTitle sx={{ pb: 1 }}>成纸样本复检 · {sample.sampleNo}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip size="small" label={`原归档位 ${sample.archiveBin}`} color="success" variant="outlined" />
            <Chip size="small" label={`当前工序偏差 ${formatDev(deviation)}`} color={gapOk ? 'success' : 'warning'} />
            <Chip size="small" label="待复检期间不移动实物" variant="outlined" />
          </Box>
          {historyHint && <Typography variant="body2" color="text.secondary">历史结论（冻结保留）：{historyHint}</Typography>}
          <Divider />
        </Stack>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField fullWidth type="number" label="复检帘纹条数" value={stripeCount} onChange={(event) => setStripeCount(Number(event.target.value))} inputProps={{ min: 1, step: 1, 'data-testid': 'recheck-stripeCount' }} />
          </Grid>
          <Grid item xs={6}>
            <TextField select fullWidth label="复检匀度" value={evenness} onChange={(event) => setEvenness(event.target.value)} SelectProps={{ native: true, inputProps: { 'data-testid': 'recheck-evenness' } }}>
              {['均匀', '略花', '花'].map((option) => <option key={option} value={option}>{option}</option>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="复检人" value={reviewer} onChange={(event) => setReviewer(event.target.value)} inputProps={{ 'data-testid': 'recheck-reviewer' }} />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth multiline minRows={2} label="复检备注" value={note} onChange={(event) => setNote(event.target.value)} inputProps={{ 'data-testid': 'recheck-note' }} />
          </Grid>
        </Grid>
        {message && <Alert severity={message.severity} sx={{ mt: 2 }} data-testid="recheck-message">{message.text}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>关闭</Button>
        <Button color="warning" variant="outlined" onClick={() => void handleSubmit('failed')} disabled={submitting} data-testid="recheck-fail">
          复检不通过
        </Button>
        <Button color="success" variant="contained" onClick={() => void handleSubmit('passed')} disabled={submitting || !canPass} data-testid="recheck-pass">
          复检通过并恢复归档
        </Button>
      </DialogActions>
    </Dialog>
  )
}
