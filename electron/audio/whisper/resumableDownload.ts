/**
 * Resumable download of a model's large ONNX files, run by the worker before
 * transformers.js' pipeline() so pipeline() finds them in its cache.
 *
 * WHY: transformers.js fetches each file in one request, with no retry, and
 * writes it straight to its final name. A connection that drops 2 GB into
 * Large v3 Turbo's 2.55 GB encoder throws the whole attempt away, and the next
 * one starts from zero; on a network that drops long transfers it never
 * finishes. (Seen here 2026-10-14: ETIMEDOUT and resets on every large file.)
 *
 * Each file streams into `<file>.natively-part`. A failed or cut connection
 * keeps what arrived; the next attempt (this run or a later one, after a quit
 * or a cancel) asks for the rest with an HTTP Range request. Only a part whose
 * size matches the server's is renamed to the real name, so a file under its
 * real name is complete. A file already under its real name is checked against
 * the server's size before it is trusted, because earlier versions let
 * transformers.js write there directly.
 *
 * Small files (config, tokenizer) are left to transformers.js. A file the repo
 * does not have (404) is skipped and left to transformers.js too, so a wrong
 * guess here never fails a download that would otherwise work.
 *
 * Plain fetch + node:fs, the same on macOS and Windows. The worker's fetch
 * already goes through the system proxy (see utils/systemProxy.ts).
 */
import fs from 'fs';
import path from 'path';

export const PART_FILE_SUFFIX = '.natively-part';

const HF_HOST = 'https://huggingface.co';

export interface ResumableProgressEvent {
  status: 'progress' | 'done';
  file: string;
  loaded: number;
  total: number;
}

export interface ResumableDownloadOptions {
  cacheDir: string;
  repo: string;
  /** Paths inside the repo, e.g. `onnx/encoder_model.onnx`. */
  files: string[];
  onProgress?: (event: ResumableProgressEvent) => void;
  /** Consecutive attempts that add no bytes before giving up. */
  maxStalledAttempts?: number;
  /** A connection that delivers nothing for this long is dropped and retried. */
  idleTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

class PermanentDownloadError extends Error {}

function fileUrl(repo: string, file: string): string {
  return `${HF_HOST}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}`;
}

function sizeOf(p: string): number {
  try { return fs.statSync(p).size; } catch { return -1; }
}

/**
 * Windows: an antivirus scanner (or the search indexer) commonly holds a file
 * it just saw being written for a moment after it is closed, and a rename or
 * delete then fails with EPERM / EBUSY / EACCES. Retry those for up to ~10 s;
 * anything else, or a lock that outlasts that, is thrown. On macOS these codes
 * mean a real permission problem, which the retries only delay.
 */
export async function retryWhileLocked(op: () => void, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let waited = 0; ; ) {
    try { op(); return; } catch (err: any) {
      const code = err?.code;
      if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') || waited >= 10_000) throw err;
      const delay = Math.min(2000, 100 * 2 ** Math.floor(waited / 1000));
      await sleep(delay);
      waited += delay;
    }
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Downloads every listed file that is missing or incomplete. Throws when one cannot be finished. */
export async function downloadModelFilesResumable(opts: ResumableDownloadOptions): Promise<void> {
  for (const file of opts.files) {
    await downloadOneFile(opts, file);
  }
}

async function downloadOneFile(opts: ResumableDownloadOptions, file: string): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const maxStalled = opts.maxStalledAttempts ?? 6;
  const idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
  const url = fileUrl(opts.repo, file);
  const dest = path.join(opts.cacheDir, ...opts.repo.split('/'), ...file.split('/'));
  const part = dest + PART_FILE_SUFFIX;
  const report = (status: 'progress' | 'done', loaded: number, total: number) => {
    try { opts.onProgress?.({ status, file, loaded, total }); } catch { /* progress is cosmetic */ }
  };

  let stalled = 0;
  const failed = async (err: unknown): Promise<void> => {
    if (err instanceof PermanentDownloadError) throw err;
    stalled += 1;
    if (stalled >= maxStalled) {
      throw new Error(`Download of ${file} kept failing: ${(err as any)?.message ?? String(err)}`);
    }
    await sleep(Math.min(30_000, 1000 * 2 ** (stalled - 1)));
  };

  // 1. The server's size, which every completeness check below compares to.
  let total = -1;
  while (total < 0) {
    try {
      const head = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(idleTimeoutMs) });
      if (head.status === 404) return; // not in this repo: transformers.js decides
      if (!head.ok) {
        const msg = `HTTP ${head.status} for ${file}`;
        if (!isRetryableStatus(head.status)) throw new PermanentDownloadError(msg);
        throw new Error(msg);
      }
      const len = Number(head.headers.get('content-length'));
      if (!Number.isFinite(len) || len <= 0) return; // size unknown: cannot resume safely
      total = len;
    } catch (err) {
      await failed(err);
    }
  }

  // 2. Already complete under its real name.
  const existing = sizeOf(dest);
  if (existing === total) {
    report('done', total, total);
    return;
  }
  if (existing >= 0) await retryWhileLocked(() => fs.rmSync(dest, { force: true }), sleep);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  // 3. Fetch what is missing from the part, resuming after every failure.
  for (;;) {
    let have = Math.max(0, sizeOf(part));
    if (have > total) {
      fs.rmSync(part, { force: true });
      have = 0;
    }
    if (have === total) {
      await retryWhileLocked(() => fs.renameSync(part, dest), sleep);
      report('done', total, total);
      return;
    }
    const before = have;
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(new Error(`no data for ${idleTimeoutMs / 1000}s`)), idleTimeoutMs);
    };
    let handle: fs.promises.FileHandle | undefined;
    try {
      armIdle();
      const res = await fetchImpl(url, {
        headers: have > 0 ? { Range: `bytes=${have}-` } : {},
        signal: controller.signal,
      });
      if (res.status === 416) {
        // The part does not fit the file any more (it changed upstream).
        fs.rmSync(part, { force: true });
        throw new Error(`range not satisfiable for ${file}`);
      }
      if (!res.ok || !res.body) {
        const msg = `HTTP ${res.status} for ${file}`;
        if (!isRetryableStatus(res.status)) throw new PermanentDownloadError(msg);
        throw new Error(msg);
      }
      // 200 to a Range request: the server sent the whole file. Start over.
      if (have > 0 && res.status !== 206) have = 0;
      handle = await fs.promises.open(part, have > 0 ? 'a' : 'w');
      let loaded = have;
      report('progress', loaded, total);
      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        armIdle();
        await handle.write(chunk);
        loaded += chunk.byteLength;
        report('progress', Math.min(loaded, total), total);
      }
      await handle.close();
      handle = undefined;
      if (sizeOf(part) !== total) throw new Error(`connection closed early for ${file}`);
    } catch (err) {
      if (handle) { try { await handle.close(); } catch { /* already closed */ } }
      if (idleTimer) clearTimeout(idleTimer);
      // Bytes arrived: the connection is working, so the stall count restarts.
      if (Math.max(0, sizeOf(part)) > before) stalled = 0;
      await failed(err);
      continue;
    }
    if (idleTimer) clearTimeout(idleTimer);
  }
}

/**
 * What to keep when an interrupted download is cleaned up before a new
 * attempt: part files (the resume point) and ONNX files (checked against the
 * server's size before use). Everything else is small and fetched again.
 */
export function isResumableDownloadFile(name: string): boolean {
  return name.endsWith(PART_FILE_SUFFIX) || /\.onnx(_data(_\d+)?)?$/.test(name);
}

/**
 * Remove an interrupted download's files except the ones a resume can reuse
 * (see isResumableDownloadFile). The marker file is removed with the rest.
 */
export function deleteInterruptedDownloadKeepingParts(modelDir: string): void {
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (isResumableDownloadFile(e.name)) continue;
      try { fs.rmSync(p, { force: true }); } catch { /* a locked file is retried next time */ }
    }
  };
  walk(modelDir);
}
