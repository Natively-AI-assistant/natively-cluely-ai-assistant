// scripts/intent-benchmark/lib/deriveVoice.mjs
//
// `voice` is DERIVED, not independently labelled. This module is the derivation
// and the reason for it.
//
// WHY IT IS NOT AN LLM LABEL
//
// Two labelling passes both failed, in opposite directions, which is the tell
// that the axis was never a judgement call:
//
//   Pass 1 collapsed to "advisor": 103 of 104 responding Sales turns and 102 of
//   102 Seminar turns, in modes whose whole contract is that the output is what
//   the user SAYS ALOUD.
//
//   Pass 2, after the definition was rewritten, over-corrected to
//   "first_person_script": 86 of 89 Team Meet turns, in a mode whose primary job
//   is capture, and — far worse — 51 Recruiting turns, where the user is the
//   INTERVIEWER. Labelling those first_person_script instructs the system to
//   hand the recruiter words to say as though they were the candidate. That is
//   precisely the channel inversion this whole campaign exists to fix, so
//   shipping a corpus that teaches it would have been self-defeating.
//
// WHY DERIVING IS CORRECT, NOT A SHORTCUT
//
// The Phase 1 audit already established that voice is fixed per mode by the
// prompt (docs/natively-current-modes.md), with exactly two documented
// deviations: Team Meet switches to first person when the user is called on,
// and Lecture switches when the student is answering. It is a function of
// (mode, mode_intent, needs_response), and the router's per-mode `default_voice`
// config will compute it the same way in production.
//
// WHAT THAT MEANS FOR THE BENCHMARK, STATED PLAINLY
//
// Because voice is a deterministic function of two other labelled fields, a
// candidate scored on it is being measured on whether it can learn that
// function, NOT on independent judgement. It must therefore NOT be treated as
// an independent axis in the acceptance bar, and the report says so. Scoring it
// as if it were independent would inflate any model that gets mode_intent right.

/** Mode intents that flip Team Meet out of capture and into the user's voice. */
const TEAM_MEET_SPEAKING_INTENTS = new Set(['called_on_for_status', 'question_to_me']);

/** Lecture flips to first person only when the student is the one answering. */
const LECTURE_SPEAKING_INTENTS = new Set(['question_to_room']);

/** General has no fixed persona; its sensed scenario decides. */
const GENERAL_VOICE_BY_INTENT = {
  interview_answer: 'first_person_script',
  sales_objection: 'first_person_script',
  meeting_capture: 'capture',
  lecture_concept: 'advisor',
  coding_question: 'advisor',
  factual_question: 'advisor',
  small_talk: 'advisor',
};

/** Modes where the user speaks the output as themselves. */
const FIRST_PERSON_MODES = new Set([
  'technical-interview', 'looking-for-work', 'sales', 'seminar', 'call-center',
]);

/**
 * Modes where the output is advice ABOUT someone else and must never be a
 * script. Recruiting is here for a load-bearing reason: the user is the
 * interviewer, so first person would put the candidate's words in their mouth.
 */
const ADVISOR_MODES = new Set(['recruiting', 'lecture']);

/**
 * @param {{mode: string, custom_mode_key?: string, labels: {needs_response: string, mode_intent: string}}} row
 * @param {{defaultVoice?: string}} [spec] the custom mode's spec, when mode === 'custom'
 * @returns {'first_person_script'|'advisor'|'capture'|'silent'}
 */
export function deriveVoice(row, spec = null) {
  const needs = row?.labels?.needs_response;
  // The invariant the schema already enforces. Nothing that needs no response
  // has a voice.
  if (needs === 'no') return 'silent';

  const intent = row?.labels?.mode_intent;
  const key = row?.custom_mode_key ?? row?.mode;

  if (key === 'team-meet') {
    return TEAM_MEET_SPEAKING_INTENTS.has(intent) ? 'first_person_script' : 'capture';
  }
  if (key === 'lecture') {
    // Only when the student actually answers. A rhetorical question to the room
    // that needs no response never reaches here.
    return LECTURE_SPEAKING_INTENTS.has(intent) && needs !== 'no' ? 'first_person_script' : 'advisor';
  }
  if (key === 'general') {
    return GENERAL_VOICE_BY_INTENT[intent] ?? 'advisor';
  }
  if (ADVISOR_MODES.has(key)) return 'advisor';
  if (FIRST_PERSON_MODES.has(key)) return 'first_person_script';

  // Custom modes inherit their spec's default; a custom mode is a renamed
  // General, so absent a spec, General's advisor default applies.
  return spec?.defaultVoice ?? 'advisor';
}
