// A Natively plan or trial limit is not "no provider configured" (2026-11-03).
//
// A trial whose AI allowance ran out was refused by the Natively API, fell
// through the rest of the chain (a trial has nothing else) and failed with
// "No AI provider configured. Please add at least one API key in Settings.".
// The overlay counted that as a rejected key and What to Answer told the user
// to check their API keys. LLMHelper pulls in native modules that do not load
// outside Electron, so its half is checked in source; the classifier and the
// event bus run compiled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');
const wta = readFileSync(path.resolve(__dirname, '../WhatToAnswerLLM.ts'), 'utf8');
const dist = (p) => path.resolve(process.cwd(), 'dist-electron/electron', p);
const { providerFailureUserMessage, accountOrSetupUserMessage } = require(dist('llm/providerErrorClassifier.js'));
const { onNativelyPlanLimit, emitNativelyPlanLimit, nativelyLimitErrorMessage } = require(dist('llm/nativelyPlanLimitEvents.js'));
const { chatFailureFromError } = await import(path.resolve(__dirname, '../../../src/lib/chatFailure.mjs'));
const { answerFailureCause } = await import(path.resolve(__dirname, '../../../src/lib/funnel/answerFailure.mjs'));

const sliceOf = (start, len = 4000) => {
  const at = src.indexOf(start);
  assert.ok(at > 0, `missing: ${start}`);
  return src.slice(at, at + len);
};

test('the streamed answer that nothing could give fails with the Natively limit while it holds', () => {
  const inner = src.slice(src.indexOf('private async * _streamChatInner('), src.indexOf('private async * streamWithNatively('));
  assert.ok(inner.length > 1000, 'found _streamChatInner');
  assert.ok(inner.includes('throw this.exhaustedChainError();'), 'the last line of the chain');
  assert.ok(!inner.includes('throw new Error(this.noProviderAvailableMessage());'), 'not the bare no-provider sentence');
  const helper = sliceOf('private exhaustedChainError(): Error {', 400);
  assert.match(helper, /this\.nativelyLimit && this\.nativelyQuotaBlockedUntil > Date\.now\(\)/);
  assert.match(helper, /nativelyLimitErrorMessage\(this\.nativelyLimit\)/);
});

test('a plan-limit refusal is remembered with whether it was the trial, and announced', () => {
  const note = sliceOf('private noteNativelyPlanLimit(', 1600);
  assert.match(note, /onTrial = false\): boolean/);
  assert.match(note, /this\.nativelyLimit = \{/);
  assert.match(note, /emitNativelyPlanLimit\(this\.nativelyLimit\)/);
});

test('a new Natively key is a new allowance; clearing the key keeps the reason', () => {
  const set = sliceOf('public setNativelyKey(key: string | null): void {', 700);
  assert.match(set, /if \(key && key !== this\.nativelyKey\) \{ this\.nativelyQuotaBlockedUntil = 0; this\.nativelyLimit = null; \}/);
  assert.ok(set.indexOf('this.nativelyQuotaBlockedUntil = 0') < set.indexOf('this.nativelyKey = key || null'), 'compared with the old key, before it is replaced');
});

test('What to Answer says the account or setup line before testing for a provider failure', () => {
  const at = wta.indexOf('const ownLine = accountOrSetupUserMessage(error);');
  assert.ok(at > 0);
  assert.ok(at < wta.indexOf('const isProviderFailure ='), 'checked first');
  assert.ok(wta.indexOf('if (ownLine) {') < wta.indexOf('} else if (isProviderFailure) {'));
});

test('no account or setup failure is told to check its API keys', () => {
  for (const [raw, start] of [
    ['Natively API: trial ended, its AI allowance is used (ai_quota_exceeded)', 'Your free trial has ended.'],
    ['Natively API HTTP 429: ai_quota_exceeded (plan allowance exhausted)', "You've reached your Natively plan's limit."],
    ['Natively API HTTP 429 requestId=nat_stream_1: ai_quota_exceeded (plan allowance exhausted; next check 2026-11-03T12:11:00.000Z)', "You've reached your Natively plan's limit."],
    ['Natively API HTTP 403 requestId=x: subscription_expired', 'Your Natively plan has expired.'],
    ['No AI provider configured. Please add at least one API key in Settings.', 'No AI provider is set up yet.'],
  ]) {
    const err = new Error(raw);
    assert.ok(accountOrSetupUserMessage(err)?.startsWith(start), raw);
    const line = providerFailureUserMessage(err);
    assert.ok(line?.startsWith(start), `${raw} → ${line}`);
    assert.doesNotMatch(line, /api key/i, raw);
  }
});

test('a provider\'s own failures keep their lines', () => {
  assert.equal(accountOrSetupUserMessage(new Error('401 invalid api key')), null);
  assert.equal(accountOrSetupUserMessage(new Error('429 insufficient_quota: You exceeded your current quota')), null, 'OpenAI\'s quota is not Natively\'s plan');
  assert.equal(accountOrSetupUserMessage(undefined), null);
  assert.match(providerFailureUserMessage(Object.assign(new Error('Invalid API key'), { status: 401 })), /API key/);
});

test('the plan-limit bus delivers to every listener and survives one that throws', () => {
  const heard = [];
  const offBad = onNativelyPlanLimit(() => { throw new Error('boom'); });
  const offGood = onNativelyPlanLimit((l) => heard.push(l));
  assert.doesNotThrow(() => emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: true }));
  assert.deepEqual(heard, [{ code: 'ai_quota_exceeded', onTrial: true }]);
  offBad(); offGood();
  emitNativelyPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  assert.equal(heard.length, 1, 'removed listeners hear nothing');
});

test('the limit error is counted as the trial ending or the plan limit, never as a rejected key', () => {
  const trial = chatFailureFromError(nativelyLimitErrorMessage({ onTrial: true, code: 'ai_quota_exceeded' }), { provider: 'Natively' });
  assert.equal(trial.code, 'TRIAL_ENDED');
  assert.equal(answerFailureCause(trial), 'trial_ended');
  const plan = chatFailureFromError(nativelyLimitErrorMessage({ onTrial: false, code: 'ai_quota_exceeded' }), { provider: 'Natively' });
  assert.equal(plan.code, 'PLAN_LIMIT');
  assert.equal(answerFailureCause(plan), 'plan_limit');
});

test('the limit error never carries anything but a snake_case code', () => {
  const m = nativelyLimitErrorMessage({ onTrial: false, code: 'x"; rm -rf /' });
  assert.match(m, /\(plan allowance exhausted\)$/);
  assert.ok(m.includes('ai_quota_exceeded'));
  assert.ok(!m.includes('rm -rf'));
});

test('LLMHelper imports nothing from src/lib (plain tsc test trees carry no .mjs)', () => {
  assert.doesNotMatch(src, /from '\.\.\/src\/lib\//);
});
