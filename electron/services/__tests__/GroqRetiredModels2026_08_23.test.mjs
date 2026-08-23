// electron/services/__tests__/GroqRetiredModels2026_08_23.test.mjs
//
// Groq switched off every Llama id Natively shipped:
//   meta-llama/llama-4-scout-17b-16e-instruct  shut down 2026-07-17 (vision)
//   llama-3.3-70b-versatile                    shut down 2026-08-16 (text)
// See https://console.groq.com/docs/deprecations. Both were still pinned as
// baselines here, so every Groq call 404'd. `qwen/qwen3.6-27b` replaces both —
// it is the only model left in Groq's catalogue that accepts image input.
//
// Three defects this suite pins:
//
// BUG 1 (discovery blind): classifyModel() matched the Groq vision family on
//   llama+scout and classifyTextModel() on llama|mixtral|gemma. None of those
//   terms appear in Groq's current catalogue, so the 14-day auto-discovery job
//   could never see a replacement and the families would sit on their baseline
//   forever — exactly when discovery is most needed.
//
// BUG 2 (retirement is not a version bump — the load-bearing one):
//   reconcileBaselines() kept a persisted `latest` whenever its parsed version
//   was >= the new baseline's. llama-4-scout parses as 4.0 and qwen3.6-27b as
//   3.6, so an installed user's Tier 2/3 would have KEPT the decommissioned
//   scout id after the baseline was fixed. Comparison must be by id, not number.
//
// BUG 3 (hardware spec read as a version): "qwen/qwen3.6-27b" must parse as
//   3.6, not 27.x — the -27b parameter count is not a version.
//
// BUG 4 (vision refused before the request is built): the Groq branch of
//   getModelCapabilities() hardcoded supportsImages:false, and LLMHelper gates
//   the vision path on that flag. Worse, isLargeGroqModel() matched qwen only at
//   {32b,72b,110b}, so the 27b default missed it entirely and fell through to
//   the "unknown" branch. Groq's one multimodal model has to report as one.
//
// Platform note: pure string/object logic, no OS branch — one suite covers
// macOS and Windows identically.
//
// Run: npm run build:electron, then node --test on this file.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/services/ModelVersionManager.js');
const capsPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/modelCapabilities.js');
const { getModelCapabilities } = await import(pathToFileURL(capsPath).href);

const {
  parseModelVersion,
  classifyModel,
  classifyTextModel,
  isRetiredModelId,
  reconcileFamilyEntry,
  ModelFamily,
  TextModelFamily,
} = await import(pathToFileURL(modPath).href);

const GROQ_REPLACEMENT = 'qwen/qwen3.6-27b';
const DEAD_VISION = 'meta-llama/llama-4-scout-17b-16e-instruct';
const DEAD_TEXT = 'llama-3.3-70b-versatile';

const entry = (over = {}) => ({
  baseline: DEAD_VISION,
  tier1: DEAD_VISION,
  latest: DEAD_VISION,
  tier1Version: parseModelVersion(DEAD_VISION),
  latestVersion: parseModelVersion(DEAD_VISION),
  previousTier1: null,
  previousLatest: null,
  ...over,
});

describe('the retired-model list names what Groq switched off', () => {
  for (const id of [DEAD_VISION, DEAD_TEXT, 'llama-3.1-8b-instant', 'qwen/qwen3-32b']) {
    test(`${id} is marked retired`, () => {
      assert.equal(isRetiredModelId(id), true);
    });
  }

  test('the replacement is NOT marked retired', () => {
    assert.equal(isRetiredModelId(GROQ_REPLACEMENT), false);
  });
});

describe('BUG 3: a parameter count is not a version', () => {
  test('qwen/qwen3.6-27b parses as 3.6, not 27.x', () => {
    const v = parseModelVersion(GROQ_REPLACEMENT);
    assert.ok(v, 'expected a parsed version');
    assert.equal(`${v.major}.${v.minor}`, '3.6');
  });
});

describe('BUG 1: discovery can see the models Groq actually serves', () => {
  test('qwen3.6-27b classifies into the Groq VISION family', () => {
    assert.equal(classifyModel(GROQ_REPLACEMENT), ModelFamily.GROQ_LLAMA);
  });

  test('qwen3.6-27b classifies into the Groq TEXT family', () => {
    assert.equal(classifyTextModel(GROQ_REPLACEMENT), TextModelFamily.GROQ);
  });

  for (const id of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'groq/compound']) {
    test(`${id} classifies as Groq text, not OpenAI`, () => {
      assert.equal(classifyTextModel(id), TextModelFamily.GROQ);
    });
  }

  test('legacy llama ids still classify as Groq text (no regression)', () => {
    assert.equal(classifyTextModel(DEAD_TEXT), TextModelFamily.GROQ);
  });
});

describe('BUG 2: a persisted retired id is dropped even when it outranks the baseline', () => {
  test('THE FAILURE: llama-4-scout (4.0) must not survive a 3.6 baseline', () => {
    const e = entry();
    // Guard the premise: without an id check, 4.0 >= 3.6 would keep `latest`.
    assert.ok(
      parseModelVersion(DEAD_VISION).major > parseModelVersion(GROQ_REPLACEMENT).major,
      'premise: the retired id parses HIGHER than its replacement',
    );

    const changed = reconcileFamilyEntry(e, GROQ_REPLACEMENT);

    assert.equal(changed, true);
    assert.equal(e.baseline, GROQ_REPLACEMENT);
    assert.equal(e.tier1, GROQ_REPLACEMENT);
    assert.equal(e.latest, GROQ_REPLACEMENT, 'tier 2/3 must not keep the decommissioned id');
  });

  test('a retired tier1 is reset even when the baseline already matches', () => {
    const e = entry({ baseline: DEAD_TEXT, tier1: DEAD_TEXT, latest: DEAD_TEXT });
    e.tier1Version = parseModelVersion(DEAD_TEXT);
    e.latestVersion = parseModelVersion(DEAD_TEXT);

    assert.equal(reconcileFamilyEntry(e, DEAD_TEXT), true, 'a retired id is stale even at its own baseline');
    assert.equal(e.tier1, DEAD_TEXT, 'reset targets the baseline it was handed');
  });

  test('an up-to-date family is left alone', () => {
    const e = entry({
      baseline: GROQ_REPLACEMENT,
      tier1: GROQ_REPLACEMENT,
      latest: GROQ_REPLACEMENT,
      tier1Version: parseModelVersion(GROQ_REPLACEMENT),
      latestVersion: parseModelVersion(GROQ_REPLACEMENT),
    });
    assert.equal(reconcileFamilyEntry(e, GROQ_REPLACEMENT), false);
  });

  test('a genuinely newer discovered latest is preserved', () => {
    const e = entry({
      baseline: DEAD_TEXT,
      tier1: DEAD_TEXT,
      latest: 'qwen/qwen4.0-30b',
      tier1Version: parseModelVersion(DEAD_TEXT),
      latestVersion: parseModelVersion('qwen/qwen4.0-30b'),
    });
    assert.equal(reconcileFamilyEntry(e, GROQ_REPLACEMENT), true);
    assert.equal(e.latest, 'qwen/qwen4.0-30b', 'a live newer model must not be clobbered');
  });
});

describe('BUG 4: the Groq default reports the capabilities it actually has', () => {
  const caps = (id) => getModelCapabilities(id, /* isOllama */ false);

  test('THE FAILURE: qwen3.6-27b must report supportsImages', () => {
    assert.equal(caps(GROQ_REPLACEMENT).supportsImages, true);
  });

  test('qwen3.6-27b is classified cloud-tier, not fallen through to "unknown"', () => {
    const c = caps(GROQ_REPLACEMENT);
    assert.equal(c.tier, 'cloud');
    assert.equal(c.supportsXmlTags, true);
  });

  test('the text-only Groq models do NOT claim image support', () => {
    assert.equal(caps('openai/gpt-oss-120b').supportsImages, false);
    assert.equal(caps('openai/gpt-oss-20b').supportsImages, false);
    assert.equal(caps('groq/compound').supportsImages, false);
  });

  test('gpt-oss is cloud-tier — a Groq id must not be sized as a small local model', () => {
    assert.equal(caps('openai/gpt-oss-120b').tier, 'cloud');
    assert.equal(caps('openai/gpt-oss-20b').tier, 'cloud');
  });
});
