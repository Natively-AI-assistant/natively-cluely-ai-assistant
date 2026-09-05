// electron/llm/routing/__tests__/IntentFrame.test.mjs
//
// PR 5 types. Nothing is wired yet, so these guard the two things that would
// silently corrupt PR 6: a voice derivation that disagrees with the corpus it
// will be measured against, and a grounding rule that lets `mode_files` through
// for a mode with no files.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');

const {
  MODE_ROUTING, MODE_INTENT_LABELS, PROVISIONAL_MODE_INTENTS,
  routingConfigFor, deriveVoice, groundingIsLegal,
} = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/routing/IntentFrame.js')).href);

// The benchmark's own derivation, which labels the corpus. If these two
// disagree, every voice figure in the benchmark describes a different function
// from the one the router would run.
const bench = await import(pathToFileURL(path.join(repoRoot, 'scripts/intent-benchmark/lib/deriveVoice.mjs')).href);

const BUILTINS = ['general', 'technical-interview', 'looking-for-work', 'sales',
  'recruiting', 'team-meet', 'lecture', 'seminar', 'call-center'];

describe('per-mode routing config', () => {
  test('covers every built-in mode', () => {
    assert.deepEqual(Object.keys(MODE_ROUTING).sort(), [...BUILTINS].sort());
  });

  test('RECRUITING never defaults to the user speaking as the candidate', () => {
    // The inversion this campaign exists to fix. The user is the interviewer.
    assert.equal(MODE_ROUTING['recruiting'].userRole, 'interviewer');
    assert.equal(MODE_ROUTING['recruiting'].systemCarries, 'candidate');
    assert.equal(MODE_ROUTING['recruiting'].defaultVoice, 'advisor');
  });

  test('grounding defaults match the CODE, not the brief', () => {
    // Phase 1 correction: seven of nine seed reference_files_primary; only the
    // two interview-prep modes seed profile_only. The brief had this inverted.
    const profileModes = BUILTINS.filter((m) => MODE_ROUTING[m].defaultGrounding === 'profile');
    assert.deepEqual(profileModes.sort(), ['looking-for-work', 'technical-interview']);
    assert.equal(BUILTINS.filter((m) => MODE_ROUTING[m].defaultGrounding === 'mode_files').length, 7);
  });

  test('only General and Team Meet have a silence string', () => {
    const withSilence = BUILTINS.filter((m) => MODE_ROUTING[m].silenceOutput !== null);
    assert.deepEqual(withSilence.sort(), ['general', 'team-meet']);
    assert.equal(MODE_ROUTING['general'].silenceOutput, 'Nothing actionable right now.');
    assert.equal(MODE_ROUTING['team-meet'].silenceOutput, 'Nothing to capture right now.');
  });

  test('a custom mode routes as General, because that is what it IS', () => {
    // ModesManager.isCustomMode is templateType === 'general' && name !== 'General'.
    assert.equal(routingConfigFor('some-custom-mode'), MODE_ROUTING['general']);
    assert.equal(routingConfigFor(undefined), MODE_ROUTING['general']);
  });

  test('every mode_intent label set is non-empty and matches its config', () => {
    for (const m of BUILTINS) {
      assert.ok(MODE_INTENT_LABELS[m].length > 0, m);
      assert.deepEqual(MODE_ROUTING[m].modeIntentLabels, MODE_INTENT_LABELS[m], m);
    }
  });

  test('provisional intents are the ones the Evidence Probe must upgrade', () => {
    // These are properties of the FILES, not of the words, so a router claiming
    // certainty about them is overclaiming.
    for (const i of ['in_file_question', 'off_file_question', 'off_syllabus']) {
      assert.ok(PROVISIONAL_MODE_INTENTS.has(i), i);
    }
  });
});

describe('derived voice', () => {
  test('AGREES with the benchmark derivation on every mode and intent', () => {
    // The invariant that keeps the benchmark meaningful. Checked exhaustively
    // rather than by sampling, because a divergence on one rare intent would be
    // invisible and would quietly invalidate that intent's score.
    for (const mode of BUILTINS) {
      for (const intent of [...MODE_INTENT_LABELS[mode], 'unmapped_intent']) {
        for (const needs of ['yes', 'optional', 'no']) {
          const mine = deriveVoice(mode, intent, needs);
          const theirs = bench.deriveVoice(
            { mode, labels: { mode_intent: intent, needs_response: needs } },
            { defaultVoice: MODE_ROUTING[mode].defaultVoice },
          );
          assert.equal(mine, theirs, `${mode}/${intent}/${needs}: router=${mine} bench=${theirs}`);
        }
      }
    }
  });

  test('needs_response=no is silent in every mode', () => {
    for (const m of BUILTINS) assert.equal(deriveVoice(m, 'anything', 'no'), 'silent', m);
  });

  test('Team Meet captures unless the user is called on', () => {
    assert.equal(deriveVoice('team-meet', 'action_item', 'yes'), 'capture');
    assert.equal(deriveVoice('team-meet', 'called_on_for_status', 'yes'), 'first_person_script');
  });

  test('Recruiting stays advisor for every one of its intents', () => {
    for (const i of MODE_INTENT_LABELS['recruiting']) {
      assert.equal(deriveVoice('recruiting', i, 'yes'), 'advisor', i);
    }
  });
});

describe('grounding legality', () => {
  test('mode_files requires files to actually be attached', () => {
    assert.equal(groundingIsLegal('mode_files', true), true);
    assert.equal(groundingIsLegal('mode_files', false), false);
  });

  test('every other grounding is unaffected by whether files exist', () => {
    for (const g of ['profile', 'knowledge_base', 'conversation_memory', 'none']) {
      assert.equal(groundingIsLegal(g, false), true, g);
      assert.equal(groundingIsLegal(g, true), true, g);
    }
  });
});
