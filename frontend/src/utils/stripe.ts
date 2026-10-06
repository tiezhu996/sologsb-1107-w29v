import type { PaperSample } from '../types/paper-sample'
import type { MouldVersion } from '../types/mould-version'
import type { SheetRun } from '../types/sheet-run'

export const GAP_TOLERANCE_MM = 0.2

export function calculateDeviation(measuredGap: number | null | undefined, standardGap: number | null | undefined): number | null {
  if (measuredGap === null || measuredGap === undefined || standardGap === null || standardGap === undefined) return null
  return Number((measuredGap - standardGap).toFixed(2))
}

export function isGapOutOfTolerance(deviation: number | null | undefined): boolean {
  if (deviation === null || deviation === undefined) return false
  return Math.abs(deviation) > GAP_TOLERANCE_MM
}

export function getGapConclusion(deviation: number | null | undefined): string {
  if (deviation === null || deviation === undefined) {
    return '参数待补录，暂不能判定'
  }
  if (isGapOutOfTolerance(deviation)) {
    return deviation > 0 ? '帘纹偏疏，超出允许范围' : '帘纹偏密，超出允许范围'
  }
  return '帘纹间距在允许范围'
}

export function calculateMeshDensity(wireDiameter: number | null | undefined, stripeGap: number | null | undefined): number | null {
  if (wireDiameter === null || wireDiameter === undefined || stripeGap === null || stripeGap === undefined) return null
  const pitch = wireDiameter + stripeGap
  if (pitch <= 0) return null
  return Number((10 / pitch).toFixed(1))
}

/** 工序是否具备判定所需的全部参数 */
export function hasRunParams(run: Pick<SheetRun, 'measuredGap' | 'versionId'>, version?: MouldVersion): boolean {
  return run.measuredGap !== null && run.versionId !== null && !!version && version.stripeGap !== null
}

/**
 * 工序是否合格：参数完备 + 偏差在 ±0.2 mm 内。
 * 缺参（待补录）、待重算一律不算合格。
 */
export function isRunQualified(
  run: Pick<SheetRun, 'measuredGap' | 'versionId' | 'deviation' | 'paramStatus' | 'recalcState'>,
  version?: MouldVersion,
): boolean {
  if (run.recalcState === 'pending') return false
  if (!hasRunParams(run, version)) return false
  if (run.deviation === null) return false
  return !isGapOutOfTolerance(run.deviation)
}

/** 按工序日期匹配当天（含）以前最近生效的一版纸帘参数；同日多版取版本号最大者 */
export function resolveMouldVersion(versions: MouldVersion[], mouldId: number, runDate: string): MouldVersion | null {
  let matched: MouldVersion | null = null
  for (const version of versions) {
    if (version.mouldId !== mouldId) continue
    if (version.effectiveDate > runDate) continue
    if (!matched
      || version.effectiveDate > matched.effectiveDate
      || (version.effectiveDate === matched.effectiveDate && version.versionNo > matched.versionNo)) {
      matched = version
    }
  }
  return matched
}

/** 归档/复检结论文案：匀度与帘纹偏差两个维度 */
export function buildSampleConclusion(
  sample: Pick<PaperSample, 'evenness'>,
  deviation: number | null,
): string {
  const evennessOk = sample.evenness === '均匀'
  const gapOk = deviation !== null && !isGapOutOfTolerance(deviation)
  const parts: string[] = []
  parts.push(evennessOk ? '匀度均匀' : `匀度${sample.evenness}`)
  parts.push(deviation === null ? '帘纹偏差待补录' : gapOk ? `帘纹偏差 ${deviation > 0 ? '+' : ''}${deviation.toFixed(2)} mm 合格` : `帘纹偏差 ${deviation > 0 ? '+' : ''}${deviation.toFixed(2)} mm 超差`)
  const passed = evennessOk && gapOk
  return `${passed ? '复检合格' : '复检未通过'}：${parts.join('，')}`
}

export function isSamplePassing(
  sample: Pick<PaperSample, 'evenness'>,
  deviation: number | null,
): boolean {
  return sample.evenness === '均匀' && deviation !== null && !isGapOutOfTolerance(deviation)
}
