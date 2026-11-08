/**
 * Direct Hugging Face Hub file fetcher for the Nemotron 3.5 ASR streaming
 * model. Every other model in the catalog downloads as a side effect of
 * @huggingface/transformers' pipeline() call. Nemotron does not go through
 * that pipeline (raw ONNX sessions via NemotronEngine — see whisperWorker.ts's
 * `nemotron-rnnt` init branch), so this module owns the download step
 * explicitly: fetch each required file over HTTP, write to a `.partial.*`
 * sibling, then atomically rename into place so a killed process never
 * leaves a file that looks complete but isn't.
 *
 * The partial name is unique per download (pid + time + random), the same
 * scheme Parakeet uses. It used to be one fixed `<file>.partial`: two workers
 * fetching the same model wrote into the same partial, the first to finish
 * renamed it away, and the second's rename threw "no such file or directory" —
 * which was then read as a corrupt model and deleted the copy that had just
 * finished. LocalModelDownloadService is now the single download owner, so two
 * writers should not happen at all; this keeps the files safe if they ever do.
 */
import fs from 'fs';
import path from 'path';
import { finished } from 'stream/promises';

import { NEMOTRON_REQUIRED_FILES } from '../modelManager';
import { cleanOrphanedPartialFiles } from '../parakeet/downloadFiles';

export const NEMOTRON_REPO = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
// Single source of truth for the file list lives in modelManager.ts (Task 2) —
// isModelCached() and the downloader must never drift out of sync on which
// files constitute "this model is present".
export const NEMOTRON_FILES = NEMOTRON_REQUIRED_FILES;

// Approximate byte sizes per file, for progress-bar weighting. Exact totals
// aren't required — this only affects how smoothly the bar advances.
// Keyed off `typeof NEMOTRON_REQUIRED_FILES[number]` (not a bare `Record<string, number>`)
// so this object and NEMOTRON_REQUIRED_FILES are compiler-enforced to stay in
// sync: a future add/rename/remove in the required-files list makes this
// object fail to typecheck (missing OR excess key — verified both directions)
// instead of silently producing `APPROX_BYTES[file] === undefined` → `NaN`
// propagating through `downloadedSoFar`, which would defeat the
// `pct === lastReportedPct` dedup guard below (NaN !== NaN never matches)
// and reflood IPC on every chunk.
const APPROX_BYTES: Record<(typeof NEMOTRON_REQUIRED_FILES)[number], number> = {
  'encoder.onnx': 2_800_000, 'encoder.onnx.data': 693_000_000,
  'decoder.onnx': 4_800, 'decoder.onnx.data': 60_000_000,
  'joint.onnx': 2_200, 'joint.onnx.data': 38_000_000,
  'tokenizer.json': 660_000, 'vocab.txt': 65_000, 'tokenizer_config.json': 200,
};
const TOTAL_APPROX_BYTES = Object.values(APPROX_BYTES).reduce((a, b) => a + b, 0);

export async function downloadNemotronFiles(
  destDir: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  // Partials left by a process that is no longer running. A live download's
  // partial (another worker in this process, or another instance) is kept.
  cleanOrphanedPartialFiles(destDir);
  // The reader loop below fires once per network chunk — for the 693MB
  // `encoder.onnx.data` file that's tens of thousands of callbacks. Each
  // callback becomes a `parentPort.postMessage` → LocalModelDownloadService
  // `setEntry` → broadcast to every BrowserWindow (this app runs a 3-window
  // overlay). Dedupe to one call per percentage point so the IPC volume
  // matches every other model's WhisperProgressAggregator-smoothed rate.
  let lastReportedPct = -1;
  const report = (pct: number): void => {
    if (pct === lastReportedPct) return;
    lastReportedPct = pct;
    onProgress(pct);
  };
  let downloadedSoFar = 0;
  for (const file of NEMOTRON_FILES) {
    const destPath = path.join(destDir, file);
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
      downloadedSoFar += APPROX_BYTES[file];
      report(Math.min(99, Math.round((downloadedSoFar / TOTAL_APPROX_BYTES) * 100)));
      continue;
    }
    const url = `https://huggingface.co/${NEMOTRON_REPO}/resolve/main/${file}`;
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${file}: HTTP ${response.status}`);
    }
    // Content-Length, when the server sends one, is the ground truth for how
    // many bytes this file SHOULD be. Compared against actual written bytes
    // below so a connection that terminates cleanly but early (no HTTP
    // error, no thrown read error — just fewer bytes than promised) is
    // still caught, instead of silently producing a truncated-but-nonzero
    // file that isModelCached()/isNemotronModelCached() (size > 0 only)
    // would treat as a valid, complete download forever.
    const expectedBytesHeader = response.headers.get('content-length');
    const expectedBytes = expectedBytesHeader !== null ? Number(expectedBytesHeader) : null;
    const partialPath = `${destPath}.partial.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const fileStream = fs.createWriteStream(partialPath);
    let fileBytes = 0;
    try {
      const reader = response.body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileBytes += value.byteLength;
        // Honor WriteStream backpressure: write() returning false means the
        // internal buffer is over its highWaterMark — await 'drain' before
        // reading more, or a fast network + slow disk accumulates hundreds of
        // MB of queued Buffers in this worker's heap on the 690MB encoder
        // weights (the memory preflight ran BEFORE this download, and 3 real
        // ONNX sessions get created right after it). (2026-08-14 code review.)
        if (!fileStream.write(value)) {
          await new Promise<void>((resolve) => fileStream.once('drain', resolve));
        }
        const pct = Math.min(99, Math.round(((downloadedSoFar + fileBytes) / TOTAL_APPROX_BYTES) * 100));
        report(pct);
      }
      fileStream.end();
      await finished(fileStream);
      if (expectedBytes !== null && Number.isFinite(expectedBytes) && fileBytes !== expectedBytes) {
        // A connection that ended cleanly but early. Reported as a download
        // failure (see loadFailure.ts), which leaves the files that DID arrive
        // whole in place for the retry.
        throw new Error(
          `Truncated download for ${file}: expected ${expectedBytes} bytes, received ${fileBytes}`,
        );
      }
      // Another download finished this file first: keep theirs, drop ours.
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
        fs.rmSync(partialPath, { force: true });
      } else {
        fs.renameSync(partialPath, destPath);
      }
    } catch (downloadErr) {
      // Never leave a partial behind: closing first matters on Windows, where
      // an open file cannot be removed.
      fileStream.destroy();
      try { fs.rmSync(partialPath, { force: true }); } catch { /* still locked — cleanOrphanedPartialFiles gets it later */ }
      throw downloadErr;
    }
    downloadedSoFar += fileBytes;
  }
  report(99);
}

/**
 * Clean up after an interrupted download: only the `.partial.*` files. A file
 * under its real name was renamed there after its length checked out, so it is
 * complete; deleting it turned a quit during the final load into a full 700 MB
 * download at the next launch. The download skips files already present.
 */
export function deletePartialNemotronFiles(destDir: string): void {
  let entries: string[];
  try { entries = fs.readdirSync(destDir); } catch { return; }
  for (const entry of entries) {
    if (!entry.includes('.partial.')) continue;
    try { fs.rmSync(path.join(destDir, entry), { force: true }); } catch { /* a locked file is retried next time */ }
  }
}

/** Remove the whole model folder: its files failed to load as damaged. */
export function discardNemotronFiles(destDir: string): void {
  if (!fs.existsSync(destDir)) return;
  fs.rmSync(destDir, { recursive: true, force: true });
}
