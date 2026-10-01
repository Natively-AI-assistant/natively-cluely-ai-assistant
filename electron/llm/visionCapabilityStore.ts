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

const SCHEMA_VERSION = 1;
const GLOBAL_KEY = '__nativelyVisionCapabilityStore';

interface ProviderCatalogue { fetchedAt: number; models: Record<string, boolean> }
interface PersistedShape { version: number; providers: Record<string, ProviderCatalogue> }

const catalogueKey = (provider: string, baseURL: string) => `${provider}|${baseURL}`;

export class VisionCapabilityStore {
  private readonly filePath: string | null;
  private readonly now: () => number;
  private providers = new Map<string, ProviderCatalogue>();

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
    this.providers.set(catalogueKey(provider, baseURL), { fetchedAt: this.now(), models: Object.fromEntries(answers) });
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
        }
      }
    } catch {
      this.providers.clear(); // corrupt: start empty; the next write repairs the file
    }
  }

  private save(): void {
    if (!this.filePath) return;
    try {
      const payload: PersistedShape = { version: SCHEMA_VERSION, providers: Object.fromEntries(this.providers) };
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      // tmp + rename, as ProviderPerformanceStore and SettingsManager do: a crash
      // mid-write leaves the previous good file, not a truncated one.
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.filePath);
    } catch {
      // Cannot persist: answers stay in memory for this session.
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
