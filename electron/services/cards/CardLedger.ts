// electron/services/cards/CardLedger.ts
//
// The card ledger: how often each onboarding / promotional card was shown,
// its strikes, when it may return and whether it is retired (toaster policy,
// docs/superpowers/specs/2026-09-26-toaster-policy-design.md §7.1). The rules
// live in src/lib/cards/cardPolicy.mjs; this class only owns the file.
//
// One JSON file in the app's data folder, written atomically (temp file, then
// rename) so a crash mid-write leaves the previous version intact. A file that
// cannot be read never blocks startup: it is kept as `.bak` and a fresh ledger
// starts. Same code and path API on macOS and Windows.

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  emptyLedger,
  applyOutcome,
  migrateLegacy,
} from '../../../src/lib/cards/cardPolicy.mjs';
import type { Ledger, LegacyCardHistory } from '../../../src/lib/cards/cardPolicy.mjs';

const FILE_NAME = 'card-ledger.json';

function isLedgerShape(v: unknown): v is Ledger {
  const l = v as Ledger | null;
  return !!l
    && typeof l === 'object'
    && l.version === 1
    && typeof l.firstLaunchAt === 'number'
    && typeof l.launchCount === 'number'
    && !!l.cards && typeof l.cards === 'object';
}

export class CardLedger {
  private ledger: Ledger;
  /**
   * The file exists but could not be READ (not parsed) this session: locked
   * by an antivirus scanner on Windows, a permission error. That is not
   * corruption — keep the file untouched, run from memory, never save over it.
   */
  private readOnly = false;
  /** Launches counted while the file was unreadable, added once it recovers. */
  private pendingLaunches = 0;

  constructor(private readonly filePath: string, private readonly now: () => number = Date.now) {
    this.ledger = this.load();
  }

  /** The instance for this app, anchored on globalThis: esbuild inlines this module into several bundles. */
  public static getInstance(): CardLedger {
    const g = globalThis as unknown as Record<string, CardLedger | undefined>;
    const KEY = '__nativelyCardLedger';
    if (!g[KEY]) g[KEY] = new CardLedger(path.join(app.getPath('userData'), FILE_NAME));
    return g[KEY] as CardLedger;
  }

  private load(): Ledger {
    if (!fs.existsSync(this.filePath)) return emptyLedger(this.now());
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (e: any) {
      console.warn(`[CardLedger] Could not read ${FILE_NAME} (${e?.code || e?.message}); using memory this session and leaving the file alone`);
      this.readOnly = true;
      return emptyLedger(this.now());
    }
    try {
      const parsed = JSON.parse(raw);
      if (!isLedgerShape(parsed)) throw new Error('unexpected shape');
      return { ...parsed, imported: parsed.imported ?? {}, lastPromoShownAt: parsed.lastPromoShownAt ?? null };
    } catch (e: any) {
      console.warn(`[CardLedger] Unreadable ${FILE_NAME} (${e?.message}); keeping it as .bak and starting fresh`);
      try { fs.renameSync(this.filePath, this.filePath + '.bak'); } catch { /* best effort */ }
      return emptyLedger(this.now());
    }
  }

  private save(): void {
    if (this.readOnly) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.ledger));
      fs.renameSync(tmp, this.filePath);
    } catch (e: any) {
      // Memory keeps the change for this session; the next save retries.
      console.warn(`[CardLedger] Could not save ${FILE_NAME}:`, e?.message);
    }
  }

  /**
   * While the file cannot be read, retry on every access; once it reads,
   * adopt it (plus the launches counted meanwhile) and resume saving.
   */
  private tryRecover(): void {
    if (!this.readOnly) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!isLedgerShape(parsed)) return;
      this.ledger = {
        ...parsed,
        imported: parsed.imported ?? {},
        lastPromoShownAt: parsed.lastPromoShownAt ?? null,
        launchCount: parsed.launchCount + this.pendingLaunches,
      };
      this.pendingLaunches = 0;
      this.readOnly = false;
      this.save();
    } catch {
      /* still unreadable */
    }
  }

  /**
   * False while the file exists but cannot be read. Callers must then treat
   * the ledger as not loaded — an empty stand-in would bring back cards the
   * user retired.
   */
  public isReadable(): boolean {
    this.tryRecover();
    return !this.readOnly;
  }

  public get(): Ledger {
    this.tryRecover();
    return this.ledger;
  }

  /** Apply an outcome (throws on an unknown card or outcome, or while unreadable, writing nothing). */
  public record(id: string, outcome: string, meta?: { until?: number }): Ledger {
    this.tryRecover();
    if (this.readOnly) throw new Error('ledger_unreadable');
    this.ledger = applyOutcome(this.ledger, id, outcome, this.now(), meta);
    this.save();
    return this.ledger;
  }

  /** One real app start (main process), not a renderer reload. */
  public recordLaunch(): Ledger {
    this.tryRecover();
    if (this.readOnly) this.pendingLaunches += 1;
    this.ledger = { ...this.ledger, launchCount: this.ledger.launchCount + 1 };
    this.save();
    return this.ledger;
  }

  /** Seed from pre-ledger history, once per source. */
  public importLegacy(source: 'main' | 'renderer', legacy: LegacyCardHistory | null | undefined): Ledger {
    this.tryRecover();
    if (this.readOnly || this.ledger.imported?.[source]) return this.ledger;
    const migrated = migrateLegacy(this.ledger, legacy, this.now());
    this.ledger = { ...migrated, imported: { ...this.ledger.imported, [source]: this.now() } };
    this.save();
    return this.ledger;
  }
}
