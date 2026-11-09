/**
 * The decider's model input (deciderState.ts) — auto-answer-decider campaign §4.
 *
 * The question and the state are part of the trained model, so the TypeScript
 * builder and its Python twin (ml/auto-answer-decider/decider/state.py) must
 * produce the same bytes. decider-fixtures/state-parity.json is written by
 * Python (make_state_fixtures.py); this file asserts TypeScript reproduces it.
 * Regenerate the fixture only together with a retrain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/decider/deciderState.js'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'decider-fixtures/state-parity.json'), 'utf8'));

const words = (s) => s.split(/\s+/).filter(Boolean).length;
const turn = (role, text) => ({ role, text, timestamp: 0 });

test('question: byte-identical to the Python twin (model input)', () => {
  assert.equal(JSON.stringify({ [S.DECIDER_QUESTION_ID]: S.DECIDER_QUESTION }), JSON.stringify(fixture.question));
  assert.deepEqual(Object.keys(S.DECIDER_QUESTION.criteria), S.DECIDER_LABELS);
});

test('serialize: same bytes as Python json.dumps(ensure_ascii=False) — quotes, control chars, non-ASCII, astral', () => {
  for (const c of fixture.serialize) {
    assert.equal(S.serializeDeciderState(c.fields), c.serialized);
  }
});

test('fit: same result as Python — oldest turns first, then last_answered, then candidate head; tail always kept', () => {
  for (const c of fixture.fit) {
    const r = S.fitDeciderState(c.fields, words, c.room);
    assert.equal(r.serialized, c.result.serialized, `room ${c.room}`);
    assert.equal(r.droppedTurns, c.result.droppedTurns);
    assert.equal(r.answeredShrunk, c.result.answeredShrunk);
    assert.equal(r.droppedCandidateWords, c.result.droppedCandidateWords);
  }
  const heavy = fixture.fit.find(c => c.result.droppedCandidateWords > 0);
  const last = heavy.fields.candidate.split(/\s+/).at(-1);
  assert.ok(S.fitDeciderState(heavy.fields, words, heavy.room).fields.candidate.endsWith(last), 'candidate keeps its tail');
});

test('fields: last 6 turns, roles and speaker labels, judge tails, null last_answered, mode default', () => {
  const turns = Array.from({ length: 9 }, (_, i) => turn(i % 2 ? 'user' : 'interviewer', `t${i}`));
  const f = S.buildDeciderStateFields({
    candidateText: 'x'.repeat(1200), recentTurns: turns, speakers: turns.map((_, i) => (i === 8 ? 'speaker_2' : undefined)),
  });
  assert.deepEqual(f.context, ['USER: t3', 'OTHERS: t4', 'USER: t5', 'OTHERS: t6', 'USER: t7', 'OTHERS/speaker_2: t8']);
  assert.equal(f.candidate.length, 1001);
  assert.ok(f.candidate.startsWith('…'));
  assert.equal(f.last_answered, null);
  assert.equal(f.mode, 'general');
  assert.equal(f.transcript_lagging, false);
  assert.deepEqual(Object.keys(f), ['mode', 'addressed_to', 'transcript_lagging', 'context', 'last_answered', 'candidate']);
});

test('addressed_to: computed from the judge name helpers, STT slips count as the USER', () => {
  const at = (cand, name, ctx = []) => S.computeAddressedTo(cand, ctx, name);
  assert.equal(at('Jordan, can you take the next item?', 'Jordan Lee'), 'user');
  assert.equal(at('Jordon, can you take the next item?', 'Jordan'), 'user', 'one-edit slip');
  assert.equal(at('Priyanka, can you take the next item?', 'Jordan'), 'other');
  assert.equal(at('Thanks Sam. Jordan, what do you think?', 'Jordan'), 'user', 'thanks-prefixed vocative');
  assert.equal(at('can you take the next item?', 'Jordan'), 'none', 'no vocative');
  assert.equal(at('Priyanka, can you take the next item?', null), 'none', 'name unknown: nothing to compare');
  assert.equal(at('Okay, can you take the next item?', 'Jordan'), 'none', 'not a vocative');
  assert.equal(at('Priyanka, and Jordan, can you both look?', 'Jordan'), 'user', 'both named: answer');
});

test('mode names map to template ids; an unknown name maps to null, never to a guess', () => {
  assert.equal(S.modeIdForName('Technical Interview'), 'technical-interview');
  assert.equal(S.modeIdForName('Team Meet'), 'team-meet');
  assert.equal(S.modeIdForName('Call Center'), 'call-center');
  assert.equal(S.modeIdForName('My custom thing'), null);
  assert.equal(S.modeIdForName(null), null);
});
