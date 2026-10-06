import type { MouldVersion } from '../types/mould-version'
import type { RunParamStatus } from '../types/sheet-run'
import { calculateDeviation, isGapOutOfTolerance } from './stripe'

/**
 * 时点匹配：返回某纸帘在指定日期“当天以前（含当天）最近一版”参数快照。
 *
 * 严格按版本登记日期过滤，绝不使用现在档案里的最新值回头计算历史工序。
 * 若该日期早于所有版本（缺失参数），返回 undefined，由调用方标记待补录。
 */
export function findEffectiveVersion(
  versions: MouldVersion[],
  mouldId: number,
  date: string,
): MouldVersion | undefined {
  const candidates = versions
    .filter((version) => version.mouldId === mouldId && version.versionDate <= date)
    .sort((a, b) => {
      if (a.versionDate !== b.versionDate) return a.versionDate < b.versionDate ? 1 : -1
      // 同一天多版时取序号更大（后登记）的一版
      return b.seq - a.seq
    })
  return candidates[0]
}

export interface RunParamResult {
  matchedVersionId: number | null
  standardGap: number | null
  deviation: number | null
  paramStatus: RunParamStatus
}

/**
 * 依据命中版本计算工序标准间距、偏差与参数状态。
 * 无版本可匹配时一律为 pendingData（待补录），不能算合格。
 */
export function resolveRunParam(
  versions: MouldVersion[],
  mouldId: number,
  runDate: string,
  measuredGap: number,
): RunParamResult {
  const version = findEffectiveVersion(versions, mouldId, runDate)
  if (!version) {
    return { matchedVersionId: null, standardGap: null, deviation: null, paramStatus: 'pendingData' }
  }
  const deviation = calculateDeviation(measuredGap, version.stripeGap)
  return {
    matchedVersionId: version.id ?? null,
    standardGap: version.stripeGap,
    deviation,
    paramStatus: isGapOutOfTolerance(deviation) ? 'exceeded' : 'qualified',
  }
}

/** 下一个版本序号 */
export function nextVersionSeq(versions: MouldVersion[], mouldId: number): number {
  return versions.reduce((max, version) => (version.mouldId === mouldId ? Math.max(max, version.seq) : max), 0) + 1
}

export const PARAM_STATUS_LABEL: Record<RunParamStatus, string> = {
  qualified: '合格',
  exceeded: '超差',
  pendingData: '待补录',
}
