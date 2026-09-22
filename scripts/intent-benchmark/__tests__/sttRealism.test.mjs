// scripts/intent-benchmark/__tests__/sttRealism.test.mjs
//
// The gate that decides whether the corpus is worth building on.
//
// The failure it exists to catch is specific: a cloud LLM asked for transcript
// lines produces clean prose with the capitals removed. That is invisible by
// inspection at 1,500 rows and fatal, because every Phase 4 candidate would
// then be scored on an input distribution that does not occur in production.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeInput, analyzeBatch, CATEGORY_PROFILES, MIN_SAMPLE_FOR_RATES, redundantTrapPairs, partitionMalformed } from '../lib/sttRealism.mjs';

const CLEAN_PROSE = [
  'Could you explain how the caching layer handles invalidation?',
  'What is the time complexity of this approach?',
  'I think we should refactor this module before the release.',
  'Can you walk me through the deployment process?',
  'That seems like a reasonable trade-off to me.',
  'Let me know if you need anything else from my side.',
  'The migration is scheduled for next Tuesday afternoon.',
  'We should probably discuss this in the retrospective.',
];

const REAL_STT = [
  'so could you uh explain how the cashing layer handles invalidation',
  'wait how does the the caching layer know when to',
  'mhm',
  'yeah exactly',
  'um whats the deal with invalidation there',
  'right right',
  'i think i think thats the wrong approach',
  'and then we just need to make sure that the',
  'why',
  'so the the thing is we dont really have',
];

describe('per-input analysis', () => {
  test('detects punctuation, casing, fillers and repairs', () => {
    assert.equal(analyzeInput('Could you explain?').hasPunctuation, true);
    assert.equal(analyzeInput('Could you explain').hasUppercase, true);
    assert.equal(analyzeInput('so um whats that').hasFiller, true);
    assert.equal(analyzeInput('the the thing is').hasRepair, true);
    assert.equal(analyzeInput('whats that').hasFiller, false);
  });
});

describe('batch gate', () => {
  test('REJECTS clean prose', () => {
    const r = analyzeBatch(CLEAN_PROSE);
    assert.ok(r.problems.length > 0, 'clean prose must not pass the gate');
    assert.ok(r.problems.some((p) => /uppercase|punctuation/.test(p)));
  });

  test('rejects prose even when the capitals are stripped', () => {
    // The exact failure mode. Lowercasing is what a lazy generator does, and it
    // clears the two hard checks while leaving the text obviously written.
    const stripped = CLEAN_PROSE.map((s) => s.toLowerCase().replace(/[.,?!]/g, ''));
    const r = analyzeBatch(stripped);
    assert.ok(r.problems.length > 0, 'lowercased prose must still be rejected');
    assert.ok(r.problems.some((p) => /filler|repair/.test(p)), 'it should fail on disfluency, not casing');
  });

  test('ACCEPTS realistic STT', () => {
    const r = analyzeBatch(REAL_STT);
    assert.deepEqual(r.problems, [], `expected clean pass, got ${r.problems.join('; ')}`);
  });

  test('catches duplicates', () => {
    const dupes = [...REAL_STT, 'yeah exactly', 'yeah exactly'];
    assert.ok(analyzeBatch(dupes).problems.some((p) => /duplicate/.test(p)));
  });
});

describe('sample-size discipline', () => {
  test('rate checks are SKIPPED below the sample threshold', () => {
    // A rate on n=1 is noise: a single row is either 0% or 100% short. The
    // first smoke run rejected 19 of 24 cells almost entirely on this, which
    // was a defect in the gate, not in the text.
    const one = ['so like can you find the bug and then uh give me the fixed implementation'];
    const r = analyzeBatch(one, { category: 'multi_intent' });
    assert.equal(r.ratesEvaluated, false);
    assert.deepEqual(r.problems, [], 'a single valid row must not be rejected on rates');
  });

  test('hard checks still apply at n=1', () => {
    // Punctuation and casing are per-row properties. They need no sample.
    const r = analyzeBatch(['Can you explain this.'], { category: 'multi_intent' });
    assert.ok(r.problems.length >= 2, 'punctuation and uppercase must fail even at n=1');
  });

  test('rates ARE evaluated at or above the threshold', () => {
    const many = Array.from({ length: MIN_SAMPLE_FOR_RATES }, (_, i) => `this is written prose number ${i} with no disfluency at all`);
    const r = analyzeBatch(many);
    assert.equal(r.ratesEvaluated, true);
    assert.ok(r.problems.some((p) => /filler/.test(p)));
  });
});

describe('category profiles', () => {
  test('multi_intent does not demand short turns', () => {
    // A multi-intent turn is never five words. Demanding it rejects correct
    // output, which the first smoke run did.
    assert.equal(CATEGORY_PROFILES.multi_intent.minShortRate, null);
    assert.equal(CATEGORY_PROFILES.normal_request.minShortRate, null);
  });

  test('no_response and fragment DO expect short turns', () => {
    assert.ok(CATEGORY_PROFILES.no_response.minShortRate > 0);
    assert.ok(CATEGORY_PROFILES.fragment.minShortRate > CATEGORY_PROFILES.no_response.minShortRate);
  });

  test('the no_response floor matches its own brief', () => {
    // Two of the six kinds that brief asks for are inherently short, so about a
    // third is the correct shape. An earlier 0.45 floor rejected spec-conformant
    // output measured at 33% and 42%.
    assert.ok(CATEGORY_PROFILES.no_response.minShortRate <= 0.35,
      'floor must not exceed what the category brief actually produces');
  });
});

describe('trap duplicates', () => {
    // An adversarial pair collides on wording where the disambiguator is the
    // channel or the history rather than the words, so a trap cell carries more
    // duplicates than any other. It does not carry a third of them: measured on
    // the v2 corpus, collisions that genuinely changed the label were 0.6% of
    // rows. The ceiling is loosened for the category, not removed.
    const withDupes = (nDupes, nUnique) => [
        ...Array.from({ length: nDupes }, () => 'so uh is that valid'),
        ...Array.from({ length: nUnique }, (_, i) => `yeah i mean uh whats the ${i} one i mean the other one`),
    ];

    test('the default ceiling rejects even a few colliding pairs', () => {
        const r = analyzeBatch(withDupes(2, 18), { category: 'multi_intent' });
        assert.ok(r.problems.some((p) => /duplicate/.test(p)));
    });

    test('the trap profile admits a realistic share of them', () => {
        const r = analyzeBatch(withDupes(2, 18), { category: 'trap' });
        assert.ok(!r.problems.some((p) => /duplicate/.test(p)), r.problems.join('; '));
    });

    test('the trap ceiling is still a ceiling', () => {
        const r = analyzeBatch(withDupes(8, 12), { category: 'trap' });
        assert.ok(r.problems.some((p) => /duplicate/.test(p)), 'a third identical must still reject');
    });
});

describe('redundantTrapPairs', () => {
    const row = (input, needs_response, dialogue_act = 'ask') => ({
        input, labels: { needs_response, dialogue_act, task: 'none' },
    });

    test('a colliding pair with DIFFERENT labels is the intended trap', () => {
        assert.equal(redundantTrapPairs([row('is that valid', 'yes'), row('is that valid', 'no')]), 0);
    });

    test('a colliding pair with the SAME label is a repeat', () => {
        assert.equal(redundantTrapPairs([row('is that valid', 'yes'), row('is that valid', 'yes')]), 1);
    });

    test('counts only the rows beyond one per distinct label signature', () => {
        const rows = [
            row('is that valid', 'yes'), row('is that valid', 'yes'),
            row('is that valid', 'no'), row('is that valid', 'no'),
        ];
        assert.equal(redundantTrapPairs(rows), 2);
    });

    test('distinct inputs are never redundant', () => {
        assert.equal(redundantTrapPairs([row('one thing', 'yes'), row('another thing', 'yes')]), 0);
    });

    test('normalises case and whitespace before comparing', () => {
        assert.equal(redundantTrapPairs([row('Is  That Valid', 'yes'), row('is that valid', 'yes')]), 1);
    });
});

describe('partitionMalformed', () => {
    // The defect: punctuation is a per-row property but was checked as a batch
    // rate, so one bad row exceeded a 2% ceiling at every batch size we run and
    // took the whole cell with it.
    const good = 'so uh how does the caching layer know when to';

    test('separates punctuated rows from clean ones', () => {
        const { keep, drop } = partitionMalformed([good, 'is this good?', good]);
        assert.equal(keep.length, 2);
        assert.equal(drop.length, 1);
        assert.equal(drop[0].reason, 'punctuation');
    });

    test('separates capitalised rows', () => {
        const { keep, drop } = partitionMalformed([good, 'Is this good', good]);
        assert.equal(drop.length, 1);
        assert.equal(drop[0].reason, 'uppercase');
        assert.equal(keep.length, 2);
    });

    test('reports the original index so the row can be found again', () => {
        const { drop } = partitionMalformed([good, good, 'nope.']);
        assert.equal(drop[0].index, 2);
    });

    test('a clean batch drops nothing', () => {
        const { keep, drop } = partitionMalformed([good, good]);
        assert.equal(drop.length, 0);
        assert.equal(keep.length, 2);
    });

    test('one bad row in 24 no longer condemns the batch', () => {
        const batch = Array.from({ length: 24 }, (_, i) => (i === 7 ? 'is this good?' : good));
        const { keep, drop } = partitionMalformed(batch);
        assert.equal(drop.length, 1);
        assert.equal(keep.length, 23);
        // and what survives now passes the hard checks it used to fail
        const r = analyzeBatch(keep.map((k) => k.input));
        assert.ok(!r.problems.some((p) => /punctuation/.test(p)), r.problems.join('; '));
    });
});
