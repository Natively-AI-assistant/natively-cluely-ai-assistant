// electron/llm/codingPromptSignals.ts
//
// THE single resolver for the three coding signals every prompt surface needs:
// is this a coding turn, what SHAPE of coding turn is it, and did the user
// constrain the output format.
//
// Why one module: six call sites (WhatToAnswerLLM, IntelligenceEngine's V3
// personaBase, ipcHandlers' V3 personaBase, two LLMHelper prompt selections,
// and the phone surface) each computed `codingTask` with their own inline
// `isCodingAnswerType(...)` expression. Adding kind/format detection to each of
// them by hand is exactly how `ci-v3-vacuous-gates` happened — some sites get
// wired, some do not, and the difference is invisible until a live turn.
//
// Everything returned is a BOUNDED enum or boolean. No question text is
// returned for the system prompt, deliberately: promptSystemV2 registers every
// composed prompt in a Map for reverse lookup, and per-turn text in the system
// prompt would make that key space unbounded.

import { isCodingAnswerType, type AnswerType } from './AnswerPlanner';
import { detectExplicitCodingContract, type ExplicitCodingContract } from './codingFollowup';

/**
 * Which coding contract the turn wants.
 *   - 'dsa'  → `dsa_question_answer`: a named algorithm/interview problem. The
 *              six-section walkthrough (Approach / Technique / Code / Dry Run /
 *              Complexity / Follow-up Points) is the product format.
 *   - 'impl' → `coding_question_answer`: a build task ("write a React
 *              stopwatch"). Code-first with the correct fence tag and a short
 *              explanation — NOT an interview walkthrough.
 *
 * This mirrors the split AnswerPlanner (CODING_TEMPLATE vs CODING_IMPL_TEMPLATE)
 * and AnswerValidator (six-heading vs light validator) already make.
 */
export type CodingTaskKind = 'dsa' | 'impl';

export interface CodingPromptSignals {
  /** The turn is coding-shaped: attach a coding contract in ANY mode. */
  codingTask: boolean;
  /** Which contract. Undefined when `codingTask` is false. */
  codingTaskKind?: CodingTaskKind;
  /** An explicit user format constraint that OVERRIDES the default shape. */
  codingFormat?: Exclude<ExplicitCodingContract, null>;
  /** The question already carries a code template the answer must conform to. */
  suppliedTemplate?: boolean;
}

// ── supplied-template detection ─────────────────────────────────────────────
//
// A "template already in the question" is a function signature, class stub,
// method skeleton, or fenced starter block the answer must be written INTO —
// typically a LeetCode/HackerRank harness read off the screen, or a signature
// the interviewer dictated. Inventing a different entry point makes the answer
// uncompilable against the editor the user is actually typing in.

/** A fenced code block anywhere in the question. */
const FENCED_BLOCK_RE = /```[\s\S]*?```/;

/** Declaration headers across the languages this product actually sees. */
const SIGNATURE_RE = new RegExp(
  [
    // Python: def name(...)  /  class Solution
    String.raw`\bdef\s+\w+\s*\(`,
    // A class DECLARATION — the name must be followed by `{` or `:` so prose
    // ("the class Solution we discussed", "a class diagram") cannot match.
    String.raw`\bclass\s+[A-Z]\w*\s*(?:\([^)]*\))?\s*[:{]`,
    String.raw`\bconstructor\s*\(`,
    // JS/TS: function name( , const name = ( ... ) => , method shorthand in a class
    String.raw`\bfunction\s+\w+\s*\(`,
    String.raw`\b(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>`,
    // Java/C#/C++: public|private|static <type> name(
    String.raw`\b(?:public|private|protected|static)\s+[\w<>\[\],\s]+\s+\w+\s*\(`,
    // Go / Rust
    String.raw`\bfunc\s+(?:\([^)]*\)\s*)?\w+\s*\(`,
    String.raw`\bfn\s+\w+\s*\(`,
    // C/C++ free function with an explicit return type and a body/semicolon
    String.raw`\b(?:int|void|bool|double|float|char|string|vector<[^>]+>)\s+\w+\s*\([^)]*\)\s*[;{]`,
    // Class METHOD SHORTHAND on its own line: `  get(key) {`. Anchored to a line
    // start and requiring the opening brace so prose cannot match.
    String.raw`(?:^|\n)[ \t]*[\w$]+\s*\([^)\n]*\)\s*\{`,
  ].join('|'),
  'i',
);

/**
 * Prose that ASSERTS a template exists even when the stub itself was not
 * transcribed into the question ("keep the given signature" while the stub sits
 * on screen).
 *
 * Deliberately NARROW. It once also matched "complete the following function" /
 * "implement the method", which is the most ordinary phrasing for a plain coding
 * ask with no stub anywhere — and this signal drives an AFFIRMATIVE prompt line
 * ("a code template IS present, find it"), so a false positive tells the model to
 * hunt for something that does not exist. Every phrase here names a supplied
 * artifact rather than an action.
 */
const TEMPLATE_PHRASE_RE =
  /\b(?:given|provided|following|this|the)\s+(?:function\s+)?(?:signature|stub|template|skeleton|boilerplate)\b|\bstarter\s+code\b|\byour\s+code\s+here\b|\b(?:keep|match|follow|use)\s+(?:the\s+)?(?:given|provided|existing|same)\s+(?:function\s+)?(?:signature|stub|template|name|names)\b/i;

/**
 * Does the question already supply a code template the answer must conform to?
 *
 * Deterministic and deliberately structural: a bare mention of the word
 * "function" is not a template, a declaration header or an explicit
 * "complete the following method" is. False positives are cheap here — the
 * resulting directive is conditional ("if a template is supplied, use it") —
 * but a false negative silently loses the user's harness, so the phrase list
 * errs slightly inclusive.
 */
export function detectSuppliedCodeTemplate(question: string | undefined | null): boolean {
  const q = (question || '').trim();
  if (!q) return false;
  if (FENCED_BLOCK_RE.test(q)) return true;
  if (SIGNATURE_RE.test(q)) return true;
  if (TEMPLATE_PHRASE_RE.test(q)) return true;
  return false;
}

/**
 * STRUCTURAL-only twin of detectSuppliedCodeTemplate: real code is present (a
 * fenced block or a declaration header), not merely a word that also occurs in
 * ordinary prose.
 *
 * Added by code review 2026-08-19. The phrase list above is deliberately
 * inclusive because for an ALREADY-coding turn a false positive only produces
 * a conditional directive ("if a template is supplied, use it"). The screen-
 * stub PROMOTION below has no such tolerance: there a false positive converts
 * a non-coding turn into a full coding contract plus an affirmative "a code
 * template IS present — find it" instruction, so "Can you improve this
 * template for my newsletter?" / "match the given signature in the contract"
 * got the six-section DSA treatment and a hunt for a stub that never existed.
 * The promotion's own comment already promises "a real signature or fenced
 * block, not a phrase" — this is that promise in code.
 */
export function detectStructuralCodeTemplate(question: string | undefined | null): boolean {
  const q = (question || '').trim();
  if (!q) return false;
  return FENCED_BLOCK_RE.test(q) || SIGNATURE_RE.test(q);
}

// A SHORT question whose subject is a demonstrative — the words a person uses
// when the thing they mean is on the screen in front of them. Deliberately
// requires the demonstrative to BE the subject: "how do I do this", "what goes
// here", "solve this one". A long question that merely contains "this" is not
// deictic, and a question with its own concrete subject ("what does this
// candidate's resume say") is excluded by the word cap.
const DEICTIC_ASK_RE =
  /\b(this|that|these|it|here|the above|the screen)\b/i;

// The product's own trigger phrasings, BARE (2026-08-19): "What should I say?"
// carries no demonstrative, but with a screen attached it can only mean the
// screen. Anchored so "what should I say about my experience with Kafka" —
// which names its own subject — never matches.
const BARE_TRIGGER_ASK_RE =
  /^\s*what\s+(?:should|do|would|can)\s+i\s+(?:say|answer|respond|reply)\s*[?.!]*\s*$/i;

// Past-tense conversational frames ("how did that go", "was that ok") are
// deictic by grammar and never a request to write code. Excluded so an editor
// left open behind a sales call cannot promote small talk into a coding turn.
const RETROSPECTIVE_FRAME_RE = /\b(did|was|were|went|has|have)\b/i;

export function isDeicticAsk(question: string | undefined | null): boolean {
  const q = (question || '').trim();
  if (!q) return false;
  const words = q.split(/\s+/).filter(Boolean).length;
  if (words > 12) return false;
  if (RETROSPECTIVE_FRAME_RE.test(q)) return false;
  if (BARE_TRIGGER_ASK_RE.test(q)) return true;
  return DEICTIC_ASK_RE.test(q);
}

// ── screen-coding promotion (single source of truth) ────────────────────────
//
// Code-review 2026-08-22, two confirmed findings with one root: the
// screen-is-the-subject promotion was hand-rolled divergently at three call
// sites (WhatToAnswerLLM's contract promotion, IntelligenceEngine's V3
// personaBase callback, and — implicitly, by NOT knowing about it — the
// engine's scaffold stream-hold/regeneration gates). Two consequences:
//   1. The text-channel promotion skipped the structural-code check this
//      module's own screen-stub promotion requires, so ANY captured page
//      (a CRM dashboard, a job description) promoted a blind/deictic press
//      to a full DSA contract.
//   2. The engine's scaffold machinery could not see the promotion, so a
//      promoted turn's CORRECT six-section answer was first fully
//      stream-held and then regenerated away.
// One exported predicate, consulted everywhere, fixes both divergences.
//
// Images still promote without inspection — pixels cannot be structurally
// checked client-side, and the original live defect ("screenshot attached but
// code not generated") was image-based. Captured TEXT must contain a real
// structural code template (a signature or fenced block, not a phrase).
export function isPromotedScreenCodingTurn(input: {
  /** The routed turn is already coding-shaped — promotion is moot. */
  alreadyCoding: boolean;
  question?: string | null;
  hasImages: boolean;
  screenText?: string | null;
}): boolean {
  if (input.alreadyCoding) return false;
  const q = (input.question || '').trim();
  if (q && !isDeicticAsk(q)) return false;
  if (input.hasImages) return true;
  return detectStructuralCodeTemplate(input.screenText);
}

// ── build-task detection ────────────────────────────────────────────────────
//
// `coding_question_answer` is NOT a synonym for "implementation task". It is the
// FALLTHROUGH coding route: `dsa_question_answer` requires a hit in
// AnswerPlanner's DSA_PATTERNS, a finite list of named problems, and everything
// else coding-shaped lands here. Measured 2026-08-18 over 40 canonical interview
// problems: only 10 matched DSA_PATTERNS. "valid parentheses", "coin change",
// "trapping rain water", "LRU cache" and 26 others fell through.
//
// That was harmless while both types received the same DSA contract. The moment
// the kind selects the contract it stops being harmless: 30 of 40 classic
// interview problems would get the code-first implementation shape with no dry
// run and no complexity — a live-benchmark failure, not a theoretical one.
//
// So the kind is NOT read off the answer type alone. 'impl' requires positive
// evidence of a BUILD task; everything else defaults to 'dsa', which is both the
// pre-2026-08-18 behavior and the safe direction (the six-section shape contains
// the code an implementation answer would give, plus more).
const BUILD_TASK_RE = new RegExp(
  [
    // artifacts you build rather than algorithms you solve
    String.raw`\b(component|hook|endpoint|route|middleware|controller|service|micro-?service|server|api|sdk|client|cli|script|utility|util|helper|wrapper|decorator|plugin|extension|migration|dashboard|form|page|screen|website|web ?app|app|daemon|cron|job|pipeline|workflow|scraper|crawler|bot|parser|serializer|validator|logger|config|boilerplate|scaffold)\b`,
    // frameworks, platforms and languages-of-plumbing
    String.raw`\b(react|preact|vue|svelte|angular|next\.?js|nuxt|remix|express|fastify|nest\.?js|django|flask|fastapi|rails|spring boot|laravel|node\.?js|deno|bun|electron|tailwind|bootstrap|graphql|rest|grpc|websocket|redis|postgres|mysql|mongo|sqlite|prisma|sequelize|docker|kubernetes|terraform|github action|aws|s3|lambda|firebase|supabase|stripe)\b`,
    // data-plumbing verbs with an object, not algorithmic ones
    String.raw`\b(upload|download|fetch|scrape|render|deploy|authenticate|authorize|paginate|migrate|seed|integrate|connect to|call the)\b`,
    // file/format work
    String.raw`\b(csv|json|xml|yaml|pdf|excel|xlsx|markdown|html|css|regex|env file)\b`,
    // SQL work is always a build task, never an interview walkthrough.
    String.raw`\b(sql|query|queries|stored procedure|schema|table|join)\b`,
  ].join('|'),
  'i',
);

/**
 * Does this question ask for something BUILT (a component, a script, an
 * endpoint) rather than an algorithm SOLVED?
 */
export function isBuildTask(question: string | undefined | null): boolean {
  return BUILD_TASK_RE.test(question || '');
}

/**
 * Map a routed answer type + its question onto the contract shape.
 *
 * `question` is optional so existing callers keep compiling; without it a
 * `coding_question_answer` resolves to 'dsa', the safe default described above.
 */
export function codingTaskKindFor(
  answerType: AnswerType | string | undefined | null,
  question?: string | null,
): CodingTaskKind | undefined {
  if (answerType === 'dsa_question_answer') return 'dsa';
  if (answerType === 'coding_question_answer') return isBuildTask(question) ? 'impl' : 'dsa';
  return undefined;
}

/**
 * Resolve every coding prompt signal for a turn from what the caller already
 * has: the routed answer type and the question text. Never throws — a surface
 * that cannot resolve signals must still answer.
 *
 * Detection stays where it lives (AnswerPlanner owns `answerType`); this only
 * translates a routed verdict into prompt-shaping signals.
 */
/**
 * Format constraints whose DIRECTIVE references a solution that already exists
 * ("the solution already in the conversation", "do NOT re-output the code").
 * On a FIRST turn there is no such solution, so honouring them there answers
 * "solve two sum and give me the time complexity" with a bare complexity line
 * and no code — the opposite of what was asked. `code_only` and `explain_only`
 * are self-contained and need no prior turn.
 */
const CONTINUATION_ONLY_FORMATS: ReadonlySet<string> = new Set(['complexity_only', 'dry_run_only']);

export function resolveCodingPromptSignals(input: {
  answerType?: AnswerType | string | null;
  question?: string | null;
  /**
   * Extra text that is part of THIS turn but not of the question string —
   * screen OCR, an attached file. The canonical reported case is a LeetCode
   * stub visible on screen, which never appears in `answerPlan.question`.
   */
  surroundingText?: string | null;
  /**
   * Does a prior coding turn exist in this session? Gates the continuation-only
   * format contracts above. Defaults to FALSE so an un-wired surface degrades to
   * the full contract (an answer with more than was asked) rather than to a
   * stripped one (an answer missing the code).
   */
  priorCodingTurnExists?: boolean;
  /**
   * The CALLER already promoted this turn to the coding path (code review
   * 2026-08-19). Manual chat resolves a prior coding problem for bare/
   * continuation asks ("code?", "now optimize it") and flips its own
   * isCodingChat, but the turn is still PLANNED follow_up_answer — so deriving
   * codingTask from `answerType` alone returns false and the v2 system prompt
   * silently drops the whole coding contract block for exactly those turns.
   * `priorCodingTurnExists` cannot serve here: it gates continuation-only
   * FORMATS and must stay orthogonal to whether this is a coding turn at all.
   * Defaults false, so no surface changes behaviour without opting in.
   */
  codingTurnPromoted?: boolean;
}): CodingPromptSignals {
  let codingTask = false;
  try {
    codingTask = !!(input.answerType && isCodingAnswerType(input.answerType as AnswerType));
  } catch {
    codingTask = false;
  }
  // A caller-side promotion is authoritative: it means the surface resolved a
  // real prior coding problem for this turn and is attaching it as context.
  if (!codingTask && input.codingTurnPromoted === true) {
    codingTask = true;
  }
  // SCREEN-STUB PROMOTION (2026-08-18). A deictic ask with the problem visible
  // on screen — "how do I do this", "what goes here", "solve this one" — carries
  // no coding verb, so AnswerPlanner routes it `unknown_answer` and the turn gets
  // no coding contract in any mode. This is the canonical reported case (a
  // LeetCode stub in the editor, the question spoken) and a KNOWN-OPEN gap: see
  // electron/context-intelligence/__tests__/ScreenCodeAskCodingTask2026_08_05.test.mjs,
  // which pins that a screen code-ask does not claim CODING_TASK. Measured live:
  // 2 of 3 screen-stub scenarios produced prose with no code at all.
  //
  // The promotion is narrow on BOTH sides — it needs a STRUCTURAL template in the
  // surrounding evidence (a real signature or fenced block, not a phrase) AND a
  // short demonstrative question. It shapes the PROMPT only; the routed answer
  // type is untouched, so no profile/grounding policy shifts underneath it.
  //
  // Two shapes qualify:
  //   1. the stub is IN the question and the lead-in carries no coding verb —
  //      "Complete:", "Fill this in:", "Here is the starter code". Measured
  //      live: these routed to unknown_answer / sales_answer, and the model
  //      returned code with no fence at all because no contract asked for one.
  //   2. the stub is on SCREEN and the question is a bare demonstrative.
  if (!codingTask) {
    // STRUCTURAL detector only (code review 2026-08-19) — the promotion must
    // see real code, per this block's own "not a phrase" promise above.
    const stubInQuestion = detectStructuralCodeTemplate(input.question);
    const stubOnScreen = isDeicticAsk(input.question) && detectStructuralCodeTemplate(input.surroundingText);
    if (stubInQuestion || stubOnScreen) {
      return {
        codingTask: true,
        codingTaskKind: isBuildTask(input.question) ? 'impl' : 'dsa',
        suppliedTemplate: true,
      };
    }
  }
  if (!codingTask) return { codingTask: false };

  let codingFormat: ExplicitCodingContract = null;
  let suppliedTemplate = false;
  try {
    codingFormat = detectExplicitCodingContract(input.question || '');
    if (codingFormat && CONTINUATION_ONLY_FORMATS.has(codingFormat) && !input.priorCodingTurnExists) {
      codingFormat = null;
    }
    suppliedTemplate = detectSuppliedCodeTemplate(input.question)
      || detectSuppliedCodeTemplate(input.surroundingText);
  } catch {
    codingFormat = null;
    suppliedTemplate = false;
  }

  return {
    codingTask: true,
    codingTaskKind: codingTaskKindFor(input.answerType, input.question) ?? 'dsa',
    codingFormat: codingFormat ?? undefined,
    suppliedTemplate: suppliedTemplate || undefined,
  };
}
