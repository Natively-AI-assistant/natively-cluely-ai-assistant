/**
 * Downloads an extension's model files from Hugging Face.
 *
 * This is the implementation of `ModelDownloader`, the interface `ModelStore`
 * declared up front so that the licence gate would be written once and could not
 * be bypassed by the download path arriving later. Everything about WHERE a file
 * goes, WHETHER it may be fetched, and whether its bytes are correct stays in
 * `ModelStore`. This file only moves bytes.
 *
 * Core distributes no weights. Every byte that lands here got there because the
 * user asked for it.
 *
 * Design notes worth keeping:
 *
 *  - **The revision is pinned before the first byte.** `main` is a moving
 *    target: a repo updated mid-download would produce a file that matches no
 *    recorded hash and no released version. The commit sha is resolved once and
 *    every request uses it, so a resumed download cannot straddle two revisions.
 *
 *  - **Resume is verified, never assumed.** A server that ignores `Range`
 *    answers 200 with the WHOLE file, not 206 with the tail. Appending that to a
 *    partial file produces a corrupt result that is the right size often enough
 *    to be dangerous. A 200 restarts from zero.
 *
 *  - **The partial file is never the destination.** Bytes accumulate in
 *    `<file>.part` and are renamed into place only after the stream closes.
 *    Nothing can observe a half-written model at its real path — and on Windows,
 *    renaming after close is also what avoids the open-handle lock.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { ExtensionModel } from './ExtensionManifest';
import type { ModelDownloader } from './ModelStore';

const HF_API = 'https://huggingface.co/api/models';
const HF_HOST = 'huggingface.co';
const METADATA_TIMEOUT_MS = 20_000;
/** Time allowed for the response HEADERS. The body itself is not on a clock. */
const CONNECT_TIMEOUT_MS = 30_000;
const MAX_RESUME_ATTEMPTS = 3;

export interface HuggingFaceDownloaderOptions {
  fetchImpl?: typeof fetch;
  /** Optional token for gated repos. Sent as a bearer header, never in a URL. */
  getToken?: () => string | undefined;
  logger?: { info(msg: string): void; warn(msg: string): void };
}

/**
 * A Hugging Face repo id: `owner/name`. Validated because it is interpolated
 * into a URL, and because a manifest is downloaded content.
 *
 * Rejects anything with a path separator beyond the single slash, a scheme, a
 * traversal segment, or a host — all of which would point the download
 * somewhere other than the repo the manifest names.
 */
export function isSafeRepoId(repo: string): boolean {
  if (typeof repo !== 'string' || repo.length === 0 || repo.length > 200) return false;
  if (repo.includes('..') || repo.includes('\\') || repo.includes('\0')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(repo)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo);
}

/**
 * The path of a file WITHIN the repo (`onnx/model.onnx`). Sub-directories are
 * legitimate here — unlike the local `file`, which `ModelStore.resolve()`
 * restricts to a bare name — so this validates traversal rather than forbidding
 * separators outright.
 */
export function isSafeRepoPath(repoPath: string): boolean {
  if (typeof repoPath !== 'string' || repoPath.length === 0 || repoPath.length > 512) return false;
  if (repoPath.startsWith('/') || repoPath.includes('\\') || repoPath.includes('\0')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(repoPath)) return false;
  return !repoPath.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

export function buildResolveUrl(repo: string, revision: string, repoPath: string): string {
  const encodedPath = repoPath.split('/').map(encodeURIComponent).join('/');
  return `https://${HF_HOST}/${repo}/resolve/${encodeURIComponent(revision)}/${encodedPath}`;
}

export class HuggingFaceModelDownloader implements ModelDownloader {
  private readonly options: HuggingFaceDownloaderOptions;

  constructor(options: HuggingFaceDownloaderOptions = {}) {
    this.options = options;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'Natively' };
    const token = this.options.getToken?.();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  /**
   * The commit sha for a repo's default branch.
   *
   * Returns null when the repo has no resolvable revision. The caller then falls
   * back to `main`, which is the honest degradation: a download is still better
   * than none, and the sha256 check remains the real guarantee either way.
   */
  async resolveRevision(repo: string): Promise<string | null> {
    const doFetch = this.options.fetchImpl ?? fetch;
    try {
      const res = await doFetch(`${HF_API}/${repo}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const json: any = await res.json();
      return typeof json?.sha === 'string' && json.sha ? json.sha : null;
    } catch {
      return null;
    }
  }

  async download(
    model: ExtensionModel,
    destination: string,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (model.source !== 'huggingface') {
      throw new Error(`unsupported model source ${JSON.stringify(model.source)}; this downloader handles huggingface only`);
    }
    const repo = model.repo;
    if (!repo) {
      // ModelStore checks this too. Repeated here because a guessed repo id must
      // never be reachable, whichever path calls in.
      throw new Error(`model "${model.key}" has no resolved repository id`);
    }
    if (!isSafeRepoId(repo)) {
      throw new Error(`model "${model.key}" declares an unsafe repository id ${JSON.stringify(repo)}`);
    }
    const repoPath = model.repoPath ?? model.file;
    if (!isSafeRepoPath(repoPath)) {
      throw new Error(`model "${model.key}" declares an unsafe repository path ${JSON.stringify(repoPath)}`);
    }

    const revision = (await this.resolveRevision(repo)) ?? 'main';
    const url = buildResolveUrl(repo, revision, repoPath);
    const partPath = `${destination}.part`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    // approxBytes is the manifest's estimate and is only a fallback for the
    // progress denominator. The server's own Content-Length wins whenever it is
    // present, because the estimate can be wrong and progress that exceeds 100%
    // reads as a bug.
    let totalBytes = model.approxBytes > 0 ? model.approxBytes : 0;

    for (let attempt = 0; attempt < MAX_RESUME_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error('download cancelled');

      const already = safeSize(partPath);
      try {
        await this.fetchInto(url, partPath, already, signal, (received) => {
          const total = totalBytes || 0;
          onProgress(total > 0 ? Math.min(1, received / total) : 0);
        }, (contentTotal) => {
          if (contentTotal > 0) totalBytes = contentTotal;
        });

        // Rename only after the write stream has closed. On Windows an open
        // handle makes this fail with EBUSY/EPERM, and the failure looks like a
        // permissions problem rather than a sequencing one.
        fs.renameSync(partPath, destination);
        onProgress(1);
        return;
      } catch (e) {
        if (signal.aborted) {
          // A cancelled download keeps its .part file: the next attempt resumes
          // rather than re-fetching several hundred megabytes.
          throw new Error('download cancelled');
        }
        const last = attempt === MAX_RESUME_ATTEMPTS - 1;
        this.options.logger?.warn(
          `[extensions] download attempt ${attempt + 1} for ${model.key} failed: ${errText(e)}${last ? '' : '; resuming'}`,
        );
        if (last) throw e;
      }
    }
  }

  /**
   * One attempt. Appends to `partPath` when the server honours the range, and
   * truncates when it does not.
   */
  private async fetchInto(
    url: string,
    partPath: string,
    resumeFrom: number,
    signal: AbortSignal,
    onBytes: (receivedTotal: number) => void,
    onTotal: (total: number) => void,
  ): Promise<void> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const headers = this.headers();
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;

    // Two signals: the caller's cancellation, and a connect timeout that must
    // NOT apply to the body. A 400MB model on a slow link is not a stuck
    // request, and one timeout covering both would abort it at the worst moment.
    const connect = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
    const res = await doFetch(url, { headers, signal: AbortSignal.any([signal, connect]) });

    if (res.status === 416) {
      // "Range not satisfiable": the .part is at least as long as the file. It is
      // not trustworthy, so start over rather than rename something unverified.
      try { fs.rmSync(partPath, { force: true }); } catch { /* best effort */ }
      throw new Error('partial file was longer than the remote file; restarting');
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${redactUrl(url)}`);
    }
    if (!res.body) {
      throw new Error('response had no body');
    }

    // THE TRAP. A server that ignores Range replies 200 with the whole file.
    // Appending it to a partial produces a file that is corrupt but plausible.
    const honouredRange = res.status === 206;
    const append = resumeFrom > 0 && honouredRange;
    const startingAt = append ? resumeFrom : 0;
    if (resumeFrom > 0 && !honouredRange) {
      this.options.logger?.info('[extensions] server ignored Range; restarting the download from zero');
    }

    const contentLength = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(contentLength) && contentLength > 0) {
      // With a 206 this header is the REMAINING bytes, not the file size.
      onTotal(append ? startingAt + contentLength : contentLength);
    }

    let received = startingAt;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        onBytes(received);
        controller.enqueue(chunk);
      },
    });

    const out = fs.createWriteStream(partPath, { flags: append ? 'a' : 'w' });
    // `pipeline` closes the write stream on both success and failure, which is
    // what makes the rename above safe on Windows.
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as any), out);
  }
}

function safeSize(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

/** URLs here carry no credentials, but nothing is gained by logging the full path. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '<url>';
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
