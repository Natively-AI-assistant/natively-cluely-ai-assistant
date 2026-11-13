/**
 * The judge's "Recent transcript" is what people SAID. The app's own drafted
 * answers (role 'assistant') and lines the user TYPED to the assistant are not
 * speech, and the judge prompt used to label both "USER:", so the judge read
 * the AI's answer as the user having already answered (pipeline forensics
 * 2026-11-13, F-CTX-06: P2-s05 judge prompts 060/062 carried
 * "USER: Ledgerline is a Go reconciliation service…").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer', p);
const { buildJudgePrompt, JUDGE_CONTEXT_TURNS } = require(dist('AutoAnswerJudge.js'));
const { SimpleAutoAnswerEngine, STABILITY_MS } = require(dist('SimpleAutoAnswer.js'));

const flush = () => new Promise((r) => setImmediate(r));
const AI_ANSWER = 'Ledgerline is a Go reconciliation service I built that matches ledger entries nightly.';

test('the rendered judge prompt never labels the assistant\'s own answer as USER', () => {
  const prompt = buildJudgePrompt({
    candidateText: 'Okay. What about the second one on your resume?',
    recentTurns: [
      { role: 'interviewer', text: 'Tell me about the first project on your resume.', timestamp: 1 },
      { role: 'assistant', text: AI_ANSWER, timestamp: 2 },
      { role: 'user', text: 'Sure, so the first one is Ledgerline.', timestamp: 3 },
    ],
    questionId: 'q1',
  });
  assert.ok(!prompt.includes(`USER: ${AI_ANSWER}`), 'the AI answer is not presented as the user speaking');
  assert.ok(!prompt.includes(AI_ANSWER), 'drafted answers are not transcript');
  assert.ok(prompt.includes('USER: Sure, so the first one is Ledgerline.'), 'the user\'s real speech keeps its label');
  assert.ok(prompt.includes('OTHERS: Tell me about the first project on your resume.'));
});

test('a line the user TYPED to the assistant is not meeting speech either', () => {
  const prompt = buildJudgePrompt({
    candidateText: 'How did you test it?',
    recentTurns: [
      { role: 'user', text: 'what should I say about my testing approach', typed: true, timestamp: 1 },
      { role: 'interviewer', text: 'Walk me through Ledgerline.', timestamp: 2 },
    ],
    questionId: 'q1',
  });
  assert.ok(!prompt.includes('what should I say about my testing approach'));
});

test('speaker labels stay aligned with their turns when non-speech rows are dropped', () => {
  const prompt = buildJudgePrompt({
    candidateText: 'And how would you scale it?',
    recentTurns: [
      { role: 'interviewer', text: 'Design a URL shortener.', timestamp: 1 },
      { role: 'assistant', text: AI_ANSWER, timestamp: 2 },
      { role: 'interviewer', text: 'Okay, that sounds reasonable.', timestamp: 3 },
    ],
    speakers: ['speaker_1', undefined, 'speaker_2'],
    questionId: 'q1',
  });
  assert.ok(prompt.includes('OTHERS/speaker_1: Design a URL shortener.'));
  assert.ok(prompt.includes('OTHERS/speaker_2: Okay, that sounds reasonable.'));
});

test('the engine hands the judge spoken turns only, and drafted answers do not crowd real turns out of the window', async () => {
  const clock = new FakeClock();
  const turns = [];
  for (let i = 0; i < JUDGE_CONTEXT_TURNS; i++) {
    turns.push({ role: 'interviewer', text: `Spoken interviewer turn number ${i} about the system.`, timestamp: i });
    turns.push({ role: 'assistant', text: `${AI_ANSWER} (${i})`, timestamp: i });
  }
  const calls = [];
  const engine = new SimpleAutoAnswerEngine({
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => turns,
    dispatch: () => {},
    judgeCandidate: async (req) => { calls.push(req); return null; },
    telemetry: () => {}, log: () => {},
  }, clock);
  engine.onMeetingStart();
  engine.ingest({ speaker: 'interviewer', text: 'What about the second one on your resume?', final: true, timestamp: clock.now(), origin: 'stt' });
  for (let t = 0; t < STABILITY_MS + 500; t += 100) { clock.advance(100); await flush(); }
  assert.ok(calls.length >= 1);
  const seen = calls[0].recentTurns;
  assert.ok(seen.every((t) => t.role !== 'assistant'), 'no assistant rows reach the judge');
  assert.equal(seen.length, JUDGE_CONTEXT_TURNS, 'the window holds JUDGE_CONTEXT_TURNS spoken turns');
});
