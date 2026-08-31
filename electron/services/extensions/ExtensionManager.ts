/**
 * Install / remove / enable / disable / list / load lifecycle.
 *
 * The manager owns the ORDER of operations and the consent gate; it owns no
 * transport (that is `ExtensionHost`) and no policy (that is
 * `PermissionBroker`). Install is deliberately a single funnel: validate,
 * present the permissions, require confirmation, only then record the grant.
 * There is no path that writes a registry record without passing the prompt.
 */

import * as fs from 'fs';
import type { ExtensionManifest } from './ExtensionManifest';
import { validateManifest } from './ExtensionManifest';
import { ExtensionRegistry, type ExtensionRecord } from './ExtensionRegistry';
import { ModelStore } from './ModelStore';
import { CrashSupervisor, createExtensionHost, type ExtensionHost } from './ExtensionHost';
import { createPermissionBroker } from './PermissionBroker';
import { extensionDir, isSafeExtensionId } from './paths';
import {
  isHighRiskPermission,
  type ExtensionContext,
  type ExtensionLogger,
  type ExtensionPermission,
  type RankedCandidate,
  type RerankCandidate,
} from './types';

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export interface InstallPrompt {
  extensionId: string;
  name: string;
  version: string;
  author: string;
  homepage: string;
  permissions: ExtensionPermission[];
  /** Permissions that warrant an explicit warning in the dialog. */
  highRiskPermissions: ExtensionPermission[];
  /** Models the extension would download, with their licence terms. */
  models: Array<{
    key: string;
    approxBytes: number;
    spdx: string;
    licenseUrl: string;
    commercialUseRestricted: boolean;
    requiresAcknowledgement: boolean;
  }>;
  /** True for every extension installed through this system. */
  communityMaintained: boolean;
}

/**
 * Presents the prompt and resolves true only on an affirmative user action.
 * Phase 5 supplies the real dialog. A confirmer that throws is treated as a
 * refusal, so a broken dialog can never read as consent.
 */
export type InstallConfirmer = (prompt: InstallPrompt) => Promise<boolean>;

export type InstallResult =
  | { ok: true; record: ExtensionRecord; warnings: string[] }
  | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export interface ExtensionManagerOptions {
  registry: ExtensionRegistry;
  modelStore: ModelStore;
  appVersion: string;
  confirmInstall: InstallConfirmer;
  logger?: ExtensionLogger;
  supervisor?: CrashSupervisor;
  rootOverride?: string;
  /** Injected by tests; production uses the real utilityProcess host. */
  createHost?: typeof createExtensionHost;
  /** Injected rather than read from process.platform, per the platform contract. */
  platform?: NodeJS.Platform;
}

export class ExtensionManager {
  private readonly registry: ExtensionRegistry;
  private readonly modelStore: ModelStore;
  private readonly appVersion: string;
  private readonly confirmInstall: InstallConfirmer;
  private readonly logger: ExtensionLogger;
  private readonly supervisor: CrashSupervisor;
  private readonly rootOverride?: string;
  private readonly hosts = new Map<string, ExtensionHost>();
  private readonly createHost: typeof createExtensionHost;
  private readonly platform: NodeJS.Platform;

  constructor(options: ExtensionManagerOptions) {
    this.registry = options.registry;
    this.modelStore = options.modelStore;
    this.appVersion = options.appVersion;
    this.confirmInstall = options.confirmInstall;
    this.logger = options.logger ?? consoleLogger('extensions');
    this.supervisor = options.supervisor ?? new CrashSupervisor();
    this.rootOverride = options.rootOverride;
    this.createHost = options.createHost ?? createExtensionHost;
    this.platform = options.platform ?? process.platform;
  }

  // ── Load lifecycle ─────────────────────────────────────────────────────

  /**
   * Start an enabled extension in its own utilityProcess.
   *
   * Refuses to start a disabled one: `enabled` is the user's switch, and a load
   * path that ignored it would resurrect an extension that supervision had just
   * auto-disabled.
   */
  async load(id: string): Promise<ExtensionHost | null> {
    const existing = this.hosts.get(id);
    if (existing) return existing;

    const record = this.registry.get(id);
    if (!record) return null;
    if (!record.enabled) {
      this.logger.warn(`refusing to load "${id}": it is disabled`);
      return null;
    }

    const host = this.createHost({
      manifest: record.manifest,
      extensionDir: extensionDir(id, this.rootOverride),
      modelDir: this.modelStore.modelDir(id),
      broker: createPermissionBroker(this.platform),
      config: { ...record.config },
      logger: this.logger,
      onCrash: () => {
        this.hosts.delete(id);
        this.reportCrash(id);
      },
    });

    try {
      await host.start();
    } catch (e) {
      this.logger.warn(`failed to start "${id}"`, errText(e));
      try { await host.stop(); } catch { /* best effort */ }
      this.reportCrash(id);
      return null;
    }

    this.hosts.set(id, host);
    return host;
  }

  /** Start every enabled extension. Failures are isolated per extension. */
  async loadEnabled(): Promise<void> {
    for (const record of this.registry.list()) {
      if (!record.enabled) continue;
      await this.load(record.id);
    }
  }

  async unload(id: string): Promise<void> {
    const host = this.hosts.get(id);
    if (!host) return;
    this.hosts.delete(id);
    await host.stop();
  }

  /** Stop every running extension. Wire this into the app quit path. */
  async unloadAll(): Promise<void> {
    await Promise.all([...this.hosts.keys()].map((id) => this.unload(id)));
  }

  running(): string[] {
    return [...this.hosts.keys()];
  }

  /**
   * Rerank through a loaded extension. Returns null — never throws — when the
   * extension is absent, times out or fails, so a caller can fall back to the
   * existing ordering without a try/catch at every site.
   */
  async rerank(
    id: string,
    query: string,
    candidates: RerankCandidate[],
    topK: number,
    signal: AbortSignal,
  ): Promise<RankedCandidate[] | null> {
    const host = this.hosts.get(id);
    if (!host) return null;
    try {
      return await host.rerank(query, candidates, topK, signal);
    } catch (e) {
      this.logger.warn(`rerank via "${id}" failed; keeping the existing order`, errText(e));
      return null;
    }
  }

  list(): ExtensionRecord[] {
    return this.registry.list();
  }

  get(id: string): ExtensionRecord | null {
    return this.registry.get(id);
  }

  /**
   * Install from an already-staged payload directory.
   *
   * Fetching the payload is the CLI's job (Phase 5); by the time it reaches
   * here the bytes are on disk and this decides whether they may be recorded.
   */
  async install(params: {
    manifestJson: unknown;
    source: string;
    /** Where the payload was staged. Verified to exist before recording. */
    payloadDir: string;
  }): Promise<InstallResult> {
    const validation = validateManifest(params.manifestJson, { appVersion: this.appVersion });
    if (!validation.ok) return { ok: false, errors: validation.errors };

    const manifest = validation.manifest;

    if (!isSafeExtensionId(manifest.id)) {
      return { ok: false, errors: [`unsafe extension id "${manifest.id}"`] };
    }

    if (!directoryExists(params.payloadDir)) {
      return { ok: false, errors: [`staged payload directory not found: ${params.payloadDir}`] };
    }

    const existing = this.registry.get(manifest.id);

    let confirmed = false;
    try {
      confirmed = await this.confirmInstall(this.buildPrompt(manifest));
    } catch (e) {
      this.logger.warn(`install confirmation failed for "${manifest.id}"`, errText(e));
      confirmed = false;
    }
    if (!confirmed) {
      return { ok: false, errors: ['installation was not confirmed'] };
    }

    const record: ExtensionRecord = {
      id: manifest.id,
      manifest,
      source: params.source,
      installedAt: new Date().toISOString(),
      // Never enabled by default. No extension ships on.
      enabled: false,
      grantedPermissions: [...manifest.permissions],
      // An update keeps the user's configuration; a fresh install starts from
      // the manifest defaults.
      config: existing?.config ?? { ...(manifest.config ?? {}) },
    };

    this.registry.upsert(record);
    fs.mkdirSync(this.modelStore.modelDir(manifest.id), { recursive: true });

    return { ok: true, record, warnings: validation.warnings };
  }

  /** Remove an extension, its models, and its registry entry. */
  remove(id: string): boolean {
    const record = this.registry.get(id);
    if (!record) return false;

    void this.unload(id);
    this.modelStore.removeAll(id);
    try {
      fs.rmSync(extensionDir(id, this.rootOverride), { recursive: true, force: true });
    } catch (e) {
      this.logger.warn(`could not remove payload directory for "${id}"`, errText(e));
    }
    this.supervisor.clear(id);
    return this.registry.remove(id);
  }

  enable(id: string): boolean {
    return this.registry.setEnabled(id, true);
  }

  disable(id: string, reason?: string): boolean {
    // Stop first, then record: leaving a disabled extension running is the
    // failure the user would actually notice.
    void this.unload(id);
    return this.registry.setEnabled(id, false, reason);
  }

  /**
   * Record a crash and disable the extension once it exceeds the session
   * limit. Returns the verdict so the caller can decide whether to restart.
   */
  reportCrash(id: string): ReturnType<CrashSupervisor['recordCrash']> {
    const verdict = this.supervisor.recordCrash(id);
    if (verdict.action === 'disable') {
      this.registry.setEnabled(id, false, verdict.reason);
      this.logger.warn(verdict.reason);
    }
    return verdict;
  }

  /**
   * Build the context handed to an extension's `init()`.
   *
   * Exactly four fields. No `fs`, no `net`, no `process`, and no object that
   * transitively reaches them: `config` is deep-cloned so an extension cannot
   * reach back into the registry's live record and mutate it, and `logger` is
   * a fresh namespaced facade rather than Core's own logger object.
   */
  buildContext(record: ExtensionRecord): ExtensionContext {
    return {
      extensionId: record.id,
      modelDir: this.modelStore.modelDir(record.id),
      logger: namespacedLogger(record.id, this.logger),
      config: deepFreeze(structuredClone(record.config ?? {})),
    };
  }

  private buildPrompt(manifest: ExtensionManifest): InstallPrompt {
    return {
      extensionId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      homepage: manifest.homepage,
      permissions: [...manifest.permissions],
      highRiskPermissions: manifest.permissions.filter(isHighRiskPermission),
      models: manifest.models.map((m) => ({
        key: m.key,
        approxBytes: m.approxBytes,
        spdx: m.license.spdx,
        licenseUrl: m.license.url,
        commercialUseRestricted: m.license.commercialUseRestricted,
        requiresAcknowledgement: m.license.requiresAcknowledgement,
      })),
      communityMaintained: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function directoryExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function namespacedLogger(extensionId: string, base: ExtensionLogger): ExtensionLogger {
  const tag = `[extension:${extensionId}]`;
  return {
    debug: (m, ...a) => base.debug(`${tag} ${m}`, ...a),
    info: (m, ...a) => base.info(`${tag} ${m}`, ...a),
    warn: (m, ...a) => base.warn(`${tag} ${m}`, ...a),
    error: (m, ...a) => base.error(`${tag} ${m}`, ...a),
  };
}

function consoleLogger(tag: string): ExtensionLogger {
  const prefix = `[${tag}]`;
  return {
    debug: (m, ...a) => console.debug(prefix, m, ...a),
    info: (m, ...a) => console.log(prefix, m, ...a),
    warn: (m, ...a) => console.warn(prefix, m, ...a),
    error: (m, ...a) => console.error(prefix, m, ...a),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
