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
  userEndpointBudgetMs,
  LIVE_USER_ENDPOINT_MIN_TOTAL_HARD_TIMEOUT_MS,
  LIVE_USER_ENDPOINT_MAX_TOTAL_HARD_TIMEOUT_MS,
  USER_ENDPOINT_MIN_SAMPLES_TO_NARROW,
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


describe('the user-endpoint budget stops guessing once the endpoint has answered', () => {
  // 15000 is honest for an address we have never called. It stops being the
  // best answer the moment that address answers once.
  test('unmeasured stays at the 15s guess', () => {
    assert.equal(userEndpointBudgetMs(null), LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(userEndpointBudgetMs(undefined), LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(userEndpointBudgetMs({ maxMs: 900, count: 0 }), LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(userEndpointBudgetMs({ maxMs: NaN, count: 3 }), LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS);
  });

  test('WIDENS from a single sample — the direction that costs a healthy turn nothing', () => {
    // The vision-log tail. One turn at 11.6s is enough to prove 15000 is too
    // tight for this endpoint, and waiting for more evidence just means more
    // turns die in the meantime.
    assert.equal(userEndpointBudgetMs({ maxMs: 11_600, count: 1 }), 16_600);
  });

  test('NARROWS only after enough evidence, and never below the default route', () => {
    const fast = { maxMs: 600, count: 1 };
    assert.equal(userEndpointBudgetMs(fast), LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS,
      'one fast turn must not shorten the leash');
    assert.equal(
      userEndpointBudgetMs({ maxMs: 600, count: USER_ENDPOINT_MIN_SAMPLES_TO_NARROW - 1 }),
      LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS,
    );
    assert.equal(
      userEndpointBudgetMs({ maxMs: 600, count: USER_ENDPOINT_MIN_SAMPLES_TO_NARROW }),
      LIVE_USER_ENDPOINT_MIN_TOTAL_HARD_TIMEOUT_MS,
      'a proven-fast gateway settles at the default-provider ceiling, not below it',
    );
  });

  test('the adaptive budget stays inside [default ceiling, vision ceiling]', () => {
    assert.equal(LIVE_USER_ENDPOINT_MIN_TOTAL_HARD_TIMEOUT_MS, LIVE_DEFAULT_PROVIDER_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(LIVE_USER_ENDPOINT_MAX_TOTAL_HARD_TIMEOUT_MS, LIVE_VISION_TOTAL_HARD_TIMEOUT_MS);
    // A pathologically slow endpoint cannot buy itself an unbounded wait.
    assert.equal(userEndpointBudgetMs({ maxMs: 60_000, count: 20 }), LIVE_USER_ENDPOINT_MAX_TOTAL_HARD_TIMEOUT_MS);
    for (const maxMs of [0, 300, 5_000, 9_000, 14_000, 30_000]) {
      for (const count of [1, 5, 50]) {
        const ms = userEndpointBudgetMs({ maxMs, count });
        assert.ok(ms >= LIVE_USER_ENDPOINT_MIN_TOTAL_HARD_TIMEOUT_MS && ms <= LIVE_USER_ENDPOINT_MAX_TOTAL_HARD_TIMEOUT_MS,
          `maxMs=${maxMs} count=${count} produced ${ms}`);
      }
    }
  });

  test('measurement reaches the ceiling ONLY on the user-endpoint route', () => {
    // Every other route's number is derived from something known about the
    // transport, so an observation has nothing to correct there.
    const slow = { maxMs: 18_000, count: 10 };
    assert.equal(totalHardTimeoutMs({ observedUserEndpointLatency: slow }), LIVE_DEFAULT_PROVIDER_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(totalHardTimeoutMs({ viaServerCascade: true, observedUserEndpointLatency: slow }), LIVE_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(totalHardTimeoutMs({ isLocal: true, observedUserEndpointLatency: slow }), LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(totalHardTimeoutMs({ isVisionTurn: true, isUserEndpoint: true, observedUserEndpointLatency: slow }),
      LIVE_VISION_TOTAL_HARD_TIMEOUT_MS);
    assert.equal(totalHardTimeoutMs({ isUserEndpoint: true, observedUserEndpointLatency: slow }), 20_000);
  });

  test('both selectors adapt identically', () => {
    const obs = { maxMs: 11_600, count: 3 };
    assert.equal(
      firstUsefulDeadlineMs('identity_answer', false, false, true, obs),
      totalHardTimeoutMs({ isUserEndpoint: true, observedUserEndpointLatency: obs }),
    );
  });
});

describe('what gets measured, and what must not blend', () => {
  function customHelper(id, baseUrl) {
    const h = new LLMHelper(undefined, false);
    h.setModel(id, [{ id, name: id, model: 'x/y', apiKey: 'sk-test', baseUrl }]);
    return h;
  }

  test('two gateways sharing a provider id are measured separately', () => {
    // textHealth keys these both as 'custom'. Sizing a deadline off that would
    // let a fast OpenRouter set the budget for a slow self-hosted proxy — which
    // is why this is a separate map keyed by the endpoint.
    const a = customHelper('same-id', 'https://gateway-a.example/v1');
    const b = customHelper('same-id', 'https://gateway-b.example/v1');
    for (let i = 0; i < 6; i++) a.recordAnswerFirstToken(500);
    assert.equal(a.observedAnswerLatency().count, 6);
    assert.equal(b.observedAnswerLatency(), null, 'a different base URL must start fresh');
  });

  test('editing a provider’s base URL restarts measurement rather than inheriting it', () => {
    const h = customHelper('my-proxy', 'https://old.example/v1');
    for (let i = 0; i < 6; i++) h.recordAnswerFirstToken(500);
    assert.equal(h.observedAnswerLatency().count, 6);
    h.setModel('my-proxy', [{ id: 'my-proxy', name: 'my-proxy', model: 'x/y', apiKey: 'sk-test', baseUrl: 'https://new.example/v1' }]);
    assert.equal(h.observedAnswerLatency(), null, 'stale samples from the old endpoint must not size the new one');
  });

  test('nothing is recorded on a route that does not adapt', () => {
    const h = new LLMHelper(undefined, false);
    h.setModel('gemini', []);
    h.recordAnswerFirstToken(900);
    assert.equal(h.observedAnswerLatency(), null);
  });

  test('the decaying max forgives one outlier instead of pinning the budget', () => {
    const h = customHelper('flaky', 'https://flaky.example/v1');
    h.recordAnswerFirstToken(13_000);
    const spiked = userEndpointBudgetMs(h.observedAnswerLatency());
    for (let i = 0; i < 8; i++) h.recordAnswerFirstToken(500);
    const recovered = userEndpointBudgetMs(h.observedAnswerLatency());
    assert.ok(spiked > LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS, `spike should widen, got ${spiked}`);
    assert.ok(recovered < spiked, `a recovered endpoint must come back down: ${spiked} -> ${recovered}`);
  });

  test('a garbage measurement is ignored, not stored', () => {
    const h = customHelper('junk', 'https://junk.example/v1');
    h.recordAnswerFirstToken(NaN);
    h.recordAnswerFirstToken(-5);
    h.recordAnswerFirstToken(Infinity);
    assert.equal(h.observedAnswerLatency(), null);
  });
});

describe('the answer call sites actually record what the budget reads', () => {
  // The policy above is worthless if nothing feeds it. These anchor on real
  // code only — a previous test in this area was defeated by the searched-for
  // text appearing in a comment.
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('IntelligenceEngine records first-token latency and reads it back', () => {
    const src = stripComments(fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8'));
    assert.ok(/recordAnswerFirstToken\?\.\(/.test(src), 'WTA must record its first-token latency');
    assert.ok(/observedUserEndpointLatency/.test(src), 'WTA must pass the observation into the selector');
  });

  test('manual chat and the phone-mirror path both record', () => {
    const src = stripComments(fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8'));
    assert.ok(/noteManualFirstToken\(\)/.test(src), 'manual chat must record');
    assert.ok(/notePhoneFirstToken\(\)/.test(src), 'the phone-mirror path must record');
    assert.equal((src.match(/recordAnswerFirstToken\?\.\(/g) || []).length, 2,
      'both ipcHandlers answer streams must record, and nothing else should');
  });
});
