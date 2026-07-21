// electron/llm/codingFollowup.ts
//
// Coding answer FORMAT CONTRACTS + same-session coding FOLLOW-UPS.
//
// Two real bugs this fixes (observed in the manual test session 2026-06-15):
//   (#5/#7) "Write code only for Two Sum in Python" returned the full six-section
//           DSA template, because the coding prompt ALWAYS injected the six-section
//           contract and the post-stream repair ALWAYS forced every heading back in
//           — even when the user explicitly constrained the format.
//   (#6)    "Give time and space complexity" after a Two Sum answer lost the prior
//           problem: it was re-planned as a fresh coding question with no link to the
//           code it was supposed to analyse.
//
// THE RULE (task Phase 11): an EXPLICIT user format instruction beats the default DSA
// template, and a coding FOLLOW-UP inherits the previous coding problem unless it
// introduces a new one. This module is the deterministic (no-LLM) decision layer for
// both. Pure + dependency-light (only the shared CODING_CONTRACT text), so it is fully
// unit-testable and importable without cycle risk.

import { CODING_CONTRACT } from './codingContract';

/**
 * An EXPLICIT coding format constraint the user stated. `null` = no explicit
 * constraint, so the default six-section DSA contract governs.
 *   - code_only       → only the code, no prose/sections.
 *   - complexity_only → only the time/space complexity analysis.
 *   - dry_run_only    → only a dry run / trace of the existing solution.
 *   - explain_only    → explanation only, NO code.
 */
export type ExplicitCodingContract =
  | 'code_only'
  | 'complexity_only'
  | 'dry_run_only'
  | 'explain_only'
  | null;

const lc = (s?: string) => (s || '').toLowerCase().trim();

// "code only" / "just the code" / "only give code" / "no explanation, just code".
const CODE_ONLY_RE =
  /\b(?:just|only)\s+(?:the\s+|me\s+the\s+)?code\b|\bcode[- ]?only\b|\bonly\s+(?:give|write|show)\s+(?:me\s+)?(?:the\s+)?code\b|\bno\s+explanation,?\s+just\b|\bgive\s+me\s+(?:only\s+)?the\s+code\b|\bcode\s+(?:and\s+)?nothing\s+else\b/i;

// "dry run" / "trace through" / "walk through the code".
const DRY_RUN_RE =
  /\bdry[- ]?run\b|\btrace\s+(?:through|it|the\s+code|the\s+solution|this)\b|\bwalk\s+(?:me\s+)?through\s+(?:the|your)\s+(?:code|solution|execution)\b|\bstep\s+through\s+(?:the|your|this)\b/i;

// "time and space complexity" / "what's the complexity" / "big-O".
const COMPLEXITY_RE =
  /\b(?:time\s*(?:and|&|\/|,)?\s*space|space\s*(?:and|&|\/|,)?\s*time)\s+complexit/i;
const COMPLEXITY_LOOSE_RE =
  /\b(?:give|state|tell\s+me|what(?:'s| is| are)?|analy[sz]e|provide)\b[^.?!]*\bcomplexit/i;
const COMPLEXITY_BARE_RE = /^\s*(?:the\s+)?(?:time\s+and\s+space\s+)?complexit(?:y|ies)\??\s*$/i;
const BIG_O_RE = /\bbig[- ]?o\b(?!ther)/i;

// "without code" / "without writing code" / "no code" / "explain only" /
// "don't write code" / "conceptually". The (?:writing|using|adding)? gerund covers
// "without writing code" / "no actual code" phrasings.
const EXPLAIN_ONLY_RE =
  /\b(?:without|no|don'?t\s+(?:write|use|include|give))\s+(?:any\s+|actual\s+|writing\s+|using\s+|adding\s+|me\s+)*code\b|\bexplain\s+(?:it\s+|this\s+|the\s+\w+\s+)?(?:only|conceptually|in\s+words|in\s+plain\s+english)\b|\bonly\s+explain\b|\bconceptual(?:ly)?\s+(?:answer|explanation)\b|\bjust\s+explain\b/i;

/**
 * Detect an explicit coding FORMAT constraint from the question. Deterministic,
 * order = most-specific-first. Returns `null` when there is no explicit constraint
 * (the default six-section DSA contract then governs).
 */
export function detectExplicitCodingContract(question: string): ExplicitCodingContract {
  const q = lc(question);
  if (!q) return null;
  if (CODE_ONLY_RE.test(q)) return 'code_only';
  if (DRY_RUN_RE.test(q)) return 'dry_run_only';
  if (EXPLAIN_ONLY_RE.test(q)) return 'explain_only';
  if (COMPLEXITY_RE.test(q) || COMPLEXITY_BARE_RE.test(q) || BIG_O_RE.test(q)) return 'complexity_only';
  // Loose complexity ("give the complexity", "what is the complexity") only when the
  // message is short — a long question that merely mentions complexity is a full ask.
  if (COMPLEXITY_LOOSE_RE.test(q) && q.split(/\s+/).length <= 12) return 'complexity_only';
  return null;
}

// Back-references that prove the message is ABOUT a prior solution, not a new problem.
const BACKREF_RE =
  /\b(it|this|that|the\s+(?:above|previous|prior|last|same|code|solution|function|algorithm|approach|problem))\b/i;

// STRONG coding-domain continuation signals — these are coding-specific enough that a
// SHORT message containing them is a coding follow-up on their own ("make it iterative",
// "what's the complexity", "handle duplicates", "without extra space").
const CONTINUATION_STRONG_RE =
  /\b(in[- ]?place|iterativ|recursiv|complexit|big[- ]?o|dry[- ]?run|trace|step\s+through|edge\s+cases?|handle\s+(?:duplicates?|negatives?|empty|nulls?)|space[- ]?optimi|without\s+(?:extra\s+)?space|one[- ]?pass|two[- ]?pointers?|time\s+and\s+space)\b/i;
// LOOSE generic verbs ("optimize", "improve", "rewrite", "convert", "faster") that ALSO
// appear in non-coding asks ("improve our onboarding", "rewrite the landing page copy").
// These only count as a coding continuation when paired with an explicit back-reference
// to the prior solution — never on word-count alone (code-review MEDIUM 2026-06-15).
const CONTINUATION_LOOSE_RE =
  /\b(optimi[sz]e|optimal|improve|make\s+it|refactor|rewrite|convert|faster|more\s+efficient|walk\s+through)\b/i;

/**
 * Is `question` a coding CONTINUATION — a short follow-up that only makes sense
 * relative to a prior coding solution ("give time and space complexity", "dry run
 * this with …", "now optimize it", "make it iterative")? This is the SHAPE test; the
 * caller confirms a prior coding turn actually exists before acting on it.
 *
 * Guarded so a long, self-contained coding question is NOT treated as a follow-up:
 * a continuation must be short OR carry an explicit back-reference.
 */
export function isCodingContinuation(question: string): boolean {
  const q = lc(question);
  if (!q) return false;
  if (detectExplicitCodingContract(q)) return true; // code_only/complexity/dry-run/explain are all continuations-or-constraints
  const words = q.split(/\s+/).filter(Boolean).length;
  // STRONG coding signal: a SHORT message is a follow-up on its own; a LONG one needs a
  // back-reference ("Optimize the merge step of a 200-line service…" is NOT a follow-up).
  if (CONTINUATION_STRONG_RE.test(q)) return words <= 9 || BACKREF_RE.test(q);
  // LOOSE generic verb ("optimize it", "improve it", "rewrite that"): ONLY when it
  // back-references the prior solution — never on word-count alone, so "improve our
  // onboarding email" / "rewrite the landing page copy" are NOT coding follow-ups.
  if (CONTINUATION_LOOSE_RE.test(q)) return BACKREF_RE.test(q);
  return false;
}

/** A stored coding turn (what we recall to give a follow-up its prior problem). */
export interface PriorCodingTurn {
  userMessage: string;
  assistantAnswer: string;
}

const fence = (s: string) => s.replace(/```/g, '``​`');

/**
 * Build the PRIOR-PROBLEM context block prepended to a coding follow-up's prompt so
 * the model resolves "give complexity" / "dry run this" / "optimize it" against the
 * SAME problem and code, instead of asking what problem it is. The prior code block
 * is preserved verbatim (the model needs it to analyse). Bounded so a huge prior
 * answer can't blow the prompt.
 */
export function buildPriorCodingContextBlock(turn: PriorCodingTurn): string {
  const q = (turn.userMessage || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const a = (turn.assistantAnswer || '').trim().slice(0, 2400);
  return `PRIOR CODING PROBLEM IN THIS CONVERSATION (the user's new message is a follow-up to it — resolve it against THIS problem and code; do not ask which problem):
Previous question: ${fence(q)}

Previous answer/solution:
${fence(a)}`;
}

const NO_LEAK_RULES = `Additional rules:
- Do not include resume, JD, salary, negotiation, or unrelated profile context.
- NEVER mention "Natively", the assistant, the product, or the candidate's profile/projects. This is a pure technical answer about the algorithm only.`;

/**
 * Build the prompt-ready coding answer contract for a manual coding answer, honoring
 * an explicit format constraint. With `null` this is the standard six-section DSA
 * contract (current behavior). With an explicit constraint it is a MINIMAL contract
 * that produces ONLY what the user asked for — no six-section template, so the
 * post-stream repair has nothing to "fix" back into a full template.
 */
export function buildCodingContractPrompt(
  explicitContract: ExplicitCodingContract,
  opts?: { includeVerification?: boolean; verificationInstruction?: string },
): string {
  if (!explicitContract) {
    const verification = opts?.includeVerification && opts.verificationInstruction
      ? `\n\n${opts.verificationInstruction}`
      : '';
    return `<answer_contract>
answerType: coding
${CODING_CONTRACT}

${NO_LEAK_RULES}${verification}
</answer_contract>`;
  }

  const body = (() => {
    switch (explicitContract) {
      case 'code_only':
        return `The user asked for CODE ONLY. Output ONLY the solution as a single fenced code block with a language tag (e.g. \`\`\`python). NO prose before or after, NO "## Approach"/"## Complexity"/any heading, NO explanation, NO dry run. Just the code.`;
      case 'complexity_only':
        return `The user asked ONLY for the COMPLEXITY of the solution already in the conversation. Output ONLY:
- Time Complexity: O(...), because ...
- Space Complexity: O(...), because ...
Reference the SAME problem/solution from the prior turn. Do NOT restate the problem, re-output the code, or add other sections.`;
      case 'dry_run_only':
        return `The user asked ONLY for a DRY RUN / trace of the solution already in the conversation, on the input they gave. Output ONLY the step-by-step trace (state at each step → final output). Do NOT re-output the code, the approach, or the complexity unless it falls out of the trace.`;
      case 'explain_only':
        return `The user asked for an EXPLANATION with NO CODE. Output a clear, speakable explanation in prose (and short bullets if helpful). Do NOT output any code block. No "## Code" section.`;
    }
  })();

  return `<answer_contract>
answerType: coding (explicit format: ${explicitContract})
${body}

${NO_LEAK_RULES}
</answer_contract>`;
}

/** Verification (the hidden test block) only makes sense when NEW code is produced. */
export function explicitContractProducesCode(explicitContract: ExplicitCodingContract): boolean {
  return explicitContract === null || explicitContract === 'code_only';
}
