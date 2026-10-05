/**
 * One-line summary of how an update was downloaded: differential or full.
 *
 * electron-updater tries a blockmap-driven differential download first and
 * silently falls back to the full ~1 GB file (it only logs the reason). During a
 * differential download its `download-progress` events report `total` as the
 * bytes actually being fetched, not the size of the update file — so comparing
 * the last progress total with the finished file's size tells us which path ran.
 *
 * This is how "are users actually getting differential updates?" gets answered
 * from a user's debug log instead of guessed. Platform-independent: macOS diffs
 * the cached update.zip, Windows the cached installer.exe, both report the same way.
 */

export type UpdateDownloadKind = 'differential' | 'full' | 'unknown'

export interface UpdateDownloadSummary {
  kind: UpdateDownloadKind
  fetchedBytes: number | null
  fileBytes: number | null
  message: string
}

const mb = (n: number): string => `${(n / 1e6).toFixed(1)} MB`

export function summarizeUpdateDownload(
  lastProgressTotal: number | null | undefined,
  downloadedFileBytes: number | null | undefined
): UpdateDownloadSummary {
  const fetched = typeof lastProgressTotal === 'number' && lastProgressTotal > 0 ? lastProgressTotal : null
  const file = typeof downloadedFileBytes === 'number' && downloadedFileBytes > 0 ? downloadedFileBytes : null

  if (fetched === null || file === null) {
    return {
      kind: 'unknown',
      fetchedBytes: fetched,
      fileBytes: file,
      message: `download finished (fetched=${fetched === null ? '?' : mb(fetched)}, file=${file === null ? '?' : mb(file)})`,
    }
  }
  if (fetched < file) {
    const pct = Math.round((fetched / file) * 100)
    return {
      kind: 'differential',
      fetchedBytes: fetched,
      fileBytes: file,
      message: `differential download: fetched ${mb(fetched)} of ${mb(file)} (${pct}%)`,
    }
  }
  return {
    kind: 'full',
    fetchedBytes: fetched,
    fileBytes: file,
    message: `full download: ${mb(file)} (no usable blockmap or no cached previous update)`,
  }
}
