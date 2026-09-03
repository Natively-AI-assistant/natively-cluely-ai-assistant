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
    verify?: (partPath: string) => Promise<{ ok: boolean; reason?: string }>,
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

    // A PINNED revision wins outright. The reranker catalogue pins a 40-char
    // sha per model and its header states that the pin "is what protects"
    // files carrying `sha256: null` — which the downloader records rather than
    // checks. Resolving live instead would make that claim false, and would let
    // one multi-file install take file 1 from revision A and file 5 from
    // revision B if the repo moved in between.
    const pinned = isSafeRevision(model.revision) ? model.revision! : null;
    // `resolved` is null when the metadata call failed (non-2xx, bad JSON, or
    // the 20s timeout). We still download — from the default branch — but a
    // null revision must never be STAMPED: the literal 'main' compares equal to
    // itself across sessions, so two consecutive metadata failures would make
    // bytes from two genuinely different HEADs look resumable against each
    // other. That is the exact corruption the stamp exists to prevent.
    const resolved = pinned ?? (await this.resolveRevision(repo));
    const revision = resolved ?? 'main';
    const url = buildResolveUrl(repo, revision, repoPath);
    const partPath = `${destination}.part`;
    // Which revision the bytes in `.part` came from. Pinning the sha within one
    // download() call is not enough: a partial left by an EARLIER session
    // belongs to whatever revision was current then, and resuming onto it
    // appends a new revision's tail to an old revision's head. That file is
    // corrupt, plausible in size, and — for any manifest entry with
    // `sha256: null`, which is most of them — passes verification, because
    // ModelStore.verify() treats an unknown hash as "record it", not "check it".
    // So the partial is only reusable when it provably came from this revision.
    const stampPath = `${partPath}.rev`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    discardStalePartial(partPath, stampPath, resolved, this.options.logger);

    // approxBytes is the manifest's estimate and is only a fallback for the
    // progress denominator. The server's own Content-Length wins whenever it is
    // present, because the estimate can be wrong and progress that exceeds 100%
    // reads as a bug.
    let totalBytes = model.approxBytes > 0 ? model.approxBytes : 0;

    for (let attempt = 0; attempt < MAX_RESUME_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error('download cancelled');

      const already = safeSize(partPath);
      // Stamp BEFORE writing any bytes, not only when resuming: a first-time
      // download interrupted before its stamp existed would be discarded by the
      // next session, losing the resume this whole mechanism exists to protect.
      // Only a RESOLVED revision may be stamped; an unresolved one leaves the
      // partial unstamped, which the next session treats as stale and discards.
      // Re-downloading is the safe failure; concatenating two revisions is not.
      if (resolved) writeStamp(stampPath, resolved);
      else { try { fs.rmSync(stampPath, { force: true }); } catch { /* best effort */ } }
      try {
        await this.fetchInto(url, partPath, already, signal, (received) => {
          const total = totalBytes || 0;
          onProgress(total > 0 ? Math.min(1, received / total) : 0);
        }, (contentTotal) => {
          if (contentTotal > 0) totalBytes = contentTotal;
        });

        if (verify) {
          const verdict = await verify(partPath);
          if (!verdict.ok) {
            try { fs.rmSync(partPath, { force: true }); } catch { /* best effort */ }
            try { fs.rmSync(stampPath, { force: true }); } catch { /* best effort */ }
            throw new Error(verdict.reason ?? 'downloaded file failed verification');
          }
        }

        // Rename only after the write stream has closed. On Windows an open
        // handle makes this fail with EBUSY/EPERM, and the failure looks like a
        // permissions problem rather than a sequencing one.
        //
        // The destination can already exist: `ModelStore.download()` does not
        // skip a model that is already `ready`, so re-downloading one lands
        // here with a file in place. POSIX rename replaces silently. Windows is
        // where this bites — if anything still holds the old file open (an ONNX
        // session in a loaded extension is the obvious case) the replace fails,
        // so unlink first and, if it still fails, say WHY rather than emitting a
        // bare EPERM that reads as a permissions bug.
        // POSIX rename over an existing file is ALREADY an atomic replace, so
        // unlinking first would only widen a window in which the user has
        // neither the old model nor the new one. Windows is the platform that
        // needs the old file out of the way — so move it ASIDE there rather
        // than deleting it, and put it back if the replace fails. Either way
        // the user never ends up with no model at all.
        const backupPath = `${destination}.old`;
        let backedUp = false;
        try {
          if (process.platform === 'win32' && fs.existsSync(destination)) {
            try { fs.rmSync(backupPath, { force: true }); } catch { /* best effort */ }
            fs.renameSync(destination, backupPath);
            backedUp = true;
          }
          fs.renameSync(partPath, destination);
        } catch (e: any) {
          // Restore the previous model, and KEEP the stamp: the .part file is
          // complete and correctly stamped, so the next attempt resumes at 100%
          // instead of re-fetching several hundred megabytes. Deleting the
          // stamp before the rename (as this used to) meant every failed
          // Windows replace also threw away a finished download.
          if (backedUp && !fs.existsSync(destination)) {
            try { fs.renameSync(backupPath, destination); } catch { /* best effort */ }
          }
          if (e?.code === 'EPERM' || e?.code === 'EBUSY' || e?.code === 'EACCES') {
            throw new Error(
              `could not replace ${path.basename(destination)}: the existing file is in use. ` +
              'Turn the extension off before re-downloading its model. ' +
              `(${e.code})`,
            );
          }
          throw e;
        }
        // Committed. Only now are the stamp and the displaced old file dead.
        try { fs.rmSync(stampPath, { force: true }); } catch { /* best effort */ }
        if (backedUp) {
          try { fs.rmSync(backupPath, { force: true }); } catch { /* best effort */ }
        }
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
    // request, and one timeout covering both aborts it at the worst moment.
    //
    // `AbortSignal.timeout()` cannot be cancelled, so using it here would do
    // exactly the thing this comment says not to: fetch's signal aborts the
    // whole request, body included. Measured — a real 128MB download aborted
    // twice at 30s and only completed because resume caught it. So the timer is
    // a controller we own, and it is cleared the moment the headers land.
    const connectController = new AbortController();
    const connectTimer = setTimeout(
      () => connectController.abort(new Error(`no response headers within ${CONNECT_TIMEOUT_MS}ms`)),
      CONNECT_TIMEOUT_MS,
    );

    let res: Response;
    try {
      res = await doFetch(url, { headers, signal: AbortSignal.any([signal, connectController.signal]) });
    } finally {
      // Headers are in (or the request failed). Either way the body is no longer
      // on this clock; only the caller's own signal can stop it now.
      clearTimeout(connectTimer);
    }

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

/**
 * Drop a partial that cannot be proved to belong to `revision`.
 *
 * Absent stamp is treated as stale, not as "probably fine": an unstamped
 * partial predates this mechanism, and there is no way to tell which revision
 * wrote it.
 */
function discardStalePartial(
  partPath: string,
  stampPath: string,
  revision: string | null,
  logger?: { info(msg: string): void; warn(msg: string): void },
): void {
  if (safeSize(partPath) === 0) return;

  let stamped: string | null = null;
  try { stamped = fs.readFileSync(stampPath, 'utf8').trim(); } catch { stamped = null; }

  // `revision === null` means we could not resolve which revision the server
  // would serve THIS time, so no partial can be proven to match it — including
  // an unstamped one, where `stamped === revision` would otherwise be
  // null === null and wrongly pass.
  if (revision !== null && stamped === revision) return;

  logger?.info(
    `[extensions] discarding a partial download from ${stamped ? `revision ${stamped}` : 'an unknown revision'}; ` +
    `the current revision is ${revision}`,
  );
  try { fs.rmSync(partPath, { force: true }); } catch { /* best effort */ }
  try { fs.rmSync(stampPath, { force: true }); } catch { /* best effort */ }
}

function writeStamp(stampPath: string, revision: string): void {
  try { fs.writeFileSync(stampPath, revision, 'utf8'); } catch { /* the partial is then treated as stale */ }
}

/** A revision is only usable as a pin if it is a full commit sha. */
export function isSafeRevision(revision: unknown): revision is string {
  return typeof revision === 'string' && /^[a-f0-9]{40}$/i.test(revision);
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
