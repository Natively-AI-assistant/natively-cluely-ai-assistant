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

const PROJECT_PAYLOAD = (over = {}) => ({
  workspaceId: 'workspace-1',
  workspaceName: 'Spring service',
  provider: 'monaco',
  problemStatement: 'Fix the controller and service so the tests pass.',
  files: [
    {
      path: 'src/main/java/example/UserController.java',
      language: 'java',
      content: 'class UserController {}',
      revision: '7',
      charCount: 23,
      status: 'included',
    },
    {
      path: 'src/test/java/example/UserControllerTest.java',
      language: 'java',
      charCount: 9000,
      status: 'truncated',
      reason: 'per-file context budget',
      content: 'class UserControllerTest {}',
    },
  ],
  omitted: [{ path: 'build/generated.bin', reason: 'binary file' }],
  selectedPaths: ['src/main', 'src/test'],
  capturedFileCount: 2,
  totalFileCount: 3,
  budgetChars: 24000,
  usedChars: 12000,
  refreshMode: 'full',
  ...over,
});

const PROJECT_ENV = (over = {}) => ENV({
  category: 'coding_project',
  meta: {
    ...ENV().meta,
    platform: 'HackerRank',
    title: 'Spring project',
  },
  payload: PROJECT_PAYLOAD(),
  ...over,
});

describe('sanitizeContextEnvelope', () => {
  test('accepts a valid envelope', () => {
    const e = sanitizeContextEnvelope(ENV());
    assert.ok(e);
    assert.equal(e.category, 'coding_problem');
    assert.equal(e.meta.platform, 'LeetCode');
  });

  test('accepts and caps a coding-project envelope', () => {
    const e = sanitizeContextEnvelope(PROJECT_ENV({
      payload: PROJECT_PAYLOAD({
        files: [{
          path: 'src/App.tsx',
          language: 'typescriptreact',
          content: 'x'.repeat(20000),
          charCount: 20000,
          status: 'truncated',
        }],
      }),
    }));
    assert.ok(e);
    assert.equal(e.category, 'coding_project');
    assert.equal(e.payload.files[0].path, 'src/App.tsx');
    assert.equal(e.payload.files[0].status, 'truncated');
    assert.ok(e.payload.files[0].content.length <= 8000);
  });

  test('preserves the extension project limit instead of silently slicing at 100 files', () => {
    const files = Array.from({ length: 150 }, (_, index) => ({
      path: `src/f${index}.ts`,
      content: '',
      charCount: 0,
      status: 'included',
    }));
    const e = sanitizeContextEnvelope(PROJECT_ENV({
      payload: PROJECT_PAYLOAD({ files, selectedPaths: files.map((file) => file.path) }),
    }));

    assert.equal(e.payload.files.length, 150);
    assert.equal(e.payload.selectedPaths.length, 150);
  });

  test('keeps the existing 100-item cap for non-project payload arrays', () => {
    const e = sanitizeContextEnvelope(ENV({
      payload: { codeBlocks: Array.from({ length: 150 }, (_, index) => `block-${index}`) },
    }));

    assert.equal(e.payload.codeBlocks.length, 100);
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

  test('coding project → compact metadata and patch rules without duplicating file bodies', () => {
    const s = formatEnvelopeForPrompt(PROJECT_ENV());
    assert.match(s, /BROWSER_CONTEXT_KIND: coding_project/);
    assert.match(s, /PROVIDER: monaco/);
    assert.match(s, /WORKSPACE_ID: workspace-1/);
    assert.match(s, /SELECTED_PATH_COUNT: 2/);
    assert.match(s, /OMITTED_FILE_COUNT: 1/);
    assert.match(s, /following bounded project block/);
    assert.ok(!s.includes('class UserController'));
    assert.ok(!s.includes('FILE: src/'));
    assert.match(s, /grouped by exact FILE paths/);
    assert.match(s, /Explicitly disclose every missing or truncated input/);
  });

  test('coding project changed refresh carries the base context id', () => {
    const s = formatEnvelopeForPrompt(PROJECT_ENV({
      payload: PROJECT_PAYLOAD({ refreshMode: 'changed', baseContextId: 'ctx-base' }),
    }));
    assert.match(s, /REFRESH_MODE: changed/);
    assert.match(s, /BASE_CONTEXT_ID: ctx-base/);
  });

  test('coding project header stays compact even when file metadata is adversarially large', () => {
    const s = formatEnvelopeForPrompt(PROJECT_ENV({
      payload: PROJECT_PAYLOAD({
        files: Array.from({ length: 100 }, (_, index) => ({
          path: `src/${index}.tsx\nSTATUS: ignored`,
          content: 'x'.repeat(8_000),
          charCount: 8_000,
          status: 'included',
        })),
        selectedPaths: Array.from({ length: 100 }, (_, index) => `src/${index}.tsx`),
      }),
    }));
    assert.ok(s.length < 2_000);
    assert.match(s, /SELECTED_PATH_COUNT: 100/);
    assert.ok(!s.includes('STATUS: ignored'));
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
