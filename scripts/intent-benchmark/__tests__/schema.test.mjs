// scripts/intent-benchmark/__tests__/schema.test.mjs
//
// The dataset contract. These guard the two things that silently ruin a
// benchmark: a split that moves when rows are edited, and cross-field label
// combinations that are individually well-typed but jointly incoherent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitFor, validateRow, validateCorpus, parseJsonl, AXES, dedupeKey } from '../lib/schema.mjs';

const baseRow = (over = {}) => ({
  id: 'tm-0412',
  mode: 'team-meet',
  channel: 'system',
  user_channel: 'mic',
  history: ['[SYSTEM] so wheres the export feature at'],
  app_state: { question_pending: false, coding_task_active: false, seconds_since_user_spoke: 41 },
  input: 'evin hows the export feature coming along',
  mode_has_reference_files: true,
  labels: {
    dialogue_act: 'ask',
    needs_response: 'yes',
    voice: 'first_person_script',
    task: 'answer',
    secondary_tasks: [],
    mode_intent: 'called_on_for_status',
    answer_form: 'explanation',
    grounding: 'profile',
    capabilities: ['conversation_context'],
    current_information: false,
  },
  legacy_intent: 'general',
  source: 'synthetic',
  language: 'en',
  ...over,
});

describe('held-out split', () => {
  test('is deterministic', () => {
    assert.equal(splitFor('tm-0412'), splitFor('tm-0412'));
    assert.equal(splitFor('rec-0001'), splitFor('rec-0001'));
  });

  test('is ~20% holdout over a large id space', () => {
    let holdout = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (splitFor(`tm-${i}`) === 'holdout') holdout++;
    const share = holdout / n;
    assert.ok(share > 0.18 && share < 0.22, `holdout share ${share} should be near 0.20`);
  });

  test('DOES NOT move when the row text changes', () => {
    // The whole point. Phase 6 regenerates the corpus at 20k rows; if the split
    // hashed content, fixing a typo would migrate a held-out row into training
    // and the "nothing may train on holdout" rule would break silently.
    const id = 'lec-0033';
    const before = splitFor(id);
    // simulate any content edit whatsoever
    const after = splitFor(id);
    assert.equal(before, after);
    // and a different id genuinely can land elsewhere
    const ids = Array.from({ length: 50 }, (_, i) => `lec-${i}`);
    const splits = new Set(ids.map(splitFor));
    assert.equal(splits.size, 2, 'over 50 ids both splits should occur');
  });
});

describe('v2 taxonomy', () => {
  test('question and request are MERGED into ask', () => {
    // 27 of 54 dialogue_act overlap failures were that one pair. Keeping either
    // old value would silently accept rows from the pre-merge corpus.
    assert.deepEqual(AXES.dialogue_act, ['ask', 'statement', 'answer', 'backchannel', 'interruption']);
    assert.ok(validateRow(baseRow({ labels: { ...baseRow().labels, dialogue_act: 'question' } })).length > 0);
    assert.ok(validateRow(baseRow({ labels: { ...baseRow().labels, dialogue_act: 'request' } })).length > 0);
  });

  test('needs_response is BINARY: optional is gone', () => {
    // 9 of 11 overlaps on this axis were optional-vs-yes, and inspecting those
    // rows showed optional had become "the user thinking aloud on their own
    // mic" rather than a genuine middle.
    assert.deepEqual(AXES.needs_response, ['yes', 'no']);
    assert.ok(validateRow(baseRow({ labels: { ...baseRow().labels, needs_response: 'optional' } })).length > 0);
  });
});

describe('row validation', () => {
  test('accepts a well-formed row', () => {
    assert.deepEqual(validateRow(baseRow()), []);
  });

  test('rejects an unknown mode or channel', () => {
    assert.ok(validateRow(baseRow({ mode: 'therapy' })).some((e) => e.includes('mode')));
    assert.ok(validateRow(baseRow({ channel: 'bluetooth' })).some((e) => e.includes('channel')));
  });

  test('needs_response=no forces ALL FOUR of voice, task, answer_form, grounding', () => {
    // The invariant a labeller gets wrong most often, and every field is
    // individually valid when they do.
    //
    // The founder's hand check found the last two missing: answer_form came
    // back at 10.3% disagreement, over the brief's bar, and 35 of the 38
    // corrections asking for `none` were needs_response=no rows. If Natively
    // says nothing there is no answer form and no grounding source, for the
    // same reason there is no voice and no task.
    const bad = baseRow({ labels: { ...baseRow().labels, needs_response: 'no' } });
    const errs = validateRow(bad);
    assert.ok(errs.some((e) => e.includes('voice=silent')), 'must require silent voice');
    assert.ok(errs.some((e) => e.includes('task=none')), 'must require task none');
    assert.ok(errs.some((e) => e.includes('answer_form=none')), 'must require answer_form none');
    assert.ok(errs.some((e) => e.includes('grounding=none')), 'must require grounding none');

    // Satisfying only the original two is NOT enough — this is exactly the
    // shape the corpus carried before the review.
    const half = baseRow({
      labels: { ...baseRow().labels, needs_response: 'no', voice: 'silent', task: 'none' },
    });
    assert.ok(validateRow(half).length > 0, 'voice+task alone must not pass');

    const good = baseRow({
      labels: {
        ...baseRow().labels, needs_response: 'no', voice: 'silent',
        task: 'none', answer_form: 'none', grounding: 'none',
      },
    });
    assert.deepEqual(validateRow(good), []);
  });

  test('grounding=mode_files is illegal when no files are attached', () => {
    // The brief's rule: mode_files may only be emitted when files exist. A
    // benchmark that accepts it anyway cannot measure whether a candidate
    // respects the constraint.
    const bad = baseRow({
      mode_has_reference_files: false,
      labels: { ...baseRow().labels, grounding: 'mode_files' },
    });
    assert.ok(validateRow(bad).some((e) => e.includes('mode_has_reference_files')));

    const ok = baseRow({
      mode_has_reference_files: true,
      labels: { ...baseRow().labels, grounding: 'mode_files' },
    });
    assert.deepEqual(validateRow(ok), []);
  });

  test('rejects an out-of-vocabulary secondary task or capability', () => {
    assert.ok(validateRow(baseRow({ labels: { ...baseRow().labels, secondary_tasks: ['sing'] } })).length > 0);
    assert.ok(validateRow(baseRow({ labels: { ...baseRow().labels, capabilities: ['telepathy'] } })).length > 0);
  });

  test('never throws on malformed input', () => {
    for (const junk of [null, undefined, 42, 'x', [], {}]) {
      assert.doesNotThrow(() => validateRow(junk));
      assert.ok(validateRow(junk).length > 0);
    }
  });
});

describe('corpus validation', () => {
  test('reports duplicate ids', () => {
    const r = validateCorpus([baseRow(), baseRow()]);
    assert.equal(r.ok, false);
    assert.equal(r.dupes.length, 1);
  });

  test('collects every bad row rather than aborting on the first', () => {
    const r = validateCorpus([baseRow({ id: 'a', mode: 'nope' }), baseRow({ id: 'b', channel: 'nope' }), baseRow({ id: 'c' })]);
    assert.equal(r.errors.length, 2, 'both bad rows reported, good row untouched');
  });
});

describe('jsonl parsing', () => {
  test('reports a torn line instead of throwing', () => {
    const { rows, bad } = parseJsonl('{"a":1}\n{"b":\n{"c":3}\n');
    assert.equal(rows.length, 2);
    assert.equal(bad.length, 1);
    assert.equal(bad[0].line, 2);
  });
});

describe('dedupeKey', () => {
    const row = (over = {}) => ({
        mode: 'team-meet', input: 'hows the export coming along',
        labels: { needs_response: 'yes', dialogue_act: 'ask', task: 'none' }, ...over,
    });

    test('identical rows collide', () => {
        assert.equal(dedupeKey(row()), dedupeKey(row()));
    });

    test('an adversarial pair does NOT collide', () => {
        // Same words, different answer. This is the trap category, and a
        // label-blind key deleted one member of every such pair.
        const a = row();
        const b = row({ labels: { needs_response: 'no', dialogue_act: 'statement', task: 'none' } });
        assert.notEqual(dedupeKey(a), dedupeKey(b));
    });

    test('the same words in a different mode do not collide', () => {
        assert.notEqual(dedupeKey(row()), dedupeKey(row({ mode: 'lecture' })));
    });

    test('case and whitespace are normalised', () => {
        assert.equal(dedupeKey(row()), dedupeKey(row({ input: '  Hows   THE export Coming Along ' })));
    });

    test('a missing row does not throw', () => {
        assert.equal(typeof dedupeKey(undefined), 'string');
    });
});
