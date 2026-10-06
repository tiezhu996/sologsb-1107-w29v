import Dexie, { type Table } from 'dexie'
import type { FiberBatch } from '../types/fiber-batch'
import type { Mould } from '../types/mould'
import type { MouldRepair } from '../types/mould-repair'
import type { MouldVersion } from '../types/mould-version'
import { BASELINE_EFFECTIVE_DATE as BASELINE_DATE, INITIAL_VERSION_NOTE as INITIAL_NOTE } from '../types/mould-version'
import type { PaperSample } from '../types/paper-sample'
import type { RecalcJob } from '../types/recalc-job'
import type { SampleReview } from '../types/sample-review'
import type { SheetRun } from '../types/sheet-run'
import { buildSampleConclusion, calculateDeviation, calculateMeshDensity, isGapOutOfTolerance, resolveMouldVersion } from './stripe'

export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowIso(): string {
  return new Date().toISOString()
}

function currentWeekDate(dayOffset: number): string {
  const date = new Date()
  const day = date.getDay()
  const mondayDistance = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + mondayDistance + dayOffset)
  return date.toISOString().slice(0, 10)
}

function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

// ---- 种子数据：DL-01 在 20 天前做过一次调校，演示“按日期匹配历史版本” ----

const dl01BaselineGap = 1.1
const dl01CurrentGap = 1.18
const dl02Gap = 0.85
const dl03Gap = 1.0
const dl04Gap = 1.25
const dl05Gap = 0.72
const repairDateDl01 = daysAgo(20)

const seedMoulds: Mould[] = [
  { id: 1, mouldNo: 'DL-01', frameW: 60, frameH: 90, wireMaterial: '竹丝', wireDiameter: 0.3, stripeGap: dl01CurrentGap, meshDensity: calculateMeshDensity(0.3, dl01CurrentGap), weaver: '周守良', state: '在用', currentVersionId: 2, schemaRev: 3 },
  { id: 2, mouldNo: 'DL-02', frameW: 55, frameH: 82, wireMaterial: '铜丝', wireDiameter: 0.2, stripeGap: dl02Gap, meshDensity: calculateMeshDensity(0.2, dl02Gap), weaver: '沈云舟', state: '在用', currentVersionId: 3, schemaRev: 3 },
  { id: 3, mouldNo: 'DL-03', frameW: 72, frameH: 105, wireMaterial: '竹丝', wireDiameter: 0.28, stripeGap: dl03Gap, meshDensity: calculateMeshDensity(0.28, dl03Gap), weaver: '周守良', state: '在用', currentVersionId: 4, schemaRev: 3 },
  { id: 4, mouldNo: 'DL-04', frameW: 50, frameH: 76, wireMaterial: '马尾丝', wireDiameter: 0.32, stripeGap: dl04Gap, meshDensity: calculateMeshDensity(0.32, dl04Gap), weaver: '林砚秋', state: '待修补', currentVersionId: 5, schemaRev: 3 },
  { id: 5, mouldNo: 'DL-05', frameW: 65, frameH: 96, wireMaterial: '铜丝', wireDiameter: 0.18, stripeGap: dl05Gap, meshDensity: calculateMeshDensity(0.18, dl05Gap), weaver: '沈云舟', state: '退役', currentVersionId: 6, schemaRev: 3 },
]

const seedRepairs: MouldRepair[] = [
  { id: 1, repairNo: 'WX-260901', mouldId: 1, repairDate: repairDateDl01, wireDiameter: 0.3, stripeGap: dl01CurrentGap, meshDensity: calculateMeshDensity(0.3, dl01CurrentGap), reason: '调校间距', technician: '周守良', note: '整帘调校，间距由 1.10 调整为 1.18', schemaRev: 3 },
]

const seedVersions: MouldVersion[] = [
  { id: 1, versionNo: 1, mouldId: 1, repairId: null, effectiveDate: BASELINE_DATE, wireDiameter: 0.3, stripeGap: dl01BaselineGap, meshDensity: calculateMeshDensity(0.3, dl01BaselineGap), note: INITIAL_NOTE, schemaRev: 3 },
  { id: 2, versionNo: 2, mouldId: 1, repairId: 1, effectiveDate: repairDateDl01, wireDiameter: 0.3, stripeGap: dl01CurrentGap, meshDensity: calculateMeshDensity(0.3, dl01CurrentGap), note: 'WX-260901 调校间距', schemaRev: 3 },
  { id: 3, versionNo: 1, mouldId: 2, repairId: null, effectiveDate: BASELINE_DATE, wireDiameter: 0.2, stripeGap: dl02Gap, meshDensity: calculateMeshDensity(0.2, dl02Gap), note: INITIAL_NOTE, schemaRev: 3 },
  { id: 4, versionNo: 1, mouldId: 3, repairId: null, effectiveDate: BASELINE_DATE, wireDiameter: 0.28, stripeGap: dl03Gap, meshDensity: calculateMeshDensity(0.28, dl03Gap), note: INITIAL_NOTE, schemaRev: 3 },
  { id: 5, versionNo: 1, mouldId: 4, repairId: null, effectiveDate: BASELINE_DATE, wireDiameter: 0.32, stripeGap: dl04Gap, meshDensity: calculateMeshDensity(0.32, dl04Gap), note: INITIAL_NOTE, schemaRev: 3 },
  { id: 6, versionNo: 1, mouldId: 5, repairId: null, effectiveDate: BASELINE_DATE, wireDiameter: 0.18, stripeGap: dl05Gap, meshDensity: calculateMeshDensity(0.18, dl05Gap), note: INITIAL_NOTE, schemaRev: 3 },
]

const seedBatches: FiberBatch[] = [
  { id: 1, batchNo: 'XW-2601', material: '构皮', origin: '陕西洋县华阳镇', cookAgent: '石灰', cookHours: 9, bleachMethod: '日晒', beatingDegree: 32, operator: '罗青禾', schemaRev: 3 },
  { id: 2, batchNo: 'XW-2602', material: '桑皮', origin: '安徽泾县小岭村', cookAgent: '纯碱', cookHours: 7, bleachMethod: '日晒', beatingDegree: 38, operator: '汪知远', schemaRev: 3 },
  { id: 3, batchNo: 'XW-2603', material: '竹麻', origin: '四川夹江马村镇', cookAgent: '石灰', cookHours: 11, bleachMethod: '漂白粉', beatingDegree: 27, operator: '郭文山', schemaRev: 3 },
  { id: 4, batchNo: 'XW-2604', material: '稻草', origin: '浙江富阳大源镇', cookAgent: '纯碱', cookHours: 6, bleachMethod: '日晒', beatingDegree: 24, operator: '蒋允中', schemaRev: 3 },
  { id: 5, batchNo: 'XW-2605', material: '构皮', origin: '贵州丹寨石桥村', cookAgent: '石灰', cookHours: 8, bleachMethod: '漂白粉', beatingDegree: 35, operator: '罗青禾', schemaRev: 3 },
]

function seedRun(
  id: number,
  runNo: string,
  mouldId: number,
  batchId: number,
  runDate: string,
  operator: string,
  measuredGap: number | null,
  standardGap: number | null,
  extra: Partial<SheetRun> = {},
): SheetRun {
  const matched = resolveMouldVersion(seedVersions, mouldId, runDate)
  const versionId = matched?.id ?? null
  const deviation = calculateDeviation(measuredGap, standardGap)
  return {
    id,
    runNo,
    mouldId,
    batchId,
    runDate,
    operator,
    stripeDirection: '竖帘纹',
    dipCount: 2,
    stackHeight: 42,
    dryMethod: '火墙',
    grammage: 32,
    measuredGap,
    deviation,
    versionId,
    versionNo: matched?.versionNo ?? null,
    paramStatus: measuredGap !== null && matched?.stripeGap !== null ? 'complete' : 'missing-param',
    recalcState: 'stable',
    deviationBefore: null,
    recalculatedAt: null,
    schemaRev: 3,
    ...extra,
  }
}

const seedRuns: SheetRun[] = [
  seedRun(1, 'CB-260701', 1, 1, currentWeekDate(0), '罗青禾', 1.08, dl01CurrentGap),
  seedRun(2, 'CB-260702', 2, 2, currentWeekDate(1), '汪知远', 0.84, dl02Gap),
  seedRun(3, 'CB-260703', 3, 3, currentWeekDate(2), '郭文山', 1.03, dl03Gap, { stripeDirection: '横帘纹', dryMethod: '日晒', dipCount: 2, stackHeight: 48, grammage: 41 }),
  seedRun(4, 'CB-260704', 1, 5, daysAgo(3), '罗青禾', 1.36, dl01CurrentGap, { dipCount: 3, stackHeight: 55, grammage: 36 }),
  seedRun(5, 'CB-260705', 2, 4, daysAgo(6), '蒋允中', 0.82, dl02Gap, { dryMethod: '日晒', stackHeight: 44, grammage: 46 }),
  seedRun(6, 'CB-260706', 3, 2, daysAgo(10), '汪知远', 0.94, dl03Gap, { dipCount: 1, stackHeight: 31, grammage: 27 }),
  seedRun(7, 'CB-260707', 4, 1, daysAgo(17), '林砚秋', 1.5, dl04Gap, { stripeDirection: '横帘纹', dryMethod: '日晒', stackHeight: 39, grammage: 34 }),
  seedRun(8, 'CB-260708', 5, 3, daysAgo(24), '郭文山', 0.71, dl05Gap, { stackHeight: 46, grammage: 44 }),
  // DL-01 维修（20 天前）之前的工序：按初始版本 1.10 mm 判定为超差，不能用当前 1.18 mm 回算成合格
  seedRun(9, 'CB-260709', 1, 2, daysAgo(30), '汪知远', 1.34, dl01BaselineGap, { stackHeight: 38, grammage: 30 }),
]

function seedSample(
  id: number,
  sampleNo: string,
  runId: number,
  sizeMm: number,
  stripeCount: number,
  evenness: PaperSample['evenness'],
  archiveBin: string,
): PaperSample {
  const run = seedRuns.find((entry) => entry.id === runId)!
  const conclusion = buildSampleConclusion({ evenness }, run.deviation)
  const passed = evenness === '均匀' && run.deviation !== null && !isGapOutOfTolerance(run.deviation)
  return {
    id,
    sampleNo,
    runId,
    sizeMm,
    stripeCount,
    evenness,
    archiveBin,
    reviewStatus: passed ? 'archived' : 'pending',
    historyConclusion: conclusion,
    historyDeviation: run.deviation,
    lastReviewedAt: null,
    schemaRev: 3,
  }
}

const seedSamples: PaperSample[] = [
  seedSample(1, 'YZ-01', 1, 210, 46, '均匀', '甲柜-03'),
  seedSample(2, 'YZ-02', 2, 180, 52, '略花', '甲柜-07'),
  seedSample(3, 'YZ-03', 3, 240, 39, '花', '乙柜-02'),
  seedSample(4, 'YZ-04', 4, 210, 31, '略花', '乙柜-05'),
  seedSample(5, 'YZ-05', 5, 200, 48, '均匀', '甲柜-11'),
  seedSample(6, 'YZ-06', 6, 260, 57, '均匀', '丙柜-01'),
]

class GbPaperMillDatabase extends Dexie {
  moulds!: Table<Mould, number>
  mouldRepairs!: Table<MouldRepair, number>
  mouldVersions!: Table<MouldVersion, number>
  fiberBatches!: Table<FiberBatch, number>
  sheetRuns!: Table<SheetRun, number>
  paperSamples!: Table<PaperSample, number>
  sampleReviews!: Table<SampleReview, number>
  recalcJobs!: Table<RecalcJob, number>

  constructor() {
    super('gbpapermill-db')
    this.version(1).stores({
      moulds: '++id,&mouldNo,state,wireMaterial',
      fiberBatches: '++id,&batchNo,material,beatingDegree',
      sheetRuns: '++id,&runNo,mouldId,batchId,runDate,operator',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount',
    })
    this.version(2).stores({
      moulds: '++id,&mouldNo,state,wireMaterial,schemaRev',
      fiberBatches: '++id,&batchNo,material,beatingDegree,schemaRev',
      sheetRuns: '++id,&runNo,mouldId,batchId,runDate,operator,schemaRev',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount,schemaRev',
    }).upgrade(async (transaction) => {
      await transaction.table('moulds').toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = 2
      })
      await transaction.table('fiberBatches').toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = 2
      })
      await transaction.table('sheetRuns').toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = 2
      })
      await transaction.table('paperSamples').toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = 2
      })
    })
    this.version(3).stores({
      moulds: '++id,&mouldNo,state,wireMaterial,schemaRev,currentVersionId',
      mouldRepairs: '++id,&repairNo,mouldId,repairDate,schemaRev',
      mouldVersions: '++id,mouldId,repairId,effectiveDate,versionNo,schemaRev',
      fiberBatches: '++id,&batchNo,material,beatingDegree,schemaRev',
      sheetRuns: '++id,&runNo,mouldId,batchId,runDate,operator,schemaRev,versionId,versionNo,paramStatus,recalcState',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount,schemaRev,reviewStatus',
      sampleReviews: '++id,sampleId,runId,kind,createdAt',
      recalcJobs: '++id,status,createdAt',
    }).upgrade(async (transaction) => {
      const mouldsTable = transaction.table<Mould>('moulds')
      const runsTable = transaction.table<SheetRun>('sheetRuns')
      const samplesTable = transaction.table<PaperSample>('paperSamples')
      const batchesTable = transaction.table<FiberBatch>('fiberBatches')
      const versionsTable = transaction.table<MouldVersion>('mouldVersions')

      // 1. 为每张存量纸帘补齐初始版本快照（以 2000-01-01 为生效基线）
      const legacyMoulds = await mouldsTable.toArray()
      const versionsByMould = new Map<number, MouldVersion[]>()
      let versionSeq = 1
      for (const mould of legacyMoulds) {
        const wireDiameter = typeof mould.wireDiameter === 'number' ? mould.wireDiameter : null
        const stripeGap = typeof mould.stripeGap === 'number' ? mould.stripeGap : null
        const baseline: MouldVersion = {
          id: versionSeq,
          versionNo: 1,
          mouldId: mould.id!,
          repairId: null,
          effectiveDate: BASELINE_DATE,
          wireDiameter,
          stripeGap,
          meshDensity: calculateMeshDensity(wireDiameter, stripeGap),
          note: INITIAL_NOTE,
          schemaRev: 3,
        }
        await versionsTable.put(baseline)
        versionsByMould.set(mould.id!, [baseline])
        versionSeq += 1
        await mouldsTable.update(mould.id!, { currentVersionId: baseline.id!, schemaRev: 3 })
      }

      // 2. 存量工序按日期补匹配版本；缺参数的旧工序标记待补录，不算合格
      const legacyRuns = await runsTable.toArray()
      const deviationByRun = new Map<number, number | null>()
      for (const run of legacyRuns) {
        const versions = versionsByMould.get(run.mouldId) ?? []
        const matched = resolveMouldVersion(versions, run.mouldId, run.runDate)
        const measuredGap = typeof run.measuredGap === 'number' ? run.measuredGap : null
        const standardGap = matched?.stripeGap ?? null
        const deviation = calculateDeviation(measuredGap, standardGap)
        const complete = measuredGap !== null && matched !== null && matched.stripeGap !== null
        deviationByRun.set(run.id!, deviation)
        await runsTable.update(run.id!, {
          measuredGap,
          deviation,
          versionId: matched?.id ?? null,
          versionNo: matched?.versionNo ?? null,
          paramStatus: complete ? 'complete' : 'missing-param',
          recalcState: 'stable',
          deviationBefore: null,
          recalculatedAt: null,
          schemaRev: 3,
        })
      }

      // 3. 存量样本写入历史结论与复检状态，归档样本保留原位置
      const legacySamples = await samplesTable.toArray()
      for (const sample of legacySamples) {
        const deviation = deviationByRun.get(sample.runId) ?? null
        const passed = sample.evenness === '均匀' && deviation !== null && !isGapOutOfTolerance(deviation)
        await samplesTable.update(sample.id!, {
          reviewStatus: passed ? 'archived' : 'pending',
          historyConclusion: buildSampleConclusion(sample, deviation),
          historyDeviation: deviation,
          lastReviewedAt: null,
          schemaRev: 3,
        })
      }

      await batchesTable.toCollection().modify((batch) => {
        batch.schemaRev = 3
      })
    })
    this.on('populate', () => this.seed())
  }

  private async seed(): Promise<void> {
    await this.moulds.bulkAdd(plain(seedMoulds))
    await this.mouldRepairs.bulkAdd(plain(seedRepairs))
    await this.mouldVersions.bulkAdd(plain(seedVersions))
    await this.fiberBatches.bulkAdd(plain(seedBatches))
    await this.sheetRuns.bulkAdd(plain(seedRuns))
    await this.paperSamples.bulkAdd(plain(seedSamples))
  }
}

export const db = new GbPaperMillDatabase()
