// scripts/__tests__/sd-grounding-harness.test.mjs
//
// Unit tests for SD quality-harness helpers (skip gate, splits, assertions,
// checkpoint resume). No Electron / network.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../lib/sd-grounding-harness.js');

describe('sd-grounding-harness skip gate', () => {
  test('shouldRunRealApi is false when opt-in flags are absent', () => {
    assert.equal(H.shouldRunRealApi({ GEMINI_API_KEY: 'secret', NATIVELY_API_KEY: 'secret' }), false);
  });

  test('shouldRunRealApi is false when opted in but no keys', () => {
    assert.equal(H.shouldRunRealApi({ RUN_SD_GROUNDING_E2E: '1' }), false);
    assert.equal(H.shouldRunRealApi({ RUN_SD_REQUIREMENTS_GATE_E2E: '1' }), false);
    assert.equal(H.shouldRunRealApi({ RUN_NATIVELY_API_E2E: '1' }), false);
  });

  test('shouldRunRealApi is false when keys are blank', () => {
    assert.equal(
      H.shouldRunRealApi({ RUN_SD_GROUNDING_E2E: '1', GEMINI_API_KEY: '  ', NATIVELY_API_KEY: '  ' }),
      false,
    );
  });

  test('shouldRunRealApi is true with RUN_SD_GROUNDING_E2E + GEMINI_API_KEY', () => {
    assert.equal(H.shouldRunRealApi({ RUN_SD_GROUNDING_E2E: '1', GEMINI_API_KEY: 'g-test' }), true);
  });

  test('shouldRunRealApi is true with RUN_SD_REQUIREMENTS_GATE_E2E + GEMINI_API_KEY', () => {
    assert.equal(
      H.shouldRunRealApi({ RUN_SD_REQUIREMENTS_GATE_E2E: '1', GEMINI_API_KEY: 'g-test' }),
      true,
    );
  });

  test('shouldRunRealApi is true with RUN_NATIVELY_API_E2E + NATIVELY_API_KEY', () => {
    assert.equal(H.shouldRunRealApi({ RUN_NATIVELY_API_E2E: '1', NATIVELY_API_KEY: 'sk-test' }), true);
  });

  test('resolveGeminiApiKey prefers GEMINI_API_KEY over GOOGLE_API_KEY', () => {
    assert.equal(
      H.resolveGeminiApiKey({ GEMINI_API_KEY: 'g1', GOOGLE_API_KEY: 'g2' }),
      'g1',
    );
    assert.equal(H.resolveGeminiApiKey({ GOOGLE_API_KEY: 'g2' }), 'g2');
    assert.equal(H.resolveGeminiApiKey({}), '');
  });
});

describe('sd-grounding-harness model + split', () => {
  test('resolveBenchmarkModel defaults to gemini-3.1-flash-lite', () => {
    assert.equal(H.resolveBenchmarkModel({}), 'gemini-3.1-flash-lite');
  });

  test('resolveBenchmarkModel honors BENCHMARK_MODEL', () => {
    assert.equal(H.resolveBenchmarkModel({ BENCHMARK_MODEL: 'gemini-3.5-flash' }), 'gemini-3.5-flash');
  });

  test('resolveSplit defaults to development', () => {
    assert.equal(H.resolveSplit({}), 'development');
  });

  test('resolveSplit accepts full', () => {
    assert.equal(H.resolveSplit({ SD_BENCHMARK_SPLIT: 'full' }), 'full');
  });

  test('development split covers the five required topics', () => {
    const qs = H.selectQuestions('development');
    assert.ok(qs.length >= 5 && qs.length <= 10);
    const ids = new Set(qs.map((q) => q.id));
    for (const id of ['url-shortener', 'twitter-feed', 'rate-limiter', 'youtube', 'distributed-cache']) {
      assert.ok(ids.has(id), `missing ${id}`);
    }
  });

  test('full split has 20+ questions and includes development', () => {
    const full = H.selectQuestions('full');
    const dev = H.selectQuestions('development');
    assert.ok(full.length >= 20, `expected >=20, got ${full.length}`);
    for (const q of dev) {
      assert.ok(full.some((f) => f.id === q.id), `full missing development id ${q.id}`);
    }
  });
});

describe('sd-grounding-harness assertions', () => {
  const q = H.selectQuestions('development').find((x) => x.id === 'url-shortener');

  test('assertAnswer fails empty text', () => {
    const r = H.assertAnswer(q, '');
    assert.equal(r.ok, false);
    assert.ok(r.misses.length >= 3);
  });

  test('assertAnswer requires framework headers and a tech claim', () => {
    const good = [
      '## Requirements',
      'We need unique short codes and low-latency redirects.',
      '## High-Level Design',
      'API tier in front of Redis cache and a URL store.',
      '## Deep Dives',
      'Hot keys live in Redis; cold paths hit the DB.',
    ].join('\n');
    const r = H.assertAnswer(q, good);
    assert.equal(r.ok, true, r.misses.join(';'));
    assert.ok(r.matchedTech.some((t) => /redis/i.test(t)));
  });

  test('assertAnswer accepts header-free section labels', () => {
    const spoken = [
      'Requirements: unique codes, <100ms redirect.',
      'High-Level Design: write path to DB, read path through CDN.',
      'Deep Dives: Base62 encoding for the short code.',
    ].join('\n');
    const r = H.assertAnswer(q, spoken);
    assert.equal(r.ok, true, r.misses.join(';'));
  });

  test('assertAnswer fails when tech claim is missing', () => {
    const noTech = [
      '## Requirements',
      'Shorten URLs.',
      '## High-Level Design',
      'Some services.',
      '## Deep Dives',
      'Scaling later.',
    ].join('\n');
    const r = H.assertAnswer(q, noTech);
    assert.equal(r.ok, false);
    assert.ok(r.misses.some((m) => m.startsWith('TECH:')));
  });
});

describe('sd-grounding-harness checkpoint', () => {
  test('loadCheckpoint returns empty when file missing', () => {
    const p = path.join(os.tmpdir(), `sd-ckpt-missing-${Date.now()}.json`);
    assert.deepEqual(H.loadCheckpoint(p), { completedIds: [] });
  });

  test('markQuestionComplete persists and filterPendingQuestions resumes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-ckpt-'));
    const file = path.join(dir, 'checkpoint.json');
    const qs = H.selectQuestions('development');
    H.markQuestionComplete(file, qs[0].id);
    H.markQuestionComplete(file, qs[1].id);
    const loaded = H.loadCheckpoint(file);
    assert.deepEqual(loaded.completedIds.sort(), [qs[0].id, qs[1].id].sort());
    const pending = H.filterPendingQuestions(qs, loaded);
    assert.equal(pending.length, qs.length - 2);
    assert.ok(!pending.some((q) => q.id === qs[0].id));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('summarizeResults computes pass/fail and latency stats', () => {
    const s = H.summarizeResults([
      { ok: true, latencyMs: 100 },
      { ok: false, latencyMs: 200 },
      { ok: true, latencyMs: 300 },
    ]);
    assert.equal(s.pass, 2);
    assert.equal(s.fail, 1);
    assert.equal(s.total, 3);
    assert.equal(s.medianMs, 200);
  });
});
