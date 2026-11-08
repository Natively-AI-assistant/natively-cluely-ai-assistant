// electron/audio/whisper/parakeet/downloadFiles.ts
import fs from 'fs';
import path from 'path';

/** v3 (multilingual). Kept as the default for callers that predate v2. */
export const PARAKEET_TDT_REPO = 'istupakov/parakeet-tdt-0.6b-v3-onnx';
/** v2 (English only). Same file layout as v3; only the vocabulary differs. */
export const PARAKEET_TDT_V2_REPO = 'istupakov/parakeet-tdt-0.6b-v2-onnx';

export const PARAKEET_TDT_REQUIRED_FILES = [
  'encoder-model.int8.onnx',
  'decoder_joint-model.int8.onnx',
  'nemo128.onnx',
  'vocab.txt',
  'config.json',
] as const;

export type ParakeetRequiredFile = (typeof PARAKEET_TDT_REQUIRED_FILES)[number];

/** One file to fetch: its path inside the repo (and under destDir), and a size for progress. */
export interface ParakeetDownloadFile {
  path: string;
  /** Progress-bar weight only. Truncation is checked against content-length. */
  approxBytes: number;
  /**
   * Exact size, when the file set is pinned to a revision (the CoreML
   * bundles). A file on disk of any other size is damaged: it is fetched
   * again instead of kept, and the install does not count as complete.
   */
  bytes?: number;
}

/** A file on disk is usable: its exact size when that is known, else non-empty. */
export function isParakeetFileIntact(filePath: string, bytes?: number): boolean {
  try {
    const size = fs.statSync(filePath).size;
    return bytes === undefined ? size > 0 : size === bytes;
  } catch {
    return false;
  }
}

/** Everything one engine needs from one Hugging Face repo. */
export interface ParakeetDownloadSet {
  repo: string;
  /** Commit to download from. Unset = `main`. */
  revision?: string;
  files: readonly ParakeetDownloadFile[];
}

// Measured from the Hugging Face tree API. Only the decoder and vocabulary
// differ between the two exports.
const ONNX_APPROX_BYTES: Record<string, Record<ParakeetRequiredFile, number>> = {
  [PARAKEET_TDT_REPO]: {
    'encoder-model.int8.onnx': 652_000_000,
    'decoder_joint-model.int8.onnx': 18_200_000,
    'nemo128.onnx': 140_000,
    'vocab.txt': 120_000,
    'config.json': 100,
  },
  [PARAKEET_TDT_V2_REPO]: {
    'encoder-model.int8.onnx': 652_000_000,
    'decoder_joint-model.int8.onnx': 9_000_000,
    'nemo128.onnx': 140_000,
    'vocab.txt': 10_000,
    'config.json': 100,
  },
};

/** The ONNX Runtime engine's files for one Parakeet export (v2 or v3). */
export function parakeetOnnxDownloadSet(repo: string = PARAKEET_TDT_REPO): ParakeetDownloadSet {
  const sizes = ONNX_APPROX_BYTES[repo];
  if (!sizes) throw new Error(`Unknown Parakeet TDT repo: ${repo}`);
  return {
    repo,
    files: PARAKEET_TDT_REQUIRED_FILES.map((file) => ({ path: file, approxBytes: sizes[file] })),
  };
}

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

/** Downloads the ONNX files for one Parakeet export (v3 unless `repo` says otherwise). */
export async function downloadParakeetTdtFiles(
  destDir: string,
  onProgress: (pct: number) => void,
  repo: string = PARAKEET_TDT_REPO,
): Promise<void> {
  await downloadParakeetFiles(destDir, parakeetOnnxDownloadSet(repo), onProgress);
}

/**
 * Downloads every file in `set` into `destDir`, keeping the repo's folder
 * layout (CoreML bundles are folders). Files already on disk that are intact
 * (isParakeetFileIntact) are kept, so an interrupted download resumes at file
 * granularity; a damaged one is fetched again.
 */
export async function downloadParakeetFiles(
  destDir: string,
  set: ParakeetDownloadSet,
  onProgress: (pct: number) => void,
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  for (const dir of new Set(set.files.map((f) => path.dirname(path.join(destDir, f.path))))) {
    cleanOrphanedPartialFiles(dir);
  }
  const totalApproxBytes = set.files.reduce((sum, f) => sum + f.approxBytes, 0) || 1;

  let lastReportedPct = -1;
  const report = (pct: number): void => {
    if (pct === lastReportedPct) return;
    lastReportedPct = pct;
    onProgress(pct);
  };

  let downloadedSoFar = 0;
  for (const { path: file, approxBytes, bytes } of set.files) {
    const destPath = path.join(destDir, file);
    if (isParakeetFileIntact(destPath, bytes)) {
      downloadedSoFar += approxBytes;
      report(Math.min(99, Math.round((downloadedSoFar / totalApproxBytes) * 100)));
      continue;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const urlPath = file.split('/').map(encodeURIComponent).join('/');
    const url = `https://huggingface.co/${set.repo}/resolve/${set.revision ?? 'main'}/${urlPath}`;
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
          Math.round(((downloadedSoFar + Math.min(fileBytes, approxBytes)) / totalApproxBytes) * 100),
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
      if (bytes !== undefined && fileBytes !== bytes) {
        throw new Error(
          `Downloaded file ${file} was truncated: expected ${bytes} bytes (pinned revision), received ${fileBytes}`,
        );
      }

      // If another concurrent download already finished and placed the valid file, we don't clobber it
      if (isParakeetFileIntact(destPath, bytes)) {
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

    downloadedSoFar += approxBytes;
    report(Math.min(99, Math.round((downloadedSoFar / totalApproxBytes) * 100)));
  }

  report(100);
}
