// Live-meeting claims (task 7b, issue #552 live-verification).
//
// A live run in General mode with 18 injected transcript segments showed the
// JIT and BM25 live-transcript ports BOTH admitting the right chunk for
// "what did jonas say about the elasticsearch window" — but the classifier
// never planned MEETING_TRANSCRIPT at all: General's primary source is
// REFERENCE_FILE, and no attribution regex matched "what did <name> say".
// The answer said nothing was said. Fixed two ways: a named-speaker
// attribution alternative (turn-classifier.ts MEETING_ATTRIBUTION_RE), and an
// `inLiveMeeting` flag that lets ANY unclassified factual question in a live
// meeting claim the transcript as an alternative, mirroring Defect A.
//
// Imports compiled output: run `npm run build:electron` first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (rel) => import(pathToFileURL(path.join(base, rel)).href);
const { decide } = await load('orchestration/orchestrator.js');

const decision = (q, inLiveMeeting) => decide({
  requestId: 'r1', requestSequence: 1, surface: 'manual-chat', modeId: 'general',
  scope: { userId: 'local', sessionId: 'sess-1' }, sessionId: 'sess-1',
  manualQuestion: q,
  ...(inLiveMeeting === undefined ? {} : { inLiveMeeting }),
});

describe('a live meeting claims the transcript as an alternative (General mode)', () => {
  test('named-speaker attribution: "what did jonas say about the elasticsearch window" plans MEETING_TRANSCRIPT and still REFERENCE_FILE, inLiveMeeting true', () => {
    const d = decision('what did jonas say about the elasticsearch window', true);
    assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
    assert.ok(d.retrievalPlan.sourceTypes.includes('REFERENCE_FILE'), JSON.stringify(d.retrievalPlan.sourceTypes));
  });

  test('named-speaker attribution fires from the regex ALONE — inLiveMeeting false still plans MEETING_TRANSCRIPT', () => {
    const d = decision('what did jonas say about the elasticsearch window', false);
    assert.ok(d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
  });

  test('a DOCUMENT subject guards the attribution regex: "what did the brief say about scope" never plans MEETING_TRANSCRIPT', () => {
    const d = decision('what did the brief say about scope', false);
    assert.ok(!d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
    assert.ok(d.retrievalPlan.sourceTypes.includes('REFERENCE_FILE'), JSON.stringify(d.retrievalPlan.sourceTypes));
  });

  test('a plain factual question with no attribution wording: "what\'s our monthly cloud budget" plans MEETING_TRANSCRIPT only when inLiveMeeting is true', () => {
    const inMeeting = decision("what's our monthly cloud budget", true);
    assert.ok(inMeeting.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(inMeeting.retrievalPlan.sourceTypes));
    const notInMeeting = decision("what's our monthly cloud budget", false);
    assert.ok(!notInMeeting.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(notInMeeting.retrievalPlan.sourceTypes));
  });

  test('a coding task stays coding — a live meeting must not turn tasks into transcript lookups', () => {
    const d = decision('reverse a linked list in python', true);
    assert.ok(!d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
    assert.ok(d.questionTypes.includes('CODING_TASK') || d.questionTypes.includes('GENERAL_TECHNICAL'), JSON.stringify(d.questionTypes));
  });
});
