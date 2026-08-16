/**
 * Direct Hugging Face Hub file fetcher for the Nemotron 3.5 ASR streaming
 * model. Every other model in the catalog downloads as a side effect of
 * @huggingface/transformers' pipeline() call. Nemotron does not go through
 * that pipeline (raw ONNX sessions via NemotronEngine — see whisperWorker.ts's
 * `nemotron-rnnt` init branch), so this module owns the download step
 * explicitly: fetch each required file over HTTP, write to a `.partial`
 * sibling, then atomically rename into place so a killed process never
 * leaves a file that looks complete but isn't.
 */
import fs from 'fs';
import path from 'path';
import { finished } from 'stream/promises';

import { NEMOTRON_REQUIRED_FILES } from '../modelManager';

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
    const fileStream = fs.createWriteStream(`${destPath}.partial`);
    let fileBytes = 0;
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
      // Clean up the partial file before throwing — an init failure surfaces
      // this as an 'error' worker message (see whisperWorker.ts), which
      // LocalWhisperSTT then classifies via isCorruptModelError and purges
      // the whole model directory on retry; there is no reason to leave a
      // known-truncated `.partial` sitting alongside it in the meantime.
      fs.rmSync(`${destPath}.partial`, { force: true });
      throw new Error(
        `Truncated download for ${file}: expected ${expectedBytes} bytes, received ${fileBytes}`,
      );
    }
    fs.renameSync(`${destPath}.partial`, destPath);
    downloadedSoFar += fileBytes;
  }
  report(99);
}

export function deletePartialNemotronFiles(destDir: string): void {
  if (!fs.existsSync(destDir)) return;
  fs.rmSync(destDir, { recursive: true, force: true });
}
