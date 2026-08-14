// electron/services/__tests__/BrowserContextEnvelope.test.mjs
//
// Tests the desktop-side envelope sanitizer, the prompt formatter, and the
// privacy-safe telemetry builder. Pure modules from dist-electron (node:crypto
// only) — no electron stub needed.
//
// Run: npm run test:services

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../');
const bc = (m) => pathToFileURL(path.resolve(root, `dist-electron/electron/services/browser-context/${m}.js`)).href;

let sanitizeContextEnvelope, formatEnvelopeForPrompt, buildCaptureTelemetry, charCountBucket;

before(async () => {
  ({ sanitizeContextEnvelope } = await import(bc('sanitize')));
  ({ formatEnvelopeForPrompt } = await import(bc('formatEnvelopeForPrompt')));
  ({ buildCaptureTelemetry, charCountBucket } = await import(bc('telemetry')));
});

const ENV = (over = {}) => ({
  envelopeVersion: 1,
  contextId: 'ctx-1',
  source: 'browser_extension',
  captureMode: 'auto',
  category: 'coding_problem',
  sensitivity: 'low',
  confidence: 'high',
  meta: { platform: 'LeetCode', title: 'Two Sum', host: 'leetcode.com', capturedAt: 1, charCount: 10, extractionSource: 'editor-dom' },
  payload: { problemTitle: 'Two Sum', visibleCode: 'def two_sum(): pass', constraints: '1<=n<=10' },
  ...over,
});

describe('sanitizeContextEnvelope', () => {
  test('accepts a valid envelope', () => {
    const e = sanitizeContextEnvelope(ENV());
    assert.ok(e);
    assert.equal(e.category, 'coding_problem');
    assert.equal(e.meta.platform, 'LeetCode');
  });

  test('rejects wrong version', () => {
    assert.equal(sanitizeContextEnvelope(ENV({ envelopeVersion: 2 })), undefined);
  });

  test('rejects wrong source', () => {
    assert.equal(sanitizeContextEnvelope(ENV({ source: 'evil' })), undefined);
  });

  test('rejects invalid category', () => {
    assert.equal(sanitizeContextEnvelope(ENV({ category: 'rm -rf' })), undefined);
  });

  test('rejects non-object', () => {
    assert.equal(sanitizeContextEnvelope(null), undefined);
    assert.equal(sanitizeContextEnvelope('nope'), undefined);
  });

  test('caps oversize payload string fields', () => {
    const e = sanitizeContextEnvelope(ENV({ payload: { visibleCode: 'x'.repeat(20000) } }));
    assert.ok(e.payload.visibleCode.length <= 8000);
  });

  test('drops a payload that blows the total budget but keeps the envelope', () => {
    const huge = {};
    for (let i = 0; i < 1000; i++) huge['k' + i] = 'y'.repeat(7000);
    const e = sanitizeContextEnvelope(ENV({ payload: huge }));
    assert.ok(e);
    assert.deepEqual(e.payload, {});
  });

  test('unknown extractionSource falls back to innerText', () => {
    const e = sanitizeContextEnvelope(ENV({ meta: { ...ENV().meta, extractionSource: 'hacker' } }));
    assert.equal(e.meta.extractionSource, 'innerText');
  });

  test('preserves the partial flag + missing list', () => {
    const e = sanitizeContextEnvelope(ENV({ meta: { ...ENV().meta, partial: true, missing: ['problem statement', 'visible code'] } }));
    assert.equal(e.meta.partial, true);
    assert.deepEqual(e.meta.missing, ['problem statement', 'visible code']);
  });

  test('drops a non-boolean partial and non-array missing', () => {
    const e = sanitizeContextEnvelope(ENV({ meta: { ...ENV().meta, partial: 'yes', missing: 'oops' } }));
    assert.equal(e.meta.partial, undefined);
    assert.equal(e.meta.missing, undefined);
  });
});

describe('formatEnvelopeForPrompt', () => {
  test('coding problem → BROWSER_CONTEXT_KIND block with sections', () => {
    const s = formatEnvelopeForPrompt(ENV());
    assert.match(s, /BROWSER_CONTEXT_KIND: coding_problem/);
    assert.match(s, /PLATFORM: LeetCode/);
    assert.match(s, /CONFIDENCE: high/);
    assert.match(s, /PROBLEM_TITLE:/);
    assert.match(s, /VISIBLE_CODE:/);
    assert.match(s, /Preserve the exact starter code/);
  });

  test('non-coding category → empty (legacy plain string only)', () => {
    assert.equal(formatEnvelopeForPrompt(ENV({ category: 'article' })), '');
    assert.equal(formatEnvelopeForPrompt(ENV({ category: 'google_docs_visible' })), '');
  });

  test('null/undefined → empty', () => {
    assert.equal(formatEnvelopeForPrompt(null), '');
    assert.equal(formatEnvelopeForPrompt(undefined), '');
  });

  test('omits empty sections', () => {
    const s = formatEnvelopeForPrompt(ENV({ payload: { problemTitle: 'P' } }));
    assert.ok(!s.includes('CONSTRAINTS:'));
    assert.match(s, /PROBLEM_TITLE:/);
  });
});

describe('telemetry — privacy-safe', () => {
  test('charCountBucket coarsens sizes', () => {
    assert.equal(charCountBucket(0), '0');
    assert.equal(charCountBucket(300), '<500');
    assert.equal(charCountBucket(1500), '500-2k');
    assert.equal(charCountBucket(9000), '8k-25k');
    assert.equal(charCountBucket(99999), '25k+');
  });

  test('event contains ONLY allowlisted fields — no raw content', () => {
    const ev = buildCaptureTelemetry({
      category: 'coding_problem',
      platform: 'LeetCode',
      confidence: 'high',
      captureMode: 'auto',
      success: true,
      charCount: 1234,
      usedInAnswer: true,
    });
    const allowed = new Set([
      'event', 'category', 'platform', 'confidenceBucket', 'captureMode',
      'success', 'charCountBucket', 'usedInAnswer', 'errorCode',
    ]);
    for (const k of Object.keys(ev)) assert.ok(allowed.has(k), `unexpected telemetry field: ${k}`);
    // exact char count must NOT appear
    assert.ok(!('charCount' in ev));
    assert.equal(ev.charCountBucket, '500-2k');
  });

  test('rejects a URL/title smuggled as platform', () => {
    const ev = buildCaptureTelemetry({ platform: 'https://leetcode.com/problems/two-sum?token=SECRET', success: true });
    assert.equal(ev.platform, undefined); // not a simple label → dropped
  });

  test('errorCode is capped, success defaults false', () => {
    const ev = buildCaptureTelemetry({ success: false, errorCode: 'x'.repeat(200) });
    assert.equal(ev.success, false);
    assert.ok(ev.errorCode.length <= 64);
  });
});
