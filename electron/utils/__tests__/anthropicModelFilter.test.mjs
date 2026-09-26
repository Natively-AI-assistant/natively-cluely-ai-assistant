// electron/utils/__tests__/anthropicModelFilter.test.mjs
//
// THE BUG THIS PINS: "AI Providers → Claude shows only Sonnet 4.6, and Fetch
// Models adds nothing."
//
// fetchAnthropicModels() filtered /v1/models with /claude-(\d+)-(\d+)?/, which
// requires DIGITS IMMEDIATELY AFTER "claude-". That is the LEGACY id shape
// (claude-3-5-sonnet). Every current-generation id puts the family name there
// instead — including the plain, undated `claude-sonnet-4-6` — so the regex did
// not match, the model was dropped, and the catalog came back EMPTY.
//
// An empty catalog is silent by design further up the stack: the IPC handler
// only persists when `models.length > 0`, and AIProvidersSettings' universe is
// `presets ∪ catalog`, so the card fell back to the single hardcoded preset
// (STANDARD_CLOUD_MODELS.claude.ids === ['claude-sonnet-4-6']) with no error.
//
// The filter is now gone entirely — /v1/models already returns only what the
// key can use. What remains to pin is the LABEL: rows must read "Claude Sonnet
// 4.6", never "claude-sonnet-4-6-20251114". formatClaudeLabel() is the fallback
// used when the API omits display_name.
//
// Platform note: this is pure network-response parsing with no OS-specific
// branch, so a single suite covers macOS and Windows identically.
//
// Run: node --test after build:electron (or ELECTRON_RUN_AS_NODE=1 electron --test)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/utils/modelFetcher.js');
const { formatClaudeLabel, pickLatestSnapshotPerModel } = await import(pathToFileURL(modPath).href);

describe('same model, several release dates → keep the newest', () => {
  test('claude-3-5-sonnet: 20241022 wins over 20240620', () => {
    // The real case: Anthropic shipped 3.5 Sonnet twice under one name.
    const picked = pickLatestSnapshotPerModel([
      { id: 'claude-3-5-sonnet-20240620', created_at: '2024-06-20T00:00:00Z' },
      { id: 'claude-3-5-sonnet-20241022', created_at: '2024-10-22T00:00:00Z' },
    ]);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].id, 'claude-3-5-sonnet-20241022');
  });

  test('the newest wins regardless of the order the API returned them in', () => {
    for (const order of [['20240620', '20241022'], ['20241022', '20240620']]) {
      const picked = pickLatestSnapshotPerModel(
        order.map(d => ({ id: `claude-3-5-sonnet-${d}`, created_at: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T00:00:00Z` })),
      );
      assert.equal(picked[0].id, 'claude-3-5-sonnet-20241022', `order ${order}`);
    }
  });

  test('falls back to the id date when created_at is absent', () => {
    const picked = pickLatestSnapshotPerModel([
      { id: 'claude-3-5-sonnet-20241022' },
      { id: 'claude-3-5-sonnet-20240620' },
    ]);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].id, 'claude-3-5-sonnet-20241022');
  });

  test('a pre-4.6 alias folds into its dated snapshot', () => {
    // `claude-sonnet-4-5` is documented as a pointer to the newest 4.5 snapshot.
    const picked = pickLatestSnapshotPerModel([
      { id: 'claude-sonnet-4-5', created_at: '2025-09-29T00:00:00Z' },
      { id: 'claude-sonnet-4-5-20250929', created_at: '2025-09-29T00:00:00Z' },
    ]);
    assert.equal(picked.length, 1);
    // Tie on date → the API's own ordering decides; the alias came first.
    assert.equal(picked[0].id, 'claude-sonnet-4-5');
  });
});

describe('distinct models are never collapsed into one another', () => {
  test('every generation survives — this is not a per-family collapse', () => {
    // The whole point: Opus 5 / 4.8 / 4.7 are DIFFERENT models, not snapshots
    // of one. Only same-model re-releases may be folded together.
    const catalog = [
      { id: 'claude-opus-5' },
      { id: 'claude-sonnet-5' },
      { id: 'claude-opus-4-8' },
      { id: 'claude-opus-4-7' },
      { id: 'claude-sonnet-4-6' },
      { id: 'claude-haiku-4-5-20251001' },
      { id: 'claude-fable-5' },
    ];
    const picked = pickLatestSnapshotPerModel(catalog);
    assert.deepEqual(picked.map(m => m.id), catalog.map(m => m.id));
  });

  test('dateless 4.6-generation ids are separate models, not aliases', () => {
    // Per the docs, claude-sonnet-4-6 is a pinned snapshot, not a pointer.
    const picked = pickLatestSnapshotPerModel([
      { id: 'claude-opus-4-6' },
      { id: 'claude-opus-4-7' },
      { id: 'claude-opus-4-8' },
    ]);
    assert.equal(picked.length, 3);
  });

  test('input order is preserved (the API returns newest-first)', () => {
    const picked = pickLatestSnapshotPerModel([
      { id: 'claude-opus-5' },
      { id: 'claude-3-5-sonnet-20241022' },
      { id: 'claude-3-5-sonnet-20240620' },
      { id: 'claude-haiku-4-5-20251001' },
    ]);
    assert.deepEqual(picked.map(m => m.id), [
      'claude-opus-5',
      'claude-3-5-sonnet-20241022',
      'claude-haiku-4-5-20251001',
    ]);
  });

  test('ignores entries with no id rather than throwing', () => {
    const picked = pickLatestSnapshotPerModel([{ id: 'claude-opus-5' }, {}, { id: '' }]);
    assert.deepEqual(picked.map(m => m.id), ['claude-opus-5']);
  });
});

describe('current ids: claude-<family>-<major>[-<minor>]', () => {
  // Every one of these returned null under the old version regex and was
  // silently dropped from the catalog.
  // Exact ids from the "Claude API ID" column of the official models overview.
  const cases = [
    ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
    ['claude-opus-5', 'Claude Opus 5'],
    ['claude-sonnet-5', 'Claude Sonnet 5'],
    ['claude-opus-4-8', 'Claude Opus 4.8'],
    ['claude-opus-4-7', 'Claude Opus 4.7'],
    ['claude-opus-4-6', 'Claude Opus 4.6'],
    ['claude-fable-5', 'Claude Fable 5'],
    ['claude-mythos-5', 'Claude Mythos 5'],
  ];

  for (const [id, label] of cases) {
    test(`${id} → "${label}"`, () => assert.equal(formatClaudeLabel(id), label));
  }
});

describe('dated snapshots lose the date, never the version', () => {
  // Pre-4.6 ids carry the snapshot date: claude-{name}-{major}-{minor}-{YYYYMMDD}
  const cases = [
    ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'],
    ['claude-opus-4-5-20251101', 'Claude Opus 4.5'],
    ['claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5'],
    ['claude-opus-4-1-20250805', 'Claude Opus 4.1'],
  ];

  for (const [id, label] of cases) {
    test(`${id} → "${label}"`, () => assert.equal(formatClaudeLabel(id), label));
  }

  test('an 8-digit tail is a date, not a minor version', () => {
    // The trap: a naive parse reads claude-opus-5-20260101 as version 5.20260101.
    assert.equal(formatClaudeLabel('claude-opus-5-20260101'), 'Claude Opus 5');
  });
});

describe('legacy ids: claude-<major>-<minor>-<family>', () => {
  const cases = [
    ['claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet'],
    ['claude-3-7-sonnet-20250219', 'Claude 3.7 Sonnet'],
    ['claude-3-opus-20240229', 'Claude 3 Opus'],
    ['claude-3-haiku-20240307', 'Claude 3 Haiku'],
  ];

  for (const [id, label] of cases) {
    test(`${id} → "${label}"`, () => assert.equal(formatClaudeLabel(id), label));
  }
});

// DEFENSIVE ONLY — Anthropic does not currently publish `-latest` aliases (its
// pre-4.6 aliases are bare, e.g. `claude-sonnet-4-5`). These pin that an
// unrecognised trailing segment degrades into a readable word rather than
// corrupting the version, in case the convention ever changes.
describe('unknown trailing segments become title-cased words', () => {
  test('legacy shape + trailing segment', () => {
    assert.equal(formatClaudeLabel('claude-3-5-sonnet-latest'), 'Claude 3.5 Sonnet Latest');
  });

  test('current shape + trailing segment', () => {
    assert.equal(formatClaudeLabel('claude-sonnet-4-6-latest'), 'Claude Sonnet 4.6 Latest');
  });

  // Real ids that exercise the same path: a family with no version at all.
  test('claude-mythos-preview → "Claude Mythos Preview"', () => {
    assert.equal(formatClaudeLabel('claude-mythos-preview'), 'Claude Mythos Preview');
  });
});

describe('unrecognised shapes still produce a readable label, never a crash', () => {
  const cases = [
    ['claude-2.1', 'Claude 2.1'],
    ['claude-instant-1.2', 'Claude Instant 1.2'],
    ['', ''],
  ];

  for (const [id, label] of cases) {
    test(`${JSON.stringify(id)} → "${label}"`, () =>
      assert.equal(formatClaudeLabel(id), label));
  }
});

describe('no label leaks a raw id or a date', () => {
  const ids = [
    'claude-sonnet-4-6',
    'claude-opus-5',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-6-latest',
  ];

  for (const id of ids) {
    test(`${id} has no 8-digit date and no hyphens`, () => {
      const label = formatClaudeLabel(id);
      assert.ok(!/\d{8}/.test(label), `date leaked into "${label}"`);
      assert.ok(!label.includes('-'), `raw id fragment leaked into "${label}"`);
    });
  }
});
