/**
 * The installed-extension index, persisted to
 * `~/.natively/extensions/registry.json`.
 *
 * This file is the record of what the user INSTALLED and what they GRANTED. It
 * is read back on every launch, so it is treated as untrusted on load: an entry
 * that fails manifest validation is dropped with a warning rather than
 * resurrected, because a hand-edited or corrupted registry must not be able to
 * widen a permission grant.
 */

import * as fs from 'fs';
import * as path from 'path';
import { registryFile } from './paths';
import { processSingleton, resetProcessSingleton } from './singleton';
import { validateManifest, type ExtensionManifest } from './ExtensionManifest';
import type { ExtensionPermission } from './types';

export interface ExtensionRecord {
  id: string;
  manifest: ExtensionManifest;
  /** Where it came from, e.g. "github:owner/repo@v1.0.0" or "registry:<id>". */
  source: string;
  /** ISO-8601 UTC. */
  installedAt: string;
  enabled: boolean;
  /**
   * Permissions the user actually accepted at install. Normally equal to
   * `manifest.permissions`, but stored separately so an UPDATE that adds a
   * permission cannot inherit consent that was never given for it.
   */
  grantedPermissions: ExtensionPermission[];
  /** User configuration for this extension. */
  config: Record<string, unknown>;
  /** Set when supervision auto-disabled it; surfaced in the UI. */
  disabledReason?: string;
}

interface RegistryFile {
  version: 1;
  extensions: ExtensionRecord[];
}

const SINGLETON_KEY = 'ExtensionRegistry';

export interface ExtensionRegistryOptions {
  filePath?: string;
  /** Running app version, for re-validating manifests on load. */
  appVersion: string;
}

export class ExtensionRegistry {
  private readonly filePath: string;
  private readonly appVersion: string;
  private records: Map<string, ExtensionRecord> | null = null;
  private readonly loadWarnings: string[] = [];

  constructor(options: ExtensionRegistryOptions) {
    this.filePath = options.filePath ?? registryFile();
    this.appVersion = options.appVersion;
  }

  list(): ExtensionRecord[] {
    return [...this.load().values()];
  }

  get(id: string): ExtensionRecord | null {
    return this.load().get(id) ?? null;
  }

  has(id: string): boolean {
    return this.load().has(id);
  }

  /** Records dropped during the last load, for logging. */
  warnings(): string[] {
    this.load();
    return [...this.loadWarnings];
  }

  upsert(record: ExtensionRecord): void {
    const records = this.load();
    records.set(record.id, record);
    this.persist(records);
  }

  remove(id: string): boolean {
    const records = this.load();
    const existed = records.delete(id);
    if (existed) this.persist(records);
    return existed;
  }

  setEnabled(id: string, enabled: boolean, disabledReason?: string): boolean {
    const records = this.load();
    const record = records.get(id);
    if (!record) return false;
    record.enabled = enabled;
    if (enabled) delete record.disabledReason;
    else if (disabledReason) record.disabledReason = disabledReason;
    this.persist(records);
    return true;
  }

  setConfig(id: string, config: Record<string, unknown>): boolean {
    const records = this.load();
    const record = records.get(id);
    if (!record) return false;
    record.config = config;
    this.persist(records);
    return true;
  }

  /** Drop the in-memory cache so the next read hits disk. Tests. */
  invalidate(): void {
    this.records = null;
    this.loadWarnings.length = 0;
  }

  private load(): Map<string, ExtensionRecord> {
    if (this.records) return this.records;

    const records = new Map<string, ExtensionRecord>();
    this.loadWarnings.length = 0;

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      const list = Array.isArray(parsed.extensions) ? parsed.extensions : [];

      for (const entry of list) {
        if (!entry || typeof entry.id !== 'string') {
          this.loadWarnings.push('dropped a registry entry with no id');
          continue;
        }

        // Re-validate on load. The app version may have changed since install,
        // and the file may have been edited by hand.
        const validation = validateManifest(entry.manifest, { appVersion: this.appVersion });
        if (!validation.ok) {
          this.loadWarnings.push(
            `dropped "${entry.id}": manifest no longer valid (${validation.errors.join('; ')})`,
          );
          continue;
        }
        if (validation.manifest.id !== entry.id) {
          this.loadWarnings.push(
            `dropped "${entry.id}": manifest id "${validation.manifest.id}" does not match its registry key`,
          );
          continue;
        }

        // A grant is only ever narrowed on load, never widened: anything the
        // manifest no longer declares is discarded.
        const declared = new Set(validation.manifest.permissions);
        const granted = Array.isArray(entry.grantedPermissions)
          ? entry.grantedPermissions.filter((p) => declared.has(p))
          : [];

        records.set(entry.id, {
          id: entry.id,
          manifest: validation.manifest,
          source: typeof entry.source === 'string' ? entry.source : 'unknown',
          installedAt: typeof entry.installedAt === 'string' ? entry.installedAt : new Date(0).toISOString(),
          enabled: entry.enabled === true,
          grantedPermissions: granted,
          config: (entry.config && typeof entry.config === 'object') ? entry.config : {},
          ...(typeof entry.disabledReason === 'string' ? { disabledReason: entry.disabledReason } : {}),
        });
      }
    } catch {
      // Missing or corrupt registry means nothing is installed. Never a grant.
    }

    this.records = records;
    return records;
  }

  private persist(records: Map<string, ExtensionRecord>): void {
    const payload: RegistryFile = { version: 1, extensions: [...records.values()] };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Same-directory temp file: rename is only atomic within one filesystem.
    const tmp = this.filePath + '.' + String(process.pid) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}

/** Process-wide registry. See `singleton.ts` for why this is not a module-level let. */
export function getExtensionRegistry(appVersion: string): ExtensionRegistry {
  return processSingleton(SINGLETON_KEY, () => new ExtensionRegistry({ appVersion }));
}

/** Tests only. */
export function resetExtensionRegistry(): void {
  resetProcessSingleton(SINGLETON_KEY);
}
