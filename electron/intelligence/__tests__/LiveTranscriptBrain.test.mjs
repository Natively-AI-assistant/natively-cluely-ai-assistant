// node:test — LiveTranscriptBrain (live transcript read facade + durable-window bug fix).
// The headline test is the bug-fix proof: a fake SessionTracker that models the REAL
// 120s eviction of contextItems shows getLiveWindow() loses a minute-1 entity by
// minute 62, while getDurableWindow() (fullTranscript-backed) still has it.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveTranscriptBrain } from '../../../dist-electron/electron/intelligence/LiveTranscriptBrain.js';
import { __resetIntelligenceFlagsCache } from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';
import { extractLatestQuestion } from '../../../dist-electron/electron/llm/index.js';

// A faithful fake of SessionTracker's two stores:
//   • contextItems  — hard-evicted to 120s on every push (the real evictOldEntries)
//   • fullTranscript — durable, survives eviction
// This mirrors SessionTracker.addTranscript()/evictOldEntries()/getDurableContext().
class FakeSession {
  constructor(now) {
    this.contextItems = [];
    this.fullTranscript = [];
    this._now = now;
    this.WINDOW = 120; // contextWindowDuration
  }
  add(role, text, tSec) {
    const timestamp = tSec * 1000;
    this.contextItems.push({ role, text, timestamp });
    // evictOldEntries: drop anything older than 120s relative to current clock.
    const cutoff = this._now * 1000 - this.WINDOW * 1000;
    this.contextItems = this.contextItems.filter(i => i.timestamp >= cutoff);
    this.fullTranscript.push({ speaker: role === 'interviewer' ? 'system' : role, text, timestamp, final: true });
  }
  setNow(tSec) {
    this._now = tSec;
    const cutoff = tSec * 1000 - this.WINDOW * 1000;
    this.contextItems = this.contextItems.filter(i => i.timestamp >= cutoff);
  }
  getContext(lastSeconds = 120) {
    const cutoff = this._now * 1000 - lastSeconds * 1000;
    return this.contextItems.filter(i => i.timestamp >= cutoff);
  }
  getContextWithInterim(lastSeconds = 120) {
    return this.getContext(lastSeconds);
  }
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

function enableDurable(on) {
  if (on) process.env.NATIVELY_DURABLE_MEMORY_WINDOW = '1';
  else delete process.env.NATIVELY_DURABLE_MEMORY_WINDOW;
  __resetIntelligenceFlagsCache();
}

describe('LiveTranscriptBrain', () => {
  afterEach(() => enableDurable(false));

  test('getLiveWindow returns the recent (120s-evicted) window', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'Tell me about your projects', 10);
    s.add('user', 'Sure', 12);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const win = brain.getLiveWindow(180);
    assert.equal(win.length, 2);
  });

  test('BUG FIX PROOF: minute-1 entity survives to minute 62 only via the durable window', () => {
    const s = new FakeSession(0);
    // Minute 1: interviewer names a project entity.
    s.add('interviewer', 'We built a system called Polaris for routing', 60);
    // ... an hour of chatter advances the clock to minute 62.
    s.setNow(62 * 60); // 3720s
    s.add('interviewer', 'And what about that earlier system?', 62 * 60);

    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);

    // The legacy live window (getContext) has evicted the minute-1 entity entirely.
    const liveWin = brain.getLiveWindow(7200);
    const liveText = liveWin.map(t => t.text).join(' ');
    assert.doesNotMatch(liveText, /Polaris/, 'live window must have lost the evicted entity');

    // The durable window (fullTranscript-backed) STILL has it — this is the fix.
    const durableWin = brain.getDurableWindow(7200);
    const durableText = durableWin.map(t => t.text).join(' ');
    assert.match(durableText, /Polaris/, 'durable window must retain the minute-1 entity');
  });

  test('getMemoryWindow honors the durableMemoryWindow flag', () => {
    const s = new FakeSession(0);
    s.add('interviewer', 'Project Polaris is key', 60);
    s.setNow(62 * 60);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);

    enableDurable(false);
    const off = brain.getMemoryWindow(7200).map(t => t.text).join(' ');
    assert.doesNotMatch(off, /Polaris/, 'flag OFF → legacy window (entity lost)');

    enableDurable(true);
    const on = brain.getMemoryWindow(7200).map(t => t.text).join(' ');
    assert.match(on, /Polaris/, 'flag ON → durable window (entity retained)');
  });

  test('getCurrentQuestion extracts the latest interviewer question', () => {
    const s = new FakeSession(60);
    s.add('user', 'hello', 5);
    s.add('interviewer', 'What is your experience with distributed systems?', 30);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const q = brain.getCurrentQuestion(180);
    assert.match(q, /distributed systems/i);
  });

  test('getCurrentQuestion falls back to last interviewer turn without an extractor', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'Walk me through your background', 30);
    const brain = new LiveTranscriptBrain(s, null);
    assert.match(brain.getCurrentQuestion(180), /background/i);
  });

  test('getRollingSummary is deterministic and content-bounded (no LLM)', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'How do you handle scaling?', 20);
    s.add('user', 'I shard', 22);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const summary = brain.getRollingSummary(180);
    assert.match(summary, /scaling/i);
    assert.match(summary, /interviewer/i);
  });

  test('getTranscriptEntities surfaces tech tokens and drops sentence-initial stop words', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'Have you used Kafka and PostgreSQL with React?', 20);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const ents = brain.getTranscriptEntities(180);
    const lower = ents.map(e => e.toLowerCase());
    assert.ok(lower.includes('kafka'));
    assert.ok(lower.includes('postgresql'));
    assert.ok(lower.includes('react'));
    // "Have" leads the sentence and is capitalized, but is a stop word → excluded.
    assert.ok(!lower.includes('have'), 'sentence-initial stop word must be filtered');
  });

  test('getLiveAnswerContext bundles window + question + summary', () => {
    const s = new FakeSession(60);
    s.add('interviewer', 'Why are you a good fit for this role?', 30);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    const ctx = brain.getLiveAnswerContext(180);
    assert.ok(Array.isArray(ctx.window));
    assert.match(ctx.currentQuestion, /fit/i);
    assert.ok(typeof ctx.rollingSummary === 'string');
  });

  test('never throws on an empty session', () => {
    const s = new FakeSession(0);
    const brain = new LiveTranscriptBrain(s, extractLatestQuestion);
    assert.doesNotThrow(() => {
      assert.deepEqual(brain.getLiveWindow(180), []);
      assert.equal(brain.getCurrentQuestion(180), '');
      assert.equal(brain.getRollingSummary(180), '');
      assert.deepEqual(brain.getTranscriptEntities(180), []);
    });
  });
});
