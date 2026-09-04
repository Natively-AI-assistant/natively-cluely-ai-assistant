/**
 * Records which model licences the user has acknowledged.
 *
 * The ledger is the ONLY thing standing between a manifest that sets
 * `requiresAcknowledgement` and a download. `ModelStore` refuses to load such a
 * model without a matching entry here, so an acknowledgement must come from a
 * real user action and is never inferred.
 *
 * Persisted as JSON at `~/.natively/licenses.json`. A corrupt or unreadable
 * ledger reads as EMPTY, never as "everything acknowledged" — the failure mode
 * of a damaged file must be an extra prompt, not a silent grant.
 */

import * as fs from 'fs';
import * as path from 'path';
import { licenseLedgerFile } from './paths';
import { processSingleton, resetProcessSingleton } from './singleton';

export interface LicenseAcknowledgement {
  extensionId: string;
  /** Model key from the manifest, e.g. "jina-reranker-v3.5-Q4_K_M". */
  modelKey: string;
  /** SPDX id recorded at the time of acknowledgement. */
  spdx: string;
  /** ISO-8601 UTC timestamp. */
  acknowledgedAt: string;
}

interface LedgerFile {
  version: 1;
  entries: LicenseAcknowledgement[];
}

const SINGLETON_KEY = 'LicenseLedger';

function entryId(extensionId: string, modelKey: string): string {
  return extensionId + ' ' + modelKey;
}

export class LicenseLedger {
  private readonly filePath: string;
  private cache: Map<string, LicenseAcknowledgement> | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? licenseLedgerFile();
  }

  /**
   * True only when this exact (extension, model) pair was acknowledged AND the
   * recorded licence still matches the manifest's. A model whose licence
   * CHANGED since acknowledgement counts as unacknowledged: the user agreed to
   * different terms, so they are asked again.
   */
  hasAcknowledged(extensionId: string, modelKey: string, spdx?: string): boolean {
    const entry = this.load().get(entryId(extensionId, modelKey));
    if (!entry) return false;
    if (spdx !== undefined && entry.spdx !== spdx) return false;
    return true;
  }

  get(extensionId: string, modelKey: string): LicenseAcknowledgement | null {
    return this.load().get(entryId(extensionId, modelKey)) ?? null;
  }

  list(): LicenseAcknowledgement[] {
    return [...this.load().values()];
  }

  /** Record an acknowledgement. Call ONLY from a confirmed user action. */
  acknowledge(extensionId: string, modelKey: string, spdx: string): LicenseAcknowledgement {
    const entry: LicenseAcknowledgement = {
      extensionId,
      modelKey,
      spdx,
      acknowledgedAt: new Date().toISOString(),
    };
    const cache = this.load();
    cache.set(entryId(extensionId, modelKey), entry);
    this.persist(cache);
    return entry;
  }

  /** Withdraw an acknowledgement (used when an extension is removed). */
  revoke(extensionId: string, modelKey?: string): void {
    const cache = this.load();
    for (const [key, entry] of [...cache.entries()]) {
      if (entry.extensionId !== extensionId) continue;
      if (modelKey !== undefined && entry.modelKey !== modelKey) continue;
      cache.delete(key);
    }
    this.persist(cache);
  }

  /** Drop the in-memory cache so the next read hits disk. Tests. */
  invalidate(): void {
    this.cache = null;
  }

  private load(): Map<string, LicenseAcknowledgement> {
    if (this.cache) return this.cache;

    const cache = new Map<string, LicenseAcknowledgement>();
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LedgerFile>;
      if (parsed && Array.isArray(parsed.entries)) {
        for (const e of parsed.entries) {
          if (
            e && typeof e.extensionId === 'string'
            && typeof e.modelKey === 'string'
            && typeof e.spdx === 'string'
            && typeof e.acknowledgedAt === 'string'
          ) {
            cache.set(entryId(e.extensionId, e.modelKey), e);
          }
        }
      }
    } catch {
      // Missing or corrupt ledger means no acknowledgements. Never a grant.
    }
    this.cache = cache;
    return cache;
  }

  private persist(cache: Map<string, LicenseAcknowledgement>): void {
    const payload: LedgerFile = { version: 1, entries: [...cache.values()] };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    // Write-then-rename, so an interrupted write cannot leave a truncated
    // ledger that reads as "nothing acknowledged" on the next launch. The temp
    // file sits in the SAME directory on purpose: rename is only atomic within
    // one filesystem, and os.tmpdir() is often a different volume on Windows.
    const tmp = this.filePath + '.' + String(process.pid) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}

/** Process-wide ledger. See `singleton.ts` for why this is not a module-level let. */
export function getLicenseLedger(): LicenseLedger {
  return processSingleton(SINGLETON_KEY, () => new LicenseLedger());
}

/** Tests only. */
export function resetLicenseLedger(): void {
  resetProcessSingleton(SINGLETON_KEY);
}
