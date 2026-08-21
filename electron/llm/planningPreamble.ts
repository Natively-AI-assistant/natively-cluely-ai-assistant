// electron/llm/planningPreamble.ts
//
// RC-6 (live shadow session C, 2026-08-21): the model sometimes opens a
// What-to-Answer response with its own DELIBERATION — planning notes addressed
// to itself, not spoken content:
//
//   "Since the interviewer is asking directly about what I built in Natively,
//    and the résumé shows me as the builder of the whole project (16,000+
//    users, $25K+ revenue…), I should answer in my own voice describing what I
//    personally built. The prior assistant turn already established the
//    product story, so this should go deeper…"  → then the real answer.
//
// Live presses 5/13/20/47 all shipped this; press 5 additionally leaked résumé
// figures inside the meta-commentary. Every existing guard was a no-op on the
// verbatim text (measured): the scaffold detector needs ≥2 markdown headings,
// the candidate sanitizer's markers only match assistant-IDENTITY phrasing
// ("as an AI model"), and detectAssistantVoiceMisfire targets misfired
// identity replies. Nothing recognized self-directed planning prose.
//
// This module strips LEADING planning sentences deterministically — sentence
// by sentence from the top, stopping at the first sentence that reads as real
// answer content. Conservative on purpose:
//   - only the answer's OPENING run of sentences is ever touched; a mid-answer
//     "I should mention…" is content and stays;
//   - a sentence must carry an explicit deliberation frame (the interviewer
//     is asking / I should answer / let me answer with / the résumé shows me)
//     to be stripped;
//   - if stripping would empty the answer, the original is returned unchanged
//     (fail-open — a wrong answer is worse than a leaky one).

/** Sentence-level deliberation frames. Each must be a PLANNING statement about
 * the exchange itself, never plausible first-person spoken content. */
const PLANNING_SENTENCE_RES: RegExp[] = [
  // "Since/So the interviewer is asking/pushing/probing…" — narration of the
  // interviewer's move. A candidate never says this aloud.
  /^(?:since|so|okay,?\s*so|now,?\s*)?\s*the interviewer (?:is|was|'s|seems|keeps?|just)\s+(?:asking|pushing|probing|looking|trying|wanting|testing|drilling|really)/i,
  // Self-directed answer planning: "I should answer…", "I'll answer with…",
  // "Let me answer…". Code-review 2026-08-22, two fixes in one:
  //   1. the old alternation required a SPACE before the contraction
  //      ("I 'll"), so "I'll answer…" — a documented live-leak shape — could
  //      never match;
  //   2. it was unanchored with content-capable verbs (address/focus/keep/
  //      describe), so a legitimate opener like "In this role I will address
  //      scalability by…" was silently deleted. Now anchored to the sentence
  //      start (with an optional short discourse lead-in) and restricted to
  //      verbs that are about ANSWERING itself, never about the subject
  //      matter.
  /^(?:(?:so|okay|now|first|alright|and),?\s+)?I(?:'ll|'m going to|\s+(?:should|will|need to|want to|am going to))\s+(?:answer|respond|reply|frame|structure|go deeper)\b/i,
  /^let me answer\b/i,
  // Meta-references to the material as material: "the résumé shows me as…",
  // "the prior assistant turn already established…".
  /\bthe (?:r[eé]sum[eé]|resume|cv) shows (?:me|him|her|them|the candidate)\b/i,
  /\bthe prior (?:assistant )?(?:turn|suggestion|answer|response)\b/i,
  /\bthe previous suggestion (?:covered|already)\b/i,
  // Choosing an answer as an option: "X is the strongest, most specific one" /
  // "that directly ties to the grounded project".
  /\bthe grounded (?:project|fact|answer|example)\b/i,
];

const isPlanningSentence = (sentence: string): boolean => {
  const s = sentence.trim();
  if (!s) return false;
  return PLANNING_SENTENCE_RES.some((re) => re.test(s));
};

export interface PlanningPreambleResult {
  text: string;
  repaired: boolean;
  /** Number of leading sentences removed (0 when untouched). */
  removedSentences: number;
}

/**
 * Split prose into alternating [sentence, separator, sentence, separator, …]
 * pieces (sentences at even indexes). The separators are CAPTURED so that
 * rejoining the survivors reproduces the original spacing byte-for-byte —
 * code-review 2026-08-22: the previous split consumed the separators and the
 * survivors were re-joined with single spaces, flattening every paragraph
 * break in a repaired answer into one run-on paragraph.
 */
const splitSentenceParts = (text: string): string[] =>
  text.split(/((?<=[.!?…])\s+)/);

/**
 * Strip the answer's leading run of planning sentences. Fenced code at the top
 * (never seen live, but cheap to respect) disables the whole pass.
 */
export function stripPlanningPreamble(answer: string): PlanningPreambleResult {
  const original = String(answer ?? '');
  const trimmed = original.trim();
  if (!trimmed || trimmed.startsWith('```')) {
    return { text: original, repaired: false, removedSentences: 0 };
  }

  const parts = splitSentenceParts(trimmed);
  // Sentences sit at even indexes; separators (captured whitespace) at odd.
  let cut = 0;
  while (cut * 2 < parts.length && isPlanningSentence(parts[cut * 2])) cut++;

  if (cut === 0) return { text: original, repaired: false, removedSentences: 0 };

  // Drop the stripped sentences AND their trailing separators; everything
  // after keeps its original spacing (paragraph breaks included).
  const rest = parts.slice(cut * 2).join('').replace(/^["']+/, '').trim();
  if (!rest) {
    // Everything was planning — nothing left to say. Fail open.
    return { text: original, repaired: false, removedSentences: 0 };
  }
  return { text: rest, repaired: true, removedSentences: cut };
}
