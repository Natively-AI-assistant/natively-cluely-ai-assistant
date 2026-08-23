/**
 * Replay harness (V2 §31-§32, V3 Amendments 7 and 9).
 *
 * Every fixture runs through every provider dialect. Per fixture the
 * expectation must hold in the canonical dialect; across dialects
 * shouldAnswer, the reconstructed question and the trigger count must match
 * (parity) — only latency may differ. `expectedFail` fixtures (audio-
 * dependent declarative questions) are asserted to STILL fail so the flag is
 * flipped deliberately, never by accident. `knownGap` dialects are reported,
 * not failed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtures, replay, judge, DIALECTS } from './replay.mjs';

const fixtures = loadFixtures();

test('the corpus covers every required bucket', () => {
  const buckets = new Set(fixtures.map(f => f.bucket));
  for (const b of ['positive', 'fragmented', 'no_punctuation', 'negative', 'continuation', 'dedup', 'follow_up',
    'continued_speech', 'manual', 'lifecycle', 'dual_channel', 'rhetorical', 'declarative']) {
    assert.ok(buckets.has(b), `missing bucket ${b}`);
  }
  assert.ok(fixtures.filter(f => f.bucket === 'positive').length >= 8);
  assert.ok(fixtures.filter(f => f.bucket === 'negative').length >= 10);
});

for (const fixture of fixtures) {
  const gaps = new Set(fixture.knownGap ?? []);

  test(`replay[canonical] ${fixture.name}${fixture.expectedFail ? ' (expectedFail)' : ''}`, () => {
    const result = replay(fixture, 'canonical');
    const problems = judge(fixture, result);
    if (fixture.expectedFail) {
      assert.ok(problems.length > 0, `${fixture.name} now PASSES — flip expectedFail deliberately (Phase 5 audio model?)`);
      return;
    }
    assert.deepEqual(problems, [], `${fixture.name}: ${problems.join('; ')}`);
  });

  if (fixture.name === 'follow_up') {
    test('replay follow_up: the second dispatch is "And why?" and is a follow-up', () => {
      const r = replay(fixture, 'canonical');
      assert.equal(r.questions.length, 2, r.skips.join(','));
      assert.equal(r.questions[1], 'And why?');
      assert.equal(r.dispatches[1].isFollowUp, true);
    });
  }

  test(`parity ${fixture.name}: every dialect agrees on shouldAnswer / question / triggerCount`, () => {
    const base = replay(fixture, 'canonical');
    const mismatches = [];
    for (const dialect of DIALECTS) {
      if (dialect === 'canonical') continue;
      const r = replay(fixture, dialect);
      const diff = [];
      if (r.shouldAnswer !== base.shouldAnswer) diff.push(`shouldAnswer ${r.shouldAnswer}≠${base.shouldAnswer}`);
      if ((r.question ?? '') !== (base.question ?? '')) diff.push(`question ${JSON.stringify(r.question)}≠${JSON.stringify(base.question)}`);
      if (r.triggerCount !== base.triggerCount) diff.push(`triggerCount ${r.triggerCount}≠${base.triggerCount}`);
      if (diff.length) {
        if (gaps.has(dialect)) console.log(`  [known gap] ${fixture.name}/${dialect}: ${diff.join(', ')}`);
        else mismatches.push(`${dialect}: ${diff.join(', ')} (skips ${r.skips.join(',') || 'none'})`);
      }
    }
    assert.deepEqual(mismatches, [], mismatches.join(' | '));
  });
}
