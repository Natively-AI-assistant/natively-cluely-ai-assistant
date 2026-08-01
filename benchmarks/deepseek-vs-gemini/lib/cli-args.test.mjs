// benchmarks/deepseek-vs-gemini/lib/cli-args.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './cli-args.mjs';

describe('parseArgs', () => {
  test('defaults: no confirm, no dry-run, no sample cap, full concurrency', () => {
    const args = parseArgs([]);
    assert.equal(args.confirm, false);
    assert.equal(args.dryRun, false);
    assert.equal(args.sample, null);
    assert.equal(args.concurrency, 4);
  });

  test('--confirm sets confirm true', () => {
    assert.equal(parseArgs(['--confirm']).confirm, true);
  });

  test('--dry-run sets dryRun true', () => {
    assert.equal(parseArgs(['--dry-run']).dryRun, true);
  });

  test('--sample=5 caps sample to 5', () => {
    assert.equal(parseArgs(['--sample=5']).sample, 5);
  });

  test('--concurrency=8 overrides concurrency', () => {
    assert.equal(parseArgs(['--concurrency=8']).concurrency, 8);
  });

  test('--only=deepseek-v4-flash,gemini-3.6-flash restricts model list', () => {
    assert.deepEqual(parseArgs(['--only=deepseek-v4-flash,gemini-3.6-flash']).only, [
      'deepseek-v4-flash', 'gemini-3.6-flash',
    ]);
  });

  test('--only unset means null (all models)', () => {
    assert.equal(parseArgs([]).only, null);
  });
});
