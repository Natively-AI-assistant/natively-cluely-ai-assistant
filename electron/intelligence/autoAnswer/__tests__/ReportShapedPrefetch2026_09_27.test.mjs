// Report-shaped asks get the prefetch head start inside the ration window.
//
// Live 2026-09-27 (sales): "Right. Our biggest pain is that escalations get
// lost over the weekend, when only 2 people are on shift." was answered by the
// judge, but it is not question-shaped and came 19.8 s after the last prefetch,
// inside PREFETCH_MIN_INTERVAL_MS, so the answer only started after the ~1.3 s
// judge. Across 343 judged live candidates, the 4 answered non-question asks
// were all reports: a pain point, symptoms, an observation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { SimpleAutoAnswerEngine, isReportShaped, isQuestionShaped } = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/SimpleAutoAnswer.js'));

const LIVE_ASKS = [
  'Okay. I noticed the baseline numbers in Table 4 are lower than the ones reported in the original paper.',
  'Right. Our biggest pain is that escalations get lost over the weekend, when only 2 people are on shift.',
  "So last week we upgraded to the annual plan, and since then my team can't log into the dashboard.",
  'Yes, we use Okta for everyone. Actually, one of them just tried again, and now it says "license limit reached."',
];

test('the four live non-question asks are report-shaped', () => {
  for (const t of LIVE_ASKS) {
    assert.equal(isQuestionShaped(t), false, t);
    assert.equal(isReportShaped(t), true, t);
  }
});

test('ordinary statements and unfinished reports are not', () => {
  assert.equal(isReportShaped('Great, that makes sense, thanks for walking through it.'), false);
  assert.equal(isReportShaped('Let me pull up the roadmap document for everyone here.'), false);
  assert.equal(isReportShaped('Right. Our biggest pain is that'), false, 'a fragment still waits');
});

test('a report inside the ration window still gets the head start', async () => {
  const clock = new FakeClock();
  const prefetched = [];
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [], dispatch: () => {}, log: () => {},
    judgeCandidate: async () => JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', action: 'answer', answerability: 0.9, question_text: null }),
    prefetchAnswer: (id, text) => prefetched.push(text),
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  const say = async (text) => {
    engine.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now(), origin: 'stt', punctuationSource: 'provider' });
    for (let t = 0; t < 4000; t += 20) { clock.advance(20); await new Promise((r) => setImmediate(r)); }
  };
  await say('Can you tell me how your routing handles weekend coverage today?');
  await say('Let me pull up the roadmap document for everyone here now.');   // rationed: no head start
  await say(LIVE_ASKS[1]);                                                     // inside the ration, but a report
  assert.equal(prefetched.length, 2);
  assert.match(prefetched[1], /biggest pain/);
});
