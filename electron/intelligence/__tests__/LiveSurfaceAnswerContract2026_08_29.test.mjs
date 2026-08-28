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
