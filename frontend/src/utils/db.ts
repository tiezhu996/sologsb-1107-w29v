import Dexie, { type Table } from 'dexie'
import type { FiberBatch } from '../types/fiber-batch'
import type { Mould } from '../types/mould'
import type { MouldVersion } from '../types/mould-version'
import type { PaperSample } from '../types/paper-sample'
import type { RecalcBatch } from '../types/recalc-batch'
import type { RecheckRecord } from '../types/recheck-record'
import type { SheetRun } from '../types/sheet-run'
import { resolveRunParam } from './mouldVersion'
import { calculateDeviation, calculateMeshDensity, getGapConclusion, isGapOutOfTolerance } from './stripe'

export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const SCHEMA_REV = 3

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

const seedMoulds: Mould[] = [
  { id: 1, mouldNo: 'DL-01', frameW: 60, frameH: 90, wireMaterial: '竹丝', wireDiameter: 0.3, stripeGap: 1.1, meshDensity: calculateMeshDensity(0.3, 1.1), weaver: '周守良', state: '在用', schemaRev: SCHEMA_REV },
  { id: 2, mouldNo: 'DL-02', frameW: 55, frameH: 82, wireMaterial: '铜丝', wireDiameter: 0.2, stripeGap: 0.85, meshDensity: calculateMeshDensity(0.2, 0.85), weaver: '沈云舟', state: '在用', schemaRev: SCHEMA_REV },
  { id: 3, mouldNo: 'DL-03', frameW: 72, frameH: 105, wireMaterial: '竹丝', wireDiameter: 0.28, stripeGap: 1.0, meshDensity: calculateMeshDensity(0.28, 1), weaver: '周守良', state: '在用', schemaRev: SCHEMA_REV },
  { id: 4, mouldNo: 'DL-04', frameW: 50, frameH: 76, wireMaterial: '马尾丝', wireDiameter: 0.32, stripeGap: 1.25, meshDensity: calculateMeshDensity(0.32, 1.25), weaver: '林砚秋', state: '待修补', schemaRev: SCHEMA_REV },
  { id: 5, mouldNo: 'DL-05', frameW: 65, frameH: 96, wireMaterial: '铜丝', wireDiameter: 0.18, stripeGap: 0.72, meshDensity: calculateMeshDensity(0.18, 0.72), weaver: '沈云舟', state: '退役', schemaRev: SCHEMA_REV },
]

/** 建帘基线版本：统一以 180 天前作为建帘日期，保证历史工序都能命中 */
function baselineVersions(): MouldVersion[] {
  const builtDate = daysAgo(180)
  return seedMoulds.map((mould) => ({
    mouldId: mould.id as number,
    seq: 1,
    versionDate: builtDate,
    wireDiameter: mould.wireDiameter,
    stripeGap: mould.stripeGap,
    meshDensity: calculateMeshDensity(mould.wireDiameter, mould.stripeGap),
    origin: '建帘' as const,
    operator: mould.weaver,
    note: '建帘基线参数',
    schemaRev: SCHEMA_REV,
  }))
}

/**
 * 演示“早期维修改变后续工序判定”：
 * DL-01 在 12 天前维修，间距由 1.10 调整为 1.22。
 * 这样 run4（3 天前，实测 1.36）按新版比对偏差 +0.14 合格，
 * 而 run1（本周，实测 1.08）按新版偏差 -0.14 仍合格；
 * 同时为“补录/修改早期维修触发重算”提供真实场景。
 */
function demoRepairVersion(): MouldVersion {
  return {
    mouldId: 1,
    seq: 2,
    versionDate: daysAgo(12),
    wireDiameter: 0.3,
    stripeGap: 1.22,
    meshDensity: calculateMeshDensity(0.3, 1.22),
    origin: '维修',
    operator: '周守良',
    note: '换丝修帘，间距调整',
    schemaRev: SCHEMA_REV,
  }
}

const seedBatches: FiberBatch[] = [
  { id: 1, batchNo: 'XW-2601', material: '构皮', origin: '陕西洋县华阳镇', cookAgent: '石灰', cookHours: 9, bleachMethod: '日晒', beatingDegree: 32, operator: '罗青禾', schemaRev: SCHEMA_REV },
  { id: 2, batchNo: 'XW-2602', material: '桑皮', origin: '安徽泾县小岭村', cookAgent: '纯碱', cookHours: 7, bleachMethod: '日晒', beatingDegree: 38, operator: '汪知远', schemaRev: SCHEMA_REV },
  { id: 3, batchNo: 'XW-2603', material: '竹麻', origin: '四川夹江马村镇', cookAgent: '石灰', cookHours: 11, bleachMethod: '漂白粉', beatingDegree: 27, operator: '郭文山', schemaRev: SCHEMA_REV },
  { id: 4, batchNo: 'XW-2604', material: '稻草', origin: '浙江富阳大源镇', cookAgent: '纯碱', cookHours: 6, bleachMethod: '日晒', beatingDegree: 24, operator: '蒋允中', schemaRev: SCHEMA_REV },
  { id: 5, batchNo: 'XW-2605', material: '构皮', origin: '贵州丹寨石桥村', cookAgent: '石灰', cookHours: 8, bleachMethod: '漂白粉', beatingDegree: 35, operator: '罗青禾', schemaRev: SCHEMA_REV },
]

type SeedRunInput = [
  id: number,
  runNo: string,
  mouldId: number,
  batchId: number,
  runDate: string,
  operator: string,
  stripeDirection: '竖帘纹' | '横帘纹',
  dipCount: number,
  stackHeight: number,
  dryMethod: '火墙' | '日晒',
  grammage: number,
  measuredGap: number,
]

const seedRunInputs: SeedRunInput[] = [
  [1, 'CB-260701', 1, 1, currentWeekDate(0), '罗青禾', '竖帘纹', 2, 42, '火墙', 32, 1.08],
  [2, 'CB-260702', 2, 2, currentWeekDate(1), '汪知远', '竖帘纹', 1, 36, '火墙', 29, 0.84],
  [3, 'CB-260703', 3, 3, currentWeekDate(2), '郭文山', '横帘纹', 2, 48, '日晒', 41, 1.03],
  [4, 'CB-260704', 1, 5, daysAgo(3), '罗青禾', '竖帘纹', 3, 55, '火墙', 36, 1.36],
  [5, 'CB-260705', 2, 4, daysAgo(6), '蒋允中', '竖帘纹', 2, 44, '日晒', 46, 0.82],
  [6, 'CB-260706', 3, 2, daysAgo(10), '汪知远', '竖帘纹', 1, 31, '火墙', 27, 0.94],
  [7, 'CB-260707', 4, 1, daysAgo(17), '林砚秋', '横帘纹', 2, 39, '日晒', 34, 1.5],
  [8, 'CB-260708', 5, 3, daysAgo(24), '郭文山', '竖帘纹', 2, 46, '火墙', 44, 0.71],
]

function buildSeedRuns(versions: MouldVersion[]): SheetRun[] {
  return seedRunInputs.map(([id, runNo, mouldId, batchId, runDate, operator, stripeDirection, dipCount, stackHeight, dryMethod, grammage, measuredGap]) => {
    const param = resolveRunParam(versions, mouldId, runDate, measuredGap)
    return {
      id, runNo, mouldId, batchId, runDate, operator, stripeDirection, dipCount, stackHeight, dryMethod, grammage, measuredGap,
      deviation: param.deviation,
      matchedVersionId: param.matchedVersionId,
      standardGap: param.standardGap,
      paramStatus: param.paramStatus,
      recalcBatchId: null,
      schemaRev: SCHEMA_REV,
    }
  })
}

function buildSeedSamples(runs: SheetRun[]): PaperSample[] {
  const seed: Array<[number, string, number, number, number, '均匀' | '略花' | '花', string]> = [
    [1, 'YZ-01', 1, 210, 46, '均匀', '甲柜-03'],
    [2, 'YZ-02', 2, 180, 52, '略花', '甲柜-07'],
    [3, 'YZ-03', 3, 240, 39, '花', '乙柜-02'],
    [4, 'YZ-04', 4, 210, 31, '略花', '乙柜-05'],
    [5, 'YZ-05', 5, 200, 48, '均匀', '甲柜-11'],
    [6, 'YZ-06', 6, 260, 57, '均匀', '丙柜-01'],
  ]
  const runById = new Map(runs.map((run) => [run.id, run]))
  return seed.map(([id, sampleNo, runId, sizeMm, stripeCount, evenness, archiveBin]) => {
    const run = runById.get(runId)
    const deviation = run?.deviation ?? null
    // 档案既有结论：按匀度或当时偏差判断是否需要下架复检
    const needsReview = evenness !== '均匀' || (deviation !== null && isGapOutOfTolerance(deviation))
    return {
      id, sampleNo, runId, sizeMm, stripeCount, evenness, archiveBin,
      reviewStatus: needsReview ? 'pending' : 'archived',
      archivedConclusion: deviation !== null ? getGapConclusion(deviation) : undefined,
      archivedDeviation: deviation,
      pendingBatchId: null,
      lastReviewId: null,
      schemaRev: SCHEMA_REV,
    }
  })
}

class GbPaperMillDatabase extends Dexie {
  moulds!: Table<Mould, number>
  mouldVersions!: Table<MouldVersion, number>
  fiberBatches!: Table<FiberBatch, number>
  sheetRuns!: Table<SheetRun, number>
  paperSamples!: Table<PaperSample, number>
  recheckRecords!: Table<RecheckRecord, number>
  recalcBatches!: Table<RecalcBatch, number>

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
    // v3：引入维修版本快照、复检记录与重算批次，并补齐历史时点匹配
    this.version(3).stores({
      moulds: '++id,&mouldNo,state,wireMaterial,schemaRev,recalcPending',
      mouldVersions: '++id,mouldId,versionDate,origin,schemaRev',
      fiberBatches: '++id,&batchNo,material,beatingDegree,schemaRev',
      sheetRuns: '++id,&runNo,mouldId,batchId,runDate,operator,schemaRev,paramStatus,matchedVersionId',
      paperSamples: '++id,&sampleNo,runId,evenness,stripeCount,schemaRev,reviewStatus',
      recheckRecords: '++id,sampleId,runId,reviewedAt,result,schemaRev',
      recalcBatches: '++id,&batchId,mouldId,status,createdAt,schemaRev',
    }).upgrade(async (transaction) => {
      const mouldsTable = transaction.table<Mould>('moulds')
      const versionsTable = transaction.table<MouldVersion>('mouldVersions')
      const runsTable = transaction.table<SheetRun>('sheetRuns')
      const samplesTable = transaction.table<PaperSample>('paperSamples')

      const moulds = await mouldsTable.toArray()
      // 1) 为每张存量纸帘补一条建帘基线版本快照（用现有参数，日期取系统最早）
      const baselineDate = '1970-01-01'
      let versionId = 1
      const seededVersions: MouldVersion[] = []
      for (const mould of moulds) {
        const version: MouldVersion = {
          id: versionId,
          mouldId: mould.id as number,
          seq: 1,
          versionDate: baselineDate,
          wireDiameter: Number(mould.wireDiameter) || 0,
          stripeGap: Number(mould.stripeGap) || 0,
          meshDensity: Number(mould.meshDensity) || 0,
          origin: '建帘',
          operator: mould.weaver,
          note: '数据升级补齐的建帘基线快照',
          schemaRev: SCHEMA_REV,
        }
        seededVersions.push(version)
        versionId += 1
      }
      await versionsTable.bulkAdd(plain(seededVersions))

      // 2) 回填每条工序的时点匹配版本、标准间距、偏差与参数状态
      const runs = await runsTable.toArray()
      for (const run of runs) {
        const param = resolveRunParam(seededVersions, run.mouldId, run.runDate, Number(run.measuredGap) || 0)
        const patch: Partial<SheetRun> = {
          matchedVersionId: param.matchedVersionId,
          standardGap: param.standardGap,
          deviation: param.deviation,
          paramStatus: param.paramStatus,
          recalcBatchId: null,
          schemaRev: SCHEMA_REV,
        }
        await runsTable.update(run.id as number, patch)
      }

      // 3) 存量样本补齐复检状态：保留原位置与历史结论，需要者标待复检
      const updatedRuns = await runsTable.toArray()
      const runById = new Map(updatedRuns.map((run) => [run.id, run]))
      const samples = await samplesTable.toArray()
      for (const sample of samples) {
        const run = runById.get(sample.runId)
        const deviation = run?.deviation ?? null
        const needsReview = sample.evenness !== '均匀' || (deviation !== null && isGapOutOfTolerance(deviation))
        await samplesTable.update(sample.id as number, {
          reviewStatus: needsReview ? 'pending' : 'archived',
          archivedConclusion: deviation !== null ? getGapConclusion(deviation) : '历史结论（缺失参数，待补录）',
          archivedDeviation: deviation,
          pendingBatchId: null,
          lastReviewId: null,
          schemaRev: SCHEMA_REV,
        })
      }

      await mouldsTable.toCollection().modify((value: Mould) => {
        value.recalcPending = false
        value.schemaRev = SCHEMA_REV
      })
      await transaction.table('fiberBatches').toCollection().modify((value: Record<string, unknown>) => {
        value.schemaRev = SCHEMA_REV
      })
    })
    this.on('populate', () => this.seed())
  }

  private async seed(): Promise<void> {
    await this.moulds.bulkAdd(plain(seedMoulds))
    const versions = [...baselineVersions(), demoRepairVersion()]
    await this.mouldVersions.bulkAdd(plain(versions))
    const runs = buildSeedRuns(versions)
    await this.fiberBatches.bulkAdd(plain(seedBatches))
    await this.sheetRuns.bulkAdd(plain(runs))
    await this.paperSamples.bulkAdd(plain(buildSeedSamples(runs)))
  }
}

export const db = new GbPaperMillDatabase()

/** 仅供需要按既有偏差生成结论的模块复用，避免循环引用 */
export { calculateDeviation }
