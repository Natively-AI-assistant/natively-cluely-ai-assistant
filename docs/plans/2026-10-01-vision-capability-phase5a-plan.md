# Vision Capability Phase 5a: Your Selected Model Reads Your Screenshot First — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the chat screenshot path, a selected OpenAI, Claude, Gemini, Groq, Natively or Antigravity model reads its own screenshot first when Natively knows it reads images. Each vendor's fixed vision model stays as a fallback. Today whichever key sorts first (usually OpenAI) answers another vendor's screenshot.

**Architecture:** The chain's seat building and ordering move out of `streamVisionWithFallback` into `buildVisionChain`, so the order can be recorded and compared. A pure function, `orderVisionCandidates` (`electron/llm/visionOrdering.ts`), decides the order: the selection's rung leads unless its circuit breaker is open, then health-ordered cloud rungs, then local ones. Phase 5b gives the screen-reading path the same function. Direct vendors gain a rung for the selected model. The Claude adapters stop sending a thinking setting to models that reject it.

**Tech Stack:** TypeScript (Electron main), esbuild per-file bundles, `node:test` `.mjs` tests against `dist-electron/`.

**Spec:** `docs/plans/2026-10-01-vision-capability-design.md` (section 3; review defect 10). Earlier plans: phases 1, 2, 3a, 3b in the same folder.

## Global Constraints

- macOS and Windows: no OS-specific code.
- Never send blind. A selected model leads only when the resolver says **yes** (name list, provider data or a passed test). Unknown and "no" get no selected rung; the vendor's fixed vision model or another provider answers.
- A fallback always uses a model known to read images. The vendor rungs keep their fixed vision tier models.
- The only ordering change allowed: the selection's own rung moves to the front (or a new `<vendor>_selected` rung appears at the front). Every other rung keeps its relative order. Task 1 records the order before the change and Task 3 asserts exactly that.
- A selected rung whose circuit breaker is open is not forced to the front. A broken selected model must not cost its full first-token budget on every screenshot.
- Existing source-pinned tests rely on the text markers `const front: VisionStreamProvider[] = []` and `const backLocal = local.filter` and on the per-gateway front-load lines between them (`FluxionProvider2026_09_18`, `NinerouterVisionSeat2026_09_20`). Keep those markers and lines.
- Claude: not executed here (no Anthropic key). Request shapes are tested; the live behaviour is marked reviewed-only.
- One build and one test suite at a time on this machine. Before each: `pgrep -f '^node scripts/build-electron.js'` and `pgrep -fl 'electron --test'` must be empty. No dev app runs in this plan.
- When running a set of test files, list them with `git ls-files` plus any new untracked file by name (`git grep -l` skips untracked files).
- API keys are never printed or put on argv. Land on local `main` only. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A selected model whose provider key is missing or switched off must not produce a rung, and must not break the chain. Tested in Task 3.
2. A selected model that equals the vendor's fixed vision model must not be tried twice. Tested in Task 3.
3. A selected rung that keeps failing must stop leading after its breaker opens, and lead again once it recovers. Tested in Task 2.
4. Selecting a text-only model of a vendor whose key is configured (for example `gpt-3.5-turbo` with an OpenAI key) must still get the screenshot answered by that vendor's vision model, not sent to the text-only model. Tested in Task 3.
5. A Claude model that rejects a thinking setting (Fable, Mythos, and any id not confirmed to accept it) must get a request without one, in both the text and image adapters. Tested in Task 4.

## Every image dispatcher, and what 5a does to it

| Dispatcher | Used by | 5a |
|---|---|---|
| `streamVisionWithFallback` (streaming chain) | Ask AI, What to Answer, Code Hint, Brainstorm: every image-bearing `streamChat` turn | **Changed**: selected model first |
| `VisionProviderRegistry` + `ScreenUnderstandingService` chain | screen understanding | unchanged; phase 5b adopts `orderVisionCandidates` and adds rungs |
| `generateWithVisionFallback` | `analyzeImageFiles`, `extractProblemFromImages`, `generateRollingScript` | unchanged; phase 5b |
| `chatWithGemini` non-streaming cascade | non-streaming chat with images | unchanged; phase 5b |
| `streamChatWithGemini` multimodal provider list | legacy streaming entry | unchanged; phase 5b |
| Direct Assist (`streamDirectAssistFrozen`, its ladder) | Direct Assist | unchanged: it already sends to the selected model |

## File structure

- Create `electron/llm/visionOrdering.ts`: `orderVisionCandidates`. Pure.
- Modify `electron/llm/modelCapabilities.ts`: `claudeAcceptsThinkingDisabled`.
- Modify `electron/LLMHelper.ts`: `buildVisionChain`, selected rungs, the ordering call, the Claude thinking parameter at four sites.
- Tests:
  - `electron/services/__tests__/fixtures/visionChainOrder2026_10_01.json` (new)
  - `electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs` (new)
  - `electron/llm/__tests__/VisionOrdering2026_10_01.test.mjs` (new)
  - `electron/services/__tests__/ClaudeThinkingParam2026_10_01.test.mjs` (new)

Commands run from the worktree root `.claude/worktrees/vision-phase5a`. `SP` = the session scratchpad.

---

### Task 1: Record the chain's order before changing it

**Files:**
- Modify: `electron/LLMHelper.ts` (`streamVisionWithFallback` → `buildVisionChain` + a thin `streamVisionWithFallback`)
- Create: `electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs`, `electron/services/__tests__/fixtures/visionChainOrder2026_10_01.json`

**Interfaces:**
- Produces: `private async buildVisionChain(req: { userContent: string; message: string; context?: string; imagePaths: string[]; systemPrompt: string }): Promise<VisionStreamProvider[]>`. It returns the ordered rungs and throws the "No vision-capable provider configured…" errors exactly as today.

- [ ] **Step 1: Extract, changing no behaviour.** In `streamVisionWithFallback`, everything from the `maybeProbeSelectedVision()` call through the end of the `if (ordered.length === 0) { … }` block moves, verbatim, into a new method placed directly above it:

```ts
  /**
   * The rungs for one screenshot turn, in the order they will be tried
   * (2026-10-01: split out of streamVisionWithFallback so the order can be
   * recorded and compared; phase 5a changes who leads). Throws the "No
   * vision-capable provider configured…" errors when nothing can read it.
   */
  private async buildVisionChain(
    req: { userContent: string; message: string; context?: string; imagePaths: string[]; systemPrompt: string },
  ): Promise<VisionStreamProvider[]> {
    const { userContent, message, context, imagePaths, systemPrompt } = req;
    // …the moved code…
    return ordered;
  }
```

`streamVisionWithFallback` keeps its signature and becomes:

```ts
    const ordered = await this.buildVisionChain(req);
    // Delegate the first-token-commit + retry + circuit-breaker state machine. …(existing comment)…
    yield* runStreamingVisionFallback(ordered, { … }, this.visionHealth, { … }, abortSignal);
```

The hooks object and the `runStreamingVisionFallback(` call stay in `streamVisionWithFallback` (a source-pinned test reads them there).

- [ ] **Step 2: Rebuild and prove nothing moved.** Run the suites that execute the chain:

```bash
npm run build:electron && node --test electron/services/__tests__/AgentRouterDispatchExecutes2026_09_30.test.mjs electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs electron/llm/__tests__/GatewayVisionWiring2026_09_03.test.mjs electron/services/__tests__/FluxionProvider2026_09_18.test.mjs electron/services/__tests__/NinerouterVisionSeat2026_09_20.test.mjs electron/llm/__tests__/RetiredModelAndEnglishOnlyWhisper2026_08_15.test.mjs electron/llm/__tests__/OllamaVisionChainProbeBudget2026_09_22.test.mjs
```
Expected: PASS, the same counts as before the extraction.

- [ ] **Step 3: Write the order characterization.**

```js
/**
 * Who reads a screenshot, and in what order (2026-10-01).
 *
 * Phase 5a moves the user's SELECTED model to the front of the chat screenshot
 * chain. This records the order for every combination of configured keys and
 * selected model BEFORE that change, so the change can be held to exactly one
 * difference: the selection's own rung leads. Every other rung keeps its place.
 *
 * Regenerate the baseline ONLY on the commit that extracted buildVisionChain
 * and changed nothing else:
 *   VISION_ORDER_WRITE=1 node --test electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs
 */
import { test } from 'node:test';
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
__setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));

const FIXTURE = path.join(__dirname, 'fixtures/visionChainOrder2026_10_01.json');

const TIERS = [
  { family: 'openai', tier1: 'gpt-5.4', tier2: 'gpt-5.4', tier3: 'gpt-5.4' },
  { family: 'claude', tier1: 'claude-sonnet-4-6', tier2: 'claude-sonnet-4-6', tier3: 'claude-sonnet-4-6' },
  { family: 'gemini_flash', tier1: 'gemini-3.8-flash', tier2: 'gemini-3.8-flash', tier3: 'gemini-3.8-flash' },
  { family: 'gemini_pro', tier1: 'gemini-3.1-pro-preview', tier2: 'gemini-3.1-pro-preview', tier3: 'gemini-3.1-pro-preview' },
];
// Which providers have a key. Each name maps to the state that makes its rung possible.
const KEYS = {
  openai: { _openaiClient: {} }, claude: { _claudeClient: {} }, gemini: { _client: {} }, groq: { _groqClient: {} },
  natively: { hasNatively: () => true }, deepseek: { _deepseekClient: {} }, openrouter: { _openrouterClient: {} },
  litellm: { _litellmClient: {} }, nvidia_nim: { _nvidiaNimClient: {} }, ninerouter: { _ninerouterClient: {} },
  fluxion: { hasFluxionCredential: () => true }, agentrouter: { hasAgentRouterCredential: () => true },
};
const KEY_SETS = [
  [], ['gemini'], ['openai'], ['claude'], ['deepseek'], ['openai', 'gemini'], ['claude', 'gemini'],
  ['openai', 'claude', 'gemini', 'groq', 'natively'],
  ['openai', 'claude', 'gemini', 'groq', 'natively', 'deepseek', 'openrouter', 'litellm', 'nvidia_nim', 'ninerouter', 'fluxion', 'agentrouter'],
];
const SELECTIONS = [
  'gpt-5.4', 'gpt-5.5', 'o3', 'gpt-3.5-turbo', 'claude-sonnet-4-6', 'claude-opus-5', 'gemini-3.1-flash-lite', 'gemini-3.8-flash',
  'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'natively', 'deepseek-v4-flash',
  'deepseek-v4-pro', 'openrouter/openai/gpt-4o', 'fluxion/claude-opus-5', 'agentrouter/gpt-6-astra', 'litellm/internal-model',
  'nvidia_nim/meta/llama-3.2-90b-vision-instruct', 'ninerouter/openai/gpt-5',
];

function helper(keys, model) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: model, ollamaModel: '', ollamaVisionModel: null,
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), configuredCustomProviders: [],
    isLocalOnlyMode: false, isProviderDisabled: () => false, deepseekPermanentlyDead: false,
    litellmBaseURL: 'http://localhost:4000/v1', ninerouterBaseURL: 'http://localhost:20128/v1',
    visionHealth: new Map(), modelVersionManager: { getAllVisionTiers: () => TIERS },
    codexCliConfig: { enabled: false, model: 'gpt-5.5' }, isCodexAvailable: () => false, antigravityFallbackModel: () => null,
    hasNatively: () => false, hasFluxionCredential: () => false, hasAgentRouterCredential: () => false,
  });
  for (const k of keys) Object.assign(h, KEYS[k]);
  return h;
}

/** `case → [rung id, …]`, or `["THROWS: <first words>"]` when nothing can read the screenshot. */
async function orders() {
  const out = {};
  for (const keys of KEY_SETS) for (const model of SELECTIONS) {
    const h = helper(keys, model);
    let ids;
    try { ids = (await h.buildVisionChain({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })).map((p) => p.id); }
    catch (e) { ids = [`THROWS: ${String(e.message).split('.').slice(0, 2).join('.')}`]; }
    out[`[${keys.join(',')}] ${model}`] = ids;
  }
  return out;
}

/** Rung ids that belong to a selection: the ones allowed to move to (or appear at) the front. */
function ownRungs(model) {
  if (/^(?:gpt-|o\d)/.test(model)) return ['openai_selected', 'openai'];
  if (model.startsWith('claude-')) return ['claude_selected', 'claude'];
  if (model.startsWith('gemini-')) return ['gemini_selected', 'gemini_flash_lite', 'gemini_flash', 'gemini_pro'];
  if (model === 'natively') return ['natively'];
  if (model.startsWith('qwen/') || model.startsWith('llama-')) return ['groq'];
  return [];
}

test('the chain order changes only by the selection moving to the front', async () => {
  const now = await orders();
  if (process.env.VISION_ORDER_WRITE === '1') {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify({ written: '2026-10-01', note: 'order at the buildVisionChain extraction commit, before phase 5a', orders: now }, null, 1) + '\n');
    return;
  }
  const before = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).orders;
  assert.deepEqual(Object.keys(now).sort(), Object.keys(before).sort(), 'the case list changed');
  for (const [name, was] of Object.entries(before)) {
    const is = now[name];
    if (JSON.stringify(is) === JSON.stringify(was)) continue;
    const model = name.slice(name.indexOf('] ') + 2);
    const own = ownRungs(model);
    assert.ok(own.includes(is[0]), `${name}: the first rung is ${is[0]}, which is not the selection's own (was ${was.join(' > ')}; now ${is.join(' > ')})`);
    const rest = is.slice(1).filter((id) => id !== is[0]);
    const wasRest = was.filter((id) => id !== is[0]);
    assert.deepEqual(rest, wasRest, `${name}: rungs other than the selection's changed order (was ${was.join(' > ')}; now ${is.join(' > ')})`);
  }
});
```

- [ ] **Step 4: Write the baseline and check it.**

Run: `VISION_ORDER_WRITE=1 node --test electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs && node --test electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs`
Expected: PASS twice. Open the fixture and read a few cases. With keys `openai,gemini` and `gemini-3.8-flash` selected, the first rung is `openai`: that is defect 10, recorded.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/LLMHelper.ts electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs electron/services/__tests__/fixtures/visionChainOrder2026_10_01.json
git commit -m "test(vision): record who reads a screenshot, in what order, before changing it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One ordering function, and a broken selection stops leading

**Files:**
- Create: `electron/llm/visionOrdering.ts`
- Modify: `electron/LLMHelper.ts` (`buildVisionChain`: the assembly after the `front` block)
- Test: `electron/llm/__tests__/VisionOrdering2026_10_01.test.mjs`

**Interfaces:**
- Consumes: `orderByHealth`, `HealthEntry` from `./streamFallbackEngine`.
- Produces: `orderVisionCandidates<T extends { id: string; priority: number }>(args: { selected: readonly T[]; cloud: readonly T[]; local: readonly T[]; localOnly: boolean; health: Map<string, HealthEntry>; now: number }): T[]`

- [ ] **Step 1: Write the failing test.**

```js
/**
 * The one ordering rule for screenshot rungs (2026-10-01): the selection's own
 * rung leads, unless its circuit breaker is open; then health-ordered cloud
 * rungs; then local ones. Pure, so both screenshot paths can share it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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
const { orderVisionCandidates } = require(dist('llm/visionOrdering.js'));

const r = (id, priority) => ({ id, priority });
const cloud = [r('openai', 0), r('claude', 1), r('gemini_flash', 2), r('fluxion', 3)];
const local = [r('custom', 100), r('ollama', 101)];
const ids = (list) => list.map((p) => p.id);
const order = (over = {}) => ids(orderVisionCandidates({ selected: [], cloud, local, localOnly: false, health: new Map(), now: 1000, ...over }));

describe('orderVisionCandidates', () => {
  test('no selection: cloud by priority, then local', () => {
    assert.deepEqual(order(), ['openai', 'claude', 'gemini_flash', 'fluxion', 'custom', 'ollama']);
  });
  test('the selection leads, and is not repeated', () => {
    assert.deepEqual(order({ selected: [cloud[3]] }), ['fluxion', 'openai', 'claude', 'gemini_flash', 'custom', 'ollama']);
    assert.deepEqual(order({ selected: [local[1]] }), ['ollama', 'openai', 'claude', 'gemini_flash', 'fluxion', 'custom']);
  });
  test('a faster measured provider does not jump ahead of the selection', () => {
    const health = new Map([['claude', { openUntil: 0, consecutiveFails: 0, ttftEma: 200 }], ['openai', { openUntil: 0, consecutiveFails: 0, ttftEma: 900 }]]);
    assert.deepEqual(order({ selected: [cloud[3]], health }), ['fluxion', 'claude', 'openai', 'gemini_flash', 'custom', 'ollama']);
  });
  test('a selection whose breaker is open stops leading, and leads again once it closes', () => {
    const health = new Map([['fluxion', { openUntil: 5000, consecutiveFails: 3, ttftEma: null }]]);
    assert.deepEqual(order({ selected: [cloud[3]], health }), ['openai', 'claude', 'gemini_flash', 'fluxion', 'custom', 'ollama'], 'cooling: tried last among cloud, not first');
    assert.deepEqual(order({ selected: [cloud[3]], health, now: 6000 }), ['fluxion', 'openai', 'claude', 'gemini_flash', 'custom', 'ollama']);
  });
  test('if the cooling selection is the only rung, it is still tried', () => {
    const only = [r('fluxion', 0)];
    const health = new Map([['fluxion', { openUntil: 5000, consecutiveFails: 3, ttftEma: null }]]);
    assert.deepEqual(ids(orderVisionCandidates({ selected: only, cloud: only, local: [], localOnly: false, health, now: 1000 })), ['fluxion']);
  });
  test('local-only: local rungs only, whatever is selected', () => {
    assert.deepEqual(order({ selected: [cloud[3]], localOnly: true }), ['custom', 'ollama']);
  });
});
```

- [ ] **Step 2: Run; verify it fails.** Expected: `Cannot find module …/visionOrdering.js`.

- [ ] **Step 3: Implement.** `electron/llm/visionOrdering.ts`:

```ts
// electron/llm/visionOrdering.ts
//
// The one ordering rule for screenshot rungs (design:
// docs/plans/2026-10-01-vision-capability-design.md, section 3). Pure, so the
// streaming chain (LLMHelper) and, from phase 5b, the screen-reading chain
// (VisionProviderRegistry) order their rungs the same way.
//
//   1. The user's own selection leads its own turn — unless its circuit breaker
//      is open. A selected model that keeps failing must not cost its full
//      first-token budget on every screenshot; it rejoins its pool and is
//      tried in the cooling group, as any other broken rung is.
//   2. Cloud rungs, fastest healthy first (orderByHealth).
//   3. Local rungs.
//   Local-only mode: local rungs only.

import { orderByHealth, type HealthEntry } from './streamFallbackEngine';

export function orderVisionCandidates<T extends { id: string; priority: number }>(args: {
  /** The rungs for the user's own selection, in the order they should lead. Each is also in `cloud` or `local`. */
  selected: readonly T[];
  cloud: readonly T[];
  local: readonly T[];
  localOnly: boolean;
  health: Map<string, HealthEntry>;
  now: number;
}): T[] {
  const { selected, cloud, local, localOnly, health, now } = args;
  if (localOnly) return orderByHealth([...local], health, now);
  const cooling = (p: T) => (health.get(p.id)?.openUntil ?? 0) > now;
  const lead = selected.filter((p) => !cooling(p));
  const leading = new Set(lead.map((p) => p.id));
  const backCloud = cloud.filter((p) => !leading.has(p.id));
  const backLocal = local.filter((p) => !leading.has(p.id));
  return [...lead, ...orderByHealth(backCloud, health, now), ...backLocal];
}
```

In `buildVisionChain`, the assembly currently reads:

```ts
    if (localOnly) {
      ordered = orderVisionByHealth(local, this.visionHealth, nowMs);
    } else {
      const front: VisionStreamProvider[] = [];
      …the front.push lines…
      const backLocal = local.filter(p => !front.includes(p));
      const backCloud = cloud.filter(p => !front.includes(p));
      ordered = [...front, ...orderVisionByHealth(backCloud, this.visionHealth, nowMs), ...backLocal];
    }
```

Keep the `front` block and both marker lines; replace only the last line and the local-only branch:

```ts
    // `front` is the selection's own rung(s). The ordering rule itself lives in
    // visionOrdering.ts, shared with the screen-reading path (phase 5b).
    const front: VisionStreamProvider[] = [];
    if (!localOnly) {
      …the front.push lines, unchanged…
    }
    const backLocal = local.filter(p => !front.includes(p)); // kept for readers; orderVisionCandidates recomputes it
    void backLocal;
    const ordered = orderVisionCandidates({ selected: front, cloud, local, localOnly, health: this.visionHealth, now: nowMs });
```

If keeping an unused `backLocal` reads badly, keep the marker as a comment line instead (`// const backLocal = local.filter — see orderVisionCandidates`). Then confirm the two source-pinned tests still find their markers: `FluxionProvider2026_09_18` slices from `const front: VisionStreamProvider[] = []` to `const backLocal = local.filter`. Import `orderVisionCandidates` from `./llm/visionOrdering`.

- [ ] **Step 4: Rebuild and run.** Run: `npm run build:electron && node --test electron/llm/__tests__/VisionOrdering2026_10_01.test.mjs electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs electron/services/__tests__/FluxionProvider2026_09_18.test.mjs electron/services/__tests__/NinerouterVisionSeat2026_09_20.test.mjs electron/services/__tests__/AgentRouterDispatchExecutes2026_09_30.test.mjs electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs`
Expected: PASS. The order characterization shows no difference (health is empty in it).

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/visionOrdering.ts electron/LLMHelper.ts electron/llm/__tests__/VisionOrdering2026_10_01.test.mjs
git commit -m "feat(vision): one ordering rule for screenshot rungs; a failing selection stops leading

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A selected direct model reads its own screenshot

**Files:**
- Modify: `electron/LLMHelper.ts` (`buildVisionChain`: direct-vendor rungs and `front` lines)
- Test: `electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs` (append)

**Interfaces:**
- Consumes: `visionVerdict`, `readsImages`, `getDirectAssistSelection`, `orderVisionCandidates` (Task 2).
- Produces: rung ids `openai_selected`, `claude_selected`, `gemini_selected`.

- [ ] **Step 1: Write the failing tests.** Append to `VisionChainOrder2026_10_01.test.mjs`:

```js
const first = async (keys, model, state = {}) => {
  const h = Object.assign(helper(keys, model), state);
  const chain = await h.buildVisionChain({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' });
  return { ids: chain.map((p) => p.id), names: chain.map((p) => p.name), chain };
};
const ALL = ['openai', 'claude', 'gemini', 'groq', 'natively'];

test('a selected Gemini model leads even when an OpenAI key exists (defect 10)', async () => {
  assert.equal((await first(['openai', 'gemini'], 'gemini-3.8-flash')).ids[0], 'gemini_flash');
  assert.equal((await first(ALL, 'gemini-3.1-pro-preview')).ids[0], 'gemini_pro');
  assert.equal((await first(ALL, 'gemini-3.1-flash-lite')).ids[0], 'gemini_flash_lite');
});
test('a selected Gemini model that is none of the three fixed ones gets its own rung, for that model', async () => {
  const r = await first(ALL, 'gemini-2.5-flash');
  assert.equal(r.ids[0], 'gemini_selected');
  assert.match(r.names[0], /gemini-2\.5-flash/);
});
test('a selected OpenAI or Claude model reads with ITSELF; the fixed vision model stays as the fallback', async () => {
  const o = await first(ALL, 'gpt-5.5');
  assert.deepEqual(o.ids.slice(0, 2), ['openai_selected', 'openai']);
  assert.match(o.names[0], /gpt-5\.5/);
  const c = await first(ALL, 'claude-opus-5');
  assert.equal(c.ids[0], 'claude_selected');
  assert.ok(c.ids.includes('claude'), 'the fixed Claude vision model is still there to fall back to');
  assert.equal((await first(ALL, 'o3')).ids[0], 'openai_selected');
});
test('a selection equal to the fixed vision model is not tried twice', async () => {
  const o = await first(ALL, 'gpt-5.4');
  assert.equal(o.ids[0], 'openai');
  assert.ok(!o.ids.includes('openai_selected'));
  const c = await first(ALL, 'claude-sonnet-4-6');
  assert.equal(c.ids[0], 'claude');
  assert.ok(!c.ids.includes('claude_selected'));
});
test('a text-only selected model gets no rung of its own: the vendor vision model answers', async () => {
  const r = await first(['openai'], 'gpt-3.5-turbo');
  assert.deepEqual(r.ids, ['openai']);
  assert.doesNotMatch(r.names.join(' '), /gpt-3\.5/);
});
test('a model nothing is known about gets no rung of its own until its test passes', async () => {
  const before = await first(ALL, 'gpt-next-unknown');
  assert.ok(!before.ids.includes('openai_selected'));
  const store = new VisionCapabilityStore({ filePath: null }); store.recordTest('openai', '', 'gpt-next-unknown', true);
  __setVisionCapabilityStore(store);
  assert.equal((await first(ALL, 'gpt-next-unknown')).ids[0], 'openai_selected');
  __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
});
test('Natively selected leads; a Groq vision model selected leads with that model', async () => {
  assert.equal((await first(ALL, 'natively')).ids[0], 'natively');
  const g = await first(ALL, 'qwen/qwen3.8-27b');
  assert.equal(g.ids[0], 'groq');
  assert.match(g.names[0], /qwen3\.8-27b/);
});
test('no key, or the provider switched off: no rung for the selection, and the chain still works', async () => {
  const noKey = await first(['gemini'], 'gpt-5.5');
  assert.ok(!noKey.ids.includes('openai_selected'));
  assert.equal(noKey.ids[0], 'gemini_flash_lite');
  const off = await first(ALL, 'gpt-5.5', { isProviderDisabled: (p) => p === 'openai' });
  assert.ok(!off.ids.some((id) => id.startsWith('openai')));
});
test('a selected rung opens the selected model', async () => {
  const calls = [];
  const { chain } = await first(ALL, 'gpt-5.5', {
    streamWithOpenaiMultimodal: async function* (_u, _imgs, _sys, model) { calls.push(model); yield 'ok'; },
  });
  for await (const _ of chain[0].open(new AbortController().signal, 1)) { /* drain */ }
  assert.deepEqual(calls, ['gpt-5.5']);
});
```

- [ ] **Step 2: Run; verify they fail.** Run: `node --test electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs`. Expected: the new tests fail (no `*_selected` rung; `openai` leads Gemini selections). The characterization still passes.

- [ ] **Step 3: Implement in `buildVisionChain`.**

Near the top, beside `deepseekSelected`:

```ts
    // The user's own DIRECT model (2026-10-01): it reads its own screenshot when
    // the resolver says it reads images — the name list, provider data or a
    // passed one-time test. Unknown and "no" get no rung of their own: the
    // vendor's fixed vision model below answers, so nothing is sent blind.
    const sel = (() => { try { return this.getDirectAssistSelection(); } catch { return null; } })();
    const selReads = sel ? readsImages(this.visionVerdict(sel), false) : false;
    const selectedDirect = (provider: DirectAssistProvider): string | null =>
      sel && selReads && sel.provider === provider ? sel.model : null;
```

In the `if (!localOnly) { … }` cloud block:

- **OpenAI.** After the existing `openai` rung:

```ts
        // …with the selected model in front of the fixed vision model, unless
        // they are the same model (then that one rung simply leads).
        const selectedOpenai = selectedDirect('openai');
        if (selectedOpenai && selectedOpenai !== tierModel(ModelFamily.OPENAI, 1)) {
          cloud.push({ id: 'openai_selected', name: `OpenAI (${selectedOpenai})`, isLocal: false, priority: prio++, ttftTimeoutMs: PRO_TTFT_MS,
            open: (sig) => this.streamWithOpenaiMultimodal(userContent, imagePaths, systemPrompt, selectedOpenai, sig) });
        }
```

- **Claude.** The same with `'claude'`, `ModelFamily.CLAUDE`, `claude_selected`, `streamWithClaudeMultimodal`.

- **Gemini.** After the three Gemini rungs:

```ts
        const selectedGemini = selectedDirect('gemini');
        const fixedGemini = [GEMINI_FLASH_LITE_MODEL, tierModel(ModelFamily.GEMINI_FLASH, 1) || GEMINI_FLASH_MODEL, tierModel(ModelFamily.GEMINI_PRO, 1) || GEMINI_PRO_MODEL];
        if (selectedGemini && !fixedGemini.includes(selectedGemini)) {
          cloud.push({ id: 'gemini_selected', name: `Gemini (${selectedGemini})`, isLocal: false, priority: prio++, ttftTimeoutMs: PRO_TTFT_MS,
            open: (sig) => this.streamWithGeminiModel(userContent, selectedGemini, imagePaths, systemPrompt, sig) });
        }
```

- **Groq.** Change the `groq` rung to use the selected Groq vision model when there is one:

```ts
        const groqVisionModel = selectedDirect('groq') ?? GROQ_VISION_MODEL;
        cloud.push({ id: 'groq', name: `Groq (${groqVisionModel})`, isLocal: false, priority: prio++, ttftTimeoutMs: FLASH_TTFT_MS,
          open: (sig) => this.streamWithGroqMultimodal(userContent, imagePaths, systemPrompt, sig, groqVisionModel) });
```

In the `front` block, after the DeepSeek line, add:

```ts
      // A selected DIRECT model leads its own turn too (2026-10-01). Before
      // this, OpenAI (priority 0) answered a Claude or Gemini user's screenshot
      // whenever an OpenAI key was present.
      const lead = (id: string) => { const p = cloud.find(c => c.id === id); if (p && !front.includes(p)) front.push(p); };
      if (selectedDirect('openai')) lead(cloud.some(c => c.id === 'openai_selected') ? 'openai_selected' : 'openai');
      if (selectedDirect('claude')) lead(cloud.some(c => c.id === 'claude_selected') ? 'claude_selected' : 'claude');
      const g = selectedDirect('gemini');
      if (g) lead(cloud.some(c => c.id === 'gemini_selected') ? 'gemini_selected'
        : g === GEMINI_FLASH_LITE_MODEL ? 'gemini_flash_lite'
        : g === (tierModel(ModelFamily.GEMINI_PRO, 1) || GEMINI_PRO_MODEL) ? 'gemini_pro' : 'gemini_flash');
      if (selectedDirect('groq')) lead('groq');
      if (sel?.provider === 'natively') lead('natively');
      if (sel?.provider === 'antigravity') lead('antigravity');
```

(`selectedGemini` and the other block-scoped constants are declared inside `if (!localOnly)`; the `front` block is also inside `if (!localOnly)` after Task 2. If they are not in the same scope, hoist `selectedDirect` results to `const` declarations before the cloud block.)

- [ ] **Step 4: Rebuild and run.** Run: `npm run build:electron && node --test electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs electron/llm/__tests__/VisionOrdering2026_10_01.test.mjs electron/services/__tests__/AgentRouterDispatchExecutes2026_09_30.test.mjs electron/services/__tests__/OpenRouterVisionConsumers2026_10_01.test.mjs electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs electron/services/__tests__/FluxionProvider2026_09_18.test.mjs electron/llm/__tests__/GatewayVisionWiring2026_09_03.test.mjs`
Expected: PASS. The characterization passes with differences only where the selection's own rung now leads. Print them once and read them:

```bash
node -e "…load the test's orders() the way the test does, diff against the fixture, print name: was → now…"
```
(Write this as `$SP/vp5a-order-diff.mjs`, importing the built `LLMHelper` and reusing the helper, key sets and selections from the test file.)

- [ ] **Step 5: Live, through the real adapters, no app.** `$SP/vp5a-live.mjs`: a real `LLMHelper` with the OpenAI key (no credits) and the Gemini key; `setModel('gemini-3.8-flash')`; `streamChat('What does this code do?', [twoSumPng])`; print the `[Vision]` log lines. Expected: `committed to Gemini Flash` on attempt 1 with no OpenAI attempt before it. Run the same script once on the Task 2 build first (before this task's change) and keep both outputs: before, an OpenAI attempt fails first.

- [ ] **Step 6: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/LLMHelper.ts electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs
git commit -m "feat(vision): a selected OpenAI, Claude, Gemini, Groq, Natively or Antigravity model reads its own screenshot first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Claude models that reject a thinking setting get none

**Files:**
- Modify: `electron/llm/modelCapabilities.ts` (`claudeAcceptsThinkingDisabled`), `electron/llm/index.ts` (export, if `claudeAcceptsSamplingParams` is exported there)
- Modify: `electron/LLMHelper.ts` (the three native Claude sites that send `thinking: { type: 'disabled' }`: `generateWithClaude`, `streamWithClaude`, `streamWithClaudeMultimodal`)
- Test: `electron/services/__tests__/ClaudeThinkingParam2026_10_01.test.mjs`

**Interfaces:**
- Produces: `claudeAcceptsThinkingDisabled(modelId: string): boolean`.

Anthropic's documentation (checked 2026-10-01 through Context7, `/llmstxt/platform_claude_llms_txt`):
- "Claude Fable 5, Claude Mythos 5, and Claude Mythos Preview do not support disabling thinking at all"; "Attempting to set thinking parameters will result in a 400 error".
- "Thinking can be disabled on Claude Sonnet 5 and Claude Opus 5, provided the effort level is set to high or below".
- Nothing found for Opus 5.5 / Sonnet 5.5.

Omitting the field is valid for every model, so it is sent only where it is known to be accepted.

- [ ] **Step 1: Write the failing test.**

```js
/**
 * `thinking: { type: 'disabled' }` goes only to Claude models known to accept it
 * (2026-10-01). Natively sent it on every native Claude request. Anthropic's
 * docs: Fable 5 and Mythos 5 reject ANY thinking setting with a 400; Opus 5 and
 * Sonnet 5 accept "disabled" at high effort or below; nothing is documented for
 * the 5.5 models. Omitting the field is valid everywhere, so unknown ids omit.
 * This matters more since phase 5a: a selected Claude model now reads its own
 * screenshot, so a rejected parameter would fail every screenshot on it.
 *
 * NOT EXECUTED against Anthropic (no key in this environment): these pin the
 * request Natively builds.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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
const { claudeAcceptsThinkingDisabled } = require(dist('llm/modelCapabilities.js'));
const { LLMHelper } = require(dist('LLMHelper.js'));

describe('claudeAcceptsThinkingDisabled', () => {
  for (const id of ['claude-3-5-sonnet-20241022', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-5', 'claude-sonnet-5']) {
    test(`${id}: sent`, () => assert.equal(claudeAcceptsThinkingDisabled(id), true));
  }
  for (const id of ['claude-fable-5-1', 'claude-fable-5', 'claude-mythos-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-8', 'claude-opus-6', 'claude-something-new', '']) {
    test(`${id || '(empty)'}: omitted`, () => assert.equal(claudeAcceptsThinkingDisabled(id), false));
  }
});

describe('the image adapter builds the request accordingly', () => {
  async function request(model) {
    const sent = [];
    const h = Object.create(LLMHelper.prototype);
    Object.assign(h, {
      isLocalOnlyMode: false, isProviderDisabled: () => false, currentModelId: model,
      assertOutboundScopes: () => {}, rateLimiters: { claude: { acquire: async () => {} } },
      buildClaudeSystemBlocks: (s) => s,
      _claudeClient: { messages: { stream: (req) => { sent.push(req); return { abort() {}, async *[Symbol.asyncIterator]() {} }; } } },
    });
    for await (const _ of h.streamWithClaudeMultimodal('what is this?', [], 'SYS', model)) { /* drain */ }
    return sent[0];
  }
  test('Sonnet 4.6 and Opus 5: thinking disabled, as before', async () => {
    assert.deepEqual((await request('claude-sonnet-4-6')).thinking, { type: 'disabled' });
    assert.deepEqual((await request('claude-opus-5')).thinking, { type: 'disabled' });
  });
  test('Fable and the 5.5 models: no thinking field at all', async () => {
    for (const model of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5']) {
      assert.equal('thinking' in (await request(model)), false, model);
    }
  });
});
```

- [ ] **Step 2: Run; verify it fails.** Expected: `claudeAcceptsThinkingDisabled is not a function`.

- [ ] **Step 3: Implement.** In `modelCapabilities.ts`, below `claudeAcceptsSamplingParams`:

```ts
/**
 * Does this Claude model accept `thinking: { type: 'disabled' }`? An allow-list,
 * for the same reason as claudeAcceptsSamplingParams: OMITTING the field is
 * valid for every model, while SENDING it to one that rejects it fails every
 * answer. Anthropic's docs (checked 2026-10-01): Fable 5 and Mythos 5 reject
 * any thinking setting with a 400; Opus 5 and Sonnet 5 accept "disabled" at
 * high effort or below (Natively sets no effort); the 5.5 models are not
 * documented either way, so they omit. Claude 3 and 4.0–4.6 have always taken
 * it. Unknown and future ids omit.
 */
export function claudeAcceptsThinkingDisabled(modelId: string): boolean {
  const id = (modelId || '').toLowerCase();
  if (/^claude-(?:2|3|instant)/.test(id)) return true;
  if (/^claude-(?:opus|sonnet|haiku)-4(?:-[0-6])?(?:-\d{8})?$/.test(id)) return true;
  return /^claude-(?:opus|sonnet)-5(?:-\d{8})?$/.test(id);
}
```

In `LLMHelper.ts`, add a small helper next to the Claude adapters:

```ts
  /** `thinking: disabled` for the Claude models that accept it; nothing for the rest (they 400 on it). */
  private claudeNoThinking(model: string): { thinking?: { type: 'disabled' } } {
    return claudeAcceptsThinkingDisabled(model) ? { thinking: { type: 'disabled' as const } } : {};
  }
```

At the three native Claude sites (`generateWithClaude`, `streamWithClaude`, `streamWithClaudeMultimodal`), replace the line `thinking: { type: 'disabled' as const }, // …` with `...this.claudeNoThinking(model),` using that site's model variable. Leave the AgentRouter site (`agentRouterAnthropicParams`) and `DEEPSEEK_NO_THINKING` alone: AgentRouter ignores the setting and DeepSeek needs it.

- [ ] **Step 4: Rebuild and run.** Run: `npm run build:electron && node --test electron/services/__tests__/ClaudeThinkingParam2026_10_01.test.mjs electron/services/__tests__/OutputCapsAndClaudeSampling2026_09_30.test.mjs electron/services/__tests__/AgentRouterWire2026_09_30.test.mjs`. Expected: PASS. If a wire-parity test pins `thinking: disabled` for a native Claude model on the allow-list, it still passes; if it pins it for one off the list, update that test and say why.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/modelCapabilities.ts electron/llm/index.ts electron/LLMHelper.ts electron/services/__tests__/ClaudeThinkingParam2026_10_01.test.mjs
git commit -m "fix(claude): a thinking setting goes only to Claude models that accept it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs, validation, review, landing

**Files:**
- Modify: `docs/plans/2026-10-01-vision-capability-design.md` (delivery item 5; a note that the in-app check for phases 3a/3b was closed as not run, by Evin's choice)

- [ ] **Step 1: Docs.**
  - **Delivery item 5:** split into 5a (built) and 5b.
    - 5a: one ordering rule; a selected direct model reads its own screenshot first in the chat path; Claude thinking parameter.
    - 5b: the screen-reading path adopts the ordering and gains cURL, Codex, Antigravity and DeepSeek rungs; the non-streaming image paths; "Keep screenshots on this device" uses `/api/show`; the on-the-spot test.
  - **In-app check note:** the phases 3a/3b check was not run in the app. State what covers it instead.
  - **Messages:** the "clearer messages" of section 3 are already in place (local-only, OpenRouter, DeepSeek, AgentRouter, private vision). Say so.

- [ ] **Step 2: Full validation**, only when no other build or suite is running: `npm run typecheck:electron`, then `npm test` with the model weights linked from the main checkout and unlinked afterwards. Expected: 0 failures; report any failure by name.

- [ ] **Step 3: Final review**, then landing with the usual recipe (merge in a temp worktree; if `main` moved, confirm the merge differs from the tested branch only in files the Electron build does not use, or re-run; compare-and-swap; sync the root checkout; dirty set unchanged). Do not push.

- [ ] **Step 4: Completion report** (CLAUDE.md format): `Tested physically on macOS` for the script run; Claude request shapes `Reviewed but not executed` (no key); `Reviewed but not executed on Windows`, `Requires physical Windows verification`; the order differences from Task 3; remaining risks (a selected slow reasoning model now leads its screenshot turn with the 30-second first-token budget before falling back).
