# Vision Capability Phase 3b: Direct DeepSeek Flash Reads Screenshots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user whose selected model is direct DeepSeek Flash gets their screenshots read by it. Today Natively never sends DeepSeek an image, although Flash reads them.

**Architecture:** The DeepSeek adapter learns to attach images (OpenAI `image_url` parts, the format measured live). DeepSeek stops being "decided by the route" in the resolver and becomes an ordinary provider: the name list says Flash reads images, anything else is tested once (phase 3a). The streaming vision chain seats a DeepSeek rung only for a selected DeepSeek model the resolver says reads images, and Direct Assist forwards images on the same answer. One phase-3a judge gap found while measuring is closed first.

**Tech Stack:** TypeScript (Electron main), esbuild per-file bundles, `node:test` `.mjs` tests against `dist-electron/`.

**Spec:** `docs/plans/2026-10-01-vision-capability-design.md` (section 1 "Can this route carry an image?", delivery item 3). Earlier plans: phases 1, 2 and 3a in the same folder.

## Measured, 2026-10-01 (direct `api.deepseek.com/chat/completions`, the adapter's own request shape, test image "7392")

| Model | Reply |
|---|---|
| `deepseek-flash` | `7392` |
| `deepseek-v4-flash` | `7392` |
| `deepseek-v4-pro` | `42` (HTTP 200: a blind, made-up answer) |

## Global Constraints

- macOS and Windows: no OS-specific code.
- Never send blind. DeepSeek Pro answers HTTP 200 without seeing the image, so a DeepSeek model is sent a screenshot only when the resolver says yes (the name list for Flash, or a passed one-time test). Unknown is never seated and never forwarded.
- A DeepSeek rung is seated only for the model the user selected, as every gateway rung is: it is never recruited for someone else's turn.
- Other gateways' DeepSeek models are unaffected. The name-list entry covers direct ids and AgentRouter's (measured in phase 1); OpenRouter's catalogue lists its DeepSeek Flash as text-only and stays authoritative there.
- Only one Natively dev app and one build at a time on this machine. Before each build check `pgrep -f '^node scripts/build-electron.js'` and `pgrep -fl 'electron --test'`; before an app run check `pgrep -f '^node scripts/dev-agent.mjs'` (anchor the pattern, or a waiting loop matches itself).
- API keys are never printed or put on argv. Land on local `main` only. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Out of scope: the screen-reading registry gets no DeepSeek rung here (phase 5 gives both paths one ordering); `generateWithDeepseek` (non-streaming) stays text-only, since nothing routes an image to it.

## Review Focus

1. A blind model that answers the test with a short wrong number ("42") must be judged a miss, not skipped as too short to be a reply. Tested in Task 1.
2. DeepSeek Pro (or any future DeepSeek model not known to read images) must never receive a screenshot before a test says yes. Tested in Tasks 2 and 4.
3. A DeepSeek key that is present while another provider is selected must not seat a DeepSeek rung. Tested in Task 4.
4. The screenshots privacy scope must see the image on the DeepSeek adapter. Today the adapter passes no image paths to the scope guard. Tested in Task 3.
5. A DeepSeek-only user with Pro selected must be told that model can't read screenshots and that Flash can, not "add an OpenAI/Claude/Gemini/Groq key". Tested in Task 4.

## Every place that steers images away from DeepSeek today

| Site | Today | Phase 3b |
|---|---|---|
| `visionResolver.ts` `case 'deepseek'` | `no`, decided by the route | removed: name list, then one-time test, like any provider |
| `modelCapabilities.ts` `agentRouterDeepseekReadsImages` | Flash is vision only behind `agentrouter/` | Flash is vision when direct or behind `agentrouter/` |
| `LLMHelper.streamWithDeepseek` | text only; scope guard sees no image | optional `imagePaths`, sent as `image_url` parts; scope guard sees them |
| `streamDirectAssistFrozen` `case 'deepseek'` | calls the adapter without images | passes `imagePaths` |
| `streamVisionWithFallback` | no DeepSeek rung | a rung for a selected DeepSeek model the resolver says reads images, front-loaded |
| `VISION_TESTABLE` | DeepSeek not tested | DeepSeek tested when unknown |
| Empty-chain message | generic "add an API key" | DeepSeek-specific when the selected DeepSeek model can't read images |
| `generateWithDeepseek`, the text cascade's DeepSeek entry | text only | unchanged |

## File structure

- Modify `electron/llm/visionProbeOutcome.ts`: a different number is a real reply.
- Modify `electron/llm/modelCapabilities.ts`: `deepseekFlashReadsImages`.
- Modify `electron/llm/visionResolver.ts`: drop the `deepseek` route case.
- Modify `electron/LLMHelper.ts`: adapter images, Direct Assist case, chain seat and front-load, message, `VISION_TESTABLE`.
- Tests:
  - `electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs` (modify)
  - `electron/llm/__tests__/VisionResolver2026_10_01.test.mjs` (modify)
  - `electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs` (modify: one `INTENDED` rule)
  - `electron/services/__tests__/AgentRouterScreenshots2026_09_30.test.mjs` (modify: direct Flash now reads images)
  - `electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs` (modify)
  - `electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs` (modify)
  - `electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs` (new)

Commands run from the worktree root `.claude/worktrees/vision-phase3b`. `SP` = the session scratchpad.

---

### Task 1: A wrong number is a real reply

**Files:**
- Modify: `electron/llm/visionProbeOutcome.ts` (`judgeProbeReply`)
- Modify: `electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs`

**Interfaces:**
- Produces: `judgeProbeReply` returns `'no'` for a reply that contains a number (two or more digits) other than the one shown.

- [ ] **Step 1: Write the failing test.** Append inside `describe('judgeProbeReply', …)`:

```js
  test('a blind model that answers with a different number is a miss, however short (phase 3b)', () => {
    // Measured 2026-10-01: direct deepseek-v4-pro answered "42" to an image
    // showing 7392. Too short to count as "a real reply" by length alone, so a
    // blind model stayed unknown forever and was never marked text-only.
    for (const reply of ['42', '1234', '12', 'It is 4816.', '7391']) assert.equal(judgeProbeReply(reply, '7392'), 'no', reply);
    for (const reply of ['', '4', 'ok', '.']) assert.equal(judgeProbeReply(reply, '7392'), 'unknown', JSON.stringify(reply));
  });
```

- [ ] **Step 2: Run; verify it fails.** Run: `node --test --test-name-pattern="different number" electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs`. Expected: FAIL (`'42'` → `unknown`).

- [ ] **Step 3: Implement.** In `judgeProbeReply`, replace the final `return` line with:

```ts
  // A different number IS an answer, however short: a blind model told to
  // "answer with the number only" replies "42" (deepseek-v4-pro, measured).
  const digits = (text.match(/\d/g) ?? []).length;
  return digits >= 2 || text.replace(/[^\p{L}\p{N}]/gu, '').length >= 6 ? 'no' : 'unknown';
```

and extend the function's doc comment: "A reply containing a different number is a miss even when short."

- [ ] **Step 4: Rebuild and run.** Run: `npm run build:electron && node --test electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs electron/llm/__tests__/VisionProbe2026_10_01.test.mjs`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add electron/llm/visionProbeOutcome.ts electron/llm/__tests__/VisionProbeOutcome2026_10_01.test.mjs
git commit -m "fix(vision): a blind model answering a different number is a miss, however short

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: DeepSeek becomes an ordinary provider for the resolver

**Files:**
- Modify: `electron/llm/modelCapabilities.ts` (`agentRouterDeepseekReadsImages` → `deepseekFlashReadsImages`)
- Modify: `electron/llm/visionResolver.ts` (remove `case 'deepseek'`)
- Modify: `electron/LLMHelper.ts` (`VISION_TESTABLE`)
- Modify tests: `VisionResolver2026_10_01`, `VisionCharacterization2026_10_01`, `AgentRouterScreenshots2026_09_30`, `VisionResolverConsumers2026_10_01`, `VisionProbeWiring2026_10_01`

**Interfaces:**
- Produces: `getModelCapabilities('deepseek-flash', false).supportsImages === true` (and `deepseek-v4-flash`, `deepseek-v4-flash-0731`); `resolveVision({ provider: 'deepseek', model })` → name list, then test, else unknown.

- [ ] **Step 1: Update the tests first.**

`VisionResolver2026_10_01.test.mjs`:
- Replace the test `"direct DeepSeek's adapter never attaches an image, whatever the model"` with:

```js
  test('direct DeepSeek: Flash reads images (measured); Pro is unknown until tested, never yes by default', () => {
    assert.deepEqual(v('deepseek', 'deepseek-v4-flash'), yes('names'));
    assert.deepEqual(v('deepseek', 'deepseek-flash'), yes('names'));
    assert.deepEqual(v('deepseek', 'deepseek-v4-pro'), unknown);
    assert.deepEqual(v('deepseek', 'deepseek-v4-pro', { testedVision: () => false }), no('test'));
  });
```

- In `'never applies to route-decided providers or Ollama'`, delete the `deepseek` line (DeepSeek is no longer route-decided).

`AgentRouterScreenshots2026_09_30.test.mjs`: replace the test `'direct DeepSeek stays text-only — its adapter never sends an image'` with:

```js
  test('direct DeepSeek Flash reads images since 2026-10-01 (its adapter now attaches them); Pro does not', () => {
    assert.equal(reads('deepseek-flash'), true);
    assert.equal(reads('deepseek-v4-flash'), true);
    assert.equal(reads('deepseek-v4-pro'), false);
  });
```

(The next test in that file, `'the DeepSeek entry is AgentRouter\'s alone, and Flash only'`, keeps its assertions on `openrouter/…`, `fluxion/…` and `agentrouter/deepseek-v4-pro`; rename it `'other gateways are not covered, and Flash only'`.)

`VisionResolverConsumers2026_10_01.test.mjs`: in `'unchanged for plain selections'`, change `assert.equal(caps({ currentModelId: 'deepseek-v4-flash' }), false);` to `true`, add `assert.equal(caps({ currentModelId: 'deepseek-v4-pro' }), false);`, and rename the test `'plain selections'`.

`VisionProbeWiring2026_10_01.test.mjs`: in the "no test" list, replace the DeepSeek entry with `['a direct DeepSeek Flash model (the name list knows it)', 'deepseek-v4-flash']`, and add after that loop:

```js
  test('direct DeepSeek Pro is unknown, so it is tested once through the DeepSeek adapter', async () => {
    const h = helper(); h.enableVisionProbing();
    const seen = [];
    h.streamWithDeepseek = async function* (_prompt, _system, model, _signal, imagePaths) { seen.push({ model, images: (imagePaths || []).length }); yield '42'; };
    h.setModel('deepseek-v4-pro');
    await settle();
    assert.equal(seen.length, 2, 'a wrong number is confirmed with a second, different image');
    assert.deepEqual(seen.map((s) => s.images), [1, 1]);
    assert.equal(store.tested('deepseek', '', 'deepseek-v4-pro')?.reads, false);
  });
```

`VisionCharacterization2026_10_01.test.mjs`: add a fourth `INTENDED` rule:

```js
  { why: 'direct DeepSeek Flash reads images (measured 2026-10-01; its adapter attaches them since phase 3b)',
    match: (k) => k.split('|')[1] === 'deepseek' && /^deepseek-(?:v\d+-)?flash(?:$|-)/.test(k.split('|')[2]) },
```

- [ ] **Step 2: Run; verify they fail.** Run: `node --test electron/llm/__tests__/VisionResolver2026_10_01.test.mjs electron/services/__tests__/AgentRouterScreenshots2026_09_30.test.mjs electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs`. Expected: the new DeepSeek assertions fail, and the characterization fails with "stale rule" for the new rule.

- [ ] **Step 3: Implement.**

`modelCapabilities.ts`: replace `agentRouterDeepseekReadsImages` and its comment with:

```ts
/**
 * DeepSeek Flash reads images. Measured twice: through AgentRouter
 * (2026-09-30, both routes) and directly (2026-10-01, `deepseek-flash` and
 * `deepseek-v4-flash` read the test image; DeepSeek's pricing page lists Vision
 * for Flash). V4 Pro does NOT: sent an image directly it answers HTTP 200 with
 * a made-up reply, so it must never be assumed.
 *
 * Covers the DIRECT id and AgentRouter's. Other gateways are left to their own
 * data: OpenRouter's catalogue lists its DeepSeek Flash as text-only, and it
 * refuses the image. Direct became true on 2026-10-01, when streamWithDeepseek
 * learned to attach images; before that the direct adapter dropped them, and
 * saying yes here would have promised a read that never happened.
 */
function deepseekFlashReadsImages(routedId: string, strippedLower: string): boolean {
  const direct = (routedId || '').toLowerCase() === strippedLower;
  return (direct || /^agentrouter\//i.test(routedId || '')) && /^deepseek-(?:v\d+-)?flash(?:$|-)/.test(strippedLower);
}
```

and update its one call site to `deepseekFlashReadsImages(modelId, lower)`. (`lower` has a leading `models/` stripped; a DeepSeek id never has one, so `direct` compares correctly.)

`visionResolver.ts`: delete the `case 'deepseek':` block and its comment, so DeepSeek falls to `default:` (`fromTestThenNames`). Update the header comment of the `natively`/`codex-cli`/`antigravity` group if it mentions DeepSeek.

`LLMHelper.ts`: add `'deepseek'` to `VISION_TESTABLE`.

- [ ] **Step 4: Rebuild and run.** Same command as Step 2, after `npm run build:electron`. Expected: PASS, except the new DeepSeek Pro wiring test, which needs Task 3's adapter signature (it stubs `streamWithDeepseek` with five parameters and counts images): if it fails only on `images`, leave it failing and finish it in Task 3. The characterization must show gains only for direct DeepSeek Flash ids.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/llm/modelCapabilities.ts electron/llm/visionResolver.ts electron/LLMHelper.ts electron/llm/__tests__/VisionResolver2026_10_01.test.mjs electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs electron/services/__tests__/AgentRouterScreenshots2026_09_30.test.mjs electron/services/__tests__/VisionResolverConsumers2026_10_01.test.mjs electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs
git commit -m "feat(vision): direct DeepSeek Flash is known to read images; other DeepSeek models are tested

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The DeepSeek adapter attaches images

**Files:**
- Modify: `electron/LLMHelper.ts` (`streamWithDeepseek`; `streamDirectAssistFrozen` `case 'deepseek'`)
- Test: `electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs`

**Interfaces:**
- Produces: `streamWithDeepseek(userMessage: string, systemPrompt?: string, modelId?: string, abortSignal?: AbortSignal, imagePaths?: string[])`.

- [ ] **Step 1: Write the failing test.**

```js
/**
 * Direct DeepSeek Flash reads screenshots (2026-10-01).
 *
 * Measured: api.deepseek.com reads an image sent as an OpenAI `image_url` part
 * on deepseek-flash and deepseek-v4-flash, and Natively never sent one — the
 * adapter had no image argument, and the screenshots scope guard was handed
 * the text only. deepseek-v4-pro answers HTTP 200 with a made-up reply, so the
 * adapter carries images for whichever model it is given and the callers
 * decide who gets one.
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

let store;
beforeEach(() => { store = new VisionCapabilityStore({ filePath: null }); __setVisionCapabilityStore(store); });

const image = () => { const p = path.join(os.tmpdir(), `ds-${process.pid}-${Math.random().toString(36).slice(2)}.png`); fs.writeFileSync(p, Buffer.from('89504e470d0a1a0a', 'hex')); return p; };

/** A helper whose DeepSeek client records the request it is given. */
function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  const requests = []; const scopes = [];
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: 'deepseek-v4-flash', ollamaModel: '',
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), configuredCustomProviders: [],
    isLocalOnlyMode: false, isProviderDisabled: () => false, deepseekPermanentlyDead: false,
    litellmBaseURL: 'http://localhost:4000/v1', ninerouterBaseURL: 'http://localhost:20128/v1',
    rateLimiters: { deepseek: { acquire: async () => {} } },
    assertOutboundScopes: (provider, text, imagePaths) => { scopes.push({ provider, images: (imagePaths || []).length }); },
    assertOutboundImagesAllowed: () => {}, getDeniedOutboundScopes: () => [],
    visionHealth: new Map(), modelVersionManager: { getAllVisionTiers: () => [], onModelError: async () => {} },
    codexCliConfig: { enabled: false }, isCodexAvailable: () => false, antigravityFallbackModel: () => null, hasNatively: () => false,
    _deepseekClient: { chat: { completions: { create: async (body) => { requests.push(body); return (async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; })(); } } } },
    ...state,
  });
  return { h, requests, scopes };
}
const drain = async (gen) => { const out = []; for await (const t of gen) out.push(t); return out.join(''); };

describe('the adapter', () => {
  test('with an image: an OpenAI image_url part after the text, and the scope guard sees the image', async () => {
    const { h, requests, scopes } = helper(); const img = image();
    assert.equal(await drain(h.streamWithDeepseek('what is this?', 'SYS', 'deepseek-v4-flash', undefined, [img])), 'ok');
    const user = requests[0].messages.at(-1);
    assert.equal(user.role, 'user');
    assert.ok(Array.isArray(user.content), 'multimodal content is an array of parts');
    assert.deepEqual(user.content[0], { type: 'text', text: 'what is this?' });
    assert.equal(user.content[1].type, 'image_url');
    assert.match(user.content[1].image_url.url, /^data:image\/png;base64,/);
    assert.deepEqual(scopes, [{ provider: 'deepseek', images: 1 }], 'the screenshots scope is checked with the image, not the text alone');
    assert.equal(requests[0].model, 'deepseek-v4-flash');
    fs.rmSync(img, { force: true });
  });
  test('without an image: byte-for-byte the text request it always sent', async () => {
    const { h, requests, scopes } = helper();
    await drain(h.streamWithDeepseek('hello', 'SYS', 'deepseek-v4-flash'));
    assert.deepEqual(requests[0].messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hello' }]);
    assert.deepEqual(scopes, [{ provider: 'deepseek', images: 0 }]);
  });
});

describe('Direct Assist', () => {
  const request = (model, img) => ({ requestId: 'r', selection: { provider: 'deepseek', model }, systemPrompt: 's', userPrompt: 'What is on screen?', imagePaths: img ? [img] : [] });
  test('a screenshot on DeepSeek Flash reaches DeepSeek with the image', async () => {
    const { h, requests } = helper(); const img = image();
    await drain(h.streamDirectAssistFrozen(request('deepseek-v4-flash', img), null, null));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].messages.at(-1).content.at(-1).type, 'image_url');
    fs.rmSync(img, { force: true });
  });
  test('a screenshot on DeepSeek Pro is refused before any request: it would be answered blind', async () => {
    const { h, requests } = helper({ currentModelId: 'deepseek-v4-pro' }); const img = image();
    await assert.rejects(() => drain(h.streamDirectAssistFrozen(request('deepseek-v4-pro', img), null, null)), /does not support image input/);
    assert.equal(requests.length, 0);
    fs.rmSync(img, { force: true });
  });
});
```

- [ ] **Step 2: Run; verify it fails.** Run: `node --test electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs`. Expected: the image tests fail (the content is a string; the scope guard saw 0 images; Direct Assist sent no image).

- [ ] **Step 3: Implement in `electron/LLMHelper.ts`.**

`streamWithDeepseek`: add the parameter and build the content.

```ts
  private async * streamWithDeepseek(userMessage: string, systemPrompt?: string, modelId?: string, abortSignal?: AbortSignal, imagePaths?: string[]): AsyncGenerator<string, void, unknown> {
    if (this.isLocalOnlyMode) throw new Error("Cloud providers disabled in local-only mode");
    if (!this.deepseekClient) throw new Error("DeepSeek client not initialized");
    // The image paths go to the scope guard too (2026-10-01): it used to be
    // handed the text alone, because this adapter never carried an image.
    this.assertOutboundScopes('deepseek', userMessage, imagePaths);
```

and replace `messages.push({ role: "user", content: userMessage });` with:

```ts
    // Images as OpenAI `image_url` parts, the format DeepSeek Flash read live
    // (2026-10-01). This adapter attaches them for whichever model it is given:
    // WHO may be sent one is decided above it (the vision resolver), because
    // deepseek-v4-pro answers HTTP 200 without seeing the image.
    if (imagePaths?.length) {
      messages.push({ role: "user", content: [{ type: "text", text: userMessage }, ...await this.buildOpenAiImageParts(imagePaths)] });
    } else {
      messages.push({ role: "user", content: userMessage });
    }
```

`streamDirectAssistFrozen`, `case 'deepseek':` → `yield* this.streamWithDeepseek(directUserPrompt, request.systemPrompt, model, abortSignal, imagePaths);`

Check the three other `streamWithDeepseek(` call sites (`grep -n "streamWithDeepseek(" electron/LLMHelper.ts`): they pass four arguments or fewer and stay text-only.

- [ ] **Step 4: Rebuild and run.** Run: `npm run build:electron && node --test electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs electron/services/__tests__/VisionProbeWiring2026_10_01.test.mjs electron/llm/__tests__/DirectAssistCore2026_08_29.test.mjs electron/llm/__tests__/DeepseekFlashMigration2026_09_25.test.mjs`. Expected: PASS (including Task 2's DeepSeek Pro wiring test).

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/LLMHelper.ts electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs
git commit -m "feat(deepseek): the direct adapter attaches screenshots; Direct Assist sends them to Flash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The selected DeepSeek model reads its own screenshot turn

**Files:**
- Modify: `electron/LLMHelper.ts` (`streamVisionWithFallback`: seat, front-load, message)
- Test: `electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs` (append)

**Interfaces:**
- Consumes: `streamWithDeepseek(…, imagePaths)` (Task 3), `visionVerdict`, `readsImages`.

- [ ] **Step 1: Write the failing tests.** Append:

```js
describe('the streaming vision chain', () => {
  async function chain(state = {}) {
    const opened = [];
    const stub = (name) => async function* (...args) { opened.push({ name, args }); yield 'ok'; };
    const { h } = helper({ client: null, openaiClient: null, claudeClient: null, groqClient: null, ...state });
    h.streamWithDeepseek = stub('deepseek'); h.streamWithGeminiModel = stub('gemini');
    let error = null;
    try { for await (const _ of h.streamVisionWithFallback({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })) { /* drain */ } } catch (e) { error = e; }
    return { opened, error };
  }
  test('DeepSeek Flash selected, nothing else configured: DeepSeek reads the screenshot', async () => {
    const { opened, error } = await chain();
    assert.equal(error, null, error?.message);
    assert.equal(opened[0].name, 'deepseek');
    assert.deepEqual(opened[0].args[4], ['/tmp/x.png'], 'the image is handed to the adapter');
    assert.equal(opened[0].args[2], 'deepseek-v4-flash', 'for the selected model');
  });
  test('DeepSeek Flash selected with another vision key: the selected model still leads its own turn', async () => {
    const { opened } = await chain({ client: {} });
    assert.equal(opened[0].name, 'deepseek');
  });
  test('DeepSeek Pro selected: never seated; another provider answers', async () => {
    const { opened, error } = await chain({ currentModelId: 'deepseek-v4-pro', client: {} });
    assert.equal(error, null);
    assert.ok(!opened.some((o) => o.name === 'deepseek'), 'Pro answers blind, so it gets no screenshot');
    assert.equal(opened[0].name, 'gemini');
  });
  test('DeepSeek Pro selected and nothing else: the user is told this model cannot read screenshots, and that Flash can', async () => {
    const { error } = await chain({ currentModelId: 'deepseek-v4-pro' });
    assert.match(error?.message ?? '', /^No vision-capable provider configured\./);
    assert.match(error.message, /deepseek-v4-pro/);
    assert.match(error.message, /DeepSeek Flash/);
    assert.doesNotMatch(error.message, /OpenAI, Claude, Gemini, or Groq/);
  });
  test('a DeepSeek key with ANOTHER model selected seats no DeepSeek rung', async () => {
    for (const state of [
      { currentModelId: 'gemini-3.1-flash-lite', client: {} },
      { customProvider: { id: 'c', name: 'c', multimodal: false }, client: {} },
      { useOllama: true, ollamaModel: 'llama3.1:8b', ollamaVisionModel: null, resolveOllamaVisionModelForChain: async () => null, client: {} },
    ]) {
      const { opened } = await chain(state);
      assert.ok(!opened.some((o) => o.name === 'deepseek'), JSON.stringify(Object.keys(state)));
    }
  });
  test('a key marked dead for this session (402) is not seated', async () => {
    const { opened } = await chain({ deepseekPermanentlyDead: true, client: {} });
    assert.ok(!opened.some((o) => o.name === 'deepseek'));
  });
  test('a DeepSeek model a one-time test passed is seated', async () => {
    store.recordTest('deepseek', '', 'deepseek-v5-next', true);
    const { opened } = await chain({ currentModelId: 'deepseek-v5-next' });
    assert.equal(opened[0]?.name, 'deepseek');
  });
});
```

- [ ] **Step 2: Run; verify they fail.** Expected: no DeepSeek rung is ever opened; the Pro-only message is the generic one.

- [ ] **Step 3: Implement in `streamVisionWithFallback`.**

After the AgentRouter seat (the last gateway seat before Codex), add:

```ts
      // Direct DeepSeek (2026-10-01). Seated only when it is the model the user
      // selected AND the resolver says that model reads images: the name list
      // for Flash (measured), or a passed one-time test. Never on unknown —
      // deepseek-v4-pro answers HTTP 200 without seeing the image, so an
      // unverified DeepSeek model would be a blind answer. The session's 402
      // flag is honoured, as the text cascade does.
      const deepseekSelected = !this.useOllama && !this.customProvider && !this.activeCurlProvider && this.isDeepseekModel(this.currentModelId);
      const deepseekReads = deepseekSelected && readsImages(this.visionVerdict({ provider: 'deepseek', model: this.currentModelId }), false);
      if (deepseekReads && this.deepseekClient && !this.deepseekPermanentlyDead) {
        cloud.push({ id: 'deepseek', name: `DeepSeek (${deepseekWireModel(this.currentModelId)})`, isLocal: false, priority: prio++, ttftTimeoutMs: PRO_TTFT_MS,
          open: (sig) => this.streamWithDeepseek(userContent, systemPrompt, this.currentModelId, sig, imagePaths) });
      }
```

In the front-load block, after the AgentRouter line, add:

```ts
      // The selected DeepSeek model leads its own turn, like the gateways above.
      if (deepseekSelected) { const ds = cloud.find(p => p.id === 'deepseek'); if (ds) front.push(ds); }
```

`deepseekSelected` and `deepseekReads` are declared inside `if (!localOnly) { … }`; the front-load block is outside it. Declare both with `let` before that `if` (initialised `false`) and assign inside, or compute them before the `if` (they do not depend on `localOnly`).

In the `ordered.length === 0` block, after the local-only throw and the OpenRouter message, add:

```ts
      // A selected DeepSeek model that does not read images (Pro), and nothing
      // else configured: name the model and the one that can (2026-10-01).
      if (deepseekSelected && !deepseekReads) {
        throw new Error(`No vision-capable provider configured. The selected DeepSeek model (${deepseekWireModel(this.currentModelId)}) can't read screenshots — DeepSeek Flash can. Pick DeepSeek Flash, or add another vision provider in Settings.`);
      }
```

- [ ] **Step 4: Rebuild and run every vision suite.**

Run:
```bash
npm run build:electron && git grep -z -l -E "supportsImages|visionCapability|gatewaySeatReadsImages|streamVisionWithFallback|VisionProbe|directSelectionSupportsImages|streamWithDeepseek|deepseek" -- 'electron/**/__tests__/*.test.mjs' | xargs -0 node --test
```
Expected: PASS; the characterization gains are direct DeepSeek Flash ids only.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck:electron
git add electron/LLMHelper.ts electron/services/__tests__/DeepseekScreenshots2026_10_01.test.mjs
git commit -m "feat(deepseek): a selected DeepSeek Flash reads its own screenshot turn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Live check, docs, validation, landing

**Files:**
- Modify: `docs/plans/2026-10-01-vision-capability-design.md` (section 1, delivery item 3)

- [ ] **Step 1: Live, through the real adapters, without the app.** Write `$SP/vp3b-live.mjs`: a real `LLMHelper` from the bundle with ONLY the DeepSeek key (read from `.env`, never printed) and an in-memory store. Check:
  1. Forced probes: `deepseek-v4-flash` → yes; `deepseek-v4-pro` → no (two blind replies).
  2. `setModel('deepseek-v4-flash')`, then `streamChat('What does this code do?', [twoSumPng])`: the answer is about Two Sum, and the log shows `[Vision] committed to DeepSeek`.
  3. `setModel('deepseek-v4-pro')`, then the same `streamChat`: the reply is "I can't read screenshots with the current setup. The selected DeepSeek model (deepseek-v4-pro) can't read screenshots — DeepSeek Flash can…", and no request was made with an image.

  Save the output to `$SP/vp3b-live.txt`.

- [ ] **Step 2: Docs.**
  - **Design doc, section 1:** "direct DeepSeek's adapter now carries images; Flash is known to read them, other DeepSeek models are tested once".
  - **Delivery item 3:** mark 3b done.
  - **Design doc and memory:** note that the phase 3a in-app check is still owed.

- [ ] **Step 3: Full validation**, one at a time and only when no other build or suite is running: `npm run typecheck:electron`, then `npm test` with the model weights linked from the main checkout and unlinked afterwards. Expected: 0 failures (report any failure by name, even an unrelated one).

- [ ] **Step 4: Final review, then landing** with the usual recipe (merge in a temp worktree; if `main` moved, confirm the merge differs from the tested branch only in files the Electron build does not use, or re-run; compare-and-swap; sync the root checkout; dirty set unchanged). Do not push.

- [ ] **Step 5: In-app check for phases 3a and 3b together**, when no other dev app is running: the recipe saved in memory for 3a, plus a screenshot on a selected DeepSeek Flash. If the machine never frees up, say so in the report.

- [ ] **Step 6: Completion report** (CLAUDE.md format): `Tested physically on macOS` for what the script and app exercised; `Reviewed but not executed on Windows`, `Requires physical Windows verification`; remaining risks (DeepSeek changing which models read images: Flash is name-listed, so a change needs a refused screenshot to trigger a re-test).
