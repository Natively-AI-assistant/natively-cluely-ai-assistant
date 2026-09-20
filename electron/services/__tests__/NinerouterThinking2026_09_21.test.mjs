/**
 * Per-model thinking control for 9Router.
 *
 * WHY THIS EXISTS — measured, not assumed. On the reference instance 45 of 47
 * models report `reasoning: true`, and 9Router's DEFAULT is effectively high
 * effort. Sending an explicit level is the single biggest latency lever there
 * is:
 *
 *   gemini/gemini-3.5-flash-lite   baseline 3963ms -> effort:none  721ms
 *   minimax/MiniMax-M3             baseline 2581ms -> effort:none  857ms
 *
 * and it is monotonic across none/low/medium/high, so it is genuinely honoured
 * rather than accepted-and-ignored (the failure shape OpenRouter's
 * `output_dimension` has here).
 *
 * THE TRAP: `reasoning_effort:'none'` WORKS on gemini-3.5-flash-lite even
 * though its catalogue entry says `thinkingCanDisable: false` — 3963ms to
 * 721ms, measured. 9Router clamps to the model's minimum instead of refusing.
 * So that flag must NOT gate whether the option is offered; it only changes
 * what the option is honestly CALLED, because "Off" would overpromise on a
 * model that can only be turned down.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};
const { LLMHelper } = require(path.join(root, 'dist-electron/electron/LLMHelper.js'));
const { ninerouterThinkingOptions } =
  await import(pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href);

const MODEL = 'ninerouter/minimax/MiniMax-M3';

/** Captures the request body streamWithNinerouter actually sends. */
function makeHelper(thinking) {
  const sent = [];
  const h = Object.create(LLMHelper.prototype);
  h.isLocalOnlyMode = false;
  h.assertOutboundScopes = () => {};
  h.rateLimiters = { ninerouter: { acquire: async () => {} } };
  h.currentModelId = MODEL;
  h.ninerouterApiKey = 'sk-x';
  h.ninerouterBaseURL = 'http://localhost:20128/v1';
  h.ninerouterMaxTokens = 1024;
  h.ninerouterThinking = thinking;
  h.ninerouterModelBudgets = new Map();
  h.ninerouterModelInputCaps = new Map();
  h.ninerouterVisionModels = new Set();
  h.ninerouterModelsFetchedAt = Date.now();
  h.ninerouterModelsFetch = null;
  h.isProviderDisabled = () => false;
  h._ninerouterClient = {
    chat: { completions: { create: async (req) => {
      sent.push(req);
      return (async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; })();
    } } },
  };
  return { h, sent };
}

async function drain(h) {
  for await (const _ of LLMHelper.prototype.streamWithNinerouter.call(
    h, 'hi', 'SYS', undefined, undefined, MODEL)) { /* drain */ }
}

describe('the wire carries the chosen level', () => {
  test("'auto' sends NOTHING, so 9Router keeps its own default", async () => {
    const { h, sent } = makeHelper('auto');
    await drain(h);
    assert.ok(!('reasoning_effort' in sent[0]),
      'auto must not pin a level — that is what makes it auto');
  });

  test('an unset preference behaves as auto', async () => {
    const { h, sent } = makeHelper(undefined);
    await drain(h);
    assert.ok(!('reasoning_effort' in sent[0]));
  });

  test('each level is sent verbatim as reasoning_effort', async () => {
    for (const level of ['none', 'low', 'medium', 'high']) {
      const { h, sent } = makeHelper(level);
      await drain(h);
      assert.equal(sent[0].reasoning_effort, level, `${level} must reach the wire`);
    }
  });

  test('a junk value is dropped rather than sent', async () => {
    // Stored settings outlive code. An unrecognised level must not become a
    // 400 on every question.
    const { h, sent } = makeHelper('ludicrous');
    await drain(h);
    assert.ok(!('reasoning_effort' in sent[0]));
  });
});

describe('the options adapt to the model', () => {
  test('a non-reasoning model gets NO control', () => {
    // gemini/gemma-4-31b-it reports reasoning:false. Offering a thinking level
    // for it would be a control that does nothing.
    assert.deepEqual(ninerouterThinkingOptions({ reasoning: false }), []);
  });

  test('a reasoning model that CAN disable offers a true Off', () => {
    const opts = ninerouterThinkingOptions({ reasoning: true, thinkingCanDisable: true });
    assert.deepEqual(opts.map(o => o.id), ['auto', 'none', 'low', 'medium', 'high']);
    assert.match(opts.find(o => o.id === 'none').name, /off/i);
  });

  test('a model that CANNOT disable still offers the level — named honestly', () => {
    // The measured trap. gemini-3.5-flash-lite reports thinkingCanDisable:false
    // and `reasoning_effort:'none'` still takes it from 3963ms to 721ms, because
    // 9Router clamps to the model's minimum. Hiding the option would hide the
    // biggest single win; calling it "Off" would promise something the model
    // cannot do.
    const opts = ninerouterThinkingOptions({ reasoning: true, thinkingCanDisable: false });
    assert.ok(opts.some(o => o.id === 'none'), 'the fastest setting must still be offered');
    assert.match(opts.find(o => o.id === 'none').name, /minimal/i);
    assert.doesNotMatch(opts.find(o => o.id === 'none').name, /off/i);
  });

  test('unknown capabilities fall back to the full set', () => {
    // A model the catalogue has not described — offer everything and let the
    // server decide, rather than silently withholding the control.
    const opts = ninerouterThinkingOptions(undefined);
    assert.deepEqual(opts.map(o => o.id), ['auto', 'none', 'low', 'medium', 'high']);
  });

  test('auto is always first and is the default', () => {
    const opts = ninerouterThinkingOptions({ reasoning: true, thinkingCanDisable: true });
    assert.equal(opts[0].id, 'auto');
  });
});
