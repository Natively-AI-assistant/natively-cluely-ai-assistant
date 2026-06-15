// node:test — Phase 6 LiveTranscriptBrain SHADOW-wiring proof.
//
// Phase 6 wired LiveTranscriptBrain into IntelligenceEngine.runWhatShouldISay() in
// SHADOW/PARITY mode behind the `liveTranscriptBrain` flag (default OFF). When ON, the
// engine does exactly this — and nothing else with the result:
//
//   const brain = new LiveTranscriptBrain(this.session as any, extractLatestQuestion as any);
//   const brainQ = brain.getCurrentQuestion(180);
//   wtaTrace.noteContext({ ... reason: brainQ ... === extractedQuestion ... });
//
// The brain output is recorded on an observe-only trace and NEVER alters the answer.
// This test exercises the REAL compiled LiveTranscriptBrain (from dist-electron) against
// the same SessionTrackerLike surface the engine passes (the real SessionTracker), proving
// the shadow call is correct and crash-proof:
//   (a) getCurrentQuestion returns the latest interviewer question;
//   (b) getCurrentQuestion returns '' on an empty session (graceful);
//   (c) construct + getCurrentQuestion never throws on a minimal/partial session
//       (the `this.session as any` cast must not hide a runtime crash);
//   (d) getHotWindow / getLiveAnswerContext work.
//
// Models the FakeSession on electron/intelligence/__tests__/LiveTranscriptBrain.test.mjs,
// but the headline of THIS file is the shadow contract: getCurrentQuestion(180) is the only
// thing the wiring calls, so that path must be exactly right and exception-safe.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LiveTranscriptBrain } from '../../../dist-electron/electron/intelligence/LiveTranscriptBrain.js';
import { extractLatestQuestion } from '../../../dist-electron/electron/llm/index.js';

// Faithful fake of the SessionTrackerLike surface the brain reads (getContext /
// getContextWithInterim / getDurableContext / getLastInterviewerTurn). Mirrors the REAL
// SessionTracker: contextItems is 120s-evicted, fullTranscript is durable.
class FakeSession {
  constructor(now) {
    this.contextItems = [];
    this.fullTranscript = [];
    this._now = now;
    this.WINDOW = 120;
  }
  add(role, text, tSec) {
    const timestamp = tSec * 1000;
    this.contextItems.push({ role, text, timestamp });
    const cutoff = this._now * 1000 - this.WINDOW * 1000;
    this.contextItems = this.contextItems.filter(i => i.timestamp >= cutoff);
    this.fullTranscript.push({ speaker: role === 'interviewer' ? 'system' : role, text, timestamp, final: true });
  }
  getContext(lastSeconds = 120) {
    const cutoff = this._now * 1000 - lastSeconds * 1000;
    return this.contextItems.filter(i => i.timestamp >= cutoff);
  }
  getContextWithInterim(lastSeconds = 120) {
    // The WTA path injects the latest interim interviewer partial; model it faithfully.
    const items = [...this.getContext(lastSeconds)];
    if (this._interim && this._interim.text.trim()) {
      const last = items[items.length - 1];
      const dup = last && last.role === 'interviewer' &&
        (last.text === this._interim.text || Math.abs(last.timestamp - this._interim.timestamp) < 1000);
      if (!dup) items.push({ role: 'interviewer', text: this._interim.text, timestamp: this._interim.timestamp });
    }
    return items;
  }
  setInterim(text, tSec) { this._interim = { text, timestamp: tSec * 1000 }; }
  getDurableContext(lastSeconds = 7200) {
    const cutoff = Number.isFinite(lastSeconds) ? this._now * 1000 - lastSeconds * 1000 : -Infinity;
    return this.fullTranscript
      .filter(s => s.timestamp >= cutoff && (s.text || '').trim())
      .map(s => ({ role: s.speaker === 'system' ? 'interviewer' : s.speaker, text: s.text, timestamp: s.timestamp }));
  }
  getLastInterviewerTurn() {
    for (let i = this.contextItems.length - 1; i >= 0; i--) {
      if (this.contextItems[i].role === 'interviewer') return this.contextItems[i].text;
    }
    return null;
  }
}

describe('Phase 6 — LiveTranscriptBrain SHADOW wiring (the WTA shadow call surface)', () => {
  // (a) The exact call the engine makes when the flag is ON.
  test('getCurrentQuestion(180) returns the latest interviewer question', () => {
    const s = new FakeSession(60);
    s.add('user', 'Thanks for having me', 5);
    s.add('interviewer', 'Tell me about a time you scaled a service.', 20);
    s.add('interviewer', 'Specifically, how did you handle the database layer?', 40);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const q = brain.getCurrentQuestion(180);
    assert.ok(q && q.trim().length > 0, 'must return a non-empty question');
    assert.match(q, /database layer/i, 'must surface the LATEST interviewer question');
  });

  // The shadow block reads the interim too (getContextWithInterim is what
  // getCurrentQuestion uses), matching the inline WTA interim injection.
  test('getCurrentQuestion(180) sees a half-spoken interim question', () => {
    const s = new FakeSession(60);
    s.add('user', 'Sure', 5);
    s.setInterim('What is your experience with Kubernetes', 55);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const q = brain.getCurrentQuestion(180);
    assert.match(q, /kubernetes/i, 'interim interviewer partial must be answerable');
  });

  // (b) Empty session → '' (the shadow records retrieved:false, no crash, no answer change).
  test('getCurrentQuestion(180) returns "" on an empty session (graceful)', () => {
    const s = new FakeSession(0);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    assert.equal(brain.getCurrentQuestion(180), '');
  });

  // (c) The `this.session as any` cast must not hide a runtime crash. A partial session
  // object (each accessor present but minimal / throwing) must NEVER throw out of the brain
  // — the engine's try/catch is a backstop, but the brain itself is defensive.
  test('construct + getCurrentQuestion never throws on a minimal session', () => {
    const minimal = {
      getContext: () => [],
      getContextWithInterim: () => [],
      getDurableContext: () => [],
      getLastInterviewerTurn: () => null,
    };
    const brain = new LiveTranscriptBrain(minimal, extractLatestQuestion);
    assert.doesNotThrow(() => {
      assert.equal(brain.getCurrentQuestion(180), '');
    });
  });

  test('getCurrentQuestion swallows a throwing session accessor (defensive, not just engine try/catch)', () => {
    // Every accessor throws — the brain's internal try/catch must still yield '' (this is
    // why the engine can pass `this.session as any` without the brain becoming a crash vector).
    const hostile = {
      getContext() { throw new Error('boom'); },
      getContextWithInterim() { throw new Error('boom'); },
      getDurableContext() { throw new Error('boom'); },
      getLastInterviewerTurn() { throw new Error('boom'); },
    };
    const brain = new LiveTranscriptBrain(hostile, extractLatestQuestion);
    let out;
    assert.doesNotThrow(() => { out = brain.getCurrentQuestion(180); });
    assert.equal(out, '', 'a throwing session must degrade to "" — never propagate');
  });

  test('getCurrentQuestion falls back to last interviewer turn when the extractor finds no question', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'okay', 30); // not a question — extractor yields nothing useful
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const q = brain.getCurrentQuestion(180);
    // Either the extractor returns '' (no question) → falls back to last interviewer turn.
    assert.equal(q, 'okay');
  });

  // (d) getHotWindow / getLiveAnswerContext work (the broader read surface a future
  // refactor would consume; the shadow proves the drop-in is viable).
  test('getHotWindow returns the interim-inclusive window', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'How do you approach testing?', 30);
    s.setInterim('And what about CI', 58);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const hot = brain.getHotWindow(180);
    assert.ok(Array.isArray(hot));
    const text = hot.map(t => t.text).join(' ');
    assert.match(text, /testing/i);
    assert.match(text, /CI/, 'hot window must include the interim partial');
  });

  test('getLiveAnswerContext bundles window + currentQuestion + summary', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'Why are you interested in this role?', 30);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const ctx = brain.getLiveAnswerContext(180);
    assert.ok(Array.isArray(ctx.window));
    assert.match(ctx.currentQuestion, /role/i);
    assert.equal(typeof ctx.rollingSummary, 'string');
    assert.equal(typeof ctx.questionType, 'string');
    assert.equal(typeof ctx.isFollowUp, 'boolean');
  });

  // PARITY: the shadow records 'brain_parity' vs 'brain_question_divergence' by comparing
  // brain.getCurrentQuestion(180) to the inline extractLatestQuestion(transcriptTurns). On a
  // shared window the two MUST agree — this is the property the shadow trace asserts.
  test('PARITY: brain question matches the inline extractLatestQuestion on the same window', () => {
    const s = new FakeSession(60);
    s.add('user', 'Hi', 5);
    s.add('interviewer', 'Can you describe your most challenging bug?', 40);

    // The inline WTA path: getContext(180) → map → extractLatestQuestion(transcriptTurns).
    const transcriptTurns = s.getContext(180).map(i => ({ role: i.role, text: i.text, timestamp: i.timestamp }));
    const inline = extractLatestQuestion(transcriptTurns);

    // The shadow path: brain.getCurrentQuestion(180) over getContextWithInterim.
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const brainQ = brain.getCurrentQuestion(180);

    assert.ok(inline.latestQuestion, 'inline path must extract a question');
    // Same window, same extractor → parity (the trace would record 'brain_parity').
    assert.equal(brainQ, inline.latestQuestion.trim(), 'shadow must be at PARITY with the live inline path');
  });
});
