// The judge prompt's size budget.
//
// Measured 2026-09-24 against gemini-3.1-flash-lite, thinking minimal, tiny
// output, median of 3: ~1.0 s at <=2k input tokens, 1.58 s at 7.5k, 3.77 s at
// 28k. Input size, not tier, is the dominant term.
//
// JUDGE_CONTEXT_TURNS caps the NUMBER of turns at 8 but nothing capped their
// LENGTH, and the candidate and last-answered text were unbounded too. Eight
// rambling turns therefore pushed a 2500 ms judge deadline straight past it.
// The fixed boilerplate is already ~1955 tokens, so the variable part is what
// has to be held down.
//
// Tails are kept, never heads: an ask lands at the END of speech, so truncating
// from the front is what preserves the thing being judged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mod = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/AutoAnswerJudge.js'));
const { buildJudgePrompt, JUDGE_CONTEXT_TURNS, JUDGE_PROMPT_MAX_VARIABLE_CHARS } = mod;

const longTurn = (tag) => tag + ' ' + 'word '.repeat(600);   // ~3000 chars each

test('a budget constant exists and is documented in tokens the measurement used', () => {
  assert.ok(typeof JUDGE_PROMPT_MAX_VARIABLE_CHARS === 'number', 'the variable part must have a declared ceiling');
  assert.ok(JUDGE_PROMPT_MAX_VARIABLE_CHARS <= 8000,
    `budget too loose: ${JUDGE_PROMPT_MAX_VARIABLE_CHARS} chars on top of ~7819 boilerplate lands well past the flat band`);
});

test('eight rambling turns cannot blow the prompt open', () => {
  const recentTurns = Array.from({ length: JUDGE_CONTEXT_TURNS }, (_, i) => ({
    role: i % 2 ? 'interviewer' : 'user', text: longTurn('T' + i),
  }));
  const prompt = buildJudgePrompt({ recentTurns, candidateText: longTurn('CAND') });
  // Boilerplate (~7819) plus the declared variable ceiling, with a little slack
  // for the scaffolding lines between blocks.
  assert.ok(prompt.length <= 7819 + JUDGE_PROMPT_MAX_VARIABLE_CHARS + 600,
    `prompt was ${prompt.length} chars - the cap is not being applied`);
});

test('truncation keeps the END of a turn, where the ask actually is', () => {
  const recentTurns = [{ role: 'interviewer', text: 'START-MARKER ' + 'filler '.repeat(800) + ' END-MARKER' }];
  const prompt = buildJudgePrompt({ recentTurns, candidateText: 'so what do you think?' });
  assert.ok(prompt.includes('END-MARKER'), 'the tail of a turn must survive truncation');
  assert.ok(!prompt.includes('START-MARKER'), 'the head is what should be dropped');
});

test('the candidate keeps its tail too - that is the ask being judged', () => {
  const prompt = buildJudgePrompt({
    recentTurns: [],
    candidateText: 'CAND-START ' + 'filler '.repeat(800) + ' CAND-END',
  });
  assert.ok(prompt.includes('CAND-END'), 'the end of the candidate must survive');
});

test('short, ordinary input is passed through untouched', () => {
  const recentTurns = [
    { role: 'interviewer', text: 'so we looked at the migration timeline' },
    { role: 'user', text: 'right' },
  ];
  const prompt = buildJudgePrompt({ recentTurns, candidateText: 'what is your read on the Q3 risk?' });
  assert.ok(prompt.includes('so we looked at the migration timeline'));
  assert.ok(prompt.includes('what is your read on the Q3 risk?'));
  // NOT a bare `…` check: the fixed boilerplate already contains one, in the
  // "OTHERS/speaker_1, OTHERS/speaker_2, …" diarization line. Assert instead
  // that no elision marker was prepended to these specific turns.
  assert.ok(!prompt.includes('…so we looked'), 'a short turn must not be truncated');
  assert.ok(!prompt.includes('…what is your read'), 'a short candidate must not be truncated');
});
