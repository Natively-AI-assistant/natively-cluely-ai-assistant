// electron/context-intelligence/debug/jsonl-writer.ts
//
// Robust append-only JSON Lines writer for context-debug records.
//
// Design constraints (all asserted in tests):
//   - One record per line; each line standalone-valid JSON, appended atomically
//     enough that a crash mid-session leaves every COMPLETED line readable.
//   - Writes are serialized through a promise chain (no interleaved appends)
//     and BOUNDED: past MAX_PENDING queued writes, records are dropped and
//     counted — never an unbounded in-memory queue, never backpressure onto
//     the answer path.
//   - Every public method is fire-and-forget-safe: a full disk, a permission
//     error, a deleted directory — all are swallowed (and counted). Logging
//     failure must never fail an AI request.
//   - Injectable directory + clock for tests. No Electron imports.
//   - Rotation: one file per writer session, plus a size cap; retention keeps
//     the newest N files.

import * as fs from 'fs';
import * as path from 'path';

export interface JsonlWriterOptions {
  directory: string;
  /** File-name prefix; the session timestamp is appended. */
  prefix?: string;
  maxFileBytes?: number;
  maxPendingWrites?: number;
  retainFiles?: number;
  now?: () => Date;
}

const DEFAULTS = {
  prefix: 'context-debug',
  maxFileBytes: 50 * 1024 * 1024,
  maxPendingWrites: 500,
  retainFiles: 10,
};

const stamp = (d: Date): string =>
  d.toISOString().replace(/[:]/g, '').replace(/\..+$/, 'Z');

export class ContextDebugJsonlWriter {
  private readonly dir: string;
  private readonly prefix: string;
  private readonly maxFileBytes: number;
  private readonly maxPending: number;
  private readonly retainFiles: number;
  private readonly now: () => Date;

  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private bytesWritten = 0;
  private rotationIndex = 0;
  private currentFile: string | null = null;
  private dirReady = false;
  /** Records dropped (queue bound) or failed (fs error) — observability only. */
  public droppedRecords = 0;
  public writeFailures = 0;

  constructor(opts: JsonlWriterOptions) {
    this.dir = opts.directory;
    this.prefix = opts.prefix ?? DEFAULTS.prefix;
    this.maxFileBytes = opts.maxFileBytes ?? DEFAULTS.maxFileBytes;
    this.maxPending = opts.maxPendingWrites ?? DEFAULTS.maxPendingWrites;
    this.retainFiles = opts.retainFiles ?? DEFAULTS.retainFiles;
    this.now = opts.now ?? (() => new Date());
  }

  /** Path of the file this session appends to (created lazily on first write). */
  getCurrentFilePath(): string {
    if (!this.currentFile) {
      const suffix = this.rotationIndex ? `-${this.rotationIndex}` : '';
      this.currentFile = path.join(this.dir, `${this.prefix}-${stamp(this.now())}${suffix}.jsonl`);
    }
    return this.currentFile;
  }

  /** Queue one record. Never throws; never blocks the caller. */
  append(record: unknown): void {
    if (this.pending >= this.maxPending) { this.droppedRecords += 1; return; }
    let line: string;
    try {
      line = `${JSON.stringify(record)}\n`;
    } catch {
      this.droppedRecords += 1;
      return;
    }
    this.pending += 1;
    this.chain = this.chain.then(async () => {
      try {
        await this.ensureDir();
        if (this.bytesWritten > 0 && this.bytesWritten + line.length > this.maxFileBytes) {
          this.rotationIndex += 1;
          this.currentFile = null;
          this.bytesWritten = 0;
        }
        await fs.promises.appendFile(this.getCurrentFilePath(), line, 'utf8');
        this.bytesWritten += line.length;
      } catch {
        this.writeFailures += 1;
      } finally {
        this.pending -= 1;
      }
    });
  }

  /** Await all queued writes (shutdown/tests). Never rejects. */
  async flush(): Promise<void> {
    try { await this.chain; } catch { /* chain never rejects, but stay safe */ }
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await fs.promises.mkdir(this.dir, { recursive: true });
    this.dirReady = true;
    // Retention runs once per session, off the answer path, best-effort.
    void this.cleanupOldFiles().catch(() => { /* retention is best-effort */ });
  }

  private async cleanupOldFiles(): Promise<void> {
    const entries = await fs.promises.readdir(this.dir);
    const mine = entries
      .filter((f) => f.startsWith(`${this.prefix}-`) && f.endsWith('.jsonl'))
      .sort();                                   // timestamped names sort chronologically
    const excess = mine.length - this.retainFiles;
    for (let i = 0; i < excess; i++) {
      await fs.promises.unlink(path.join(this.dir, mine[i])).catch(() => { /* best-effort */ });
    }
  }
}

// ── shared writer instance ──────────────────────────────────────────────────
//
// Anchored on globalThis (SettingsManager rule): esbuild inlines this module
// per entry bundle; the directory bound by main.ts's copy must be visible to
// the copy inlined into whichever bundle emits a record.

interface SharedWriterState {
  writer: ContextDebugJsonlWriter | null;
  directory: string | null;
}
const WRITER_KEY = '__nativelyContextDebugWriterV1__';
function shared(): SharedWriterState {
  const g = globalThis as unknown as Record<string, unknown>;
  let s = g[WRITER_KEY] as SharedWriterState | undefined;
  if (!s) { s = { writer: null, directory: null }; g[WRITER_KEY] = s; }
  return s;
}

/** Bind the platform log directory once at startup (main process). */
export function bindContextDebugLogDirectory(directory: string): void {
  const s = shared();
  s.directory = directory;
  s.writer = null;          // next append creates a fresh session file there
}

export function getContextDebugWriter(): ContextDebugJsonlWriter | null {
  const s = shared();
  if (!s.directory) return null;
  if (!s.writer) s.writer = new ContextDebugJsonlWriter({ directory: s.directory });
  return s.writer;
}

export function getContextDebugLogDirectory(): string | null {
  return shared().directory;
}

export async function flushContextDebugWriter(): Promise<void> {
  await shared().writer?.flush();
}
