// Issue #775 (2026-11-21): What to Answer swapped the interviewer's Java-to-AWS question for a mic line.
//
// The interviewer channel's final arrived at 34:45.903; a microphone final with different words for the same
// moment arrived 251 ms later. The manual-press rule that prefers the user's own newer question took the mic line
// ("What kind of certificate may be needed?") and the answer was about HTTPS certificates and mutual TLS.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wasSpokenOverOtherParty, MIN_MS_PER_SPOKEN_WORD, speechWindowWithoutUserLine, segmentsWithoutUserLine } from '../../../dist-electron/electron/llm/overlappingTurns.js';
import { extractLatestQuestion } from '../../../dist-electron/electron/llm/transcriptQuestionExtractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const T0 = 2_085_903; // 34:45.903 in ms from meeting start
const INTERVIEWER = { role: 'interviewer', text: 'connect with the services from the Java code? What kind of certainly needed', timestamp: T0 };
const MIC = { role: 'user', text: 'What kind of certificate may be needed?', timestamp: T0 + 251 };

describe('a mic line spoken over the interviewer is not the user\'s own question', () => {
  test('the issue\'s pair, 251 ms apart, overlapped', () => {
    assert.equal(wasSpokenOverOtherParty(MIC, INTERVIEWER), true);
  });

  test('the same words arriving together (same millisecond) overlapped', () => {
    assert.equal(wasSpokenOverOtherParty({ ...MIC, timestamp: T0 }, INTERVIEWER), true);
  });

  test('a user question that lands after the time it takes to say it is the user\'s own', () => {
    // "How many rounds are there?" said once the recruiter finished: 5 words, final 1.6 s later.
    const recruiter = { text: 'let me check the scorecard, what are we actually scoring on and what weights', timestamp: 10_000 };
    const user = { text: 'How many rounds are there?', timestamp: 11_600 };
    assert.equal(wasSpokenOverOtherParty(user, recruiter), false);
  });

  test('the window is the user line\'s length, not a fixed delay', () => {
    const words = MIC.text.split(/\s+/).length; // 6
    const edge = words * MIN_MS_PER_SPOKEN_WORD;
    assert.equal(wasSpokenOverOtherParty({ ...MIC, timestamp: T0 + edge - 1 }, INTERVIEWER), true);
    assert.equal(wasSpokenOverOtherParty({ ...MIC, timestamp: T0 + edge }, INTERVIEWER), false);
  });

  test('a backchannel over the user\'s question does not take it', () => {
    // The interviewer said "okay, sure" while the user was asking; the user's question still counts.
    const backchannel = { text: 'okay, sure', timestamp: 20_000 };
    const user = { text: 'What does the on-call rotation look like?', timestamp: 20_200 };
    assert.equal(wasSpokenOverOtherParty(user, backchannel), false);
  });

  test('missing timestamps never block the user\'s question', () => {
    assert.equal(wasSpokenOverOtherParty({ text: MIC.text, timestamp: undefined }, INTERVIEWER), false);
    assert.equal(wasSpokenOverOtherParty(MIC, { text: INTERVIEWER.text, timestamp: NaN }), false);
  });

  test('the extractor still picks the interviewer\'s question for the issue transcript', () => {
    const extracted = extractLatestQuestion([INTERVIEWER, MIC]);
    assert.match(extracted.latestQuestion, /Java code/);
    assert.doesNotMatch(extracted.latestQuestion, /certificate/);
  });
});

describe('the overlapping line is left out of that answer\'s prompt', () => {
  // Kept in, it steered 3/3 live answers (Natively API) to certificates even with the right question chosen.
  test('the speech window loses only the newest matching [ME] line', () => {
    const win = ['[ME]: What kind of certificate may be needed?', '[INTERVIEWER]: ' + INTERVIEWER.text, '[ME]: What kind of certificate may be needed?'].join('\n');
    assert.equal(speechWindowWithoutUserLine(win, MIC.text), ['[ME]: What kind of certificate may be needed?', '[INTERVIEWER]: ' + INTERVIEWER.text].join('\n'));
  });

  test('an interviewer line with the same words stays', () => {
    const win = '[INTERVIEWER]: What kind of certificate may be needed?';
    assert.equal(speechWindowWithoutUserLine(win, 'What kind of certificate may be needed?'), win);
  });

  test('live evidence loses the user segment, keeps the interviewer\'s and older user lines', () => {
    const roleOf = (sp) => (sp === 'interviewer' ? 'interviewer' : 'user');
    const segs = [
      { speaker: 'user', text: MIC.text, timestamp: T0 - 60_000 },
      { speaker: 'interviewer', text: INTERVIEWER.text, timestamp: T0 },
      { speaker: 'user', text: MIC.text, timestamp: T0 + 251 },
    ];
    assert.deepEqual(segmentsWithoutUserLine(segs, MIC, roleOf), segs.slice(0, 2));
    assert.equal(segmentsWithoutUserLine(segs, null, roleOf), segs, 'no overlap: the transcript is handed over untouched');
  });
});

describe('IntelligenceEngine checks the overlap before switching to the user\'s line', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'IntelligenceEngine.ts'), 'utf8');

  test('the switch is skipped when the user spoke over the other party', () => {
    const i = src.indexOf("trace.mark('repair_used', { reason: 'question_from_user_utterance' });");
    assert.ok(i > 0);
    const block = src.slice(Math.max(0, i - 1200), i);
    assert.match(block, /wasSpokenOverOtherParty\(transcriptTurns\[ui\], transcriptTurns\[ii\]\)/);
    assert.match(block, /if \(userAskedLast && !userSpokeOverOtherParty && extractedQuestion\.latestQuestion !== userText\)/);
  });

  test('the overlapping line reaches the V3 context builder, which drops it from the speech window and live evidence', () => {
    assert.match(src, /overlappedUserLine = \{ text: userText, timestamp: transcriptTurns\[ui\]\.timestamp \}/);
    assert.match(src, /this\.v3ModeRetrievalContext\(_screenPortText, \{ modeInfo: snapshotModeInfo, referenceFiles: snapshotReferenceFiles \}, overlappedUserLine\)/);
    assert.match(src, /segmentsWithoutUserLine\(\(this\.session as any\)\?\.getRetrievalTranscript\?\.\(\) \?\? \[\], leaveOutUserLine,/);
    assert.match(src, /speechWindowWithoutUserLine\(String\(formatted \?\? ''\), leaveOutUserLine\.text\)/);
  });
});
