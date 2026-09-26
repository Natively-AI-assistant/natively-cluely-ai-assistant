// T3 (partial) — the live spoken surface shipped the MANUAL-CHAT answer
// contract, and a blind re-press lost its directive.
//
// When V3 composes, `_v3p.user` replaces `packet.userMessage`, so everything
// whose only carrier is `packet` silently disappears. Two consequences on the
// live path, both fixed here, both on channels that already existed:
//
//   • `personaBase` resolved `action: 'answer'` — the manual-chat contract.
//     `what_to_say` is this surface's own action (`runWhatShouldISay` is
//     literally its caller) and carries the instruction the overlay most needs:
//     "Output only the exact words the user should say next in the active role.
//     No coaching, alternatives, labels, or quotation marks."
//
//   • `<repeat_press_directive>` reached the model only via `packet`. Measured
//     live 2026-08-19: pressing the trigger again on the same coding page, with
//     no new question, produced commentary on the previous answer and then
//     agreement with it.
//
// ── TWO THINGS THE FINDINGS DOC GOT WRONG, both found by DUMPING the composed
//    prompt rather than reading the code ────────────────────────────────────
//
//   1. It expected this switch to restore Team Meet's "only when directly
//      addressed" overlay rule. That rule is ALREADY present under 'answer'.
//      `voiceOverlay()` returns '' for team-meet+'answer', so the rule arrives
//      by another route — and the half of the finding predicting an overlay that
//      "answers other attendees' chatter" does not reproduce.
//
//   2. It described the coding CONTRACT as discarded under V3. It is not:
//      personaBase passes `_promoted` through as `codingTask`, and the composed
//      prompt does contain the Complexity / Dry Run sections. Only the DIRECTIVE
//      was missing.
//
// ── AND THE REASON CODING TURNS KEEP 'answer' ───────────────────────────────
//
// `what_to_say` + codingTask composes BOTH "output only the exact words to say"
// AND the six-section coding contract into one prompt — two instructions that
// cannot both be obeyed. A coding answer on the live surface is a written
// artifact, not words to read aloud.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { resolveV2SystemPrompt } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/llm/promptSystemV2.js'));

const SPOKEN_WORDS = /exact words the user should say/;
const CODING_SECTIONS = /Complexity|Dry Run/i;
const ADDRESSED_RULE = /directly addressed/;

const compose = (action, codingTask, templateType = 'team-meet') =>
  String(resolveV2SystemPrompt({
    action, codingTask, tier: 'standard',
    activeMode: { id: 'm', templateType, name: templateType },
  }) || '');

describe('the live surface asks for spoken words on a non-coding turn', () => {
  test("'what_to_say' carries the spoken-words contract; 'answer' does not", () => {
    assert.match(compose('what_to_say', false), SPOKEN_WORDS);
    assert.doesNotMatch(compose('answer', false), SPOKEN_WORDS,
      'if this ever matches, the switch stopped being the thing that adds it');
  });

  test('it does not smuggle in the coding contract', () => {
    assert.doesNotMatch(compose('what_to_say', false), CODING_SECTIONS);
  });
});

describe('a coding turn keeps the written contract, and the two never mix', () => {
  test("'what_to_say' + coding would contradict itself — which is why coding keeps 'answer'", () => {
    // Pinning the contradiction so the exception is not "tidied away" later by
    // someone who sees an inconsistent action and makes it uniform.
    const both = compose('what_to_say', true);
    assert.match(both, SPOKEN_WORDS);
    assert.match(both, CODING_SECTIONS);
  });

  test("'answer' + coding gives the section contract with no spoken-words rule", () => {
    const coding = compose('answer', true);
    assert.match(coding, CODING_SECTIONS);
    assert.doesNotMatch(coding, SPOKEN_WORDS);
  });
});

describe("the findings doc's Team Meet claim does not reproduce", () => {
  test('the "directly addressed" rule is present under BOTH actions', () => {
    for (const action of ['answer', 'what_to_say']) {
      for (const codingTask of [false, true]) {
        assert.match(compose(action, codingTask), ADDRESSED_RULE,
          `team-meet lost its overlay rule under action=${action} coding=${codingTask}`);
      }
    }
  });

  test('recruiting keeps its interviewer-probe voice under both actions', () => {
    for (const action of ['answer', 'what_to_say']) {
      assert.match(compose(action, false, 'recruiting'), /INTERVIEWER/,
        `recruiting lost its voice overlay under ${action}`);
    }
  });
});

describe('EXPLANATORY modes keep the direct-answer contract', () => {
  // Review finding: the first version switched unconditionally across all nine
  // modes, and the suite only exercised team-meet and recruiting — the two where
  // `voiceOverlay()` supplies role framing — so a green run said nothing about
  // the other seven.
  //
  // `answer` branches on mode ("in a live role mode, output the exact words that
  // role should say. IN DIRECT CHAT OR AN EXPLANATORY MODE, ANSWER THE USER
  // DIRECTLY"). `what_to_say` does not. The per-mode voice table settles which
  // is which: lecture is "a quiet study partner explaining to the student …
  // never speak as the student", and general is "the assistant in direct chat,
  // or the user's own voice … as the moment requires".
  for (const mode of ['lecture', 'general']) {
    test(`${mode} must NOT get a script-for-the-user contract`, () => {
      assert.doesNotMatch(compose('answer', false, mode), SPOKEN_WORDS,
        `${mode} is explanatory; "output only the exact words to say" turns an `
        + 'explanation into a recitation');
    });
  }

  // The modes where the user genuinely IS the speaker keep the spoken contract.
  for (const mode of ['team-meet', 'sales', 'call-center', 'looking-for-work']) {
    test(`${mode} is a speaking role and does get it`, () => {
      assert.match(compose('what_to_say', false, mode), SPOKEN_WORDS);
    });
  }
});

describe('a screen-code deictic turn does not get contradictory instructions', () => {
  // Review finding, HIGH. `_promoted` is `!codingSignals.codingTask && …`, so it
  // is FALSE exactly when the signals say coding; and the bridge's `codingTask`
  // is `isCodingAnswerType(answerPlan.answerType)`, false for `unknown_answer`.
  // A deictic ask over a code template on screen satisfied NEITHER term, so it
  // would have taken 'what_to_say' — "no coaching, alternatives, LABELS" — while
  // the CodingStreamGate and the post-stream repair independently enforced the
  // six-section shape. The prompt would forbid the headings the repair requires.
  //
  // The engine branch is not directly reachable from here, so this pins the
  // PROPERTY that makes the bug possible: the two contracts are mutually
  // exclusive, therefore whatever picks between them must never see a coding
  // turn as non-coding.
  test('the spoken-words rule and the section contract never belong together', () => {
    const spoken = compose('what_to_say', false);
    const sections = compose('answer', true);
    assert.match(spoken, SPOKEN_WORDS);
    assert.doesNotMatch(spoken, CODING_SECTIONS);
    assert.match(sections, CODING_SECTIONS);
    assert.doesNotMatch(sections, SPOKEN_WORDS);
  });
});
