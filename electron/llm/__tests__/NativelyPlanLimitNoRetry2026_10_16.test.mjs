/**
 * LLMHelper — a Natively 429 whose body names a plan limit (ai_quota_exceeded,
 * *_plan_limit, …) is the month's allowance, not a rate limit. It must not be
 * retried with 400/800/1600 ms backoff, and the helper must stop calling the
 * API locally until the server's Retry-After. Source-level checks: LLMHelper
 * pulls in native modules that do not load outside Electron.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');

test('withRetry throws plan-limit errors immediately instead of backing off', () => {
  const withRetry = src.slice(src.indexOf('private async withRetry<T>('), src.indexOf('private async withRetry<T>(') + 3000);
  const guard = withRetry.indexOf('PLAN_LIMIT_RE.test(msg)');
  const retryable = withRetry.indexOf('const isRetryable');
  assert.ok(guard > 0, 'withRetry must test PLAN_LIMIT_RE');
  assert.ok(guard < retryable, 'the plan-limit guard must run before the retryable classification');
});

test('both Natively call paths check the local block before any network call and record a plan-limit 429', () => {
  for (const tag of ["makeRequestId('nat_json')", "makeRequestId('nat_stream')"]) {
    const at = src.indexOf(tag);
    assert.ok(at > 0, tag);
    const next = src.slice(at, at + 200);
    assert.ok(/this\.assertNativelyNotBlocked\(requestId\)/.test(next), `${tag} must be followed by assertNativelyNotBlocked`);
  }
  assert.equal((src.match(/this\.noteNativelyPlanLimit\(response\.status, response\.headers, errData, nativelyKey === TRIAL_SENTINEL_KEY\)/g) || []).length, 2, 'JSON and stream HTTP-failure branches both record the limit');
});

test('the plan-limit pattern matches the server shapes and not a plain rate limit', () => {
  const m = /PLAN_LIMIT_RE = (\/.+\/);/.exec(src);
  assert.ok(m, 'PLAN_LIMIT_RE must be declared');
  const re = eval(m[1]);
  for (const s of ['ai_quota_exceeded', 'transcription_quota_exceeded', 'search_plan_limit', 'lifetime_exceeded', 'Natively API HTTP 429 requestId=x: ai_quota_exceeded (plan allowance exhausted; next check 2026-10-17T00:00:00.000Z)']) {
    assert.ok(re.test(s), s);
  }
  for (const s of ['rate_limit', 'too many requests', 'HTTP 429', 'quota exceeded for metric']) {
    assert.ok(!re.test(s), `must not match ${s}`);
  }
});

test('the local block is bounded so a plan upgrade is noticed', () => {
  const max = /NATIVELY_QUOTA_BLOCK_MAX_MS = ([\d_ *]+);/.exec(src);
  assert.ok(max);
  const ms = eval(max[1].replace(/_/g, ''));
  assert.ok(ms <= 12 * 60 * 60_000, 'at most 12 h between re-checks');
});
