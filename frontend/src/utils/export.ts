import { db, plain } from './db'
import { CURRENT_SCHEMA_REV } from './recalculation'

export async function exportDatabaseJson(): Promise<string> {
  const [moulds, mouldRepairs, mouldVersions, fiberBatches, sheetRuns, paperSamples, sampleReviews, recalcJobs] = await Promise.all([
    db.moulds.toArray(),
    db.mouldRepairs.toArray(),
    db.mouldVersions.toArray(),
    db.fiberBatches.toArray(),
    db.sheetRuns.toArray(),
    db.paperSamples.toArray(),
    db.sampleReviews.toArray(),
    db.recalcJobs.toArray(),
  ])
  const filename = `gbpapermill-backup-${new Date().toISOString().slice(0, 10)}.json`
  const backup = plain({
    database: 'gbpapermill-db',
    version: CURRENT_SCHEMA_REV,
    exportedAt: new Date().toISOString(),
    moulds,
    mouldRepairs,
    mouldVersions,
    fiberBatches,
    sheetRuns,
    paperSamples,
    sampleReviews,
    recalcJobs,
    summary: {
      repairs: mouldRepairs.length,
      versionSnapshots: mouldVersions.length,
      runsRecalculated: sheetRuns.filter((run) => run.recalculatedAt !== null).length,
      runsPendingRecalc: sheetRuns.filter((run) => run.recalcState === 'pending').length,
      runsMissingParams: sheetRuns.filter((run) => run.paramStatus === 'missing-param').length,
      samplesPendingReview: paperSamples.filter((sample) => sample.reviewStatus === 'pending').length,
      samplesReviewFailed: paperSamples.filter((sample) => sample.reviewStatus === 'failed').length,
      reviews: sampleReviews.length,
      pendingRecalcJobs: recalcJobs.filter((job) => job.status === 'pending').length,
    },
  })
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return filename
}
