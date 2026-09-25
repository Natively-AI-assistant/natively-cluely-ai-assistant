// electron/audio/whisper/parakeet/downloadFiles.ts
import fs from 'fs';
import path from 'path';

export const PARAKEET_TDT_REPO = 'istupakov/parakeet-tdt-0.6b-v3-onnx';

export const PARAKEET_TDT_REQUIRED_FILES = [
  'encoder-model.int8.onnx',
  'decoder_joint-model.int8.onnx',
  'nemo128.onnx',
  'vocab.txt',
  'config.json',
] as const;

export type ParakeetRequiredFile = (typeof PARAKEET_TDT_REQUIRED_FILES)[number];

const APPROX_BYTES: Record<ParakeetRequiredFile, number> = {
  'encoder-model.int8.onnx': 652_000_000,
  'decoder_joint-model.int8.onnx': 18_200_000,
  'nemo128.onnx': 140_000,
  'vocab.txt': 120_000,
  'config.json': 100,
};

const TOTAL_APPROX_BYTES = Object.values(APPROX_BYTES).reduce((a, b) => a + b, 0);

/**
 * Cleans up orphaned .partial.* download files left behind if the app or worker
 * process crashed or was terminated mid-stream. Active downloads by living processes
 * are preserved.
 */
export function cleanOrphanedPartialFiles(destDir: string): void {
  try {
    if (!fs.existsSync(destDir)) return;
    const entries = fs.readdirSync(destDir);
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.includes('.partial.')) continue;
      const parts = entry.split('.partial.');
      if (parts.length < 2) continue;
      const meta = parts[1].split('.');
      const pid = Number(meta[0]);
      const timestamp = Number(meta[1]);
      let isConfirmedDead = false;
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          // Process is currently running — never delete an active download's partial file
          continue;
        } catch (e: any) {
          if (e.code === 'ESRCH') {
            isConfirmedDead = true;
          }
        }
      }

      // Only delete if the creating process is confirmed dead, or unparseable and stale (> 24 hours)
      const isStaleOrphan = !Number.isFinite(pid) && Number.isFinite(timestamp) && (now - timestamp > 24 * 60 * 60 * 1000);
      if (isConfirmedDead || isStaleOrphan) {
        try {
          fs.unlinkSync(path.join(destDir, entry));
        } catch {
          // ignore busy/locked file
        }
      }
    }
  } catch {
    // ignore directory read issues
  }
}

export async function downloadParakeetTdtFiles(
  destDir: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  cleanOrphanedPartialFiles(destDir);

  let lastReportedPct = -1;
  const report = (pct: number): void => {
    if (pct === lastReportedPct) return;
    lastReportedPct = pct;
    onProgress(pct);
  };

  let downloadedSoFar = 0;
  for (const file of PARAKEET_TDT_REQUIRED_FILES) {
    const destPath = path.join(destDir, file);
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
      downloadedSoFar += APPROX_BYTES[file];
      report(Math.min(99, Math.round((downloadedSoFar / TOTAL_APPROX_BYTES) * 100)));
      continue;
    }

    const url = `https://huggingface.co/${PARAKEET_TDT_REPO}/resolve/main/${file}`;
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${file}: HTTP ${response.status}`);
    }

    const expectedBytesHeader = response.headers.get('content-length');
    const expectedBytes = expectedBytesHeader !== null ? Number(expectedBytesHeader) : null;
    const partialPath = `${destPath}.partial.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const fileStream = fs.createWriteStream(partialPath);
    let fileBytes = 0;

    try {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileBytes += value.byteLength;
        if (!fileStream.write(value)) {
          await new Promise<void>((resolve) => fileStream.once('drain', resolve));
        }
        const pct = Math.min(
          99,
          Math.round(((downloadedSoFar + fileBytes) / TOTAL_APPROX_BYTES) * 100),
        );
        report(pct);
      }
      fileStream.end();
      await new Promise<void>((resolve, reject) => {
        fileStream.once('finish', resolve);
        fileStream.once('error', reject);
      });

      if (expectedBytes !== null && fileBytes !== expectedBytes) {
        throw new Error(
          `Downloaded file ${file} was truncated: expected ${expectedBytes} bytes, received ${fileBytes}`,
        );
      }

      // If another concurrent download already finished and placed the valid file, we don't clobber it
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
        try { fs.unlinkSync(partialPath); } catch { /* ignore */ }
      } else {
        fs.renameSync(partialPath, destPath);
      }
    } catch (downloadErr) {
      try {
        fs.unlinkSync(partialPath);
      } catch {
        /* ignore */
      }
      throw downloadErr;
    }

    downloadedSoFar += APPROX_BYTES[file];
    report(Math.min(99, Math.round((downloadedSoFar / TOTAL_APPROX_BYTES) * 100)));
  }

  report(100);
}
