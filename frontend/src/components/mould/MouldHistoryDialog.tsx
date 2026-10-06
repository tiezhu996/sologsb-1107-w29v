import { useMemo } from 'react'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { Mould } from '../../types/mould'
import type { MouldVersion } from '../../types/mould-version'

interface MouldHistoryDialogProps {
  open: boolean
  mould: Mould | null
  versions: MouldVersion[]
  onClose: () => void
  onEdit: (version: MouldVersion) => void
  onRegisterRepair: () => void
}

/**
 * 纸帘维修版本档案：按时间倒序列出每一版（建帘/维修）的日期、丝径、间距与密度。
 * 历史工序按工序日期匹配这里面“当天以前最近”的一版。
 */
export function MouldHistoryDialog({ open, mould, versions, onClose, onEdit, onRegisterRepair }: MouldHistoryDialogProps) {
  const list = useMemo(
    () => (mould ? versions.filter((version) => version.mouldId === mould.id) : []),
    [mould, versions],
  )
  if (!mould) return null

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth data-testid="history-dialog">
      <DialogTitle sx={{ pb: 1 }}>
        维修版本档案 · {mould.mouldNo}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontWeight: 400 }}>
          共 {list.length} 版，历史工序按日期匹配当天以前最近一版参数，不以现值回算。
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>版本</TableCell>
              <TableCell>日期</TableCell>
              <TableCell>类型</TableCell>
              <TableCell align="right">丝径 mm</TableCell>
              <TableCell align="right">帘纹间距 mm</TableCell>
              <TableCell align="right">密度 根/cm</TableCell>
              <TableCell>匠人/备注</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list.map((version) => (
              <TableRow key={version.id} hover data-testid="history-row">
                <TableCell sx={{ fontWeight: 700 }}>v{version.seq}</TableCell>
                <TableCell>{version.versionDate}</TableCell>
                <TableCell>
                  <Chip size="small" color={version.origin === '维修' ? 'warning' : 'default'} variant={version.origin === '维修' ? 'filled' : 'outlined'} label={version.origin} />
                </TableCell>
                <TableCell align="right">{version.wireDiameter.toFixed(2)}</TableCell>
                <TableCell align="right">{version.stripeGap.toFixed(2)}</TableCell>
                <TableCell align="right">{version.meshDensity.toFixed(1)}</TableCell>
                <TableCell>
                  <Typography variant="body2">{version.operator}</Typography>
                  {version.note && <Typography variant="caption" color="text.secondary">{version.note}</Typography>}
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    onClick={() => onEdit(version)}
                    data-testid={`edit-version-${version.id}`}
                  >
                    补改
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {list.length === 0 && (
              <TableRow><TableCell colSpan={8} align="center">该纸帘尚无版本快照，请登记建帘或维修。</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={onRegisterRepair} data-testid="history-new-repair">登记新维修</Button>
          <Button onClick={onClose}>关闭</Button>
        </Stack>
      </DialogActions>
    </Dialog>
  )
}
