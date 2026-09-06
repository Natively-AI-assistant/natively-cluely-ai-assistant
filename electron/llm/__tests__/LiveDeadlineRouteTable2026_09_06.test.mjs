// electron/llm/__tests__/LiveDeadlineRouteTable2026_09_06.test.mjs
//
// The live first-token ceiling used to be one number, 13000, for everyone.
//
// That number is not general. Its derivation is written into
// LIVE_TOTAL_HARD_TIMEOUT_MS's own comment: "the natively-api server's 10s
// cutover + 3s for the next leg to produce a first token". It describes a
// mechanism — a SEQUENTIAL server-side provider cascade — that only exists on
// one route. Every other route was inheriting it by sharing its `return`.
//
// That silent inheritance has now caused two separate defects. It truncated the
// vision layer's deliberate 20s budget (fixed 2026-09-05, e079cd4a: 21% of one
// user's screenshot turns died at the ceiling with a real answer 1.4s away). And
// it made a direct Gemini call wait 13s to conclude something was not coming
// back, when nothing sits behind a direct call to rescue it and the fallback was
// available at 8.
//
// So the ceiling is now a ROUTE TABLE, and this file pins it. The ordering
// constraints are the part that actually breaks in review:
//
//  • vision must stay ABOVE user-endpoint, or a screenshot turn on a Custom
//    provider silently loses the budget e079cd4a was measured to need;
//  • the natively route must stay ABOVE the server's 10s cutover, which is the
//    F-301 invariant DeadlineBudgetOrdering2026_08_10 owns — asserted here too,
//    against the constant rather than the server file, so the ordering is still
//    checked in CI where natively-api is not checked out;
//  • the two selectors must agree about the same turn, because they are read by
//    two different surfaces (WTA reads the ceiling, manual chat reads the
//    first-useful cap) and a disagreement is invisible from either one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
// CJS named-import interop on this bundle is unreliable under the ESM loader;
// createRequire is what the sibling suites in this directory use.
const cjs = createRequire(path.join(root, 'package.json'));
const dl = cjs(path.join(root, 'dist-electron/electron/llm/index.js'));

// LLMHelper transitively constructs ModelVersionManager, which reads
// app.getPath('userData') at construction. There is no `app` under
// ELECTRON_RUN_AS_NODE, so stub the module in the CJS cache before requiring it.
// The require MUST be created from the repo's own package.json — one created
// from this file's path resolves 'electron' elsewhere and the stub silently
// never takes effect.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'route-table-test-'));
const electronStub = new Module('electron');
electronStub.exports = {
  app: {
    isReady: () => true,
    getPath: (n) => (n === 'userData' ? tmpUserData : os.tmpdir()),
    getAppPath: () => root,
    getName: () => 'natively-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: () => {},
  },
  shell: { openPath: async () => '' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: { getSources: async () => [] },
  net: { isOnline: () => true },
};
electronStub.loaded = true;
cjs.cache[cjs.resolve('electron')] = electronStub;

const { LLMHelper } = cjs(path.join(root, 'dist-electron/electron/LLMHelper.js'));

const {
  totalHardTimeoutMs,
  firstUsefulDeadlineMs,
  LIVE_TOTAL_HARD_TIMEOUT_MS,
  LIVE_VISION_TOTAL_HARD_TIMEOUT_MS,
  LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS,
  LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS,
  LIVE_DEFAULT_PROVIDER_TOTAL_HARD_TIMEOUT_MS,
  LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS,
} = dl;

describe('the route table assigns each route the number its own path justifies', () => {
  test('a shipped provider called directly gets 8s', () => {
    // Gemini / Groq / Claude / OpenAI / DeepSeek. Nothing behind them can
    // rotate to a healthy provider, so the client giving up IS the recovery.
    assert.equal(LIVE_DEFAULT_PROVIDER_TOTAL_HARD_TIMEOUT_MS, 8000);
    assert.equal(totalHardTimeoutMs({}), 8000);
    assert.equal(totalHardTimeoutMs({ isUserEndpoint: false, viaServerCascade: false }), 8000);
  });

  test('a user-supplied endpoint gets 15s', () => {
    assert.equal(LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS, 15000);
    assert.equal(totalHardTimeoutMs({ isUserEndpoint: true }), 15000);
  });

  test('the natively route keeps 13s, unchanged', () => {
    // Deliberately NOT lowered. 8000 is the exact value
    // DeadlineBudgetOrdering2026_08_10's header documents as the broken,
    // inverted configuration: the client abandoning the turn 2s before the
    // server rotates. Changing this constant is how F-301 comes back.
    assert.equal(LIVE_TOTAL_HARD_TIMEOUT_MS, 13000);
    assert.equal(totalHardTimeoutMs({ viaServerCascade: true }), 13000);
  });

  test('local still gets the cold-load budget, whatever else is true', () => {
    assert.equal(totalHardTimeoutMs({ isLocal: true }), LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(
      totalHardTimeoutMs({ isLocal: true, isUserEndpoint: true, isVisionTurn: true }),
      LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS,
      'a local rung must not be re-classified by any other flag',
    );
  });
});

describe('ordering constraints that a future edit would otherwise break silently', () => {
  test('a vision turn on a user endpoint keeps 20s, NOT 15s', () => {
    // The regression this exists to catch: merging vision into the
    // user-endpoint case. e079cd4a sized 20000 off a measured 11.6s tail on
    // real image turns; 15000 would still clear that tail but spends the margin
    // that fix was written to buy.
    assert.equal(
      totalHardTimeoutMs({ isVisionTurn: true, isUserEndpoint: true }),
      LIVE_VISION_TOTAL_HARD_TIMEOUT_MS,
    );
    assert.ok(
      LIVE_VISION_TOTAL_HARD_TIMEOUT_MS > LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS,
      'vision must outrank the user-endpoint ceiling',
    );
  });

  test('a vision turn on the natively route still uses the natively ceiling', () => {
    assert.equal(
      totalHardTimeoutMs({ isVisionTurn: true, viaServerCascade: true }),
      LIVE_TOTAL_HARD_TIMEOUT_MS,
    );
  });

  test('the natively ceiling still clears the server cutover by >= 2s', () => {
    // The same invariant DeadlineBudgetOrdering2026_08_10 checks against
    // natively-api/server.js. Repeated here against the literal because that
    // suite SKIPS when the gitlink is not checked out — which is every CI run.
    const SERVER_CUTOVER_MS = 10_000;
    assert.ok(
      LIVE_TOTAL_HARD_TIMEOUT_MS - SERVER_CUTOVER_MS >= 2000,
      `margin is ${LIVE_TOTAL_HARD_TIMEOUT_MS - SERVER_CUTOVER_MS}ms; the server's next leg needs >= 2000ms`,
    );
  });

  test('the shortest route is still long enough for a healthy first token', () => {
    // A floor, not a ceiling. Every route must clear ~1s of healthy TTFT with
    // room to spare, or the deadline stops being a safety net and starts being
    // the thing that fails the turn.
    for (const [name, ms] of [
      ['default', totalHardTimeoutMs({})],
      ['user endpoint', totalHardTimeoutMs({ isUserEndpoint: true })],
      ['natively', totalHardTimeoutMs({ viaServerCascade: true })],
      ['vision', totalHardTimeoutMs({ isVisionTurn: true })],
    ]) {
      assert.ok(ms >= 5000, `${name} route is only ${ms}ms`);
    }
  });
});

describe('WTA and manual chat cannot disagree about the same turn', () => {
  // totalHardTimeoutMs is read by IntelligenceEngine (WTA); firstUsefulDeadlineMs
  // is read by ipcHandlers (manual chat and the phone-mirror path). They are two
  // functions answering one question, and each past divergence between them
  // showed up as a bug on exactly one surface.
  test('the default route agrees across both selectors', () => {
    assert.equal(
      firstUsefulDeadlineMs('identity_answer', false, false, false),
      totalHardTimeoutMs({}),
    );
    assert.equal(LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS, LIVE_DEFAULT_PROVIDER_TOTAL_HARD_TIMEOUT_MS);
  });

  test('the user-endpoint route agrees across both selectors', () => {
    assert.equal(
      firstUsefulDeadlineMs('identity_answer', false, false, true),
      totalHardTimeoutMs({ isUserEndpoint: true }),
    );
  });

  test('the natively route agrees across both selectors', () => {
    assert.equal(
      firstUsefulDeadlineMs('identity_answer', false, true, false),
      totalHardTimeoutMs({ viaServerCascade: true }),
    );
  });

  test('a complex answer type does not escape the user-endpoint budget', () => {
    // COMPLEX_TYPES is consulted only on the default route. A coding question on
    // a LiteLLM gateway must still be bounded by that gateway's ceiling.
    assert.equal(
      firstUsefulDeadlineMs('coding_question_answer', false, false, true),
      LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS,
    );
  });

  test('omitting the new argument preserves the previous default-route behaviour', () => {
    // Back-compat for the call sites not updated here (regen/repair streams).
    assert.equal(
      firstUsefulDeadlineMs('identity_answer'),
      LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS,
    );
  });
});

describe('the predicate that selects the user-endpoint route', () => {
  // isUsingUserEndpoint() must key on the ENDPOINT, not on whose key pays. A
  // user's own Gemini key still hits Google's well-known API and belongs with
  // the defaults; a LiteLLM proxy fronting that same model does not.
  function helperWithModel(modelId) {
    const h = new LLMHelper(undefined, false);
    h.setModel(modelId, []);
    return h;
  }

  test('LiteLLM and NVIDIA NIM are user endpoints', () => {
    assert.equal(helperWithModel('litellm/gpt-4o').isUsingUserEndpoint(), true);
    assert.equal(helperWithModel('nvidia_nim/meta/llama-3.3-70b').isUsingUserEndpoint(), true);
  });

  test('an active Custom Provider is a user endpoint', () => {
    const h = new LLMHelper(undefined, false);
    h.setModel('my-openrouter', [{
      id: 'my-openrouter',
      name: 'OpenRouter',
      model: 'google/gemini-2.5-flash',
      apiKey: 'sk-test',
      baseUrl: 'https://openrouter.ai/api/v1',
    }]);
    assert.equal(h.isUsingUserEndpoint(), true);
  });

  test('a shipped provider is NOT a user endpoint, even on the user’s own key', () => {
    assert.equal(helperWithModel('natively').isUsingUserEndpoint(), false);
    for (const id of ['gemini', 'gemini-pro', 'claude', 'llama', 'deepseek']) {
      assert.equal(helperWithModel(id).isUsingUserEndpoint(), false, `${id} should use the default route`);
    }
  });

  test('selecting Ollama AFTER a custom provider clears the user-endpoint route', () => {
    // The only way the new predicate could steal a turn from an existing route:
    // isUsingUserEndpoint() reads `customProvider`, and if a stale value survived
    // a switch to Ollama, a cold local model would be raced against 15s instead
    // of 30s and aborted to the canned line. setModel's ollama branch nulls the
    // field; this asserts the behaviour rather than the branch.
    const h = new LLMHelper(undefined, false);
    h.setModel('my-openrouter', [{
      id: 'my-openrouter', name: 'OpenRouter', model: 'google/gemini-2.5-flash',
      apiKey: 'sk-test', baseUrl: 'https://openrouter.ai/api/v1',
    }]);
    assert.equal(h.isUsingUserEndpoint(), true, 'precondition: the custom provider is active');

    h.setModel('ollama-qwen3.5:9b', []);
    assert.equal(h.isUsingOllama(), true);
    assert.equal(h.isUsingUserEndpoint(), false,
      'a stale customProvider would re-route a cold local model onto the 15s ceiling');
    assert.equal(
      totalHardTimeoutMs({ isLocal: h.isUsingOllama(), isUserEndpoint: h.isUsingUserEndpoint() }),
      LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS,
    );
  });

  test('natively is the cascade route and not the user-endpoint route', () => {
    const h = helperWithModel('natively');
    assert.equal(h.isUsingNativelyServerCascade(), true);
    assert.equal(h.isUsingUserEndpoint(), false);
  });
});
