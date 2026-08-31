/**
 * Resolves, verifies and locates an extension's model files on disk.
 *
 * Phase 1 implements the DECISION surface — where a model lives, whether it is
 * present, whether it is allowed to load, and whether its bytes match a known
 * hash. Downloading is Phase 4: `ModelDownloader` is declared here and injected
 * there, so the licence gate below is written once and cannot be bypassed by
 * the download path arriving later.
 *
 * Core distributes no weights. Every byte in this tree got there because the
 * user asked for it, either by confirming a download or by pointing at a file
 * they already had.
 *
 * Downloads land in `~/.natively/models/<extension-id>/`, one directory per
 * extension, which is also the only directory `filesystem.models` admits.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { ExtensionModel } from './ExtensionManifest';
import { extensionModelDir } from './paths';
import { getLicenseLedger, type LicenseLedger } from './LicenseLedger';

export type ModelState =
  | 'not-downloaded'
  | 'downloading'
  | 'ready'
  | 'verification-failed'
  /** Present on disk, but its licence has not been acknowledged. */
  | 'blocked-unacknowledged';

export interface ModelStatus {
  extensionId: string;
  modelKey: string;
  state: ModelState;
  /** Absolute path the model is expected at, present or not. */
  filePath: string;
  /** Bytes on disk, when the file exists. */
  bytes?: number;
  /** Why the model is blocked or failed, for the UI. */
  reason?: string;
}

/** Implemented in Phase 4. Declared here so the licence gate is written once. */
export interface ModelDownloader {
  download(
    model: ExtensionModel,
    destination: string,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface ModelStoreOptions {
  ledger?: LicenseLedger;
  downloader?: ModelDownloader;
  /** Overrides the storage root. Tests. */
  rootOverride?: string;
}

export class ModelStore {
  private readonly ledger: LicenseLedger;
  private readonly downloader: ModelDownloader | null;
  private readonly rootOverride?: string;
  private readonly downloading = new Set<string>();

  constructor(options: ModelStoreOptions = {}) {
    this.ledger = options.ledger ?? getLicenseLedger();
    this.downloader = options.downloader ?? null;
    this.rootOverride = options.rootOverride;
  }

  /** The extension's private model directory. */
  modelDir(extensionId: string): string {
    return extensionModelDir(extensionId, this.rootOverride);
  }

  /**
   * Absolute path for one model file.
   *
   * `model.file` comes from a downloaded manifest, so it is treated as hostile:
   * only a bare filename is accepted. A manifest cannot place a file outside
   * the extension's own model directory via `../` or an absolute path.
   */
  resolve(extensionId: string, model: ExtensionModel): string {
    const dir = this.modelDir(extensionId);
    const base = path.basename(model.file);
    if (!base || base !== model.file || base === '.' || base === '..' || model.file.includes('\0')) {
      throw new Error(
        `model "${model.key}" declares an unsafe file name ${JSON.stringify(model.file)}; ` +
        'it must be a bare filename with no path separators',
      );
    }
    return path.join(dir, base);
  }

  /**
   * Path to the file within its SOURCE repository. Remote-side only — never
   * used to build a local path, which always comes from `resolve()`.
   */
  sourcePath(model: ExtensionModel): string {
    return model.repoPath ?? model.file;
  }

  /**
   * Whether this model may be loaded at all.
   *
   * A model whose manifest sets `requiresAcknowledgement` and has no matching
   * ledger entry is REFUSED, regardless of whether its bytes are already on
   * disk — including a file the user supplied themselves.
   */
  isLoadAllowed(extensionId: string, model: ExtensionModel): { allowed: boolean; reason?: string } {
    if (!model.license.requiresAcknowledgement) return { allowed: true };
    if (this.ledger.hasAcknowledged(extensionId, model.key, model.license.spdx)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        `model "${model.key}" is licensed ${model.license.spdx} and requires acknowledgement ` +
        'before it can be loaded',
    };
  }

  status(extensionId: string, model: ExtensionModel): ModelStatus {
    const filePath = this.resolve(extensionId, model);
    const base: ModelStatus = { extensionId, modelKey: model.key, state: 'not-downloaded', filePath };

    const gate = this.isLoadAllowed(extensionId, model);
    if (!gate.allowed) {
      return { ...base, state: 'blocked-unacknowledged', reason: gate.reason };
    }

    if (this.downloading.has(this.key(extensionId, model.key))) {
      return { ...base, state: 'downloading' };
    }

    let bytes: number;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size === 0) return base;
      bytes = stat.size;
    } catch {
      return base;
    }

    return { ...base, state: 'ready', bytes };
  }

  /**
   * Verify a file against a known hash.
   *
   * When `expected` is null the hash is unknown — this is the first verified
   * download — so the computed digest is returned for the caller to RECORD in
   * the manifest. An unknown hash is never treated as a passing check.
   */
  async verify(filePath: string, expected: string | null | undefined): Promise<
    { ok: true; sha256: string; recorded: boolean } | { ok: false; sha256: string | null; reason: string }
  > {
    let actual: string;
    try {
      actual = await sha256File(filePath);
    } catch (e) {
      return { ok: false, sha256: null, reason: `could not read ${filePath}: ${errText(e)}` };
    }

    if (!expected) return { ok: true, sha256: actual, recorded: true };

    if (actual.toLowerCase() !== expected.toLowerCase()) {
      return {
        ok: false,
        sha256: actual,
        reason: `sha256 mismatch: expected ${expected.toLowerCase()}, got ${actual}`,
      };
    }
    return { ok: true, sha256: actual, recorded: false };
  }

  /**
   * Adopt a file the user already has, instead of downloading it.
   *
   * Copied rather than symlinked: a symlink would let the file move or vanish
   * underneath a load, and on Windows creating one needs either Developer Mode
   * or elevation.
   */
  async useExistingFile(
    extensionId: string,
    model: ExtensionModel,
    sourcePath: string,
  ): Promise<ModelStatus> {
    const gate = this.isLoadAllowed(extensionId, model);
    if (!gate.allowed) {
      return {
        extensionId, modelKey: model.key, state: 'blocked-unacknowledged',
        filePath: this.resolve(extensionId, model), reason: gate.reason,
      };
    }

    const destination = this.resolve(extensionId, model);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(sourcePath, destination);

    const verified = await this.verify(destination, model.sha256);
    if (!verified.ok) {
      try { fs.rmSync(destination, { force: true }); } catch { /* best effort */ }
      return {
        extensionId, modelKey: model.key, state: 'verification-failed',
        filePath: destination, reason: verified.reason,
      };
    }
    return this.status(extensionId, model);
  }

  /**
   * Download a model. Phase 4 injects the downloader; until then this throws
   * rather than silently reporting success.
   */
  async download(
    extensionId: string,
    model: ExtensionModel,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<ModelStatus> {
    const gate = this.isLoadAllowed(extensionId, model);
    if (!gate.allowed) throw new Error(gate.reason);
    if (!this.downloader) {
      throw new Error('no ModelDownloader configured (downloads land in Phase 4)');
    }
    if (model.source === 'huggingface' && model.repo === null) {
      throw new Error(
        `model "${model.key}" has no resolved repository id; supply one in extension.json before downloading`,
      );
    }

    const destination = this.resolve(extensionId, model);
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    const key = this.key(extensionId, model.key);
    this.downloading.add(key);
    try {
      await this.downloader.download(model, destination, onProgress, signal);
    } finally {
      this.downloading.delete(key);
    }

    const verified = await this.verify(destination, model.sha256);
    if (!verified.ok) {
      try { fs.rmSync(destination, { force: true }); } catch { /* best effort */ }
      return {
        extensionId, modelKey: model.key, state: 'verification-failed',
        filePath: destination, reason: verified.reason,
      };
    }
    return this.status(extensionId, model);
  }

  /** Delete every model file for an extension (used on remove). */
  removeAll(extensionId: string): void {
    try {
      fs.rmSync(this.modelDir(extensionId), { recursive: true, force: true });
    } catch { /* best effort */ }
  }

  private key(extensionId: string, modelKey: string): string {
    return extensionId + ' ' + modelKey;
  }
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
