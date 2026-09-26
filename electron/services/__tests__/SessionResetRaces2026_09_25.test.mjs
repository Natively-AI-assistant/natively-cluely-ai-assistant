// A reset that lands while async session work is still awaiting must win.
//
// compactTranscriptIfNeeded() summarizes the oldest 500 segments through the
// recap LLM once a meeting passes 1800. MeetingPersistence.stopMeeting()
// snapshots the transcript and calls session.reset() immediately, so a stop
// during that call left the summary to resolve INTO THE NEXT SESSION: the
// ended meeting's bullets were appended to the new session's epoch summaries
// (and from there to its answers and saved notes), and the 500-entry eviction
// ran against the new session's transcript, deleting it. Reproduced on main
// before this fix: meeting B's 3 lines became 0 and meeting A's summary was
// in meeting B's getFullSessionContext().
//
// The phone-mirror and desktop chat paths have the same shape: they save the
// answer after awaiting the provider, so a meeting stop or mode switch in
// between saved it into the context that replaced the one it was asked in.
// Those are gated on the context epoch (see AnswerSaveAfterContextChange2026_09_25).
//
// Requires: npm run build:electron.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');
const { SessionTracker } = await import(pathToFileURL(path.join(distDir, 'SessionTracker.js')).href);

const COMPACTION_THRESHOLD = 1800;

function deferredRecap() {
  let resolve;
  let reject;
  const calls = [];
  const recap = {
    generate: (prompt) => {
      calls.push(prompt);
      return new Promise((res, rej) => { resolve = res; reject = rej; });
    },
  };
  return { recap, calls, resolve: (v) => resolve(v), reject: (e) => reject(e) };
}

// Fill past the threshold so the next addTranscript starts a compaction whose
// recap call stays pending until the test releases it.
function startCompaction(session, label) {
  const t0 = Date.now();
  for (let i = 0; i <= COMPACTION_THRESHOLD; i++) {
    session.addTranscript({ speaker: 'interviewer', text: `${label} line ${i}`, timestamp: t0 + i, final: true });
  }
}

const settle = () => new Promise((r) => setImmediate(r));

describe('transcript compaction vs session reset', () => {
  test('control: with no reset, the summary is kept and the oldest 500 segments are evicted', async () => {
    const s = new SessionTracker();
    const d = deferredRecap();
    s.setRecapLLM(d.recap);
    startCompaction(s, 'meeting A');
    assert.equal(d.calls.length, 1, 'compaction must have started exactly one recap call');

    d.resolve('- meeting A summary');
    await settle();

    assert.deepEqual(s.transcriptEpochSummaries, ['- meeting A summary']);
    assert.equal(s.getFullTranscript().length, COMPACTION_THRESHOLD + 1 - 500);
  });

  test('a summary that resolves after reset() is discarded and the new session keeps its transcript', async () => {
    const s = new SessionTracker();
    const d = deferredRecap();
    s.setRecapLLM(d.recap);
    startCompaction(s, 'meeting A');

    s.reset(); // MeetingPersistence.stopMeeting()
    for (let i = 0; i < 3; i++) {
      s.addTranscript({ speaker: 'interviewer', text: `meeting B line ${i}`, timestamp: Date.now() + i, final: true });
    }

    d.resolve('- MEETING A: acquisition price is $40M');
    await settle();

    assert.deepEqual(s.transcriptEpochSummaries, [], 'the ended meeting\'s summary leaked into the new session');
    assert.deepEqual(
      s.getFullTranscript().map((seg) => seg.text),
      ['meeting B line 0', 'meeting B line 1', 'meeting B line 2'],
      'the ended meeting\'s eviction ran against the new session\'s transcript',
    );
    assert.doesNotMatch(String(s.getFullSessionContext()), /MEETING A/);
  });

  test('a recap failure after reset() does not push a fallback marker into the new session', async () => {
    const s = new SessionTracker();
    const d = deferredRecap();
    s.setRecapLLM(d.recap);
    startCompaction(s, 'meeting A');

    s.reset();
    d.reject(new Error('provider down'));
    await settle();

    assert.deepEqual(s.transcriptEpochSummaries, []);
  });

  test('a mode-context clear does NOT discard an in-flight compaction (the transcript survives it)', async () => {
    const s = new SessionTracker();
    const d = deferredRecap();
    s.setRecapLLM(d.recap);
    startCompaction(s, 'meeting A');

    s.clearSessionContext();
    d.resolve('- meeting A summary');
    await settle();

    assert.deepEqual(s.transcriptEpochSummaries, ['- meeting A summary']);
    assert.equal(s.getFullTranscript().length, COMPACTION_THRESHOLD + 1 - 500);
  });

  test('a compaction can start again after a discarded one', async () => {
    const s = new SessionTracker();
    const first = deferredRecap();
    s.setRecapLLM(first.recap);
    startCompaction(s, 'meeting A');
    s.reset();
    first.resolve('- stale');
    await settle();

    const second = deferredRecap();
    s.setRecapLLM(second.recap);
    startCompaction(s, 'meeting B');
    assert.equal(second.calls.length, 1, 'isCompacting was left set by the discarded run');
  });
});

describe('session and context epochs', () => {
  test('session epoch: reset() advances it; clearSessionContext() does not', () => {
    const s = new SessionTracker();
    const e0 = s.getSessionEpoch();
    s.clearSessionContext();
    assert.equal(s.getSessionEpoch(), e0);
    s.reset();
    assert.equal(s.getSessionEpoch(), e0 + 1);
  });

  // The context epoch gates answer saves (phone-mirror and desktop chat): an
  // answer asked before a meeting stop OR a mode switch must not be saved into
  // the context that replaced it. modes:set-active clears via
  // clearSessionContext(), and does so even when re-selecting the same mode,
  // which a mode-id comparison alone would miss.
  test('context epoch: both reset() and clearSessionContext() advance it', () => {
    const s = new SessionTracker();
    const c0 = s.getContextEpoch();
    s.clearSessionContext();
    assert.equal(s.getContextEpoch(), c0 + 1);
    s.reset();
    assert.equal(s.getContextEpoch(), c0 + 2);
  });
});
