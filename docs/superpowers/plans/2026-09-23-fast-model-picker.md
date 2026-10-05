# Fast Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick a model in Settings that the app uses for its cheap internal LLM calls — the Auto Answer judge, the query rewrite, and browser-metadata classification.

**Architecture:** One new private seam on `LLMHelper`, `callFastModel()`, resolves the picked model, routes it through the existing per-provider classifiers, and makes a single non-streaming call. Three consumers try it as rung 0 and fall through to their existing ladders when it returns `null`. Unset is a first-class state meaning "behave exactly as today".

**Tech Stack:** TypeScript, Electron main process, React renderer, `node:test` run under the Electron runner.

**Spec:** `docs/superpowers/specs/2026-09-23-fast-model-picker-design.md`

## Global Constraints

- **Unset must be byte-identical to today.** `getFastModel()` returns `null` when unset — never a default.
- **`null` means "unavailable, use your existing path". Only abort throws.** A provider failure must never prevent the ladder beneath it from answering.
- **Every provider branch does four things in order:** `assertOutboundScopes(family, message)` → acquire that family's rate limiter if one exists → one non-streaming request → `stripLeadingReasoningBlock`.
- **Rate-limiter keys today:** `groq`, `gemini`, `openai`, `claude`, `deepseek`, `litellm`, `nvidia_nim`, `openrouter`. A family with no limiter skips that step rather than throwing.
- **No `process.platform` branch may be introduced.** This is provider-routing logic plus a renderer picker; both are platform-neutral (CLAUDE.md cross-platform contract).
- **Settings writes return a boolean.** A refused write must never be reported as success.
- **Fast Response Mode (`fastModeApplies`) is a different feature and must not be touched.**
- **Test command** (the Electron runner — several of these tests need Electron's ABI):
  ```bash
  node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=nat-fm \
    --default-tmpdir CODEX_HOME=nat-fm-codex --set ELECTRON_RUN_AS_NODE=1 \
    -- electron --test "<test file>"
  ```

## Review Focus

Input classes the spec implies but which no task's happy path exercises. Each has a test assigned to the task that owns the code.

1. **A stale/retired model id** — the user picked a model that the provider has since removed. `callFastModel` must return `null` (fall through), not throw. *Task 2.*
2. **Abort while the fast rung is in flight** — the judge superseding or hitting its deadline must propagate, not be swallowed as a fallthrough to the ladder. *Task 3.*
3. **An empty or whitespace-only response** — a model that returns `""` must count as failure and fall through, not deliver an empty verdict. *Task 2.*
4. **Family disabled after the pick was saved** — `isProviderDisabled('groq')` becomes true while `fastModel` still names a Groq model. Must return `null`. *Task 2.*
5. **`isLocalOnlyMode` with a cloud model picked** — must return `null` and never make an outbound request. *Task 2.*

---

### Task 1: Storage and IPC

**Files:**
- Modify: `electron/services/CredentialsManager.ts` (field near `defaultModel`; getter near `getDefaultModel` at :1121; setter near `setDefaultModel` at :1750)
- Modify: `electron/ipcHandlers.ts` (near `set-default-model` at :13208)
- Modify: `electron/preload.ts` (near `setDefaultModel` at :2344-2346)
- Test: `electron/services/__tests__/FastModelSetting2026_09_23.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `CredentialsManager.getFastModel(): string | null`, `CredentialsManager.setFastModel(model: string | null): boolean`. IPC channels `get-fast-model` and `set-fast-model`. Preload `getFastModel()` / `setFastModel(modelId)`.

- [ ] **Step 1: Write the failing test**

```js
// electron/services/__tests__/FastModelSetting2026_09_23.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('getFastModel returns null when unset — unset must mean "behave as today"', () => {
  const src = read('electron/services/CredentialsManager.ts');
  const m = src.match(/public getFastModel\(\)[\s\S]{0,300}?\n    \}/);
  assert.ok(m, 'getFastModel must exist');
  assert.match(m[0], /\|\|\s*null/, 'must fall back to null, never to a default model id');
  assert.doesNotMatch(m[0], /'gemini|'gpt-|'deepseek/, 'must not hardcode a default fast model');
});

test('setFastModel returns the persistence boolean, like setSttProvider', () => {
  const src = read('electron/services/CredentialsManager.ts');
  const m = src.match(/public setFastModel\([\s\S]{0,400}?\n    \}/);
  assert.ok(m, 'setFastModel must exist');
  assert.match(m[0], /\)\s*:\s*boolean/, 'must be typed boolean — void hides a refused write');
  assert.match(m[0], /refuseWriteWhileDegraded/, 'must refuse while the store is degraded');
  assert.match(m[0], /const persisted = this\.saveCredentials\(\)/);
  assert.match(m[0], /return persisted/);
});

test('the set-fast-model IPC handler reports a refused write instead of success', () => {
  const src = read('electron/ipcHandlers.ts');
  const i = src.indexOf("safeHandle('set-fast-model'");
  assert.ok(i > -1, 'set-fast-model handler must exist');
  const body = src.slice(i, i + 600);
  assert.match(body, /if \(!.*setFastModel\(/, 'the boolean must control the response');
  assert.match(body, /success: false/, 'a refused write must return success:false');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=nat-fm --default-tmpdir CODEX_HOME=nat-fm-codex --set ELECTRON_RUN_AS_NODE=1 -- electron --test "electron/services/__tests__/FastModelSetting2026_09_23.test.mjs"`
Expected: FAIL — "getFastModel must exist".

- [ ] **Step 3: Add the field, getter and setter**

In `electron/services/CredentialsManager.ts`, beside `defaultModel?: string;` in the credentials interface (:139 area):

```ts
    /** The model used for cheap internal calls (judge, query rewrite, classification). */
    fastModel?: string;
```

Beside `getDefaultModel()` (:1121):

```ts
    /**
     * The user's chosen fast model, or null when unset.
     *
     * Null is a first-class state meaning "use the measured per-provider ladder",
     * NOT a missing default. Returning a model id here would silently override the
     * judge ladder for every user who never opened the picker.
     */
    public getFastModel(): string | null {
        return this.credentials.fastModel || null;
    }
```

Beside `setDefaultModel()` (:1750), following `setSttProvider`'s boolean shape (:1594):

```ts
    /** @returns false when the write was refused or did not persist. */
    public setFastModel(model: string | null): boolean {
        if (this.refuseWriteWhileDegraded('set fast model')) return false;
        this.credentials.fastModel = model ?? undefined;
        const persisted = this.saveCredentials();
        console.log(`[CredentialsManager] Fast Model set to: ${model ?? '(auto)'}`);
        return persisted;
    }
```

- [ ] **Step 4: Add the IPC channels**

In `electron/ipcHandlers.ts`, beside `set-default-model` (:13208):

```ts
  safeHandle('set-fast-model', async (_, modelId: string | null) => {
    if (modelId !== null && typeof modelId !== 'string') {
      return { success: false, error: 'invalid_value_type' };
    }
    if (!CredentialsManager.getInstance().setFastModel(modelId)) {
      return { success: false, error: 'settings_store_degraded' };
    }
    return { success: true };
  });

  safeHandle('get-fast-model', async () => {
    return { model: CredentialsManager.getInstance().getFastModel() };
  });
```

In `electron/preload.ts`, beside `setDefaultModel` (:2346):

```ts
  getFastModel: () => ipcRenderer.invoke('get-fast-model'),
  setFastModel: (modelId: string | null) => ipcRenderer.invoke('set-fast-model', modelId),
```

- [ ] **Step 5: Run the test to verify it passes**

Run the Step 2 command. Expected: 3 passing.

- [ ] **Step 6: Typecheck and commit**

```bash
node node_modules/typescript7/lib/tsc.js -p electron/tsconfig.json --noEmit
git add electron/services/CredentialsManager.ts electron/ipcHandlers.ts electron/preload.ts electron/services/__tests__/FastModelSetting2026_09_23.test.mjs
git commit -m "feat(settings): store a user-chosen fast model

Null when unset — a first-class state meaning 'use the measured ladder',
not a missing default. The setter returns the persistence boolean so a
refused write is never reported as success."
```

---

### Task 2: The `callFastModel` seam

**Files:**
- Modify: `electron/LLMHelper.ts` (new private method; place it directly above `generateQueryRewrite` at :4754)
- Test: `electron/llm/__tests__/CallFastModel2026_09_23.test.mjs`

**Interfaces:**
- Consumes: `CredentialsManager.getFastModel()` from Task 1.
- Produces: `private async callFastModel(message: string, opts: { signal?: AbortSignal; timeoutMs?: number; json?: boolean }): Promise<string | null>` on `LLMHelper`. Returns `null` for every unavailable/failure case; throws only on abort.

- [ ] **Step 1: Write the failing test**

```js
// electron/llm/__tests__/CallFastModel2026_09_23.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js'));

function helper(over = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    _client: null, _openaiClient: null, _claudeClient: null, _groqClient: null, _deepseekClient: null,
    isLocalOnlyMode: false,
    getDisabledProviderFamilies: () => [],
    assertOutboundScopes: () => {},
    rateLimiters: { openai: { acquire: async () => {} }, gemini: { acquire: async () => {} } },
    fastModelId: null,
    ...over,
  });
  return h;
}
const call = (h, opts = {}) => h.callFastModel('judge this', opts);

test('returns null when no fast model is configured', async () => {
  assert.equal(await call(helper({ fastModelId: null })), null);
});

test('returns null for an unrecognised or retired model id — never throws', async () => {
  const h = helper({ fastModelId: 'some-model-that-was-retired' });
  assert.equal(await call(h), null);
});

test('returns null when the picked family is disabled', async () => {
  const h = helper({
    fastModelId: 'gpt-5.5',
    _openaiClient: { chat: { completions: { create: async () => { throw new Error('must not be called'); } } } },
    getDisabledProviderFamilies: () => ['openai'],
  });
  assert.equal(await call(h), null);
});

test('returns null in local-only mode and makes no outbound request', async () => {
  let called = false;
  const h = helper({
    fastModelId: 'gpt-5.5', isLocalOnlyMode: true,
    _openaiClient: { chat: { completions: { create: async () => { called = true; return {}; } } } },
  });
  assert.equal(await call(h), null);
  assert.equal(called, false);
});

test('an empty response is a failure, not an empty verdict', async () => {
  const h = helper({
    fastModelId: 'gpt-5.5',
    _openaiClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: '   ' } }] }) } } },
  });
  assert.equal(await call(h), null);
});

test('a provider failure returns null so the caller falls through', async () => {
  const h = helper({
    fastModelId: 'gpt-5.5',
    _openaiClient: { chat: { completions: { create: async () => { throw new Error('503'); } } } },
  });
  assert.equal(await call(h), null);
});

test('abort propagates instead of falling through', async () => {
  const controller = new AbortController();
  const h = helper({
    fastModelId: 'gpt-5.5',
    _openaiClient: { chat: { completions: { create: () => new Promise((_r, rej) => {
      controller.signal.addEventListener('abort', () => rej(controller.signal.reason), { once: true });
    }) } } },
  });
  const p = call(h, { signal: controller.signal });
  controller.abort(new Error('superseded'));
  await assert.rejects(p, /superseded/);
});

test('a good response comes back, scopes asserted and limiter acquired first', async () => {
  const order = [];
  const h = helper({
    fastModelId: 'gpt-5.5',
    assertOutboundScopes: () => order.push('scopes'),
    rateLimiters: { openai: { acquire: async () => { order.push('limiter'); } } },
    _openaiClient: { chat: { completions: { create: async () => {
      order.push('request');
      return { choices: [{ message: { content: '{"is_ask":true}' } }] };
    } } } },
  });
  assert.equal(await call(h), '{"is_ask":true}');
  assert.deepEqual(order, ['scopes', 'limiter', 'request']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=nat-fm --default-tmpdir CODEX_HOME=nat-fm-codex --set ELECTRON_RUN_AS_NODE=1 -- electron --test "electron/llm/__tests__/CallFastModel2026_09_23.test.mjs"`
Expected: FAIL — `h.callFastModel is not a function`.

- [ ] **Step 3: Add the resolver and the seam**

In `electron/LLMHelper.ts`, directly above `generateQueryRewrite` (:4754):

```ts
  /**
   * The user's chosen fast model, or null. Read per call rather than cached so a
   * Settings change takes effect without restarting the helper.
   */
  private get fastModelId(): string | null {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getFastModel();
    } catch { return null; }
  }

  /**
   * One non-streaming call on the user's chosen FAST model.
   *
   * Returns null for every "not available" case — unset, no client, family
   * disabled, local-only, unrecognised id, provider failure, empty body — so the
   * caller falls through to its own ladder unchanged. ONLY an abort throws, so a
   * caller can tell a missing setting from a user cancellation; the judge needs
   * that distinction because its deadline and supersede must propagate.
   */
  private async callFastModel(
    message: string,
    opts: { signal?: AbortSignal; timeoutMs?: number; json?: boolean } = {},
  ): Promise<string | null> {
    const modelId = this.fastModelId;
    if (!modelId) return null;
    if (this.isLocalOnlyMode) return null;

    const timer = opts.timeoutMs
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)].filter(Boolean) as AbortSignal[])
      : opts.signal;

    const finish = (raw: string | null | undefined): string | null => {
      const text = stripLeadingReasoningBlock(raw || '').trim();
      return text ? text : null;
    };

    try {
      if (this.isOpenAiModel(modelId) && this.openaiClient) {
        this.assertOutboundScopes('openai', message);
        await this.rateLimiters.openai?.acquire();
        const res = await this.openaiClient.chat.completions.create({
          model: modelId,
          messages: [{ role: 'user', content: message }],
          max_completion_tokens: 512,
          ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
          ...openaiReasoningParam(modelId),
        }, { signal: timer });
        return finish(res.choices?.[0]?.message?.content);
      }
      if (this.isGroqModel(modelId) && this.groqClient && !this._groqLocalDisabled) {
        this.assertOutboundScopes('groq', message);
        await this.rateLimiters.groq?.acquire();
        const res = await this.createGroqCompletion(
          { model: modelId, messages: [{ role: 'user', content: message }], temperature: 0, max_tokens: 256, stream: false },
          { signal: timer },
        );
        return finish(res.choices?.[0]?.message?.content);
      }
      if (this.isGeminiModel(modelId) && this.client) {
        this.assertOutboundScopes('gemini', message);
        await this.rateLimiters.gemini?.acquire();
        // @ts-ignore — abortSignal is accepted by the SDK's request config
        const res = await this.client.models.generateContent({
          model: modelId,
          contents: [{ role: 'user', parts: [{ text: message }] }],
          config: {
            maxOutputTokens: 256, temperature: 0, abortSignal: timer,
            ...(opts.json ? { responseMimeType: 'application/json' } : {}),
          },
        });
        const parts = res.candidates?.[0]?.content?.parts ?? [];
        return finish(res.text ?? (Array.isArray(parts) ? parts : [parts]).map((p: any) => p?.text ?? '').join(''));
      }
      if (this.isDeepseekModel(modelId) && this.deepseekClient) {
        this.assertOutboundScopes('deepseek', message);
        await this.rateLimiters.deepseek?.acquire();
        const res = await this.deepseekClient.chat.completions.create({
          model: modelId,
          messages: [{ role: 'user', content: message }],
          temperature: 0, max_tokens: 256,
          ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
          ...DEEPSEEK_NO_THINKING,
        }, { signal: timer });
        return finish(res.choices?.[0]?.message?.content);
      }
      if (this.isClaudeModel(modelId) && this.claudeClient) {
        this.assertOutboundScopes('claude', message);
        await this.rateLimiters.claude?.acquire();
        const res: any = await this.claudeClient.messages.create({
          model: modelId, max_tokens: 256, temperature: 0,
          messages: [{ role: 'user', content: message }],
        }, { signal: timer });
        return finish((res?.content ?? []).map((c: any) => (c?.type === 'text' ? c.text : '')).join(''));
      }
      // Unrecognised id (a retired model, or a provider with no fast path):
      // fall through rather than guessing a client.
      return null;
    } catch (error) {
      if (opts.signal?.aborted) throw error;
      return null;
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run the Step 2 command. Expected: 8 passing.

- [ ] **Step 5: Typecheck and commit**

```bash
node scripts/build-electron.js && node node_modules/typescript7/lib/tsc.js -p electron/tsconfig.json --noEmit
git add electron/LLMHelper.ts electron/llm/__tests__/CallFastModel2026_09_23.test.mjs
git commit -m "feat(llm): callFastModel seam for the user-chosen fast model

One non-streaming call routed by the existing per-provider classifiers.
Returns null for every unavailable case so callers fall through to their
own ladder; only abort throws, because the judge's deadline and supersede
must propagate rather than look like a missing setting."
```

---

### Task 3: Judge rung 0

**Files:**
- Modify: `electron/LLMHelper.ts` — `generateJudgeVerdict` at :4799
- Test: `electron/intelligence/autoAnswer/__tests__/FastModelJudgeRung2026_09_23.test.mjs`

**Interfaces:**
- Consumes: `callFastModel` from Task 2.
- Produces: no new exports. `generateJudgeVerdict`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

```js
// electron/intelligence/autoAnswer/__tests__/FastModelJudgeRung2026_09_23.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(__dirname, '../../../../dist-electron/electron/LLMHelper.js'));

function judgeHelper(over = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    _client: null, _openaiClient: null, _claudeClient: null, _groqClient: null, _deepseekClient: null,
    isLocalOnlyMode: false,
    getDisabledProviderFamilies: () => [],
    assertOutboundScopes: () => {},
    rateLimiters: {},
    ...over,
  });
  return h;
}

test('the fast model answers the judge before any ladder rung runs', async () => {
  let ladderRan = false;
  const h = judgeHelper();
  h.callFastModel = async () => '{"is_ask":true}';
  h.generateContentStructured = async () => { ladderRan = true; return '{}'; };
  assert.equal(await h.generateJudgeVerdict('prompt'), '{"is_ask":true}');
  assert.equal(ladderRan, false, 'rung 0 answered, so no ladder rung should run');
});

test('when the fast rung returns null the existing ladder still answers', async () => {
  const h = judgeHelper();
  h.callFastModel = async () => null;
  h.generateContentStructured = async () => '{"is_ask":false}';
  assert.equal(await h.generateJudgeVerdict('prompt'), '{"is_ask":false}');
});

test('an abort in the fast rung propagates — it must NOT fall through to the ladder', async () => {
  let ladderRan = false;
  const controller = new AbortController();
  const h = judgeHelper();
  h.callFastModel = async () => { throw Object.assign(new Error('superseded'), { name: 'AbortError' }); };
  h.generateContentStructured = async () => { ladderRan = true; return '{}'; };
  controller.abort();
  await assert.rejects(h.generateJudgeVerdict('prompt', { signal: controller.signal }), /superseded/);
  assert.equal(ladderRan, false, 'a cancelled judge must not spend a ladder call');
});

test('with no fast model set the judge behaves exactly as before', async () => {
  const h = judgeHelper();
  h.callFastModel = async () => null;          // unset resolves to null
  h.generateContentStructured = async () => '{"ladder":true}';
  assert.equal(await h.generateJudgeVerdict('prompt'), '{"ladder":true}');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=nat-fm --default-tmpdir CODEX_HOME=nat-fm-codex --set ELECTRON_RUN_AS_NODE=1 -- electron --test "electron/intelligence/autoAnswer/__tests__/FastModelJudgeRung2026_09_23.test.mjs"`
Expected: FAIL — the first test gets the ladder's value because rung 0 does not exist yet.

- [ ] **Step 3: Add rung 0**

In `generateJudgeVerdict` (:4799), immediately after `const userOnly = [...]` and **before** the `if (this.client)` Gemini block:

```ts
    // Rung 0: the user's chosen fast model, when they have set one. Everything
    // below is the measured per-provider ladder and remains the fallback, so an
    // unset or failing pick degrades to exactly the previous behaviour.
    const picked = await this.callFastModel(message, { signal, json: true });
    if (picked) return picked;
```

- [ ] **Step 4: Run the test to verify it passes**

Run the Step 2 command. Expected: 4 passing.

- [ ] **Step 5: Run the whole Auto Answer suite for regressions**

```bash
npm run test:auto-answer
```
Expected: all passing, no change in count beyond the new file.

- [ ] **Step 6: Commit**

```bash
git add electron/LLMHelper.ts electron/intelligence/autoAnswer/__tests__/FastModelJudgeRung2026_09_23.test.mjs
git commit -m "feat(auto-answer): the chosen fast model answers the judge first

Rung 0 ahead of the measured per-provider ladder, which stays as the
fallback. An unset or failing pick degrades to the previous behaviour;
an abort propagates so a superseded judge does not spend a ladder call."
```

---

### Task 4: Query rewrite and the `preferFast` path

**Files:**
- Modify: `electron/LLMHelper.ts` — `generateQueryRewrite` at :4754, `generateContentStructured` at :4903 (the vestigial `preferFast` comment sits at :4935)
- Test: `electron/llm/__tests__/FastModelPreferFast2026_09_23.test.mjs`

**Interfaces:**
- Consumes: `callFastModel` from Task 2.
- Produces: no signature changes. `generateContentStructured`'s `opts.preferFast` becomes load-bearing again.

- [ ] **Step 1: Write the failing test**

```js
// electron/llm/__tests__/FastModelPreferFast2026_09_23.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(root, 'dist-electron/electron/LLMHelper.js'));

const helper = () => {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, { isLocalOnlyMode: false, getDisabledProviderFamilies: () => [], assertOutboundScopes: () => {}, rateLimiters: {} });
  return h;
};

test('preferFast:true consults the fast model before building the ladder', async () => {
  const h = helper();
  h.callFastModel = async () => '{"fast":true}';
  assert.equal(await h.generateContentStructured('x', { preferFast: true }), '{"fast":true}');
});

test('preferFast is NOT consulted without the flag — the ladder owns normal calls', async () => {
  let fastCalled = false;
  const h = helper();
  h.callFastModel = async () => { fastCalled = true; return '{"fast":true}'; };
  try { await h.generateContentStructured('x'); } catch { /* no providers configured */ }
  assert.equal(fastCalled, false);
});

test('preferFast is load-bearing in source, so it cannot go vestigial again', () => {
  const src = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');
  const i = src.indexOf('public async generateContentStructured');
  const body = src.slice(i, i + 3000);
  assert.match(body, /opts\?\.preferFast[\s\S]{0,200}callFastModel/,
    'preferFast must reach callFastModel — it was previously a no-op behind `void opts`');
  assert.doesNotMatch(body, /void opts;/, 'the vestigial marker must be gone');
});

test('generateQueryRewrite uses the seam and falls back to its own chain', async () => {
  const h = helper();
  h.callFastModel = async () => 'rewritten';
  assert.equal(await h.generateQueryRewrite('q'), 'rewritten');

  const h2 = helper();
  h2.callFastModel = async () => null;
  h2._client = null; h2._groqClient = null; h2.nativelyKey = null;
  assert.equal(await h2.generateQueryRewrite('q'), '', 'no fast model and no chain → empty, never a throw');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=nat-fm --default-tmpdir CODEX_HOME=nat-fm-codex --set ELECTRON_RUN_AS_NODE=1 -- electron --test "electron/llm/__tests__/FastModelPreferFast2026_09_23.test.mjs"`
Expected: FAIL — `preferFast` is still a no-op.

- [ ] **Step 3: Make `preferFast` load-bearing**

In `generateContentStructured` (:4903), replace the vestigial marker at :4935:

```ts
    // `opts.preferFast` retained for API compatibility; ordering no longer
```
…and its `void opts;` line, with:

```ts
    // `opts.preferFast` is the opt-in fast path: the user's chosen fast model is
    // tried BEFORE the ladder is built. It was previously a no-op behind `void
    // opts` — the ladder below is unchanged and remains the fallback.
    if (opts?.preferFast) {
      const picked = await this.callFastModel(message, { json: true });
      if (picked) return picked;
    }
```

- [ ] **Step 4: Refactor `generateQueryRewrite` onto the seam**

In `generateQueryRewrite` (:4754), immediately after the `try {` and the `isLocalOnlyMode` guard, before the `if (this.client)` block:

```ts
      // The user's chosen fast model first; the Gemini → Groq → Natively chain
      // below is the fallback. This method already had exactly this shape, so
      // the seam replaces a hand-rolled copy rather than adding a layer.
      const picked = await this.callFastModel(message, { timeoutMs, signal: controller.signal, json: true });
      if (picked) return picked;
```

- [ ] **Step 5: Run the test to verify it passes**

Run the Step 2 command. Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
node scripts/build-electron.js && node node_modules/typescript7/lib/tsc.js -p electron/tsconfig.json --noEmit
git add electron/LLMHelper.ts electron/llm/__tests__/FastModelPreferFast2026_09_23.test.mjs
git commit -m "feat(llm): route the query rewrite and preferFast calls through the fast model

preferFast was vestigial behind \`void opts\`; it now means what its name
says. generateQueryRewrite hand-rolled this exact shape, so moving it onto
the seam deletes a duplicate rather than adding a layer. Browser-metadata
classification is covered by the same change via its preferFast call."
```

---

### Task 5: The Settings picker

**Files:**
- Modify: `src/components/settings/AIProvidersSettings.tsx` (state near :2565, Active Model change handler near :3003)
- Test: `src/lib/__tests__/fastModelHint.test.mjs`
- Create: `src/lib/fastModelHint.mjs` + `src/lib/fastModelHint.d.mts`

**Interfaces:**
- Consumes: preload `getFastModel()` / `setFastModel()` from Task 1.
- Produces: `isKnownFastModel(modelId: string): boolean` from `src/lib/fastModelHint.mjs`.

> Repo convention: a `.mjs` helper imported from TS needs a hand-written `.d.mts` sibling (see `src/lib/micPermissionPolicy.d.mts`). Pure logic lives in the helper so it is testable without a renderer.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/fastModelHint.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKnownFastModel } from '../fastModelHint.mjs';

test('known small tiers do not warn', () => {
  for (const id of ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gpt-5.5',
                    'gpt-5.4-mini', 'gpt-5.4-nano', 'deepseek-v4-flash',
                    'llama-3.3-70b-versatile', 'openrouter/google/gemini-3.8-flash']) {
    assert.equal(isKnownFastModel(id), true, id);
  }
});

test('large models warn', () => {
  for (const id of ['gpt-5.6-luna', 'claude-sonnet-4-6', 'gemini-3.8-pro', 'gpt-5.4']) {
    assert.equal(isKnownFastModel(id), false, id);
  }
});

test('unset and junk never warn — the hint is for a real slow pick only', () => {
  for (const id of ['', null, undefined, 'auto']) {
    assert.equal(isKnownFastModel(id), true, String(id));
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test "src/lib/__tests__/fastModelHint.test.mjs"`
Expected: FAIL — cannot find `../fastModelHint.mjs`.

- [ ] **Step 3: Write the helper**

```js
// src/lib/fastModelHint.mjs
/**
 * Is this model id one the app believes is a small, fast tier?
 *
 * ADVISORY ONLY — it drives an inline hint and never blocks a choice, so a stale
 * entry costs a missing or spurious hint and nothing more. That is exactly why
 * this is a hint and not a filter: a hand-maintained allow-list used as a filter
 * would hide good new models every time a provider ships one.
 */
const FAST_PATTERNS = [
  /(^|\/)gemini-[\d.]+-flash(-lite)?$/,
  /(^|\/)gpt-5\.\d+-(mini|nano)$/,
  /(^|\/)gpt-5\.5$/,
  /(^|\/)deepseek-[\w.]+-flash$/,
  /(^|\/)(llama|mixtral|gemma|qwen)[\w./-]*$/,
];

export function isKnownFastModel(modelId) {
  if (!modelId || modelId === 'auto') return true;   // unset never warns
  const id = String(modelId).toLowerCase();
  return FAST_PATTERNS.some((re) => re.test(id));
}
```

```ts
// src/lib/fastModelHint.d.mts
export declare function isKnownFastModel(modelId: string | null | undefined): boolean;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/lib/__tests__/fastModelHint.test.mjs"`
Expected: 3 passing.

- [ ] **Step 5: Add the picker**

In `src/components/settings/AIProvidersSettings.tsx`, beside the `defaultModel` state (:2565):

```tsx
    const [fastModel, setFastModel] = useState<string>('auto');
```

Load it on mount alongside the existing `getDefaultModel()` read (`window.electronAPI.getFastModel()`
returns `{ model: string | null }`; map `null` to `'auto'`), then render the picker directly beneath the Active Model select, reusing `buildAvailableModelOptions()` — the same `{ id, label }[]` builder the Active Model
select uses (see :2993) — plus an `auto` entry:

```tsx
    <label className="aip-label">{t('Fast Model')}</label>
    <select
        className="aip-select"
        value={fastModel}
        onChange={(e) => {
            const next = e.target.value;
            setFastModel(next);
            window.electronAPI?.setFastModel?.(next === 'auto' ? null : next).catch(console.error);
        }}
    >
        <option value="auto">{t('Auto (recommended)')}</option>
        {buildAvailableModelOptions().map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
        ))}
    </select>
    <p className="text-xs aip-dim-fg mt-0.5">
        {t('Used for Auto Answer and other quick internal decisions — not for your answers.')}
    </p>
    {!isKnownFastModel(fastModel) && (
        <p className="text-xs aip-warn-fg mt-0.5 font-medium">
            {t('Large models make Auto Answer slower. Pick a small tier for the best results.')}
        </p>
    )}
```

Import at the top of the file:

```ts
import { isKnownFastModel } from '../../lib/fastModelHint.mjs';
```

- [ ] **Step 6: Typecheck the renderer and commit**

```bash
npx tsc -p tsconfig.json --noEmit
git add src/components/settings/AIProvidersSettings.tsx src/lib/fastModelHint.mjs src/lib/fastModelHint.d.mts src/lib/__tests__/fastModelHint.test.mjs
git commit -m "feat(settings): Fast Model picker with an advisory slow-pick hint

Lists the same models as Active Model plus an Auto default. The hint is
advisory and never blocks a choice — a filter would need a hand-maintained
list that goes stale and would hide good new models."
```

---

### Task 6: Telemetry and full verification

**Files:**
- Modify: `electron/intelligence/autoAnswer/AutoAnswerTypes.ts` (the `judgeRoute` union)
- Modify: `electron/LLMHelper.ts` (`getAutoAnswerJudgePolicy` route reporting)
- Test: extend `electron/intelligence/autoAnswer/__tests__/FastModelJudgeRung2026_09_23.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `'fast_model'` as a valid `judgeRoute` telemetry value.

- [ ] **Step 1: Add the telemetry route value**

In `electron/intelligence/autoAnswer/AutoAnswerTypes.ts`, widen the `judgeRoute` union:

```ts
    judgeRoute?: 'fast_model' | 'gemini_fast' | 'default_provider' | 'server_cascade' | 'user_endpoint' | 'local';
```

- [ ] **Step 2: Add the assertion to the judge test**

Append to `FastModelJudgeRung2026_09_23.test.mjs`:

```js
test('fast_model is a legal judge telemetry route', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../AutoAnswerTypes.ts'), 'utf8');
  assert.match(src, /judgeRoute\?:[^;]*'fast_model'/,
    'without this the feature ships unmeasurable and a bad pick is invisible in telemetry');
});
```

Add at the top of that file:

```js
import fs from 'node:fs';
```

- [ ] **Step 3: Run the full affected suites**

```bash
node scripts/build-electron.js
node node_modules/typescript7/lib/tsc.js -p electron/tsconfig.json --noEmit
npx tsc -p tsconfig.json --noEmit
node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=nat-fm \
  --default-tmpdir CODEX_HOME=nat-fm-codex --set ELECTRON_RUN_AS_NODE=1 \
  -- electron --test "electron/intelligence/autoAnswer/__tests__/**/*.test.mjs" \
                     "electron/llm/__tests__/**/*.test.mjs" \
                     "electron/services/__tests__/**/*.test.mjs"
```

- [ ] **Step 4: Compare failures against the base commit**

Build the same suites at `HEAD~6` in a separate worktree and diff the failing-test names. **Any test failing here that passes there is a regression and must be fixed before the final commit.** The repo has pre-existing environmental failures (absent bundled model weights, the premium template gallery); those appear in both lists and are not yours.

- [ ] **Step 5: Commit**

```bash
git add electron/intelligence/autoAnswer/AutoAnswerTypes.ts electron/intelligence/autoAnswer/__tests__/FastModelJudgeRung2026_09_23.test.mjs
git commit -m "feat(auto-answer): record fast_model as a judge telemetry route

Without it the picker ships unmeasurable — a slow pick would degrade Auto
Answer with nothing in the data pointing at the cause."
```

---

## Completion report (CLAUDE.md)

State when finished:
- **Files changed / behaviour changed / shared modules affected** — `LLMHelper`, `CredentialsManager`, `ipcHandlers`, `preload`, `AutoAnswerTypes`, `AIProvidersSettings`.
- **Expected macOS behaviour** = **expected Windows behaviour**: identical. No `process.platform` branch is introduced; this is provider-routing logic plus a renderer picker.
- **Validation categories:** `Covered by automated tests`, `Reviewed but not executed on Windows`, `Requires physical macOS verification` (a real meeting with a fast model selected, confirming the judge uses it and Auto Answer still answers when it fails).
- **Remaining risk:** no live-provider test covers every dispatch branch — only OpenAI-shaped and Gemini-shaped clients are exercised with stubs.
