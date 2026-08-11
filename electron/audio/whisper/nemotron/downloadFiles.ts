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
    const fileStream = fs.createWriteStream(`${destPath}.partial`);
    let fileBytes = 0;
    const reader = response.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileBytes += value.byteLength;
      fileStream.write(value);
      const pct = Math.min(99, Math.round(((downloadedSoFar + fileBytes) / TOTAL_APPROX_BYTES) * 100));
      report(pct);
    }
    fileStream.end();
    await finished(fileStream);
    fs.renameSync(`${destPath}.partial`, destPath);
    downloadedSoFar += fileBytes;
  }
  report(99);
}

export function deletePartialNemotronFiles(destDir: string): void {
  if (!fs.existsSync(destDir)) return;
  fs.rmSync(destDir, { recursive: true, force: true });
}
