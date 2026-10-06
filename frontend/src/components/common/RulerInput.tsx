import { Box, InputAdornment, TextField, Typography } from '@mui/material'
import type { ReactNode } from 'react'

interface RulerInputProps {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  unit?: string
  min?: number
  max?: number
  step?: number
  helperText?: ReactNode
  testId?: string
  disabled?: boolean
  compact?: boolean
  allowEmpty?: boolean
}

export function RulerInput({
  label,
  value,
  onChange,
  unit = 'mm',
  min = 0,
  max,
  step = 0.01,
  helperText,
  testId,
  disabled = false,
  compact = false,
  allowEmpty = false,
}: RulerInputProps) {
  return (
    <Box sx={{ width: '100%' }}>
      <Box
        aria-hidden="true"
        sx={{
          height: compact ? 8 : 12,
          mb: 0.5,
          borderRadius: 1,
          background: `repeating-linear-gradient(90deg, #8c7658 0 1px, transparent 1px ${compact ? 8 : 12}px), repeating-linear-gradient(90deg, #bfae91 0 1px, transparent 1px ${compact ? 4 : 6}px)`,
          backgroundPosition: 'bottom left',
          opacity: disabled ? 0.35 : 0.8,
        }}
      />
      <TextField
        fullWidth
        size="small"
        type="number"
        label={label}
        value={value === null || value === undefined ? '' : value}
        onChange={(event) => {
          if (event.target.value === '') {
            onChange(allowEmpty ? null : 0)
          } else {
            onChange(Number(event.target.value))
          }
        }}
        disabled={disabled}
        inputProps={{ min, max, step, 'data-testid': testId }}
        InputProps={{
          endAdornment: unit ? <InputAdornment position="end">{unit}</InputAdornment> : undefined,
        }}
        helperText={helperText}
      />
      {!helperText && (
        <Typography variant="caption" color="text.secondary">
          刻度以 1 mm 为基准，可输入小数
        </Typography>
      )}
    </Box>
  )
}
