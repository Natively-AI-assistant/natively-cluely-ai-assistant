import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TelemetryService,
  TelemetrySpan,
  sanitizeTelemetryProperties,
} from '../../../dist-electron/electron/services/telemetry/TelemetryService.js';
import { PiLatencyTrace } from '../../../dist-electron/electron/services/telemetry/PiLatencyTracer.js';

// A TelemetryService that captures every FINAL record (post-merge,
// post-sanitize) by intercepting the private appendLocal sink. This exercises
// the real track() path — debug-metadata merge + sanitizer — instead of
// re-implementing it, so the tests catch regressions in that pipeline.
function captureService() {
  const svc = new TelemetryService({ localEnabled: true });
  const events = [];
  svc.appendLocal = (record) => { events.push(record); };
  return { svc, events };
}

// ── Span helper ────────────────────────────────────────────────────────────

test('startSpan emits one event with a non-negative monotonic durationMs', () => {
  const { svc, events } = captureService();
  const span = svc.startSpan('context_build_completed', { sessionId: 's1' });
  const d = span.end({ layers: 3 });
  assert.equal(events.length, 1, 'exactly one event per span close');
  assert.equal(events[0].name, 'context_build_completed');
  assert.ok(typeof d === 'number' && d >= 0, 'duration is a non-negative number');
  assert.equal(events[0].durationMs, d, 'emitted durationMs matches return');
  assert.equal(events[0].properties.layers, 3);
});

test('span close is idempotent (second end is a no-op)', () => {
  const { svc, events } = captureService();
  const span = svc.startSpan('prompt_built');
  span.end();
  span.end();
  span.endWith('ok');
  assert.equal(events.length, 1, 'only the first close emits');
});

test('endWith records the status', () => {
  const { svc, events } = captureService();
  svc.startSpan('provider_request_started').endWith('timeout', { provider: 'natively' });
  assert.equal(events[0].status, 'timeout');
  assert.equal(events[0].properties.provider, 'natively');
});

test('elapsedMs does not close the span', () => {
  const { svc, events } = captureService();
  const span = svc.startSpan('intent_classified');
  assert.ok(span.elapsedMs() >= 0);
  assert.equal(events.length, 0, 'reading elapsed does not emit');
  span.end();
  assert.equal(events.length, 1);
});

test('TelemetrySpan is exported and constructible against a service', () => {
  const { svc, events } = captureService();
  const span = new TelemetrySpan(svc, 'first_useful_token', { sessionId: 'x' });
  span.end();
  assert.equal(events[0].name, 'first_useful_token');
  assert.equal(events[0].sessionId, 'x');
});

// ── Debug metadata merge ─────────────────────────────────────────────────────

test('debugMetadata is merged under properties.debug and can be cleared', () => {
  const { svc, events } = captureService();
  svc.setDebugMetadata({ answerType: 'coding_question_answer', provider: 'gemini' });
  svc.record('answer_type_selected', { isCoding: true });
  assert.equal(events[0].properties.debug.answerType, 'coding_question_answer');
  assert.equal(events[0].properties.debug.provider, 'gemini');
  assert.equal(events[0].properties.isCoding, true);

  svc.setDebugMetadata(null);
  svc.record('answer_type_selected', { isCoding: false });
  assert.equal(events[1].properties.debug, undefined, 'cleared debug metadata not attached');
});

test('per-event debug overrides win over global debug metadata', () => {
  const { svc, events } = captureService();
  svc.setDebugMetadata({ provider: 'natively' });
  svc.track({ name: 'provider_race_won', properties: { debug: { provider: 'groq' } } });
  assert.equal(events[0].properties.debug.provider, 'groq', 'event-level debug overrides global');
});

// ── Privacy: sanitizer must strip raw content even inside debug metadata ─────

test('sanitizer redacts api-key-like values inside debug metadata', () => {
  const { svc, events } = captureService();
  // `detail` is not a sensitive KEY, but its VALUE is api-key-like → redacted.
  svc.setDebugMetadata({ detail: 'Bearer abcdef0123456789ABCDEF' });
  svc.record('cost_estimated');
  assert.match(JSON.stringify(events[0].properties.debug), /\[REDACTED\]/);
});

test('sanitizer removes raw transcript/prompt/resume/persona/jd/negotiation content keys', () => {
  const clean = sanitizeTelemetryProperties({
    transcriptText: 'private interview transcript',
    prompt: 'full system prompt',
    rawResume: 'name address phone',
    resumeText: 'work history',
    personaText: 'tone preferences',
    jdText: 'job description body',
    negotiationScript: 'ask for 30% more',
    customNotes: 'salary floor 200k',
    latestQuestion: 'what is your name',
    tokenCount: 42,
    answerType: 'identity_answer',
    model: 'gemini-flash',
  });
  assert.equal(clean.transcriptText, '[REMOVED]');
  assert.equal(clean.prompt, '[REMOVED]');
  assert.equal(clean.rawResume, '[REMOVED]', 'rawResume must be stripped');
  assert.equal(clean.resumeText, '[REMOVED]');
  assert.equal(clean.personaText, '[REMOVED]');
  assert.equal(clean.jdText, '[REMOVED]');
  assert.equal(clean.negotiationScript, '[REMOVED]');
  assert.equal(clean.customNotes, '[REMOVED]');
  assert.equal(clean.latestQuestion, '[REMOVED]');
  assert.equal(clean.tokenCount, 42, 'metadata fields preserved');
  assert.equal(clean.answerType, 'identity_answer', 'answerType (ends in type) preserved');
  assert.equal(clean.model, 'gemini-flash');
});

test('sanitizer redacts apiKey-suffixed keys', () => {
  const clean = sanitizeTelemetryProperties({ nativelyApiKey: 'natively_sk_xxxxxxxxxxxx', model: 'gemini-flash' });
  assert.equal(clean.nativelyApiKey, '[REDACTED]');
  assert.equal(clean.model, 'gemini-flash');
});

// ── PiLatencyTrace ──────────────────────────────────────────────────────────

test('PiLatencyTrace.mark records elapsed and stores in snapshot', () => {
  const trace = new PiLatencyTrace({ source: 'what_to_answer' });
  trace.mark('what_to_answer_clicked');
  trace.mark('intent_classified', { intent: 'coding' });
  const snap = trace.snapshot();
  assert.ok('what_to_answer_clicked' in snap);
  assert.ok('intent_classified' in snap);
  assert.ok(snap.intent_classified >= snap.what_to_answer_clicked, 'milestones are monotonic');
});

test('PiLatencyTrace requestId is stable and unique-ish', () => {
  const a = new PiLatencyTrace({ source: 'manual' });
  const b = new PiLatencyTrace({ source: 'manual' });
  assert.ok(a.requestId.startsWith('pi_'));
  assert.notEqual(a.requestId, b.requestId);
});

test('markFirstUseful is idempotent and records only the first', () => {
  const trace = new PiLatencyTrace({ source: 'what_to_answer' });
  assert.equal(trace.hasFirstUseful(), false);
  assert.equal(trace.markFirstUseful(), true, 'first call returns true');
  assert.equal(trace.markFirstUseful(), false, 'subsequent calls return false');
  assert.equal(trace.hasFirstUseful(), true);
  assert.ok('first_useful_token' in trace.snapshot());
});

test('PiLatencyTrace.mark keeps the FIRST timing for a repeated milestone', () => {
  const trace = new PiLatencyTrace({ source: 'manual' });
  trace.mark('first_stream_chunk');
  const first = trace.snapshot().first_stream_chunk;
  // mark again later — value must not change
  trace.mark('first_stream_chunk');
  assert.equal(trace.snapshot().first_stream_chunk, first, 'idempotent milestone keeps first value');
});

test('PiLatencyTrace accepts a sessionId and source', () => {
  const trace = new PiLatencyTrace({ source: 'what_to_answer', sessionId: 'sess-1' });
  // mark should not throw with metadata
  assert.doesNotThrow(() => trace.mark('transcript_window_loaded', { turns: 5 }));
});

test('disabled telemetry service writes no record', () => {
  const svc = new TelemetryService({ enabled: false, localEnabled: true });
  const records = [];
  svc.appendLocal = (r) => { records.push(r); };
  svc.startSpan('prompt_built').end();
  svc.record('cost_estimated', { estimatedUsd: 1 });
  assert.equal(records.length, 0, 'enabled=false suppresses all records');
});

test('cost_estimated and tokens_used events carry numeric metadata only', () => {
  const { svc, events } = captureService();
  svc.record('cost_estimated', { estimatedUsd: 0.0021, inputTokens: 1200, outputTokens: 350 });
  svc.record('tokens_used', { total: 1550 });
  assert.equal(events[0].properties.estimatedUsd, 0.0021);
  assert.equal(events[0].properties.inputTokens, 1200);
  assert.equal(events[1].properties.total, 1550);
});

test('all 20+ PI milestone names are accepted by the trace', () => {
  const trace = new PiLatencyTrace({ source: 'what_to_answer' });
  const milestones = [
    'question_submitted', 'what_to_answer_clicked', 'transcript_window_loaded',
    'latest_question_extracted', 'intent_classified', 'answer_type_selected',
    'context_selected', 'context_build_started', 'context_build_completed',
    'prompt_built', 'provider_request_started', 'first_response_byte',
    'first_stream_chunk', 'first_visible_text', 'first_useful_token',
    'response_completed', 'validation_started', 'validation_completed',
    'validation_failed', 'repair_used', 'retry_used', 'degraded_context',
    'ui_render_completed',
  ];
  for (const m of milestones) {
    assert.doesNotThrow(() => trace.mark(m), `milestone ${m} should be markable`);
  }
  assert.equal(Object.keys(trace.snapshot()).length, milestones.length);
});
