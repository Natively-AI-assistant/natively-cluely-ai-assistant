// electron/services/__tests__/ClaudeModelClassification2026_08_05.test.mjs
//
// Regression tests for THREE defects in ModelVersionManager's Claude handling.
// All three fed findLatestInFamily(), which picks the model the auto-upgrade
// discovery job promotes into the Tier 1/2/3 slots.
//
// BUG 1 (SEVERE — wrong model wins): parseModelVersion() never stripped the
//   YYYYMMDD release-date suffix, so "claude-3-5-sonnet-20241022" parsed as
//   version 20241022.0. compareVersions() then ranked a RETIRED Claude 3.5
//   model above every current model, Opus 5 included. Discovery would promote
//   it as "latest".
//
// BUG 2 (invisible models): classifyModel()/classifyTextModel() gated on an
//   allow-list — lower.includes('sonnet'|'opus'|'haiku') — so claude-fable-5
//   and claude-mythos-5 classified as null. Discovery could not see them, and
//   any future family name would have failed identically.
//
// BUG 3 (dateless ids under-parsed): the Claude version regex required BOTH a
//   major and a minor segment, so major-only ids like "claude-opus-5" fell
//   through to the generic strategies.
//
// Anthropic documents both id grammars this code must handle:
//   4.6-gen and later  claude-{name}-{major}[-{minor}]      (dateless, pinned)
//   before 4.6         claude-{name}-{major}-{minor}-{YYYYMMDD}
//
// Platform note: pure string parsing, no OS-specific branch — one suite covers
// macOS and Windows identically.
//
// Run: node --test after build:electron

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/services/ModelVersionManager.js');
const { parseModelVersion, compareVersions, classifyModel, classifyTextModel, ModelFamily, TextModelFamily } =
  await import(pathToFileURL(modPath).href);

const ver = (id) => {
  const v = parseModelVersion(id);
  return v ? `${v.major}.${v.minor}` : null;
};

describe('BUG 1: a release date is not a version number', () => {
  test('claude-3-5-sonnet-20241022 → 3.5, not 20241022', () => {
    assert.equal(ver('claude-3-5-sonnet-20241022'), '3.5');
  });

  test('claude-haiku-4-5-20251001 → 4.5', () => {
    assert.equal(ver('claude-haiku-4-5-20251001'), '4.5');
  });

  test('claude-sonnet-4-5-20250929 → 4.5', () => {
    assert.equal(ver('claude-sonnet-4-5-20250929'), '4.5');
  });

  test('THE FAILURE: a retired 3.5 model must NOT outrank Opus 5', () => {
    const retired = parseModelVersion('claude-3-5-sonnet-20241022');
    const current = parseModelVersion('claude-opus-5');
    assert.ok(
      compareVersions(retired, current) < 0,
      `claude-3-5-sonnet-20241022 (${retired.major}.${retired.minor}) ranked >= claude-opus-5`,
    );
  });

  test('a dated snapshot ranks equal to its own dateless version', () => {
    assert.equal(
      compareVersions(parseModelVersion('claude-sonnet-4-5-20250929'), parseModelVersion('claude-sonnet-4-5')),
      0,
    );
  });

  test('newer dated snapshots still rank above older Claude generations', () => {
    assert.ok(
      compareVersions(parseModelVersion('claude-haiku-4-5-20251001'), parseModelVersion('claude-3-opus-20240229')) > 0,
    );
  });
});

describe('BUG 2: every Claude model is visible to discovery', () => {
  // These two returned null under the sonnet|opus|haiku allow-list.
  for (const id of ['claude-fable-5', 'claude-mythos-5', 'claude-mythos-preview']) {
    test(`${id} classifies as a Claude model`, () => {
      assert.equal(classifyModel(id), ModelFamily.CLAUDE);
      assert.equal(classifyTextModel(id), TextModelFamily.CLAUDE);
    });
  }

  test('a hypothetical future family name works with no code change', () => {
    assert.equal(classifyModel('claude-quasar-7'), ModelFamily.CLAUDE);
    assert.equal(classifyTextModel('claude-quasar-7'), TextModelFamily.CLAUDE);
  });

  for (const id of ['claude-opus-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022']) {
    test(`${id} still classifies (no regression)`, () => {
      assert.equal(classifyModel(id), ModelFamily.CLAUDE);
    });
  }

  test('the Bedrock anthropic.-prefixed form classifies too', () => {
    assert.equal(classifyModel('anthropic.claude-opus-5'), ModelFamily.CLAUDE);
    assert.equal(classifyTextModel('anthropic.claude-opus-5'), TextModelFamily.CLAUDE);
  });

  test('a non-Anthropic id merely containing "claude" is NOT claimed', () => {
    assert.notEqual(classifyModel('my-claude-clone-v2'), ModelFamily.CLAUDE);
  });

  test('other providers are unaffected', () => {
    assert.equal(classifyModel('gpt-5.4'), ModelFamily.OPENAI);
    assert.equal(classifyModel('gemini-3.6-flash'), ModelFamily.GEMINI_FLASH);
    assert.equal(classifyModel('gemini-3.1-pro-preview'), ModelFamily.GEMINI_PRO);
    assert.equal(classifyTextModel('llama-3.3-70b-versatile'), TextModelFamily.GROQ);
  });
});

describe('BUG 3: major-only dateless ids parse', () => {
  const cases = [
    ['claude-opus-5', '5.0'],
    ['claude-sonnet-5', '5.0'],
    ['claude-fable-5', '5.0'],
    ['claude-mythos-5', '5.0'],
  ];
  for (const [id, expected] of cases) {
    test(`${id} → ${expected}`, () => assert.equal(ver(id), expected));
  }

  test('major-only Opus 5 outranks major.minor Opus 4.8', () => {
    assert.ok(compareVersions(parseModelVersion('claude-opus-5'), parseModelVersion('claude-opus-4-8')) > 0);
  });
});

describe('generation ordering is correct end to end', () => {
  test('4.6-generation ids rank in release order', () => {
    const ordered = ['claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5'];
    for (let i = 1; i < ordered.length; i++) {
      assert.ok(
        compareVersions(parseModelVersion(ordered[i]), parseModelVersion(ordered[i - 1])) > 0,
        `${ordered[i]} did not rank above ${ordered[i - 1]}`,
      );
    }
  });

  test('the newest model wins across a full mixed catalog', () => {
    // Exactly what findLatestInFamily() does, over every documented id shape.
    const catalog = [
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'claude-opus-5',
    ];
    let best = null;
    for (const id of catalog) {
      const v = parseModelVersion(id);
      if (!v) continue;
      if (!best || compareVersions(v, best.v) > 0) best = { id, v };
    }
    assert.equal(best.id, 'claude-opus-5');
  });

  test('legacy pre-4.6 ids keep their real generation', () => {
    assert.equal(ver('claude-3-opus-20240229'), '3.0');
    assert.equal(ver('claude-3-7-sonnet-20250219'), '3.7');
  });
});
