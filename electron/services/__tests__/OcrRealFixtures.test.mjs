// LEGACY OCR PATH — TESTS SKIPPED (2026-05-17)
// =====================================================================
// This integration test exercises Tesseract.js directly through
// OcrProviderManager. OCR has been removed from Natively's runtime
// default in the vision-first pivot. The test is kept on disk so that
// if a future opt-in legacy OCR mode is reintroduced, the contract
// for Tesseract.js can be re-validated without rewriting from scratch.
// Until then it must not run.
// =====================================================================
// Set NATIVELY_RUN_LEGACY_OCR_TESTS=1 to opt in.

import { test as _test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LEGACY_OCR_ENABLED = process.env.NATIVELY_RUN_LEGACY_OCR_TESTS === '1';
const test = (name, opts, fn) => {
  if (typeof opts === 'function') return _test(name, { skip: LEGACY_OCR_ENABLED ? undefined : 'legacy OCR path disabled — set NATIVELY_RUN_LEGACY_OCR_TESTS=1 to run' }, opts);
  return _test(name, { ...(opts || {}), skip: LEGACY_OCR_ENABLED ? undefined : 'legacy OCR path disabled — set NATIVELY_RUN_LEGACY_OCR_TESTS=1 to run' }, fn);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');
const fixturesDir = path.join(root, 'tests/fixtures/screen');

const SKIP_REAL_OCR = process.env.RUN_REAL_OCR === '0';

async function loadOcrManager() {
  const mod = await import(pathToFileURL(path.join(screenDir, 'OcrProviderManager.js')).href);
  return mod.OcrProviderManager;
}

async function ensureFixtures() {
  const generator = await import(
    pathToFileURL(path.join(fixturesDir, 'generateOcrFixtures.mjs')).href
  );
  return generator.ensureFixtures(fixturesDir);
}

async function recognise(imagePath, options = {}) {
  const OcrProviderManager = await loadOcrManager();
  const manager = new OcrProviderManager();
  return manager.recognize(imagePath, { timeoutMs: 30_000, maxDimension: 1600, ...options });
}

test('OcrProviderManager extracts simple sentences from a fixture', { skip: SKIP_REAL_OCR }, async () => {
  const [simplePath] = await ensureFixtures();
  assert.ok(fs.existsSync(simplePath), `fixture missing: ${simplePath}`);

  const result = await recognise(simplePath);
  const text = (result.text || '').toLowerCase();

  assert.match(text, /hello/i, `expected "hello" in OCR text. Got: ${result.text}`);
  assert.match(text, /natively/i, `expected "natively" in OCR text. Got: ${result.text}`);

  assert.ok(typeof result.confidence === 'number', 'confidence should be a number');
  assert.ok(result.confidence >= 0 && result.confidence <= 1, 'confidence should be 0..1');
  assert.ok(typeof result.durationMs === 'number' && result.durationMs >= 0);
  assert.ok(typeof result.provider === 'string' && result.provider.length > 0);
});

test('OcrProviderManager recognises a code-problem screenshot', { skip: SKIP_REAL_OCR }, async () => {
  await ensureFixtures();
  const fixturePath = path.join(fixturesDir, 'ocr_code_problem.png');

  const result = await recognise(fixturePath);
  const text = (result.text || '').toLowerCase();

  // Tesseract on synthetic monospace can mangle underscores, so accept a fuzzy match.
  assert.ok(
    /two[_\s\-]?sum/.test(text),
    `expected "two_sum" (loose match) in OCR text. Got: ${result.text}`
  );
  assert.match(text, /return/i, `expected "return" in OCR text. Got: ${result.text}`);
});

test('OcrProviderManager recognises an error-log screenshot', { skip: SKIP_REAL_OCR }, async () => {
  await ensureFixtures();
  const fixturePath = path.join(fixturesDir, 'ocr_error_log.png');

  const result = await recognise(fixturePath);
  const text = (result.text || '').toLowerCase();

  assert.match(text, /typeerror/i);
  // "undefined" is reliably recognised across fonts; the rest can drift.
  assert.match(text, /undefined/i);
});

test('OcrProviderManager recognises a table-style screenshot', { skip: SKIP_REAL_OCR }, async () => {
  await ensureFixtures();
  const fixturePath = path.join(fixturesDir, 'ocr_table.png');

  const result = await recognise(fixturePath);
  const text = (result.text || '').toLowerCase();

  assert.match(text, /plan/i);
  assert.match(text, /price/i);
});

test('OcrProviderManager rejects with a clear error when the timeout is impossibly small', {
  skip: SKIP_REAL_OCR,
}, async () => {
  await ensureFixtures();
  const fixturePath = path.join(fixturesDir, 'ocr_simple_text.png');

  await assert.rejects(
    () => recognise(fixturePath, { timeoutMs: 1 }),
    /(timeout|All OCR providers failed)/i,
    'should reject on timeout, not silently return empty'
  );
});

test('OcrProviderManager errors cleanly on an invalid image file', { skip: SKIP_REAL_OCR }, async () => {
  const bogusPath = path.join(fixturesDir, '.does-not-exist.png');
  // Make sure the negative fixture is absent before the test.
  try {
    fs.unlinkSync(bogusPath);
  } catch {
    // best-effort
  }

  await assert.rejects(
    () => recognise(bogusPath),
    /(failed|not found|All OCR providers failed)/i
  );
});
