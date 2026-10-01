// electron/llm/codingShape.ts
//
// WHAT a coding turn asked for, decided in code (2026-09-29).
//
// A coding turn used to get one answer shape whatever was asked: the six
// sections of CODING_CONTRACT. "write the code for odd even", "what's the
// complexity of this?" and "fix this" all came back as Approach / Technique /
// Code / Dry Run / Complexity / Interviewer Follow-up Points, and the
// post-stream repair rebuilt any answer that dared to be shorter. The shape
// returned here selects the matching contract in codingContract.ts, and the
// validator checks the answer against the SAME shape, so the prompt and the
// repair can never disagree about what the answer should contain.
//
// Deterministic and dependency-free. It only classifies a turn the caller has
// ALREADY decided is a coding turn (routed coding type, a follow-up promoted to
// coding, a screenshot promotion); it never makes a turn a coding turn.

import type { CodingShape } from './codingContract';

// Code inside the question must not vote: "explain this code: ... return fib(n)"
// is an explain ask, whatever words the code contains.
const stripCode = (q: string): string =>
  q.replace(/```[\s\S]*?```/g, ' ').replace(/```[\s\S]*$/, ' ').replace(/`[^`\n]*`/g, ' ');

// An explicit ask for the whole interview template.
const FULL_RE = /\b(?:full|complete|entire|whole)\s+(?:interview\s+)?(?:walk-?through|write-?up|answer\s+format|breakdown|template|treatment)\b|\ball\s+(?:the\s+|six\s+|6\s+)?sections\b|\b(?:six|6)[- ]section\b|\bfollow-?up\s+points\b|\bwith\s+(?:a\s+)?dry\s*run\s+and\s+(?:the\s+)?(?:complexity|follow-?ups?)\b/i;

// Asking for something to be PRODUCED. "code" counts only as a verb or as the
// object of give/show/write ("give me the code"), never as the noun in "explain
// this code" / "what's the complexity of this code".
const WRITE_RE = /\b(?:write|implement|program|code\s+(?:it|this|that|up|for|to|a|an|the)\b|give\s+(?:me\s+)?(?:the\s+)?code|show\s+(?:me\s+)?(?:the\s+)?code|(?:the\s+)?code\s+for)\b/i;
const SOLVE_RE = /\b(?:solve|solution\s+(?:for|to)|leetcode|hackerrank|codeforces)\b/i;

const DEBUG_RE = /\bwhat(?:'s|\s+is)\s+wrong\b|\b(?:debug|bug|buggy|fix|broken|hangs?|hanging|infinite\s+loop|stack\s*overflow|off[- ]by[- ]one|wrong\s+(?:output|answer|result)|(?:does\s*n[o']?t|doesn'?t|isn'?t|not)\s+(?:work|working|compile|run|pass)|fails?|failing|throws?|exception|crash(?:es|ing)?|error)\b/i;
const DRY_RUN_RE = /\bdry[- ]?run\b|\btrace\b|\bstep\s+through\b|\bwalk\s+(?:me\s+)?through\s+(?:the\s+|its\s+)?execution\b|\bwhat\s+(?:does|would|will)\s+(?:this|it|the\s+(?:code|function))\s+(?:return|output|print)\s+(?:for|on|with|given)\b/i;
const COMPLEXITY_RE = /\bcomplexit(?:y|ies)\b|\bbig[- ]?o\b|\bhow\s+(?:fast|efficient|slow)\s+is\b|\bruntime\s+of\b/i;
const BRUTE_RE = /\bbrute[- ]?force\b|\bnaive\s+(?:approach|solution|way|version)\b/i;
const OPTIMIZE_RE = /\boptimi[sz](?:e|ed|ing|ation)\b|\bmore\s+efficient\b|\bfaster\b|\bspeed\s+(?:it|this)\s+up\b|\bimprove\s+(?:it|this|that|the\s+(?:code|solution|complexity))\b|\bbetter\s+(?:approach|solution|complexity|way)\b|\breduce\s+(?:the\s+)?(?:time|space|complexity|runtime)\b|\bcan\s+(?:you|we|i)\s+do\s+better\b/i;
const WALKTHROUGH_RE = /\bwalk-?\s*(?:me\s+|us\s+)?through\b|\btalk\s+(?:me\s+|us\s+)?through\b|\bexplain\s+(?:your|the|this|my)\s+(?:solution|answer)\b|\bhow\s+would\s+(?:you|i)\s+explain\b/i;
const EXPLAIN_RE = /\bexplain\b|\bwhat\s+(?:does|is)\s+(?:this|that|the|my)\s+(?:code|function|snippet|program|line|loop)\b|\bhow\s+does\s+(?:this|that|the|my)\s+(?:code|function|snippet|program|loop)?\s*work\b|\bwhat\s+is\s+(?:this|that)\s+doing\b|\bunderstand\s+(?:this|the)\s+code\b/i;
const EXPLAIN_IDEA_RE = /\bexplain\s+(?:the\s+|your\s+)?(?:approach|idea|intuition|logic|algorithm|strategy)\b/i;
const APPROACH_RE = /\b(?:what|which)\s+(?:approach|data\s+structures?|algorithms?|technique|pattern|strategy|method)\b|\bapproach\s+(?:should|would|do|can)\b|\bhow\s+(?:would|should|do|can|could)\s+(?:you|i|we)\s+(?:approach|tackle|think\s+about|start)\b|\bhint\b|\bintuition\b|\bkey\s+(?:idea|insight)\b|\bwhere\s+(?:do|should)\s+i\s+start\b|\bhigh[- ]level\s+(?:idea|approach|plan)\b/i;

/**
 * The shape a coding turn asked for. `null`/empty question (a blind press, a
 * screenshot with no words) is a request to solve what is in front of the user.
 *
 * Order matters and is tested: an explicit full ask wins; debugging wins over
 * everything that merely mentions the code; a question that asks for something
 * to be WRITTEN or SOLVED is a solution even when it also names the complexity
 * or a dry run ("solve two sum and give me the time complexity"); the narrow
 * asks follow; the safe default is `solve` (approach + code + complexity), the
 * shape that still contains everything a coding answer normally needs.
 */
export function detectCodingShape(question: string | null | undefined): CodingShape {
  const q = stripCode(String(question ?? '')).trim();
  if (!q) return 'solve';
  if (FULL_RE.test(q)) return 'full';
  if (DEBUG_RE.test(q)) return 'debug';

  const writes = WRITE_RE.test(q);
  const solves = SOLVE_RE.test(q);
  if (writes || solves) {
    if (OPTIMIZE_RE.test(q)) return 'optimize';
    // "Write" names a piece of code; "solve" names a problem to be worked.
    return solves ? 'solve' : 'code';
  }

  if (DRY_RUN_RE.test(q)) return 'dry_run';
  if (COMPLEXITY_RE.test(q)) return 'complexity';
  if (BRUTE_RE.test(q)) return 'brute_force';
  if (OPTIMIZE_RE.test(q)) return 'optimize';
  if (EXPLAIN_IDEA_RE.test(q)) return 'approach';
  if (WALKTHROUGH_RE.test(q)) return 'walkthrough';
  if (EXPLAIN_RE.test(q)) return 'explain';
  if (APPROACH_RE.test(q)) return 'approach';
  return 'solve';
}

/** A shape that asks for ONE narrow thing rather than a solution. */
export const NARROW_CODING_SHAPES: ReadonlySet<CodingShape> = new Set<CodingShape>([
  'approach', 'brute_force', 'complexity', 'dry_run', 'explain', 'walkthrough',
]);
