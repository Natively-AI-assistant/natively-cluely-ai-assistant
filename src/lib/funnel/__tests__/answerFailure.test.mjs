// Why an answer failed, as the one word the funnel records, and the note a
// running meeting leaves on disk.
//
// The control that matters: the overlay can learn a new failure cause, or main
// a new reason code, without anyone touching the funnel. The server refuses an
// event whose cause it does not know and the app then drops it, so the new
// cause would be the one failure nobody can count. These tests fail first.
//
// Run: node --experimental-strip-types --test src/lib/funnel/__tests__/answerFailure.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { answerFailureCause, looksLikeUserStop } from '../answerFailure.mjs';
import { ANSWER_FAILURE_CAUSES, FUNNEL_CATALOG, checkFunnelProps } from '../funnelCatalog.mjs';
import { DIRECT_ASSIST_CAUSES, directAssistFailureCause } from '../../directAssistFailure.mjs';
import { chatFailureFromError } from '../../chatFailure.mjs';
import { normalizeOpenMeeting, cutOffMeeting } from '../funnelState.mjs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const inCatalogue = (cause) => ANSWER_FAILURE_CAUSES.includes(cause);

test('the catalogue carries the cause list on the event', () => {
  assert.equal(FUNNEL_CATALOG.answer_failed.cause, ANSWER_FAILURE_CAUSES);
  assert.deepEqual(checkFunnelProps('answer_failed', { cause: 'auth', ai: 'own', in_meeting: true }),
    { ok: true, props: { cause: 'auth', ai: 'own', in_meeting: true } });
  assert.equal(checkFunnelProps('answer_failed', { cause: 'the provider said no' }).ok, false);
  assert.equal(checkFunnelProps('answer_failed', { cause: 'auth', detail: 'x' }).ok, false, 'nowhere for a sentence to go');
});

test('every cause the overlay can word has a word in the catalogue', () => {
  assert.ok(DIRECT_ASSIST_CAUSES.length >= 16);
  // One failure per cause, built the way causeOf sorts them.
  const samples = {
    auth: { code: 'AUTH_FAILED' }, credits: { code: 'QUOTA_EXHAUSTED' }, model: { code: 'MODEL_UNAVAILABLE' },
    setup: { code: 'NO_PROVIDER_CONFIGURED' }, rate: { code: 'RATE_LIMITED' }, idle: { code: 'STREAM_IDLE_TIMEOUT' },
    timeout: { code: 'CONNECT_TIMEOUT', waitedMs: 0 }, waited: { code: 'CONNECT_TIMEOUT', waitedMs: 8000 },
    empty: { code: 'INCOMPLETE_STREAM' }, brokeOff: { code: 'INCOMPLETE_STREAM', partial: true },
    unreachable: { code: 'PROVIDER_ERROR', unreachable: true }, tooLarge: { code: 'PROVIDER_ERROR', status: 413 },
    rejected: { code: 'PROVIDER_ERROR', status: 400 }, overloaded: { code: 'PROVIDER_ERROR', status: 503 },
    server: { code: 'PROVIDER_ERROR', status: 500 }, failed: { code: 'PROVIDER_ERROR' },
  };
  for (const cause of DIRECT_ASSIST_CAUSES) {
    assert.ok(samples[cause], `no sample failure for the cause "${cause}": add one here, and its word to ANSWER_FAILURE_CAUSES`);
    assert.equal(directAssistFailureCause(samples[cause]), cause, `the sample for "${cause}" is sorted as something else`);
    const word = answerFailureCause(samples[cause]);
    assert.ok(inCatalogue(word), `cause "${cause}" becomes "${word}", which the catalogue does not hold`);
  }
  assert.equal(answerFailureCause(samples.brokeOff), 'broke_off');
  assert.equal(answerFailureCause(samples.tooLarge), 'too_large');
  assert.equal(answerFailureCause(samples.waited), 'timeout', 'how long it waited is not a different cause');
});

test('every reason code main can send is a word in the catalogue, or deliberately not a failure', () => {
  const src = read('../../../../electron/direct-assist/types.ts');
  const block = src.slice(src.indexOf('export const DIRECT_ASSIST_ERROR_CODES = ['));
  const codes = [...block.slice(0, block.indexOf('] as const')).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(codes.length >= 16 && codes.includes('AUTH_FAILED') && codes.includes('CANCELLED'), 'the code list was read');
  const notFailures = [];
  for (const code of codes) {
    const word = answerFailureCause({ code });
    if (word === null) notFailures.push(code);
    else assert.ok(inCatalogue(word), `${code} becomes "${word}", which the catalogue does not hold`);
  }
  assert.deepEqual(notFailures, ['CANCELLED'], 'only the user stopping it is not a failure');
  assert.equal(answerFailureCause({ code: 'NO_PROVIDER_CONFIGURED' }), 'setup');
  assert.equal(answerFailureCause({ code: 'SCREENSHOT_BLOCKED_BY_PRIVACY' }), 'not_sent');
  assert.equal(answerFailureCause({ code: 'MODEL_DOES_NOT_SUPPORT_IMAGES' }), 'not_sent');
  assert.equal(answerFailureCause({ code: 'CONTEXT_TOO_LARGE' }), 'too_large');
});

test("the overlay's other answer paths: a raw error becomes a word, never its text", () => {
  const cases = [
    ['Natively API HTTP 403 requestId=nat_json_0d7b endpoint=https://api.natively.software/v1/chat: trial_expired', 'trial_ended'],
    ['Error: 401 Incorrect API key provided: sk-abc123. You can find your API key at https://platform.openai.com', 'auth'],
    ['429 Too Many Requests', 'rate'],
    ['Error: fetch failed: connect ECONNREFUSED 127.0.0.1:11434', 'unreachable'],
    ['something nobody has seen before', 'failed'],
  ];
  for (const [raw, expected] of cases) {
    const failure = chatFailureFromError(raw, { provider: 'OpenAI' });
    const word = answerFailureCause(failure);
    assert.ok(inCatalogue(word), `"${raw.slice(0, 30)}…" became "${word}"`);
    assert.equal(word, expected, raw.slice(0, 40));
  }
  for (const code of ['TRIAL_ENDED', 'PLAN_LIMIT', 'PLAN_EXPIRED', 'INTERNAL_ERROR', 'CHAT_ERROR']) {
    assert.ok(inCatalogue(answerFailureCause({ code })), code);
  }
});

test('a stopped or cut-short answer is not a failed one', () => {
  for (const code of ['CANCELLED', 'OUTPUT_LIMIT', 'OUTPUT_REPETITION']) assert.equal(answerFailureCause({ code, partial: true }), null);
  for (const nothing of [null, undefined, {}, { code: '' }, { code: 42 }]) assert.equal(answerFailureCause(nothing), null);
});

test('a raw error that is the user stopping the request is not reported', () => {
  const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  for (const raw of [abort, 'AbortError: The operation was aborted', 'Request cancelled', 'Error: aborted', 'The user aborted a request.',
    'canceled', 'Request was cancelled by a newer request', 'superseded']) {
    assert.equal(looksLikeUserStop(raw), true, String(raw?.message ?? raw));
  }
  // Real failures that must still be counted, including ones that only resemble a stop.
  for (const raw of ['401 Incorrect API key provided', '429 Too Many Requests', 'fetch failed: connect ECONNREFUSED 127.0.0.1:11434',
    'Your subscription was not found', 'The model produced no answer in time', new Error('socket hang up'), null, undefined, {}, 42]) {
    assert.equal(looksLikeUserStop(raw), false, String(raw?.message ?? raw));
  }
  const src = read('../../analytics/analytics.service.ts');
  const fn = src.slice(src.indexOf('export function reportAnswerFailed'), src.indexOf('function reportFeatureUsed'));
  assert.ok(fn.indexOf('looksLikeUserStop(raw)) return;') !== -1 && fn.indexOf('looksLikeUserStop(raw)) return;') < fn.indexOf('funnelTrack'), 'checked before anything is sent');
});

test('the analytics helper reports the cause and nothing else', () => {
  const src = read('../../analytics/analytics.service.ts');
  const fn = src.slice(src.indexOf('export function reportAnswerFailed'), src.indexOf('function reportFeatureUsed'));
  assert.match(fn, /funnelTrack\?\.\('answer_failed', \{ cause \}\)/);
  // "chat was used" is a typed question, not a session starting.
  const at = src.indexOf('public trackConversationStarted');
  const started = src.slice(at, src.indexOf('\n    public ', at + 10));
  assert.ok(started.length > 60 && started.length < 600, 'the method body was found');
  assert.doesNotMatch(started, /reportFeatureUsed/);
  assert.match(src, /public trackChatQuestionSent\(\): void \{\s*reportFeatureUsed\('chat'\);/);
  const ui = read('../../../components/NativelyInterface.tsx');
  assert.match(ui, /lastManualSubmitRef\.current = \{ text: userText, atMs: nowMs \};\s*analytics\.trackChatQuestionSent\(\);/);
  assert.match(ui, /const failure = chatFailureFromError\(raw, \{ provider: chatProviderLabelRef\.current \}\);\s*reportAnswerFailed\(failure, raw\);/);
  assert.match(ui, /failure: DirectAssistAnswerFailure,\s*\) => \{\s*reportAnswerFailed\(failure\);/);
});

// ── The note a running meeting leaves on disk ────────────────────────────────

test('a meeting note is read safely', () => {
  assert.equal(normalizeOpenMeeting(null), null);
  assert.equal(normalizeOpenMeeting([]), null);
  assert.equal(normalizeOpenMeeting({ startedAt: 'yesterday', boot: 'a' }), null);
  assert.equal(normalizeOpenMeeting({ startedAt: 1000 }), null, 'a note that does not say which launch wrote it is no note');
  assert.deepEqual(normalizeOpenMeeting({ startedAt: 1000, seenAt: 5000, first: true, boot: 'a', extra: 'x' }),
    { startedAt: 1000, seenAt: 5000, first: true, boot: 'a' });
  assert.deepEqual(normalizeOpenMeeting({ startedAt: 1000, seenAt: 10, boot: 'a' }),
    { startedAt: 1000, seenAt: 1000, first: false, boot: 'a' }, 'seen before it started: the start is all that is known');
});

test('a note from another launch is a meeting that was cut off; this launch\'s own is not', () => {
  const note = { startedAt: 1_000_000, seenAt: 1_000_000 + 12.9 * 60_000, first: true, boot: 'earlier' };
  assert.deepEqual(cutOffMeeting(note, 'now'), { minutes: 12, first: true });
  assert.equal(cutOffMeeting(note, 'earlier'), null, 'still running in this launch');
  assert.equal(cutOffMeeting(null, 'now'), null);
  // Measured to when the app was last up, never to now.
  assert.deepEqual(cutOffMeeting({ ...note, seenAt: note.startedAt }, 'now'), { minutes: 0, first: true });
  assert.deepEqual(checkFunnelProps('meeting_cut_off', cutOffMeeting(note, 'now')), { ok: true, props: { minutes: 12, first: true } });
});
