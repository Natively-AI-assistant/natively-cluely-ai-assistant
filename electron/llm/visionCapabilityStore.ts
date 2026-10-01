// electron/llm/visionCapabilityStore.ts
//
// What providers PUBLISH about which models read images, saved (design:
// docs/plans/2026-10-01-vision-capability-design.md, phase 2). The resolver
// (visionResolver.ts) stays pure: callers read answers from here and pass them
// in as facts.
//
// IN-MEMORY UNTIL CONFIGURED. Only main points it at a file, after dev:agent's
// userData override. Test files stub app.getPath to the temp folder and run in
// separate processes, so a store that found its own default path would leave a
// shared /tmp file whose contents changed the next file's routing answers.
//
// ONE INSTANCE ON globalThis, as ProviderPerformanceStore and CredentialsManager
// do: the build gives every electron/*.ts entry its own copy of this module, and
// LLMHelper's copy and VisionProviderRegistry's copy must see the same answers.
//
// A store that cannot persist still works in memory; a corrupt or foreign file
// starts empty. Neither ever blocks a screenshot.

import fs from 'node:fs';
import path from 'node:path';
import { VISION_TEST_FRESH_MS } from './visionProbeOutcome';

const SCHEMA_VERSION = 1;
const GLOBAL_KEY = '__nativelyVisionCapabilityStore';

interface ProviderCatalogue { fetchedAt: number; models: Record<string, boolean> }
interface TestResult { reads: boolean; at: number }
// `tests` is optional and was added in phase 3 WITHOUT a version bump: load()
// starts empty on any other version, so bumping it would have erased every
// user's saved OpenRouter catalogue on upgrade.
interface PersistedShape { version: number; providers: Record<string, ProviderCatalogue>; tests?: Record<string, Record<string, TestResult>> }

const catalogueKey = (provider: string, baseURL: string) => `${provider}|${baseURL}`;
const RESAVE_UNCHANGED_AFTER_MS = 60 * 60 * 1000;

function sameAnswers(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

export class VisionCapabilityStore {
  private readonly filePath: string | null;
  private readonly now: () => number;
  private providers = new Map<string, ProviderCatalogue>();
  private tests = new Map<string, Record<string, TestResult>>();
  /** When each catalogue was last written to disk (its fetchedAt in the file). */
  private savedAt = new Map<string, number>();

  constructor(opts: { filePath?: string | null; now?: () => number } = {}) {
    this.filePath = opts.filePath ?? null;
    this.now = opts.now ?? Date.now;
    this.load();
  }

  /** The provider's published answer, or undefined when it has not said (never "no"). */
  answer(provider: string, baseURL: string, wireModel: string): boolean | undefined {
    const models = this.providers.get(catalogueKey(provider, baseURL))?.models;
    if (!models || !Object.prototype.hasOwnProperty.call(models, wireModel)) return undefined;
    return models[wireModel];
  }

  fetchedAt(provider: string, baseURL: string): number | undefined {
    return this.providers.get(catalogueKey(provider, baseURL))?.fetchedAt;
  }

  /** A fresh catalogue replaces the old one whole: a model gone from it is forgotten. */
  replaceProviderAnswers(provider: string, baseURL: string, answers: ReadonlyMap<string, boolean>): void {
    const key = catalogueKey(provider, baseURL);
    const models = Object.fromEntries(answers);
    const previous = this.providers.get(key);
    const now = this.now();
    this.providers.set(key, { fetchedAt: now, models });
    // LiteLLM's catalogue is refreshed every five minutes while it is in use.
    // The same answers again are not worth a disk write each time: write when
    // they changed, or when the saved copy's refresh time is over an hour old.
    const unchanged = previous !== undefined && sameAnswers(previous.models, models);
    if (unchanged && now - (this.savedAt.get(key) ?? 0) < RESAVE_UNCHANGED_AFTER_MS) return;
    // Remembered only when the write HAPPENED: a failed one (a locked file on
    // Windows, a folder that is not there yet) is tried again next time.
    if (this.save()) this.savedAt.set(key, now);
  }

  /** A saved one-time test result, or undefined when this model was never tested. */
  tested(provider: string, baseURL: string, wireModel: string): TestResult | undefined {
    const models = this.tests.get(catalogueKey(provider, baseURL));
    return models && Object.prototype.hasOwnProperty.call(models, wireModel) ? models[wireModel] : undefined;
  }

  /** Save a definite test result. Transient failures are never recorded. */
  recordTest(provider: string, baseURL: string, wireModel: string, reads: boolean): void {
    const key = catalogueKey(provider, baseURL);
    this.tests.set(key, { ...(this.tests.get(key) ?? {}), [wireModel]: { reads, at: this.now() } });
    this.save();
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as PersistedShape;
      if (parsed?.version !== SCHEMA_VERSION || !parsed.providers || typeof parsed.providers !== 'object') return;
      for (const [key, cat] of Object.entries(parsed.providers)) {
        if (cat && typeof cat.fetchedAt === 'number' && cat.models && typeof cat.models === 'object') {
          const models: Record<string, boolean> = {};
          for (const [id, v] of Object.entries(cat.models)) if (typeof v === 'boolean') models[id] = v;
          this.providers.set(key, { fetchedAt: cat.fetchedAt, models });
          this.savedAt.set(key, cat.fetchedAt);
        }
      }
      // Optional since phase 3. A phase-2 file has no tests section.
      if (parsed.tests && typeof parsed.tests === 'object') {
        for (const [key, models] of Object.entries(parsed.tests)) {
          if (!models || typeof models !== 'object') continue;
          const clean: Record<string, TestResult> = {};
          for (const [id, r] of Object.entries(models)) {
            if (r && typeof r.reads === 'boolean' && Number.isFinite(r.at)) clean[id] = { reads: r.reads, at: r.at };
          }
          this.tests.set(key, clean);
        }
      }
    } catch {
      this.providers.clear(); // corrupt: start empty; the next write repairs the file
      this.tests.clear();
    }
  }

  /** True when the file was written (or there is no file to write). */
  private save(): boolean {
    if (!this.filePath) return true;
    try {
      const payload: PersistedShape = { version: SCHEMA_VERSION, providers: Object.fromEntries(this.providers), tests: Object.fromEntries(this.tests) };
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      // tmp + rename, as ProviderPerformanceStore and SettingsManager do: a crash
      // mid-write leaves the previous good file, not a truncated one.
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.filePath);
      return true;
    } catch {
      // Cannot persist: answers stay in memory for this session.
      return false;
    }
  }
}

export function getVisionCapabilityStore(): VisionCapabilityStore {
  const g = globalThis as Record<string, unknown>;
  const existing = g[GLOBAL_KEY] as VisionCapabilityStore | undefined;
  if (existing) return existing;
  const store = new VisionCapabilityStore({ filePath: null });
  g[GLOBAL_KEY] = store;
  return store;
}

/** main only: from here on answers are loaded from, and saved to, this file. */
export function configureVisionCapabilityStore(filePath: string): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new VisionCapabilityStore({ filePath });
}

/** Test hook: replace (or with null, drop) the shared instance. */
export function __setVisionCapabilityStore(store: VisionCapabilityStore | null): void {
  const g = globalThis as Record<string, unknown>;
  if (store) g[GLOBAL_KEY] = store; else delete g[GLOBAL_KEY];
}

/** A provider's answer for a ROUTED id (`openrouter/openai/gpt-4o` → `openai/gpt-4o`). */
export function storedVisionAnswer(provider: string, routedModel: string, baseURL = ''): boolean | undefined {
  const wire = (routedModel || '').startsWith(`${provider}/`) ? routedModel.slice(provider.length + 1) : routedModel;
  return getVisionCapabilityStore().answer(provider, baseURL, wire);
}

/** One spelling for a self-hosted endpoint, so the writer and the reader build the same key. */
export function normalizeVisionBaseURL(url: string | null | undefined): string {
  return String(url ?? '').trim().replace(/\/+$/, '').replace(/\/v1$/, '').replace(/\/+$/, '');
}

/**
 * A saved one-time test result for a ROUTED id, while it is FRESH. An older one
 * is not an answer (2026-10-01 review): the probe re-tests after 30 days, and
 * when that re-test came back inconclusive the stale result — a "no" above
 * all — stayed in force for as long as the re-tests kept failing.
 */
export function storedVisionTest(provider: string, routedModel: string, baseURL = '', now: number = Date.now()): { reads: boolean; at: number } | undefined {
  const wire = (routedModel || '').startsWith(`${provider}/`) ? routedModel.slice(provider.length + 1) : routedModel;
  const saved = getVisionCapabilityStore().tested(provider, baseURL, wire);
  return saved && now - saved.at < VISION_TEST_FRESH_MS ? saved : undefined;
}
