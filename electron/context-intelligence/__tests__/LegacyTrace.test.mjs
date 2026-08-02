// Context Intelligence V3 — legacy trace emission.
//
// This instruments LIVE answer paths, so the safety properties matter more than
// the feature: it must never change an answer, never throw, and never carry
// source content.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const lt = await import(pathToFileURL(path.join(base, 'observability/legacy-trace.js')).href);
const { compareDecisions } = await import(pathToFileURL(path.join(base, 'observability/answer-trace.js')).href);
const { MemoryTraceSink, setTraceSink, recordLegacyTurn, isLegacyTraceEnabled, traceSafely, NO_POLICY } = lt;

const ENV = 'NATIVELY_CI_V3_TRACE';
let sink;
beforeEach(() => { sink = new MemoryTraceSink(); setTraceSink(sink); delete process.env[ENV]; });

const input = (over = {}) => ({
  requestId: 'r1', surface: 'manual-chat', scope: { userId: 'u1', meetingId: 'm1' },
  originalQuestion: 'Tell me about your WebRTC project.', ...over,
});

describe('disabled by default — zero cost, zero effect', () => {
  test('records nothing unless explicitly enabled', () => {
    assert.equal(isLegacyTraceEnabled({}), false);
    assert.equal(recordLegacyTurn(input()), null);
    assert.equal(sink.size, 0);
  });

  test('enables only on explicit truthy values', () => {
    for (const v of ['1', 'true', 'on', 'yes']) assert.equal(isLegacyTraceEnabled({ [ENV]: v }), true, v);
    for (const v of ['0', 'false', 'off', '']) assert.equal(isLegacyTraceEnabled({ [ENV]: v }), false, v);
  });
});

describe('never breaks an answer', () => {
  beforeEach(() => { process.env[ENV] = '1'; });

  test('a throwing sink is swallowed', () => {
    setTraceSink({ write() { throw new Error('sink exploded'); } });
    assert.doesNotThrow(() => recordLegacyTurn(input()));
    assert.equal(recordLegacyTurn(input()), null);
  });

  test('malformed input does not throw', () => {
    assert.doesNotThrow(() => recordLegacyTurn({ requestId: 'x', surface: 'manual-chat', scope: {} }));
  });

  test('traceSafely swallows any error', () => {
    assert.doesNotThrow(() => traceSafely(() => { throw new Error('boom'); }));
  });
});

describe('records absence honestly — the F2 evidence', () => {
  beforeEach(() => { process.env[ENV] = '1'; });

  test('a layer with NO source authority is not given a plausible default', () => {
    recordLegacyTurn(input({ legacyPath: 'runManualAnswer (no source authority)' }));
    const t = sink.all()[0];
    assert.equal(t.groundingPolicy, NO_POLICY,
      'defaulting to OPEN_KNOWLEDGE would misrepresent an ungrounded surface as a policy choice');
    assert.equal(t.modePolicyVersion, NO_POLICY);
    assert.deepEqual(t.authorizedSources, []);
    assert.equal(t.engine, 'legacy');
  });

  test('preserves which legacy code path produced it', () => {
    recordLegacyTurn(input({ legacyPath: 'ipcHandlers.gemini-chat-stream' }));
    assert.equal(sink.all()[0].legacyPath, 'ipcHandlers.gemini-chat-stream');
  });

  test('a layer WITH authority records it', () => {
    recordLegacyTurn(input({ groundingPolicy: 'SOURCE_FIRST', modeId: 'technical-interview' }));
    const t = sink.all()[0];
    assert.equal(t.groundingPolicy, 'SOURCE_FIRST');
    assert.equal(t.modeId, 'technical-interview');
  });
});

describe('never carries source content', () => {
  beforeEach(() => { process.env[ENV] = '1'; });

  test('evidence text is reduced to a length', () => {
    recordLegacyTurn(input({
      acceptedEvidence: [{ evidenceId: 'ev-1', sourceId: 'resume-1', versionId: 'v2', contentLength: 42 }],
    }));
    const e = sink.all()[0].acceptedEvidence[0];
    assert.equal(e.evidenceId, 'ev-1');
    assert.equal(e.versionId, 'v2', 'version must survive — it is the top measured risk');
    assert.equal(e.content, undefined);
  });

  test('the whole trace is redacted at construction, not at the sink', () => {
    // A raw `content` field smuggled in must not survive into the sink.
    recordLegacyTurn(input({ acceptedEvidence: [{ evidenceId: 'ev-1', content: 'SECRET RESUME LINE' }] }));
    const json = JSON.stringify(sink.all()[0]);
    assert.ok(!json.includes('SECRET RESUME LINE'), 'no source text may reach the sink');
  });
});

describe('bounded memory', () => {
  beforeEach(() => { process.env[ENV] = '1'; });

  test('the ring buffer does not grow without limit', () => {
    setTraceSink(sink = new MemoryTraceSink(10));
    for (let i = 0; i < 50; i++) recordLegacyTurn(input({ requestId: `r${i}` }));
    assert.equal(sink.size, 10, 'an unbounded sink on a long meeting is its own incident');
    assert.ok(sink.byRequestId('r49'), 'newest retained');
    assert.ok(!sink.byRequestId('r0'), 'oldest evicted');
  });
});

describe('shadow-mode comparison is now possible', () => {
  beforeEach(() => { process.env[ENV] = '1'; });

  test('two legacy layers answering the same question can be diffed', () => {
    // This is the whole point: Layer B builds its own decision, Layer C builds
    // none. Before this module there was no way to observe that they disagree.
    recordLegacyTurn(input({ requestId: 'q1', groundingPolicy: 'SOURCE_FIRST', legacyPath: 'layerB' }));
    recordLegacyTurn(input({ requestId: 'q2', legacyPath: 'layerC' }));

    const [b, c] = sink.all();
    const divergences = compareDecisions(b, c);
    assert.ok(divergences.some((d) => d.field === 'groundingPolicy'),
      'the diff must surface that one layer has a policy and the other has none');
  });

  test('identical decisions produce no divergence', () => {
    recordLegacyTurn(input({ requestId: 'a', groundingPolicy: 'SOURCE_FIRST', modeId: 'technical-interview' }));
    recordLegacyTurn(input({ requestId: 'b', groundingPolicy: 'SOURCE_FIRST', modeId: 'technical-interview' }));
    const [x, y] = sink.all();
    assert.deepEqual(compareDecisions(x, y), []);
  });
});
