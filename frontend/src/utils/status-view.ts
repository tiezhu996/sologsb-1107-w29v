import type { ChipProps } from '@mui/material'
import type { PaperSample, SampleReviewStatus } from '../types/paper-sample'
import type { SheetRun } from '../types/sheet-run'
import type { MouldVersion } from '../types/mould-version'
import { isGapOutOfTolerance, isRunQualified } from './stripe'

export type RunStatusTone = 'success' | 'warning' | 'error' | 'info'

export interface RunStatusView {
  label: string
  tone: RunStatusTone
  chipColor: ChipProps['color']
}

/** 工序状态：待重算 > 待补录（缺参，不算合格）> 超差 > 合格 */
export function describeRunStatus(run: SheetRun, version?: MouldVersion): RunStatusView {
  if (run.recalcState === 'pending') return { label: '待重算', tone: 'error', chipColor: 'error' }
  if (!isRunQualified(run, version)) {
    if (run.paramStatus === 'missing-param' || run.measuredGap === null || !version || version.stripeGap === null) {
      return { label: '待补录', tone: 'info', chipColor: 'info' }
    }
  }
  if (run.deviation === null) return { label: '待补录', tone: 'info', chipColor: 'info' }
  if (isGapOutOfTolerance(run.deviation)) return { label: '超差', tone: 'warning', chipColor: 'warning' }
  return { label: '合格', tone: 'success', chipColor: 'success' }
}

export function describeSampleStatus(status: SampleReviewStatus): { label: string; chipColor: ChipProps['color'] } {
  if (status === 'archived') return { label: '已归档', chipColor: 'success' }
  if (status === 'failed') return { label: '复检未通过', chipColor: 'error' }
  return { label: '待复检', chipColor: 'warning' }
}

export function formatNullableMm(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '待补录'
  return `${value.toFixed(digits)} mm`
}

export function sampleNeedsReview(sample: PaperSample): boolean {
  return sample.reviewStatus === 'pending' || sample.reviewStatus === 'failed'
}
