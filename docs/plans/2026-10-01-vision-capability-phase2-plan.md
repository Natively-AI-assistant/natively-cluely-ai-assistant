# Vision Capability Phase 2: Provider Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Natively uses what OpenRouter publishes about each model (its `input_modalities`) to decide whether a selected OpenRouter model gets a screenshot. A text-only OpenRouter model stops being handed screenshots it would reject, and the answer is kept in a saved capability cache that later phases build on.

**Architecture:** A new `VisionCapabilityStore` (one instance on `globalThis`, like `ProviderPerformanceStore`) holds provider-published answers keyed by provider + base URL + wire model. It is in-memory until `main` points it at `userData/vision-capabilities.json`. A pure parser turns OpenRouter's `/models` response into answers. LLMHelper refreshes them in the background when an OpenRouter model is selected (at startup too, via `setModel`), and Settings' Refresh writes them as well. The resolver consults them for `openrouter`, and every OpenRouter screenshot site follows.

**Tech Stack:** TypeScript (Electron main), esbuild per-file bundles in `dist-electron/`, `node:test` `.mjs` tests against the built bundle.

**Spec:** `docs/plans/2026-10-01-vision-capability-design.md` (phase 2; sections 1-2). Phase 1 plan: `docs/plans/2026-10-01-vision-capability-phase1-plan.md`.

## Global Constraints

- Natively ships on macOS and Windows. No OS-specific code. File paths only via `app.getPath('userData')` + `path.join`. Writes use tmp + rename (Windows rename replaces the target in Node).
- A screenshot is never sent blind. Provider data may turn "unknown" into "no" only where the provider's own catalogue says so. A missing or failed fetch never counts as "no".
- OpenRouter's `input_modalities` is trusted both ways: OpenRouter rejects images sent to models it lists as text-only ("No endpoints found that support image input").
- Tests never touch the disk unless they inject a store with a temp path. The store is in-memory until `configureVisionCapabilityStore` is called, which only `main` does.
- API keys are never printed or put on argv.
- Land on local `main` only (no push). Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Out of scope, with reasons (Task 5 records them in the design doc):
  - LiteLLM `supports_vision`: confirmed in LiteLLM's docs, but only `true` is trustworthy (absence and `false` also mean "admin didn't set it"). Yes-only data changes nothing a user sees until phase 3, where it lets the one-time test skip a LiteLLM model, so it moves there.
  - 9Router keeps its credentials-backed catalogue (wired in phase 1).
  - Ollama keeps its in-memory `/api/show` cache (its other consumers are phase 5).
  - Gemini and Claude are fully covered by the name list.

## Review Focus

1. OpenRouter ids with suffixes (`:free`, `:batch`, `:nitro`): the key a writer stores must equal the key a reader asks for. A mismatch silently makes the feature a no-op. Tested through the real parser plus real consumers in Task 3.
2. A failed or partial OpenRouter fetch (offline, 5xx, malformed JSON) must leave earlier answers in place and not mark the data fresh; the next selection retries after a short backoff. Tested in Task 4.
3. A corrupt or foreign `vision-capabilities.json` must start empty, not crash startup. Tested in Task 1.
4. Selecting an OpenRouter model in local-only mode, or with OpenRouter switched off, must not fetch anything. Tested in Task 4.
5. A selected text-only OpenRouter model with no other vision provider must say why nothing can read the screenshot ("OpenRouter lists this model as text-only"), not "check the proxy is reachable". Tested in Task 3.

## OpenRouter image sites and their phase-2 behaviour

| Site | Today | Phase 2 |
|---|---|---|
| Chain seat `LLMHelper.ts` (`isOpenRouterModel && openrouterClient`, in `streamVisionWithFallback`) | seated whenever selected | `gatewaySeatReadsImages('openrouter', …)`; unknown keeps today's seat, catalogue "no" skips it |
| Registry `openrouter()` (`VisionProviderRegistry.ts`) | `supportsVision: !!apiKey && isSelected` | same rule, same function |
| Direct Assist `directSelectionSupportsImages` (fallback-rung eligibility and dispatch refusal both call it) | `true` (forward) | resolver with unknown→true; catalogue "no" → the existing clear "does not support image input" refusal |
| Empty-chain message | "check the proxy is reachable" | OpenRouter + catalogue "no": names the model and says OpenRouter lists it as text-only |
| `getCapabilities()` | names | resolver (follows automatically via `visionVerdict`) |
| Non-streaming cascade `generateWithOpenRouter(…, cloudImagePaths)` | forwards images | unchanged. OpenRouter rejects a text-only model with a clear 404, and dropping the image to answer as text would be a blind answer. |

## File structure

- Create `electron/llm/visionCapabilityStore.ts`: the store, its `globalThis` singleton, `configureVisionCapabilityStore`, `storedVisionAnswer`, test hook.
- Create `electron/llm/providerVisionData.ts`: pure `parseOpenRouterVision(json)`.
- Modify `electron/llm/visionResolver.ts`: `providerReportsVision` fact; `openrouter` case; `gatewaySeatReadsImages` gains `'openrouter'`.
- Modify `electron/LLMHelper.ts`:
  - `visionFacts()`;
  - the OpenRouter chain seat;
  - Direct Assist's openrouter case;
  - the empty-chain message;
  - `refreshOpenRouterVisionData()` and its trigger in `setModel`.
- Modify `electron/services/screen/VisionProviderRegistry.ts`: the `openrouter()` rung.
- Modify `electron/utils/modelFetcher.ts`: Settings Refresh writes OpenRouter answers.
- Modify `electron/main.ts`: configure the store before `new ProcessingHelper(this)`.
- Tests (new unless noted):
  - `electron/llm/__tests__/VisionCapabilityStore2026_10_01.test.mjs`
  - `electron/llm/__tests__/fixtures/openrouterModels2026_10_01.json`
  - `electron/llm/__tests__/OpenRouterVisionData2026_10_01.test.mjs`
  - `electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs`
  - `electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs` (modify: empty store injected)

Commands run from the worktree root `.claude/worktrees/vision-phase2`. `SP` = the session scratchpad. Tests need `npm run build:electron` first.

---

### Task 1: The capability store, and reproducing today's behaviour live

**Files:**
- Create: `electron/llm/visionCapabilityStore.ts`
- Modify: `electron/main.ts` (before `this.processingHelper = new ProcessingHelper(this)`)
- Test: `electron/llm/__tests__/VisionCapabilityStore2026_10_01.test.mjs`

**Interfaces:**
- Produces:
  - `class VisionCapabilityStore { constructor(opts?: { filePath?: string | null; now?: () => number }); answer(provider: string, baseURL: string, wireModel: string): boolean | undefined; fetchedAt(provider: string, baseURL: string): number | undefined; replaceProviderAnswers(provider: string, baseURL: string, answers: ReadonlyMap<string, boolean>): void }`
  - `getVisionCapabilityStore(): VisionCapabilityStore` (in-memory until configured)
  - `configureVisionCapabilityStore(filePath: string): void`
  - `__setVisionCapabilityStore(store: VisionCapabilityStore | null): void`
  - `storedVisionAnswer(provider: string, routedModel: string, baseURL?: string): boolean | undefined` (strips the `<provider>/` routing prefix, reads the singleton)

- [ ] **Step 1: Reproduce today's behaviour live (base build).** Follow CLAUDE.md "Agent UI testing via CDP": run `agent-browser skills get core` and `agent-browser skills get electron`, then start `npm run dev:agent` in the background. In the launcher target (`agent-browser tab`, then confirm `location.search`):
  1. Draw the Two Sum screenshot into `.agent/userdata/vp2-code.png`, using the same Pillow snippet as phase 1 Task 1 Step 5.
  2. Set the Gemini and OpenRouter keys over stdin (`setGeminiApiKey`, `setOpenrouterApiKey`; check the exact preload name with `grep -n "setOpenrouterApiKey\|setOpenRouterApiKey" electron/preload.ts`).
  3. Select `openrouter/deepseek/deepseek-v4-flash`, which OpenRouter lists as text-only. Use `setModel` for the session.
  4. Run `generateCodeHint([png], 'Two Sum')`.

Expected (today): the main-process log shows an OpenRouter vision attempt first (it is front-loaded), failing with OpenRouter's image error, then a fallback commit to Gemini. Save the `[Vision]` log lines to `$SP/vp2-live-before.txt` and stop the app through the launcher.

- [ ] **Step 2: Write the failing test.**

```js
/**
 * The vision capability store (2026-10-01): provider-published answers, saved.
 * In-memory until main configures a file, so tests and benchmarks never touch
 * the disk by accident; one instance for every bundle (globalThis), because the
 * build gives each entry its own copy of this module.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const S = require(dist('llm/visionCapabilityStore.js'));

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-')), 'vision-capabilities.json');
const answers = (o) => new Map(Object.entries(o));

describe('answers', () => {
  test('a stored answer is returned for its provider, base URL and model only', () => {
    const s = new S.VisionCapabilityStore({ filePath: null });
    s.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true, 'deepseek/deepseek-v4-flash': false }));
    assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), true);
    assert.equal(s.answer('openrouter', '', 'deepseek/deepseek-v4-flash'), false);
    assert.equal(s.answer('openrouter', '', 'never/listed'), undefined, 'absent is unknown, never "no"');
    assert.equal(s.answer('openrouter', 'http://other', 'openai/gpt-4o'), undefined, 'another base URL is another provider');
    assert.equal(s.answer('litellm', '', 'openai/gpt-4o'), undefined);
  });
  test('a refresh replaces the whole catalogue for that provider and base URL', () => {
    const s = new S.VisionCapabilityStore({ filePath: null, now: () => 1000 });
    s.replaceProviderAnswers('openrouter', '', answers({ 'a/one': true }));
    s.replaceProviderAnswers('openrouter', '', answers({ 'b/two': false }));
    assert.equal(s.answer('openrouter', '', 'a/one'), undefined, 'a model gone from the catalogue is forgotten');
    assert.equal(s.answer('openrouter', '', 'b/two'), false);
    assert.equal(s.fetchedAt('openrouter', ''), 1000);
  });
});

describe('persistence', () => {
  test('in-memory by default: nothing is written until a file is configured', () => {
    S.__setVisionCapabilityStore(null);
    const s = S.getVisionCapabilityStore();
    assert.equal(s.filePath, null, 'the shared default has no file; only main configures one');
    s.replaceProviderAnswers('openrouter', '', answers({ 'x/y': true }));
    assert.equal(s.answer('openrouter', '', 'x/y'), true, 'and still answers in memory');
    S.__setVisionCapabilityStore(null);
  });
  test('a configured file round-trips', () => {
    const file = tmpFile();
    const a = new S.VisionCapabilityStore({ filePath: file, now: () => 42 });
    a.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true, 'z/text': false }));
    const b = new S.VisionCapabilityStore({ filePath: file });
    assert.equal(b.answer('openrouter', '', 'openai/gpt-4o'), true);
    assert.equal(b.answer('openrouter', '', 'z/text'), false);
    assert.equal(b.fetchedAt('openrouter', ''), 42);
  });
  for (const [label, body] of [['corrupt JSON', '{not json'], ['a foreign shape', '{"version":99,"providers":"nope"}'], ['an empty file', '']]) {
    test(`${label} starts empty instead of crashing`, () => {
      const file = tmpFile();
      fs.writeFileSync(file, body);
      const s = new S.VisionCapabilityStore({ filePath: file });
      assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), undefined);
      s.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true }));
      assert.equal(new S.VisionCapabilityStore({ filePath: file }).answer('openrouter', '', 'openai/gpt-4o'), true, 'and the next write repairs it');
    });
  }
  test('configureVisionCapabilityStore loads the file into the shared instance', () => {
    const file = tmpFile();
    new S.VisionCapabilityStore({ filePath: file }).replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true }));
    S.configureVisionCapabilityStore(file);
    assert.equal(S.getVisionCapabilityStore().answer('openrouter', '', 'openai/gpt-4o'), true);
    S.__setVisionCapabilityStore(null);
  });
});

describe('one instance for every bundle', () => {
  test('the singleton lives on globalThis', () => {
    S.__setVisionCapabilityStore(null);
    const s = S.getVisionCapabilityStore();
    const onGlobal = Object.values(globalThis).includes(s);
    assert.ok(onGlobal, 'each esbuild entry carries its own copy of this module; only globalThis is shared');
    S.__setVisionCapabilityStore(null);
  });
  test('storedVisionAnswer strips the routing prefix', () => {
    const s = new S.VisionCapabilityStore({ filePath: null });
    s.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true }));
    S.__setVisionCapabilityStore(s);
    assert.equal(S.storedVisionAnswer('openrouter', 'openrouter/openai/gpt-4o'), true);
    assert.equal(S.storedVisionAnswer('openrouter', 'openrouter/unknown/model'), undefined);
    S.__setVisionCapabilityStore(null);
  });
});

test('main configures the store before LLMHelper exists, under the dev:agent userData', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.ts'), 'utf8');
  const configure = main.indexOf('configureVisionCapabilityStore(');
  const helper = main.indexOf('this.processingHelper = new ProcessingHelper(this)');
  assert.ok(configure > 0 && helper > 0 && configure < helper, 'configure must run before the first setModel');
  assert.match(main.slice(configure - 200, configure + 200), /app\.getPath\('userData'\)/);
});
```

- [ ] **Step 3: Run; verify it fails.** Run: `node --test electron/llm/__tests__/VisionCapabilityStore2026_10_01.test.mjs`. Expected: `Cannot find module …/visionCapabilityStore.js`.

- [ ] **Step 4: Implement `electron/llm/visionCapabilityStore.ts`.**

```ts
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
```

In `electron/main.ts`, import `configureVisionCapabilityStore` from `./llm/visionCapabilityStore` beside the other `./llm/` imports. Immediately before `this.processingHelper = new ProcessingHelper(this)`, add:

```ts
    // Saved provider vision answers (2026-10-01). Before ProcessingHelper,
    // because its setModel at startup may refresh OpenRouter's catalogue, and
    // after dev:agent's userData override (module load, above whenReady).
    configureVisionCapabilityStore(path.join(app.getPath('userData'), 'vision-capabilities.json'));
```

(`path` and `app` are already imported in `main.ts`; check with `grep -n "^import path\|^import \* as path\|from \"path\"\|from 'path'" electron/main.ts`.)

- [ ] **Step 5: Rebuild and run.** Run: `npm run build:electron && node --test electron/llm/__tests__/VisionCapabilityStore2026_10_01.test.mjs`. Expected: PASS.

- [ ] **Step 6: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/visionCapabilityStore.ts electron/main.ts electron/llm/__tests__/VisionCapabilityStore2026_10_01.test.mjs
git commit -m "feat(vision): a saved store for what providers publish about image input

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Parsing OpenRouter's catalogue; the resolver consults it

**Files:**
- Create: `electron/llm/providerVisionData.ts`
- Create: `electron/llm/__tests__/fixtures/openrouterModels2026_10_01.json`
- Modify: `electron/llm/visionResolver.ts`
- Test: `electron/llm/__tests__/OpenRouterVisionData2026_10_01.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 (pure).
- Produces:
  - `parseOpenRouterVision(json: unknown): Map<string, boolean>` (wire id → reads images; `:batch` ids dropped, as `fetchOpenRouterModels` drops them; entries with no `input_modalities` array omitted, i.e. unknown)
  - `VisionFacts.providerReportsVision?: (provider: string, routedModel: string) => boolean | undefined`
  - `gatewaySeatReadsImages(provider: 'ninerouter' | 'agentrouter' | 'openrouter', model, facts?)`

- [ ] **Step 1: Save the real catalogue as a fixture** (ids, names and modalities only):

```bash
curl -s -m 30 https://openrouter.ai/api/v1/models | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
out={'fetched':'2026-10-01','source':'GET https://openrouter.ai/api/v1/models (public), trimmed to id/name/architecture.input_modalities','data':[{'id':m['id'],'name':m.get('name'),'architecture':{'input_modalities':(m.get('architecture') or {}).get('input_modalities')}} for m in d]}
json.dump(out,open('electron/llm/__tests__/fixtures/openrouterModels2026_10_01.json','w'),indent=1)
print(len(out['data']), sum(1 for m in out['data'] if 'image' in (m['architecture']['input_modalities'] or [])))"
```
Expected: ≈ 464 models, ≈ 296 with image.

- [ ] **Step 2: Write the failing test.**

```js
/**
 * OpenRouter's own answer to "does this model read images" (2026-10-01): the
 * `architecture.input_modalities` array on GET /api/v1/models. Trusted both
 * ways, because OpenRouter itself refuses an image sent to a model it lists as
 * text-only ("No endpoints found that support image input").
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { parseOpenRouterVision } = require(dist('llm/providerVisionData.js'));
const { resolveVision, gatewaySeatReadsImages } = require(dist('llm/visionResolver.js'));
const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/openrouterModels2026_10_01.json'), 'utf8'));

describe('parseOpenRouterVision, on the real catalogue', () => {
  const parsed = parseOpenRouterVision(catalogue);
  test('every listed model gets an answer, keyed by its OpenRouter id', () => {
    const listed = catalogue.data.filter((m) => !m.id.endsWith(':batch') && Array.isArray(m.architecture.input_modalities));
    assert.equal(parsed.size, listed.length);
    for (const m of listed) assert.equal(parsed.get(m.id), m.architecture.input_modalities.includes('image'), m.id);
  });
  test('known answers', () => {
    assert.equal(parsed.get('openai/gpt-4o'), true);
    assert.equal(parsed.get('deepseek/deepseek-v4-flash'), false);
    assert.equal(parsed.get('google/gemma-4-31b-it'), true);
  });
  test(':batch duplicates are dropped, as the model picker drops them', () => {
    for (const id of parsed.keys()) assert.ok(!id.endsWith(':batch'), id);
  });
  test('malformed input is no answers, never a throw', () => {
    for (const bad of [null, undefined, {}, { data: 'x' }, { data: [null, { id: 5 }, { id: 'a/b', architecture: null }] }]) {
      assert.equal(parseOpenRouterVision(bad).size, 0);
    }
  });
});

describe('the resolver consults the provider for OpenRouter', () => {
  const facts = (map) => ({ providerReportsVision: (provider, routed) => provider === 'openrouter' ? map[routed.replace(/^openrouter\//, '')] : undefined });
  test("OpenRouter's answer beats the name list, both ways", () => {
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/openai/gpt-4o' }, facts({ 'openai/gpt-4o': false })), { reads: 'no', source: 'provider' });
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/x-ai/grok-4.7' }, facts({ 'x-ai/grok-4.7': true })), { reads: 'yes', source: 'provider' });
  });
  test('no answer: the name list, as in phase 1', () => {
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/openai/gpt-4o' }, facts({})), { reads: 'yes', source: 'names' });
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/x-ai/grok-4.7' }, facts({})), { reads: 'unknown', source: null });
  });
  test('the seat: unknown keeps today\'s seat; OpenRouter\'s "no" skips it', () => {
    assert.equal(gatewaySeatReadsImages('openrouter', 'openrouter/x-ai/grok-4.7', facts({})), true);
    assert.equal(gatewaySeatReadsImages('openrouter', 'openrouter/deepseek/deepseek-v4-flash', facts({ 'deepseek/deepseek-v4-flash': false })), false);
  });
  test('other providers never read OpenRouter answers', () => {
    assert.deepEqual(resolveVision({ provider: 'fluxion', model: 'fluxion/gpt-4o' }, facts({ 'gpt-4o': false })).reads, 'yes');
  });
});
```

- [ ] **Step 3: Run; verify it fails.** Expected: `Cannot find module …/providerVisionData.js`.

- [ ] **Step 4: Implement.** `electron/llm/providerVisionData.ts`:

```ts
// electron/llm/providerVisionData.ts
//
// Turning what a provider publishes into "does this model read images" answers
// (design: docs/plans/2026-10-01-vision-capability-design.md, phase 2). Pure.

/**
 * OpenRouter's GET /api/v1/models → wire id → reads images.
 *
 * `architecture.input_modalities` lists what a model accepts (`["text","image",
 * "file"]`). Verified 2026-10-01 against the live catalogue (296 of 464 list
 * `image`). Trusted both ways: OpenRouter refuses an image sent to a model it
 * lists as text-only. A model with no modalities array is left out — unknown,
 * not "no". `:batch` ids are dropped, as fetchOpenRouterModels drops them: they
 * duplicate the base id and are never selectable.
 */
export function parseOpenRouterVision(json: unknown): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const data = (json as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data) {
    const id = (m as { id?: unknown } | null)?.id;
    const modalities = (m as { architecture?: { input_modalities?: unknown } } | null)?.architecture?.input_modalities;
    if (typeof id !== 'string' || !id || id.endsWith(':batch') || !Array.isArray(modalities)) continue;
    out.set(id, modalities.includes('image'));
  }
  return out;
}
```

`electron/llm/visionResolver.ts`:

1. Add to `VisionFacts`:

```ts
  /** What a provider's catalogue publishes (visionCapabilityStore), for a ROUTED id; undefined = it hasn't said. */
  providerReportsVision?: (provider: string, routedModel: string) => boolean | undefined;
```

2. Add a case before `default:`:

```ts
    // OpenRouter publishes input_modalities per model and refuses images to the
    // ones it lists as text-only, so its answer is trusted both ways (2026-10-01).
    case 'openrouter': {
      const reported = facts.providerReportsVision?.('openrouter', model);
      if (reported !== undefined) return answer(reported, 'provider');
      return fromNames(model, false);
    }
```

3. Replace `gatewaySeatReadsImages` with:

```ts
/**
 * What an unknown answer means for each selected-gateway seat. 9Router and
 * OpenRouter seat (an unfetched catalogue is not "text-only"; failing closed on
 * absent data was a bug once already); AgentRouter does not (no evidence, no
 * screenshot). Phase 1 kept each rung's behaviour; OpenRouter joins in phase 2.
 */
const SEAT_ON_UNKNOWN = { ninerouter: true, openrouter: true, agentrouter: false } as const;

/**
 * Whether a selected gateway model is seated for a screenshot. One function for
 * BOTH screenshot paths — LLMHelper's streaming chain and VisionProviderRegistry
 * — so they cannot answer differently.
 */
export function gatewaySeatReadsImages(provider: keyof typeof SEAT_ON_UNKNOWN, model: string, facts: VisionFacts = {}): boolean {
  return readsImages(resolveVision({ provider, model }, facts), SEAT_ON_UNKNOWN[provider]);
}
```

- [ ] **Step 5: Rebuild and run, plus the phase-1 tests that pin the resolver.** Run: `npm run build:electron && node --test electron/llm/__tests__/OpenRouterVisionData2026_10_01.test.mjs electron/llm/__tests__/VisionResolver2026_10_01.test.mjs electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs`. Expected: PASS.

- [ ] **Step 6: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/providerVisionData.ts electron/llm/visionResolver.ts electron/llm/__tests__/OpenRouterVisionData2026_10_01.test.mjs electron/llm/__tests__/fixtures/openrouterModels2026_10_01.json
git commit -m "feat(vision): read OpenRouter's input_modalities; the resolver trusts it for OpenRouter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Every OpenRouter screenshot site follows OpenRouter's answer

**Files:**
- Modify: `electron/LLMHelper.ts`
  - `visionVerdict` → split out `visionFacts`;
  - the OpenRouter chain seat;
  - `ninerouterModelSupportsVision` and `agentRouterModelSupportsVision` pass facts;
  - Direct Assist openrouter case;
  - the empty-chain message.
- Modify: `electron/services/screen/VisionProviderRegistry.ts` (`openrouter()`).
- Modify: `electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs` (inject an empty store).
- Test: `electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs`

**Interfaces:**
- Consumes:
  - `storedVisionAnswer`, `VisionCapabilityStore`, `__setVisionCapabilityStore` (Task 1);
  - `parseOpenRouterVision`, `providerReportsVision`, `gatewaySeatReadsImages('openrouter', …)` (Task 2).
- Produces: `private visionFacts(selection: { provider: DirectAssistProvider; model: string }, custom?, curl?): VisionFacts`.

- [ ] **Step 1: Write the failing test.** Populate the store from the REAL fixture through the REAL parser, then read through the real consumers:

```js
/**
 * OpenRouter's catalogue, written by the real parser and read by every real
 * OpenRouter screenshot site (2026-10-01). The likeliest bug is a key mismatch
 * between writer and reader (routing prefix, `:free` ids), which would make the
 * whole feature a silent no-op — so nothing here hand-builds a store entry.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { LLMHelper } = require(dist('LLMHelper.js'));
const { VisionCapabilityStore, __setVisionCapabilityStore } = require(dist('llm/visionCapabilityStore.js'));
const { parseOpenRouterVision } = require(dist('llm/providerVisionData.js'));
const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '../../llm/__tests__/fixtures/openrouterModels2026_10_01.json'), 'utf8'));
const parsed = parseOpenRouterVision(catalogue);

function loadCatalogue() {
  const store = new VisionCapabilityStore({ filePath: null });
  store.replaceProviderAnswers('openrouter', '', parsed);
  __setVisionCapabilityStore(store);
}
function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '',
    ollamaModel: '', ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(),
    isLocalOnlyMode: false, isProviderDisabled: () => false, modelVersionManager: { getAllVisionTiers: () => [] }, visionHealth: new Map(),
    codexCliConfig: { enabled: false }, isCodexAvailable: () => false, antigravityFallbackModel: () => null,
    hasNatively: () => false, ...state,
  });
  return h;
}
const TEXT_ONLY = 'openrouter/deepseek/deepseek-v4-flash';   // OpenRouter: ['text']
const VISION = 'openrouter/openai/gpt-4o';                   // OpenRouter: ['text','image','file']
const FREE = [...parsed.keys()].find((id) => id.endsWith(':free'));

async function chainOrder(model, extra = {}) {
  const opened = [];
  const stub = (name) => async function* () { opened.push(name); yield 'ok'; };
  const h = helper({
    currentModelId: model, openrouterClient: {}, client: extra.gemini ? {} : null, openaiClient: null, claudeClient: null, groqClient: null,
    streamWithOpenRouter: stub('openrouter'), streamWithGeminiModel: stub('gemini'), ...extra.state,
  });
  let error = null;
  try { for await (const _ of h.streamVisionWithFallback({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })) { /* drain */ } } catch (e) { error = e; }
  return { opened, error };
}

beforeEach(loadCatalogue);

describe('the streaming chain', () => {
  test('a model OpenRouter lists as text-only is not handed the screenshot; another provider answers', async () => {
    const { opened, error } = await chainOrder(TEXT_ONLY, { gemini: true });
    assert.equal(error, null, error?.message);
    assert.ok(!opened.includes('openrouter'), `opened: ${opened}`);
    assert.equal(opened[0], 'gemini');
  });
  test('a vision model still leads its own turn', async () => {
    const { opened } = await chainOrder(VISION, { gemini: true });
    assert.equal(opened[0], 'openrouter');
  });
  test('a :free id is matched by the same key the parser wrote', async () => {
    assert.ok(FREE, 'the fixture has :free ids');
    const reads = parsed.get(FREE);
    const { opened } = await chainOrder(`openrouter/${FREE}`, { gemini: true });
    assert.equal(opened[0] === 'openrouter', reads, `${FREE}: OpenRouter says ${reads}, opened ${opened}`);
  });
  test('nothing else configured: the user is told OpenRouter lists the model as text-only', async () => {
    const { error } = await chainOrder(TEXT_ONLY);
    assert.match(error?.message ?? '', /^No vision-capable provider configured\./);
    assert.match(error.message, /deepseek\/deepseek-v4-flash/);
    assert.match(error.message, /OpenRouter lists it as text-only/);
    assert.doesNotMatch(error.message, /proxy is reachable/);
  });
  test('no catalogue yet: seated exactly as before', async () => {
    __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
    const { opened } = await chainOrder(TEXT_ONLY, { gemini: true });
    assert.equal(opened[0], 'openrouter');
  });
});

describe('Direct Assist', () => {
  test("refuses a screenshot for a model OpenRouter lists as text-only (its clear message, not OpenRouter's 404)", () => {
    const h = helper();
    assert.equal(h.directSelectionSupportsImages({ provider: 'openrouter', model: TEXT_ONLY }, null, null), false);
    assert.equal(h.directSelectionSupportsImages({ provider: 'openrouter', model: VISION }, null, null), true);
  });
  test('no catalogue yet: forwards, as before', () => {
    __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
    assert.equal(helper().directSelectionSupportsImages({ provider: 'openrouter', model: TEXT_ONLY }, null, null), true);
  });
});

describe('getCapabilities', () => {
  test("follows OpenRouter's answer", () => {
    assert.equal(helper({ currentModelId: TEXT_ONLY }).getCapabilities().supportsImages, false);
    assert.equal(helper({ currentModelId: 'openrouter/x-ai/grok-4.7' }).getCapabilities().supportsImages, parsed.get('x-ai/grok-4.7'));
  });
});

describe('data characterization: exactly the ids OpenRouter lists as text-only flip, nothing else', () => {
  test('the seat answer over the whole catalogue', () => {
    const flips = [];
    for (const [id, readsImages] of parsed) {
      __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
      const before = helper().directSelectionSupportsImages({ provider: 'openrouter', model: `openrouter/${id}` }, null, null);
      loadCatalogue();
      const after = helper().directSelectionSupportsImages({ provider: 'openrouter', model: `openrouter/${id}` }, null, null);
      assert.equal(before, true, 'before: every selected OpenRouter model was forwarded');
      assert.equal(after, readsImages, id);
      if (!after) flips.push(id);
    }
    const textOnly = [...parsed].filter(([, r]) => !r).map(([id]) => id);
    assert.deepEqual(flips.sort(), textOnly.sort());
  });
  test('no provider other than OpenRouter changes', () => {
    for (const [provider, model] of [['fluxion', 'fluxion/gpt-4o'], ['litellm', 'litellm/deepseek/deepseek-v4-flash'], ['agentrouter', 'agentrouter/deepseek-v4-flash'], ['openai', 'gpt-4o'], ['deepseek', 'deepseek-v4-flash']]) {
      __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
      const before = helper().directSelectionSupportsImages({ provider, model }, null, null);
      loadCatalogue();
      assert.equal(helper().directSelectionSupportsImages({ provider, model }, null, null), before, `${provider} ${model}`);
    }
  });
});

describe('VisionProviderRegistry asks the same function', () => {
  // Its bundle inlines CredentialsManager, so the rung cannot be built here (as
  // in phase 1); the shared function it calls is executed above.
  const src = fs.readFileSync(path.join(__dirname, '../screen/VisionProviderRegistry.ts'), 'utf8');
  const start = src.indexOf('function openrouter(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  test('openrouter() seats by gatewaySeatReadsImages with the stored answers', () => {
    assert.match(body, /gatewaySeatReadsImages\('openrouter'/);
    assert.match(body, /storedVisionAnswer/);
  });
});
```

Also, in `VisionCharacterization2026_10_01.test.mjs`, right after the `LLMHelper` require, add:

```js
// Hermetic: phase 2's provider data lives in a shared store; the baseline was
// written with none, so the move is judged with none.
const { VisionCapabilityStore, __setVisionCapabilityStore } = require(dist('llm/visionCapabilityStore.js'));
__setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
```

- [ ] **Step 2: Run; verify it fails.** Run: `node --test electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs`. Expected: the chain, Direct Assist, getCapabilities, data-characterization and registry tests fail (OpenRouter is still seated and forwarded unconditionally). The "no catalogue yet" tests pass; they guard today's behaviour.

- [ ] **Step 3: Implement in `electron/LLMHelper.ts`.**

1. Import `storedVisionAnswer` from `./llm/visionCapabilityStore` and `type VisionFacts` from `./llm/visionResolver` (extend the existing visionResolver import).

2. Replace `visionVerdict` with `visionFacts` + `visionVerdict`:

```ts
  /**
   * The facts only this process holds, for the vision resolver: Ollama's
   * /api/show results, 9Router's catalogue, the active custom/cURL provider,
   * and what provider catalogues published (visionCapabilityStore).
   */
  private visionFacts(
    selection: { provider: DirectAssistProvider; model: string },
    custom: CustomProvider | null = this.customProvider,
    curl: CurlProvider | null = this.activeCurlProvider,
  ): VisionFacts {
    return {
      ollamaReportsVision: (m) => this.ollamaVisionCache.get(m),
      ninerouterVisionModels: selection.provider === 'ninerouter' ? [...this.ninerouterVisionModels] : undefined,
      customProvider: selection.provider === 'curl' ? curl : custom,
      providerReportsVision: (provider, routed) => storedVisionAnswer(provider, routed),
    };
  }

  /** The vision resolver's answer for a selection. See electron/llm/visionResolver.ts. */
  private visionVerdict(
    selection: { provider: DirectAssistProvider; model: string },
    custom: CustomProvider | null = this.customProvider,
    curl: CurlProvider | null = this.activeCurlProvider,
  ): VisionVerdict {
    return resolveVision(selection, this.visionFacts(selection, custom, curl));
  }
```

3. In `directSelectionSupportsImages`, remove `case 'openrouter':` from the grouped gateway cases. Add before that group:

```ts
      // OpenRouter publishes which models read images and refuses an image to
      // the rest (2026-10-01). With its catalogue saying "no", Direct Assist
      // gives its own clear refusal instead of forwarding into OpenRouter's 404;
      // with no catalogue yet it forwards, as every gateway below does.
      case 'openrouter':
        return readsImages(this.visionVerdict(selection, custom, curl), true);
```

4. In `streamVisionWithFallback`, change the OpenRouter seat condition from `if (this.isOpenRouterModel(this.currentModelId) && this.openrouterClient) {` to:

```ts
      // …and, since 2026-10-01, only when OpenRouter's own catalogue does not
      // list the model as text-only: OpenRouter refuses those images, so seating
      // it only spent an attempt before another provider answered. No catalogue
      // yet means seated, as before.
      const openrouterSelected = this.isOpenRouterModel(this.currentModelId);
      if (openrouterSelected && this.openrouterClient
        && gatewaySeatReadsImages('openrouter', this.currentModelId, this.visionFacts({ provider: 'openrouter', model: this.currentModelId }))) {
```

5. In the `ordered.length === 0` block, after the local-only throw and before the AgentRouter special case, add:

```ts
      if (this.isOpenRouterModel(this.currentModelId) && storedVisionAnswer('openrouter', this.currentModelId) === false) {
        throw new Error(`No vision-capable provider configured. The selected OpenRouter model (${this.openrouterWireModel(this.currentModelId)}) can't read screenshots — OpenRouter lists it as text-only. Pick an OpenRouter model that can, or add another vision provider in Settings.`);
      }
```

6. `ninerouterModelSupportsVision` and `agentRouterModelSupportsVision` keep their bodies (their facts are unchanged).

`electron/services/screen/VisionProviderRegistry.ts`, in `openrouter()`: import `storedVisionAnswer` from `../../llm/visionCapabilityStore`, and replace `supportsVision: !!apiKey && isSelected,` with:

```ts
    // The rule LLMHelper's streaming chain seats this rung by (2026-10-01):
    // OpenRouter's own catalogue, when fetched, decides.
    supportsVision: !!apiKey && isSelected
      && gatewaySeatReadsImages('openrouter', modelId, { providerReportsVision: (p, m) => storedVisionAnswer(p, m) }),
```

- [ ] **Step 4: Rebuild and run, with the phase-1 suites.**

Run:
```bash
npm run build:electron && node --test electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs \
  electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs \
  electron/services/__tests__/OpenRouterProvider2026_09_17.test.mjs electron/llm/__tests__/GatewayVisionWiring2026_09_03.test.mjs \
  electron/llm/__tests__/DirectAssistCore2026_08_29.test.mjs electron/services/__tests__/AgentRouterDispatchExecutes2026_09_30.test.mjs
```
Expected: PASS; the characterization still reports 0 lost / 177 gained. Then print the flips where the NAME list said yes and OpenRouter says no, and read every one before committing. These are the first deliberate yes→no changes:

```bash
node -e "
const os=require('os');const path=require('path');const e=require.resolve('electron');require.cache[e]={id:e,filename:e,loaded:true,exports:{app:{getPath:()=>os.tmpdir(),isReady:()=>true,getVersion:()=>'0'},safeStorage:{isEncryptionAvailable:()=>false}}};
const {getModelCapabilities}=require('./dist-electron/electron/llm/modelCapabilities.js');const {parseOpenRouterVision}=require('./dist-electron/electron/llm/providerVisionData.js');
const p=parseOpenRouterVision(require('./electron/llm/__tests__/fixtures/openrouterModels2026_10_01.json'));
const f=[...p].filter(([id,r])=>!r&&getModelCapabilities('openrouter/'+id,false).supportsImages).map(([id])=>id);console.log(f.length, f.join(' '))"
```
Expected: a short list. Each should be a model OpenRouter genuinely serves text-only (for example a text-only variant whose family the name list marks as vision). Record the list in the commit message.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/LLMHelper.ts electron/services/screen/VisionProviderRegistry.ts electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs
git commit -m "feat(vision): a model OpenRouter lists as text-only no longer gets screenshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Fetching OpenRouter's catalogue

**Files:**
- Modify: `electron/LLMHelper.ts`: add `refreshOpenRouterVisionData`; trigger it in `setModel`.
- Modify: `electron/utils/modelFetcher.ts`: `fetchOpenRouterModels` also writes answers.
- Test: `electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs` (add the refresh tests)

**Interfaces:**
- Consumes: `getVisionCapabilityStore` (Task 1), `parseOpenRouterVision` (Task 2).
- Produces: `public refreshOpenRouterVisionData(fetchImpl: typeof fetch = fetch): Promise<void>`

- [ ] **Step 1: Write the failing test.** Append:

```js
describe('refreshOpenRouterVisionData', () => {
  const okFetch = (calls) => async (url) => { calls.push(url); return { ok: true, json: async () => catalogue }; };
  const fresh = () => { const s = new VisionCapabilityStore({ filePath: null, now: () => Date.now() }); __setVisionCapabilityStore(s); return s; };
  const ready = (state = {}) => helper({ openrouterClient: {}, openrouterApiKey: 'k', isProviderDisabled: () => false, ...state });

  test('writes the parsed catalogue, once per day', async () => {
    const s = fresh(); const calls = [];
    const h = ready();
    await h.refreshOpenRouterVisionData(okFetch(calls));
    await h.refreshOpenRouterVisionData(okFetch(calls));
    assert.equal(calls.length, 1, 'fresh data is not re-fetched');
    assert.equal(s.answer('openrouter', '', 'deepseek/deepseek-v4-flash'), false);
    assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), true);
  });
  test('concurrent callers share one request', async () => {
    fresh(); const calls = []; const h = ready();
    await Promise.all([h.refreshOpenRouterVisionData(okFetch(calls)), h.refreshOpenRouterVisionData(okFetch(calls))]);
    assert.equal(calls.length, 1);
  });
  for (const [label, impl] of [
    ['offline', async () => { throw new Error('ENOTFOUND'); }],
    ['a 503', async () => ({ ok: false, status: 503, json: async () => ({}) })],
    ['malformed JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } })],
    ['an empty catalogue', async () => ({ ok: true, json: async () => ({ data: [] }) })],
  ]) {
    test(`${label}: earlier answers stay, nothing is marked fresh, a retry waits for the backoff`, async () => {
      const s = fresh(); const h = ready();
      s.replaceProviderAnswers('openrouter', '', new Map([['openai/gpt-4o', true]]));
      // Make the earlier data stale so a refresh is due.
      s.providers.get('openrouter|').fetchedAt = 0;
      await h.refreshOpenRouterVisionData(impl);
      assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), true, 'earlier answers kept');
      assert.equal(s.fetchedAt('openrouter', ''), 0, 'not marked fresh');
      const calls = [];
      await h.refreshOpenRouterVisionData(okFetch(calls));
      assert.equal(calls.length, 0, 'a failed attempt backs off before retrying');
    });
  }
  test('local-only mode or OpenRouter switched off: nothing is fetched', async () => {
    fresh(); const calls = [];
    await ready({ isLocalOnlyMode: true }).refreshOpenRouterVisionData(okFetch(calls));
    await ready({ isProviderDisabled: (p) => p === 'openrouter' }).refreshOpenRouterVisionData(okFetch(calls));
    assert.equal(calls.length, 0);
  });
  test('setModel on an OpenRouter model starts the refresh; on anything else it does not', () => {
    const h = ready(); let started = 0;
    h.refreshOpenRouterVisionData = () => { started += 1; return Promise.resolve(); };
    h.setModel('gpt-5.5');
    h.setModel('openrouter/openai/gpt-4o');
    assert.equal(started, 1);
  });
  test("Settings' Refresh writes the same answers", () => {
    const src = fs.readFileSync(path.join(__dirname, '../../utils/modelFetcher.ts'), 'utf8');
    const start = src.indexOf('async function fetchOpenRouterModels(');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    assert.match(body, /parseOpenRouterVision\(/);
    assert.match(body, /replaceProviderAnswers\('openrouter'/);
  });
});
```

(The failure tests reach into `s.providers` to age the data. Map access is fine on the built class. If `providers` ends up `#private` in the build, add `__ageForTests(provider, baseURL)` to the store instead and use it here.)

- [ ] **Step 2: Run; verify it fails.** Expected: `h.refreshOpenRouterVisionData is not a function`, and the `setModel` and modelFetcher tests fail.

- [ ] **Step 3: Implement.** In `electron/LLMHelper.ts`, import `getVisionCapabilityStore` (extend the Task 3 import) and `parseOpenRouterVision` from `./llm/providerVisionData`. Add these fields next to the other OpenRouter fields:

```ts
  // OpenRouter vision catalogue refresh (2026-10-01): single flight, and a short
  // backoff after a failure so model switching never hammers the endpoint.
  private openrouterVisionFetch: Promise<void> | null = null;
  private openrouterVisionLastFailureAt = 0;
```

Add the method next to `openrouterWireModel`:

```ts
  /**
   * Fetch OpenRouter's catalogue and save which models read images (its
   * input_modalities). Background only: called when an OpenRouter model is
   * selected, never on the answer path. Fresh for a day; a failure keeps the
   * previous answers, is not counted as fresh, and is not retried for 10 min.
   * Nothing is fetched in local-only mode or with OpenRouter switched off.
   */
  public async refreshOpenRouterVisionData(fetchImpl: typeof fetch = fetch): Promise<void> {
    if (this.isLocalOnlyMode || this.isProviderDisabled('openrouter')) return;
    const store = getVisionCapabilityStore();
    const now = Date.now();
    if (now - (store.fetchedAt('openrouter', '') ?? 0) < OPENROUTER_VISION_TTL_MS) return;
    if (now - this.openrouterVisionLastFailureAt < OPENROUTER_VISION_RETRY_MS) return;
    if (this.openrouterVisionFetch) return this.openrouterVisionFetch;
    this.openrouterVisionFetch = (async () => {
      try {
        const headers: Record<string, string> = {};
        if (this.openrouterApiKey) headers.Authorization = `Bearer ${this.openrouterApiKey}`;
        const resp = await fetchImpl('https://openrouter.ai/api/v1/models', { headers, signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const answers = parseOpenRouterVision(await resp.json());
        if (answers.size === 0) throw new Error('empty catalogue');
        store.replaceProviderAnswers('openrouter', '', answers);
        console.log(`[LLMHelper] OpenRouter vision catalogue: ${answers.size} model(s), ${[...answers.values()].filter(Boolean).length} read images`);
      } catch (err: any) {
        this.openrouterVisionLastFailureAt = Date.now();
        console.warn('[LLMHelper] OpenRouter vision catalogue refresh failed (answers unchanged):', err?.message || err);
      } finally {
        this.openrouterVisionFetch = null;
      }
    })();
    return this.openrouterVisionFetch;
  }
```

With the other module-level constants near the top (beside `NINEROUTER_MODELS_TTL_MS`):

```ts
const OPENROUTER_VISION_TTL_MS = 24 * 60 * 60 * 1000;
const OPENROUTER_VISION_RETRY_MS = 10 * 60 * 1000;
```

In `setModel`, after `console.log(\`[LLMHelper] Switched to Model: ${targetModelId}\`);`:

```ts
    // Keep OpenRouter's "which models read images" answers current (2026-10-01).
    if (this.isOpenRouterModel(targetModelId)) void this.refreshOpenRouterVisionData();
```

In `electron/utils/modelFetcher.ts`, import `getVisionCapabilityStore` from `../llm/visionCapabilityStore` and `parseOpenRouterVision` from `../llm/providerVisionData`. In `fetchOpenRouterModels`, after the `axios.get` line, add:

```ts
    // The same response says which models read images (2026-10-01): Refresh in
    // Settings updates the saved answers too.
    const vision = parseOpenRouterVision(response.data);
    if (vision.size > 0) getVisionCapabilityStore().replaceProviderAnswers('openrouter', '', vision);
```

- [ ] **Step 4: Rebuild and run.** Run: `npm run build:electron && node --test electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs electron/services/__tests__/OpenRouterProvider2026_09_17.test.mjs`. Expected: PASS.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/LLMHelper.ts electron/utils/modelFetcher.ts electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs
git commit -m "feat(vision): fetch OpenRouter's catalogue when an OpenRouter model is selected

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Live check, docs, validation, landing

**Files:**
- Modify: `docs/plans/2026-10-01-vision-capability-design.md`: the section 2 status table and delivery items 1-3.
- Modify: `electron/llm/CodeHintLLM.ts`: the known-gap comment.

- [ ] **Step 1: Live check (after).** Repeat Task 1 Step 1 on this build. The relaunch reverts the selection, so call `setModel('openrouter/deepseek/deepseek-v4-flash')` again; that also starts the catalogue refresh. Wait for `[LLMHelper] OpenRouter vision catalogue:` in the log, then run `generateCodeHint`.
Expected:
  - no OpenRouter vision attempt;
  - `[Vision] committed to Gemini …` on attempt 1;
  - `.agent/userdata/vision-capabilities.json` exists with an `openrouter|` catalogue.

Also select `openrouter/openai/gpt-4o-mini` and run it again. Expected: OpenRouter is attempted first, as before. Save to `$SP/vp2-live-after.txt`; stop the app through the launcher.

- [ ] **Step 2: Docs.**
  - **Design doc, section 2 table:**
    - OpenRouter: "In use (phase 2), both ways".
    - LiteLLM: "Confirmed in LiteLLM's docs; only `true` is trustworthy; used from phase 3".
    - 9Router: "In use (credentials-backed catalogue)".
    - Ollama: "In use (in-memory; persisted with its phase-5 consumers)".
    - Anthropic: "Not needed: the name list covers every Claude model".
  - **Delivery items 1-3:** phase 2 delivered the store and OpenRouter. LiteLLM yes-data moves to phase 3, where it lets the test skip a model. The known-gap sentence now reads "closed for OpenRouter in phase 2; LiteLLM, NVIDIA NIM and Fluxion wait for phase 4".
  - **`CodeHintLLM.ts` known-gap comment:** same correction.

- [ ] **Step 3: Full validation.**
  1. `npm run typecheck:electron`.
  2. `npm run build:electron`.
  3. `npm test`, with the model weights linked as in phase 1. The worktree lacks the git-ignored `resources/models` downloads: link each missing file from the main checkout, run, then remove the links and confirm `find resources/models -type l | wc -l` is 0.

  Expected: typecheck clean, 0 failures.

- [ ] **Step 4: Final review and landing.** Fresh whole-branch review. Then land via the same recipe as phase 1:
  1. Build the merge in a temp worktree.
  2. Verify its tree equals the tested branch (or re-run tests if `main` moved).
  3. Compare-and-swap `update-ref`.
  4. Write the changed files into the root checkout (3-way for dirty ones), `git reset -q`, and confirm the dirty set is unchanged.

  Remove the worktree (verify the submodule is clean first) and the branch. Do not push.

- [ ] **Step 5: Completion report** (CLAUDE.md format). Include:
  - `Tested physically on macOS` (live before/after);
  - `Reviewed but not executed on Windows`, and `Requires physical Windows verification` for the file writes;
  - the flip list from Task 3;
  - remaining risks (OpenRouter changing the shape of `input_modalities`; 24-hour staleness).
