/**
 * Per-model thinking control for 9Router.
 *
 * WHY THIS EXISTS — 45 of the 47 models a stock instance serves are reasoning
 * models, and `reasoning_effort` is genuinely HONOURED: latency moves
 * monotonically across the scale, reproduced on two models and two measurement
 * methods. That rules out the accepted-and-ignored failure shape OpenRouter's
 * `output_dimension` has here.
 *
 * How much it buys is model- and prompt-dependent, and 'auto' is a reasonable
 * default rather than something to escape — on Gemini, which varies its own
 * effort per prompt, auto was the fastest setting measured.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';
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
const { ninerouterThinkingOptions, NINEROUTER_THINKING_LEVELS } =
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

  test('UNSET defaults to no thinking — the fast path, not the provider default', async () => {
    // A deliberate product choice. 9Router's own default reasons hard, and on a
    // free/cheap-tier aggregator that is the difference between a ~1s answer and
    // a multi-second one. Users who want the model to decide pick Auto.
    const { h, sent } = makeHelper(undefined);
    await drain(h);
    assert.equal(sent[0].reasoning_effort, 'none',
      'an unconfigured 9Router must be fast by default');
  });

  test("'' (never chosen) is also the default, not a silent auto", async () => {
    const { h, sent } = makeHelper('');
    await drain(h);
    assert.equal(sent[0].reasoning_effort, 'none');
  });

  test("'auto' remains the explicit opt-out and still sends nothing", async () => {
    const { h, sent } = makeHelper('auto');
    await drain(h);
    assert.ok(!('reasoning_effort' in sent[0]),
      'Auto must stay reachable — some models (Gemini) vary effort well on their own');
  });

  test('each level is sent verbatim as reasoning_effort', async () => {
    for (const level of ['none', 'low', 'medium', 'high']) {
      const { h, sent } = makeHelper(level);
      await drain(h);
      assert.equal(sent[0].reasoning_effort, level, `${level} must reach the wire`);
    }
  });

  test('a junk value falls back to the default rather than reaching the wire', async () => {
    // Stored settings outlive code. An unrecognised level must not become a 400
    // on every question — and now that the default is a real level rather than
    // silence, falling back to it keeps the fast path.
    const { h, sent } = makeHelper('ludicrous');
    await drain(h);
    assert.equal(sent[0].reasoning_effort, 'none');
  });
});

describe("the options mirror 9Router's own per-format vocabulary", () => {
  // 9Router does NOT pass reasoning_effort through. extractThinking() reads it
  // as client INTENT, applyFormat() deletes it, and rewrites that intent into
  // the backend's native shape — thinking:{budget_tokens} for claude-budget,
  // setGeminiThinking({thinkingLevel}) for gemini-level, a clamp for deepseek.
  //
  // So a canonical vocabulary does exist, which is why one control can drive
  // every backend. But the valid levels differ per thinkingFormat, and an
  // earlier version of this file invented a flat none/low/medium/high for all
  // of them. That offered levels several formats do not have (minimax and zai
  // are BINARY) while hiding levels others do (claude's max, openai's xhigh).
  //
  // These expectations are FORMAT_LEVELS from
  // open-sse/providers/thinkingLevels.js, plus its rule that
  // `thinkingCanDisable === false` filters 'none' out.
  const ids = (caps) => ninerouterThinkingOptions(caps).map(o => o.id);

  test('a non-reasoning model gets NO control', () => {
    assert.deepEqual(ninerouterThinkingOptions({ reasoning: false }), []);
  });

  test('gemini-level has no "none" — it starts at minimal', () => {
    assert.deepEqual(
      ids({ reasoning: true, thinkingFormat: 'gemini-level', thinkingCanDisable: false }),
      ['minimal', 'low', 'medium', 'high', 'auto'],
    );
  });

  test('minimax and zai are BINARY, not a four-point scale', () => {
    // Offering low/medium/high here invents levels the backend does not have.
    assert.deepEqual(ids({ reasoning: true, thinkingFormat: 'minimax', thinkingCanDisable: true }),
      ['none', 'thinking', 'auto']);
    assert.deepEqual(ids({ reasoning: true, thinkingFormat: 'zai', thinkingCanDisable: true }),
      ['none', 'thinking', 'auto']);
  });

  test('deepseek collapses the middle — none, high, max only', () => {
    assert.deepEqual(ids({ reasoning: true, thinkingFormat: 'deepseek', thinkingCanDisable: true }),
      ['none', 'high', 'max', 'auto']);
  });

  test('openai reaches xhigh and claude reaches max', () => {
    assert.deepEqual(ids({ reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: true }),
      ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'auto']);
    assert.deepEqual(ids({ reasoning: true, thinkingFormat: 'claude-budget', thinkingCanDisable: true }),
      ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'auto']);
    assert.deepEqual(ids({ reasoning: true, thinkingFormat: 'claude-adaptive', thinkingCanDisable: true }),
      ['none', 'low', 'medium', 'high', 'max', 'auto']);
  });

  test("canDisable:false removes 'none', exactly as getThinkingLevels does", () => {
    assert.ok(!ids({ reasoning: true, thinkingFormat: 'qwen', thinkingCanDisable: false }).includes('none'));
    assert.ok(ids({ reasoning: true, thinkingFormat: 'qwen', thinkingCanDisable: true }).includes('none'));
  });

  test('an unknown format falls back to their base set, not to nothing', () => {
    // L.base in their table. Withholding a control 9Router would have honoured
    // is worse than offering one it may clamp.
    assert.deepEqual(ids({ reasoning: true, thinkingFormat: 'something-new', thinkingCanDisable: true }),
      ['none', 'low', 'medium', 'high', 'auto']);
    assert.deepEqual(ids(undefined), ['none', 'low', 'medium', 'high', 'auto']);
  });

  test('the format FLOOR leads and auto sits last', () => {
    // The default has to be the first entry — a dropdown whose default is not
    // its first row reads as broken. Auto is the opt-out, so it goes to the end.
    for (const fmt of ['openai', 'gemini-level', 'minimax', 'deepseek', 'claude-budget']) {
      const o = ids({ reasoning: true, thinkingFormat: fmt });
      assert.notEqual(o[0], 'auto', `${fmt}: auto must not lead`);
      assert.equal(o[o.length - 1], 'auto', `${fmt}: auto must be reachable at the end`);
    }
  });

  test('every offered level is one the wire validator accepts', () => {
    // The two lists live in different files (electron/ never imports src/), so
    // a level the picker offers and the validator drops is a silent no-op.
    for (const fmt of ['openai', 'claude-adaptive', 'claude-budget', 'gemini-level',
                       'gemini-budget', 'zai', 'qwen', 'kimi', 'deepseek', 'minimax',
                       'hunyuan', 'step']) {
      for (const id of ids({ reasoning: true, thinkingFormat: fmt, thinkingCanDisable: true })) {
        if (id === 'auto') continue;
        assert.ok(NINEROUTER_THINKING_LEVELS.includes(id),
          `${fmt} offers "${id}" but the wire validator would drop it`);
      }
    }
  });
});

describe('the persisted shape feeds the picker directly', () => {
  test('discovery writes the SAME field names the option builder reads', () => {
    // The near-miss worth pinning: discovery briefly wrote {canDisable, format}
    // while ninerouterThinkingOptions reads {thinkingCanDisable, thinkingFormat}.
    // Nothing would have thrown — every model would simply have fallen back to
    // the generic level set, silently offering minimax a low/medium/high scale
    // it does not have.
    const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
    const at = ipc.indexOf('meta[m.id] = {');
    const block = ipc.slice(at, at + 700);
    assert.match(block, /thinkingCanDisable:/, 'must persist thinkingCanDisable, not canDisable');
    assert.match(block, /thinkingFormat:/, 'must persist thinkingFormat, not format');

    // And the renderer must hand it over untranslated.
    const ui = fs.readFileSync(path.join(root, 'src/components/settings/AIProvidersSettings.tsx'), 'utf8');
    assert.match(ui, /ninerouterThinkingOptions\(selected \? ninerouterModelMeta\[selected\] : undefined\)/,
      'the picker must read the persisted entry as-is');
  });
});

describe('the picker and the wire agree on the default', () => {
  test('the fastest level is marked as the default in the options', () => {
    // Whatever the format's floor is — 'none' for most, 'minimal' for
    // gemini-level, which has no off.
    const gem = ninerouterThinkingOptions({ reasoning: true, thinkingFormat: 'gemini-level', thinkingCanDisable: false });
    assert.equal(gem[0].id, 'minimal', 'the floor follows the format');
    assert.match(gem[0].name, /default/i, 'and is labelled as the default');

    const mm = ninerouterThinkingOptions({ reasoning: true, thinkingFormat: 'minimax', thinkingCanDisable: true });
    assert.equal(mm[0].id, 'none');
    assert.match(mm[0].name, /default/i);
  });

  test('Auto is still offered, just not first', () => {
    const o = ninerouterThinkingOptions({ reasoning: true, thinkingFormat: 'openai', thinkingCanDisable: true });
    assert.ok(o.some(x => x.id === 'auto'), 'the opt-out must remain reachable');
  });
});
