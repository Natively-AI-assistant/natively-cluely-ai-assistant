// electron/llm/performance/ProviderPerformanceStore.ts
//
// The one place provider performance evidence lives.
//
// ONE STORE, NOT TWO. LLMHelper already had a latency map, and its own comment
// names the trap this file has to avoid: "a second latency statistic for one
// provider is the recurring mistake in this area". So `LLMHelper.answerLatency`
// becomes a read/write through this store rather than a parallel population,
// and `answerLatencyKey()` keeps its gating role unchanged — when it returns
// null the route does not adapt and `observedAnswerLatency()` still returns
// null, which is the contract LiveDeadlineRouteTable2026_09_06 pins.
//
// RECORDING IS NOT ADAPTING. The store records every route, including the ones
// whose deadlines are fixed. That is what lets diagnostics say "your Gemini is
// unusually slow on this network" without that observation silently rewriting a
// deadline whose value is derived from something we can read rather than guess.
//
// PERSISTENCE. Its own file under userData, written with the same tmp+rename
// atomicity SettingsManager uses, and deliberately NOT inside settings.json:
// this blob is written far more often than settings and a torn write must not
// be able to take the user's API configuration with it.
//
// HEADLESS-SAFE. Benchmarks, unit tests and early boot all construct this
// without an Electron `app`. Every filesystem touch is defensive and a store
// that cannot persist still works perfectly in memory — losing persistence
// degrades the profile to session scope, which is exactly where it was before.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  PROFILE_SCHEMA_VERSION,
  PROFILE_STALE_AFTER_MS,
  confidenceFor,
  emptyReliability,
  isLatencyAdmissible,
  isReliabilitySignal,
  isStale,
  type Confidence,
  type PerformanceSample,
  type ProviderPerformanceProfile,
  type RouteKind,
  type WorkloadClass,
  type WorkloadEvidence,
  type CapabilityFacts,
} from './types';
import {
  emptyGaps,
  emptyLatency,
  fitContextScaling,
  foldGaps,
  foldLatency,
  foldMean,
} from './estimators';
import { profileKey, profileLookupChain } from './networkProfile';

/** What lands on disk. Versioned as a whole so a migration has one entry point. */
interface PersistedShape {
  version: number;
  savedAt: number;
  profiles: Record<string, ProviderPerformanceProfile>;
}

/**
 * Cap on stored profiles.
 *
 * A profile is created per provider × model × network. A user who travels and
 * tries models could otherwise grow this without bound, and an unbounded file
 * that is rewritten on a debounce is a slow leak with a filesystem cost. 200 is
 * far above any realistic user (a heavy user has ~5 providers × ~6 models × ~4
 * networks = 120) and evicts by `lastUpdated`, so the entry discarded is always
 * the one whose evidence was already stalest.
 */
export const MAX_PROFILES = 200;

/** Debounce on the write. Samples arrive per-turn; the disk does not need that. */
export const SAVE_DEBOUNCE_MS = 5_000;

function emptyWorkload(): WorkloadEvidence {
  return {
    ttft: emptyLatency(),
    total: emptyLatency(),
    reliability: emptyReliability(),
    generationRate: null,
    meanInputTokens: 0,
  };
}

function unknownCapability(): CapabilityFacts {
  return {
    streaming: true,
    vision: 'unknown',
    tools: 'unknown',
    structuredOutput: 'unknown',
    contextWindowTokens: 0,
    source: 'unknown',
  };
}

function newProfile(
  providerId: string,
  modelId: string,
  networkProfileId: string,
  route: RouteKind,
  now: number,
): ProviderPerformanceProfile {
  return {
    version: PROFILE_SCHEMA_VERSION,
    providerId,
    modelId,
    networkProfileId,
    route,
    capability: unknownCapability(),
    workloads: {},
    stream: emptyGaps(),
    contextScaling: null,
    source: 'shipped_prior',
    sampleCount: 0,
    lastUpdated: now,
    firstObserved: now,
  };
}

export interface StoreOptions {
  /**
   * Directory the profile file lives in. Injected so tests never touch a real
   * userData directory, and so the Electron `app` import stays out of this
   * module entirely — it is resolved by the caller that already has it.
   */
  storageDir?: string | null;
  /** Disable all disk I/O (benchmarks, unit tests). */
  ephemeral?: boolean;
  now?: () => number;
}

export class ProviderPerformanceStore {
  private profiles: Map<string, ProviderPerformanceProfile> = new Map();
  private readonly filePath: string | null;
  private readonly now: () => number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private dirty = false;
  /**
   * Bumped by every wipe (`clear`, `invalidateProvider`).
   *
   * A turn that is already streaming when the user hits "reset" will call
   * `record()` afterwards and resurrect one profile from the wipe. Harmless in
   * itself — the resurrected row is a real observation — but it makes "reset"
   * mean something different depending on whether a meeting happens to be live,
   * which is not a thing a user can reason about. Observations that were opened
   * before the wipe are dropped; anything opened after is kept.
   */
  private generation = 0;

  constructor(opts: StoreOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.filePath = opts.ephemeral || !opts.storageDir
      ? null
      : path.join(opts.storageDir, 'provider-performance.json');
  }

  // ─── persistence ────────────────────────────────────────────────────────

  /**
   * Load from disk once. Never throws: a corrupt or unreadable file leaves an
   * empty in-memory store, which behaves exactly like a fresh install — every
   * deadline falls back to its shipped prior, which is the current behaviour.
   */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as PersistedShape;
      const migrated = migrate(parsed);
      if (!migrated) return;
      for (const [key, profile] of Object.entries(migrated.profiles)) {
        if (profile && typeof profile === 'object') this.profiles.set(key, profile);
      }
    } catch {
      // A profile file is a cache of measurements, never user data. Losing it
      // costs a few turns of re-learning; refusing to boot over it would cost
      // the app. Quarantine is deliberately NOT done here (unlike settings.json)
      // because there is nothing in it worth recovering by hand.
    }
  }

  /** Schedule a debounced write. */
  private scheduleSave(): void {
    this.dirty = true;
    if (!this.filePath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
    // Never hold the event loop open for a cache write. Electron's main process
    // exiting with a pending profile save must not be delayed by it, and the
    // next launch simply re-learns.
    (this.saveTimer as unknown as { unref?: () => void }).unref?.();
  }

  /** Write now. Safe to call when nothing is dirty. */
  flush(): void {
    if (!this.filePath || !this.dirty) return;
    this.dirty = false;
    try {
      this.evictIfNeeded();
      const payload: PersistedShape = {
        version: PROFILE_SCHEMA_VERSION,
        savedAt: this.now(),
        profiles: Object.fromEntries(this.profiles),
      };
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      // tmp + rename, the same atomicity SettingsManager uses. A crash mid-write
      // leaves the previous good file rather than a truncated one.
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.filePath);
    } catch {
      // See load(): a cache that cannot persist still works in memory.
    }
  }

  private evictIfNeeded(): void {
    if (this.profiles.size <= MAX_PROFILES) return;
    const byAge = [...this.profiles.entries()].sort((a, b) => a[1].lastUpdated - b[1].lastUpdated);
    for (let i = 0; i < byAge.length - MAX_PROFILES; i++) this.profiles.delete(byAge[i][0]);
  }

  /** Called on app shutdown so the last few turns are not lost. */
  dispose(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.flush();
  }

  // ─── reads ──────────────────────────────────────────────────────────────

  /**
   * The best profile for this identity, walking the Phase 9 ladder:
   * exact network → any network for this model → any model for this provider.
   *
   * A STALE profile is skipped as a deadline source but still returned by
   * {@link getExact} for diagnostics — its reliability history is worth showing
   * even when its latency is too old to size anything.
   */
  lookup(providerId: string, modelId: string, networkProfileId: string): ProviderPerformanceProfile | null {
    this.load();
    const now = this.now();
    const [exactKey] = profileLookupChain(providerId, modelId, networkProfileId);
    const exact = this.profiles.get(exactKey);
    if (exact && exact.sampleCount > 0 && !isStale(exact, now)) return exact;
    // Wildcard tiers are COMPUTED, not stored — storing them would mean writing
    // an aggregate that can silently disagree with the rows it aggregates. Fall
    // back to the freshest sibling under each broader prefix, in order.
    return this.bestMatching(`${providerId}|${modelId}`, now)
      ?? this.bestMatching(providerId, now);
  }

  private bestMatching(prefix: string, now: number): ProviderPerformanceProfile | null {
    let best: ProviderPerformanceProfile | null = null;
    for (const [key, profile] of this.profiles) {
      if (!key.startsWith(`${prefix}|`)) continue;
      if (profile.sampleCount <= 0 || isStale(profile, now)) continue;
      if (!best || profile.lastUpdated > best.lastUpdated) best = profile;
    }
    return best;
  }

  getExact(providerId: string, modelId: string, networkProfileId: string): ProviderPerformanceProfile | null {
    this.load();
    return this.profiles.get(profileKey(providerId, modelId, networkProfileId)) ?? null;
  }

  /** Every profile, freshest first. For the diagnostics surface. */
  all(): ProviderPerformanceProfile[] {
    this.load();
    return [...this.profiles.values()].sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  confidence(providerId: string, modelId: string, networkProfileId: string): Confidence {
    const p = this.lookup(providerId, modelId, networkProfileId);
    return confidenceFor(p?.sampleCount ?? 0);
  }

  // ─── writes ─────────────────────────────────────────────────────────────

  /**
   * Fold one observation in.
   *
   * The hygiene rule is enforced HERE and nowhere else, so there is exactly one
   * answer to "does this sample count?". Latency estimators take only `normal`;
   * everything else that is not a user cancellation lands in the reliability
   * counters. Nothing is discarded outright.
   */
  /**
   * The store's current wipe generation. A caller that intends to record later
   * takes this when the stream OPENS and hands it back to `record()`.
   */
  currentGeneration(): number {
    return this.generation;
  }

  record(sample: PerformanceSample, generation?: number): void {
    this.load();
    // Opened before a wipe → the user asked to forget this, so forget it.
    if (generation !== undefined && generation !== this.generation) return;
    const now = this.now();
    const key = profileKey(sample.providerId, sample.modelId, sample.networkProfileId);
    const existing = this.profiles.get(key);
    const base = existing
      ? { ...existing, workloads: { ...existing.workloads } }
      : newProfile(sample.providerId, sample.modelId, sample.networkProfileId, sample.route, now);

    const workload: WorkloadEvidence = {
      ...(base.workloads[sample.workload] ?? emptyWorkload()),
    };
    workload.reliability = { ...workload.reliability };

    if (isReliabilitySignal(sample.sampleClass)) {
      bumpReliability(workload, sample.sampleClass);
      // Retries are counted for every reliability-bearing sample, including a
      // turn that ultimately SUCCEEDED — a provider that always works on its
      // third attempt is the case this counter exists to make visible, and
      // gating it on failure would hide exactly that.
      if (Number.isFinite(sample.retryCount) && sample.retryCount > 0) {
        workload.reliability.retries += sample.retryCount;
      }
    }

    if (isLatencyAdmissible(sample.sampleClass)) {
      if (sample.ttftMs != null) {
        workload.meanInputTokens = foldMean(
          workload.meanInputTokens,
          workload.ttft.count,
          sample.inputTokens,
        );
        workload.ttft = foldLatency(workload.ttft, sample.ttftMs);
        base.sampleCount += 1;
      }
      if (sample.totalMs != null) workload.total = foldLatency(workload.total, sample.totalMs);
      // A MEAN is right here where it is wrong for latency, and the difference
      // is the same one meanInputTokens documents: this predicts "roughly how
      // long will N tokens take to write", it is not a budget anything must
      // clear. Only a COMPLETED stream contributes — one cut by the runaway cap
      // or a stall has a truncated numerator over an untruncated denominator.
      if (sample.generationRateTps != null && sample.totalMs != null) {
        const prevRate = workload.generationRate;
        workload.generationRate = {
          tokensPerSecond: prevRate
            ? Math.round((foldMean(prevRate.tokensPerSecond * 10, prevRate.count, sample.generationRateTps * 10)) ) / 10
            : sample.generationRateTps,
          count: (prevRate?.count ?? 0) + 1,
        };
      }
      // Gaps come ONLY from a stream that completed. A stalled stream's largest
      // gap IS the stall guard's own value, so feeding it back would teach the
      // guard that this provider's normal gap equals whatever the guard allows —
      // the same upward ratchet the TTFT contract already forbids.
      if (sample.maxGapMs != null && sample.p50GapMs != null) {
        base.stream = foldGaps(base.stream, sample.maxGapMs, sample.p50GapMs);
      }
      base.source = sample.sampleClass === 'calibration'
        ? 'calibration'
        : (base.source === 'shipped_prior' ? 'production' : base.source);
    }

    base.workloads[sample.workload] = workload;
    base.contextScaling = refitContextScaling(base);
    base.lastUpdated = now;
    // ROUTE IS NOT OVERWRITTEN BY A VISION SAMPLE. Caught on real traffic: the
    // calibration vision probe shares this provider+model, so it shares the
    // profile KEY, and writing its route flipped the row to 'vision'. That is
    // not in TTFT_ADAPTIVE_ROUTES, so a profile that had been adapting its text
    // ceiling silently stopped — the ceiling went from a measured 6477ms back
    // to the shipped prior on the very turn calibration was supposed to improve.
    //
    // Vision-ness is already carried by the WORKLOAD dimension, which is where
    // it belongs; `route` describes the transport the text path takes. So a
    // non-vision sample may set it, and a vision sample may only set it on a
    // row that has nothing better.
    if (sample.workload !== 'vision' || base.route === 'vision') {
      base.route = sample.route;
    }

    this.profiles.set(key, base);
    this.scheduleSave();
  }

  /**
   * Fold one CONNECT observation (request start → response headers).
   *
   * Separate from `record` because it is a different measurement with a
   * different lifetime: the connect phase completes long before the stream
   * does, and only one provider path currently exposes it. A sample arrives
   * here whether or not the stream that followed succeeded — a connect that
   * completed is evidence about the network even if the generation then failed.
   */
  recordConnect(
    providerId: string,
    modelId: string,
    networkProfileId: string,
    route: RouteKind,
    ms: number,
    generation?: number,
  ): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.load();
    // Same wipe guard `record` has. Without it a request already in flight when
    // the user pressed "forget" re-creates the row it just erased — and the
    // Settings panel calls load() immediately after forget(), so the
    // resurrected row is visible before the button's animation finishes.
    if (generation !== undefined && generation !== this.generation) return;
    const key = profileKey(providerId, modelId, networkProfileId);
    const existing = this.profiles.get(key)
      ?? newProfile(providerId, modelId, networkProfileId, route, this.now());
    this.profiles.set(key, {
      ...existing,
      connect: foldLatency(existing.connect, ms),
      // `connectUpdatedAt`, NOT `lastUpdated`. See the field's comment: touching
      // lastUpdated here would make a connect measurement resurrect months-old
      // latency evidence past isStale(), and would let a connect-only row
      // outrank a 50-sample row in the eviction sort.
      connectUpdatedAt: this.now(),
    });
    this.scheduleSave();
  }

  /**
   * The connect evidence for ONE exact identity, or null.
   *
   * Deliberately NOT `lookup()`. That walks the ladder to a sibling network when
   * the exact row has no latency samples, which is right for latency — a sibling
   * model on the same provider is a reasonable prior — and wrong for connect:
   * a handshake time is a property of THIS network, and serving another
   * network's is worse than serving none. It also does not gate on
   * `sampleCount`, which counts LATENCY samples: a profile can legitimately hold
   * connect evidence and no committed turns yet, and gating on sampleCount made
   * a fresh identity's connect widening dead until an unrelated turn happened
   * to bump it.
   */
  connectEvidence(
    providerId: string,
    modelId: string,
    networkProfileId: string,
  ): ProviderPerformanceProfile | null {
    this.load();
    const p = this.profiles.get(profileKey(providerId, modelId, networkProfileId));
    if (!p?.connect || p.connect.count <= 0) return null;
    // Connect evidence ages on its own clock, for the same reason it is written
    // on one.
    const age = this.now() - (p.connectUpdatedAt ?? 0);
    return age > PROFILE_STALE_AFTER_MS ? null : p;
  }

  /**
   * Attach capability FACTS read from the existing registries.
   *
   * Separate entry point from `record` on purpose (Phase 4): capability truth
   * and performance evidence must never be able to contaminate each other, and
   * a function that took both would be one refactor away from inferring one
   * from the other.
   */
  setCapabilities(
    providerId: string,
    modelId: string,
    networkProfileId: string,
    capability: CapabilityFacts,
  ): void {
    this.load();
    const key = profileKey(providerId, modelId, networkProfileId);
    const existing = this.profiles.get(key)
      ?? newProfile(providerId, modelId, networkProfileId, 'default_provider', this.now());
    this.profiles.set(key, { ...existing, capability });
    this.scheduleSave();
  }

  /** Drop everything for one provider — called when its config materially changes. */
  invalidateProvider(providerId: string): void {
    this.load();
    this.generation += 1;
    let removed = false;
    for (const key of [...this.profiles.keys()]) {
      if (key.startsWith(`${providerId}|`)) { this.profiles.delete(key); removed = true; }
    }
    if (removed) this.scheduleSave();
  }

  /** Forget everything. Backs the manual "reset all" in diagnostics. */
  clear(): void {
    this.profiles.clear();
    this.generation += 1;
    this.loaded = true;
    this.dirty = true;
  }
}

function bumpReliability(workload: WorkloadEvidence, cls: PerformanceSample['sampleClass']): void {
  const r = workload.reliability;
  switch (cls) {
    // A cold start SUCCEEDED — it was just slow. Counting it as ok is right for
    // reliability and wrong for latency, which is exactly why the two decisions
    // are made by two different predicates.
    case 'normal':
    case 'cold_start':
    case 'calibration':
      r.ok += 1; break;
    case 'timeout': r.timeout += 1; break;
    case 'stall': r.stall += 1; break;
    case 'rate_limit': r.rateLimit += 1; break;
    case 'server_error': r.serverError += 1; break;
    case 'client_error': r.clientError += 1; break;
    case 'connection_failure': r.connectionFailure += 1; break;
    // network_switch / app_resumed / unknown are environmental, not the
    // provider's fault, and counting them against its success rate would make a
    // laptop lid look like an outage.
    default: break;
  }
}

/**
 * Refit the input-size → TTFT line from the workload buckets.
 *
 * Uses each bucket's MEAN input size as x and its decayed max TTFT as y — the
 * same statistic a deadline is sized from, so a projection is comparable to the
 * thing it will be compared against. Vision is excluded: an image turn's prefill
 * is not predicted by its text token count, which is the entire reason vision
 * has its own bucket and its own ceiling.
 */
function refitContextScaling(profile: ProviderPerformanceProfile): ProviderPerformanceProfile['contextScaling'] {
  const points: Array<{ inputTokens: number; ttftMs: number }> = [];
  for (const cls of ['small', 'medium', 'large'] as WorkloadClass[]) {
    const w = profile.workloads[cls];
    if (!w || w.ttft.count <= 0 || w.meanInputTokens <= 0) continue;
    points.push({ inputTokens: w.meanInputTokens, ttftMs: w.ttft.maxMs });
  }
  return fitContextScaling(points);
}

/**
 * Version migration.
 *
 * v1 is the first schema, so there is nothing to migrate FROM yet and an
 * unknown version is dropped rather than guessed at. The function exists now,
 * with that behaviour explicit, so that v2 has an obvious place to land instead
 * of a `parsed.version === 1 ? ... : ...` appearing inline in `load()`.
 */
export function migrate(parsed: unknown): PersistedShape | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<PersistedShape>;
  if (p.version !== PROFILE_SCHEMA_VERSION) return null;
  if (!p.profiles || typeof p.profiles !== 'object') return null;
  return { version: p.version, savedAt: p.savedAt ?? 0, profiles: p.profiles };
}

// ─── process-wide singleton ───────────────────────────────────────────────
//
// Anchored on globalThis for the reason SettingsManager documents: esbuild
// inlines this module into several entry bundles, so a module-level `let` would
// give each bundle its own store and the evidence would silently split.

const GLOBAL_KEY = '__nativelyProviderPerformanceStore__';

export function getProviderPerformanceStore(): ProviderPerformanceStore {
  const g = globalThis as Record<string, unknown>;
  const existing = g[GLOBAL_KEY] as ProviderPerformanceStore | undefined;
  if (existing) return existing;
  const store = new ProviderPerformanceStore({ storageDir: resolveStorageDir() });
  g[GLOBAL_KEY] = store;
  return store;
}

/** Test hook — replace the singleton. */
export function __setProviderPerformanceStore(store: ProviderPerformanceStore | null): void {
  const g = globalThis as Record<string, unknown>;
  if (store) g[GLOBAL_KEY] = store; else delete g[GLOBAL_KEY];
}

/**
 * Where the profile file goes.
 *
 * `app.getPath('userData')` per CLAUDE.md — never a hardcoded path, and never a
 * platform-specific one (this resolves to ~/Library/Application Support/… on
 * macOS and %APPDATA%\… on Windows without this module knowing either). The
 * require is dynamic and guarded because this module is also loaded by
 * benchmarks and unit tests that run under plain Node with no Electron app, and
 * an `os.tmpdir()` fallback there keeps the code path identical rather than
 * branching on "are we in Electron".
 */
function resolveStorageDir(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    const dir = app?.getPath?.('userData');
    if (dir) return dir;
  } catch { /* not in Electron — fall through */ }
  try {
    return path.join(os.tmpdir(), 'natively-provider-performance');
  } catch {
    return null;
  }
}
