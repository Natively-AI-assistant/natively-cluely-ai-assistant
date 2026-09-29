// electron/llm/codingContract.ts
//
// THE single source of truth for the coding/DSA answer structure. Every prompt
// surface and the validator import from here, so the six sections, their exact
// order, and their `## ` heading form can never drift apart again.
//
// History: the section spec was duplicated across prompts.ts (colon labels),
// tinyPrompts.ts (comma list), AnswerPlanner.ts (## headings), the assist
// prompt (### Dry Run), and AnswerValidator.ts (## headings). The model got
// contradictory instructions and the validator's `## ` check could reject the
// very format another prompt asked for. This module ends that.
//
// Dependency-free on purpose (no imports) so it can be pulled into prompts.ts,
// AnswerPlanner.ts, AnswerValidator.ts, and tests without any cycle risk.

/**
 * The six required section titles, WITHOUT the markdown prefix.
 *
 * 2026-09-29: the second section was "Technique / Data Structure / Algorithm
 * Used" and is now just "Technique". The validator still accepts the old
 * heading (stored answers, custom-mode instructions that quote it).
 */
export const CODING_SECTIONS = [
  'Approach',
  'Technique',
  'Code',
  'Dry Run',
  'Complexity',
  'Interviewer Follow-up Points',
] as const;

export type CodingSection = (typeof CODING_SECTIONS)[number];

/** The six headings in their exact, validator-checked markdown form. */
export const CODING_SECTION_HEADINGS: readonly string[] = CODING_SECTIONS.map(s => `## ${s}`);

/**
 * The full contract text injected into prompts. Imperative, model-facing.
 * Keep this the ONLY place the prose lives.
 */
export const CODING_CONTRACT = `CODING / DSA RESPONSE CONTRACT — output these EXACT markdown headings, in THIS order, with nothing before the first heading:

## Approach
- Short, interview-speakable explanation of the idea. Optimized approach clearly; brute force only if useful.

## Technique
- Name the core DSA concept/data structure/algorithm (e.g. two pointers, sliding window, hash map, stack, queue, binary search, DP, BFS/DFS, heap, trie, union-find, recursion, backtracking).

## Code
- Clean, correct, interview-ready code in ONE fenced block, tagged with the language you ACTUALLY wrote (\`\`\`python, \`\`\`java, \`\`\`cpp, \`\`\`javascript, \`\`\`typescript, \`\`\`go, \`\`\`rust, \`\`\`sql). A Java answer is tagged \`\`\`java, never \`\`\`python. Meaningful names, minimal comments. Do NOT start the answer with code — the \`## Approach\` heading comes first.

## Dry Run
- Walk through ONE sample input step by step and show how the code reaches the output.

## Complexity
- Time Complexity: O(...), because ...
- Space Complexity: O(...), because ...

## Interviewer Follow-up Points
- Syntax/built-ins, edge cases, assumptions, duplicates, boundaries, tradeoffs, or optimizations the interviewer might probe.

Every heading is mandatory and must appear verbatim (with the \`## \` prefix). Even a small/local model must emit every heading. A missing/renamed heading, or starting with code, is a format failure.`;

/**
 * A compact one-line variant of the contract for tiny-model prompts where token
 * budget is tight but the SAME heading contract must hold.
 */
export const CODING_CONTRACT_TINY = `Coding/DSA answers MUST use these EXACT markdown headings, in order, nothing before the first: "## Approach", "## Technique", "## Code" (one fenced block tagged with the language you actually wrote — Java is \`\`\`java, never \`\`\`python), "## Dry Run", "## Complexity" (Time + Space, each "O(...) because ..."), "## Interviewer Follow-up Points". Never start with code. A missing/renamed heading is a failure.`;

/**
 * WHAT a coding turn asked for (2026-09-29). The six-section contract above
 * answered every coding turn the same way, so "write the code for odd even"
 * came back as Approach / Technique / Code / Dry Run / Complexity / Follow-up
 * Points. The shape is decided in code from the question (codingShape.ts) and
 * selects one of the contracts below; the six sections stay reachable as
 * `full`, for an explicit ask.
 *
 * Bounded on purpose: the shape is part of the composed system prompt, so it
 * is part of the prompt-registry and provider prompt-cache keys.
 */
export const CODING_SHAPES = [
  'code', 'solve', 'approach', 'brute_force', 'optimize',
  'complexity', 'dry_run', 'explain', 'debug', 'walkthrough', 'full',
] as const;
export type CodingShape = (typeof CODING_SHAPES)[number];

const FENCE_RULE = 'ONE fenced block tagged with the language you actually wrote';

/** The contract for each shape except `full`, which is CODING_CONTRACT itself. */
export const CODING_SHAPE_CONTRACTS: Readonly<Record<Exclude<CodingShape, 'full'>, string>> = {
  code: `The user asked for code. Lead with it: ${FENCE_RULE}. After the block, at most two short sentences on how it works, then one line with the time and space complexity in Big-O notation. No headings, no dry run, no follow-up points, no second version.`,
  solve: `The user asked for a solution to a problem. Use exactly these three headings, in this order, each alone on its line: "## Approach", "## Code", "## Complexity".
Under Approach: two to four sentences with the key idea, naming the technique or data structure in the first sentence (hash map, two pointers, sliding window, DP, BFS...).
Under Code: ${FENCE_RULE}.
Under Complexity: time and space, each O(...) with a short reason taken from the code you wrote.
Add "## Dry Run" between Code and Complexity only when the user asked for one or the logic is genuinely hard to follow (DP state transitions, pointer or window movement, recursion); then trace one short example. No other sections.`,
  approach: `The user asked how to approach the problem (the idea, the algorithm, or the data structure), not for an implementation. Answer that directly in a few sentences: what you would use, why it fits, and the resulting time and space complexity in one line. No code block unless the user asked for code. No headings.`,
  brute_force: `The user asked for the brute-force approach only. In two to four sentences say what it does and why it is correct, give its time and space complexity, and say in one sentence why it is slow. Do not present the optimized solution, and no code block unless the user asked for code. No headings.`,
  optimize: `The user asked to improve the current solution (in the conversation, the question, or on screen). Say what changes and why it is faster in one to three sentences, give the improved code as ${FENCE_RULE} when there is code to improve, then one line comparing the old and new time and space complexity. No dry run, no follow-up points, no headings.`,
  complexity: `The user asked only for the complexity. Give the time and the space complexity, each as O(...) with a one-line reason tied to the code or solution in context (in the question, on screen, or earlier in the conversation); if none is given, use the standard optimal solution to the problem named. Nothing else: no code, no approach, no headings.`,
  dry_run: `The user asked for a dry run. Trace the code or solution in context step by step on the input they gave (or one small representative input if they gave none): the key variables at each step, then the final output. Nothing else: do not re-output the code, and no approach, complexity, or headings.`,
  explain: `The user asked what a piece of code does. Say its purpose in one sentence, then walk through the key steps in order and any line that is not obvious, then give its time and space complexity in one line. Do not rewrite the code, and no headings.`,
  debug: `The user asked what is wrong with the code. Name the bug and why it causes the problem in one or two sentences, give the corrected code as ${FENCE_RULE} (the changed function only), then say in one sentence why the fix works. No headings, no dry run, no follow-up points.`,
  walkthrough: `The user asked for a walkthrough they can say to the interviewer. Explain the solution in the order you would say it: the key idea, then the steps (a short numbered list is fine), the edge cases that matter, and the time and space complexity. Show code only when it is not already on screen or in the conversation and a snippet is essential. No headings.`,
};

/** Shapes whose answer is expected to contain a code block. */
export const CODE_PRODUCING_SHAPES: ReadonlySet<CodingShape> = new Set<CodingShape>(['code', 'solve', 'debug', 'full']);

/**
 * Contract for GENERAL IMPLEMENTATION tasks (React components, scripts, utilities,
 * UI builds) that are NOT classic DSA / LeetCode / interview algorithm questions.
 * Used by `CODING_IMPL_TEMPLATE` in AnswerPlanner for `coding_question_answer`.
 *
 * Why a separate contract: the DSA six-section template (CODING_CONTRACT) forces
 * every coding answer into an interview-walkthrough shape ("## Approach / ##
 * Technique / ## Code / ## Dry Run / ## Complexity / ## Interviewer Follow-up
 * Points") with a python fence. That is wrong for "write a React stopwatch" or
 * "build me a CSV parser" — the user wants ready-to-run code, not an essay. This
 * contract keeps the no-leak / no-Natively rules but asks for code-first output
 * with the CORRECT language tag and a short explanation. The repair layer also
 * sniffs for JSX/React content and corrects a `python` fence to `tsx` defensively.
 */
export const CODING_CONTRACT_IMPL = `IMPLEMENTATION RESPONSE CONTRACT:
- Write the complete code in ONE fenced code block with the CORRECT language tag:
  - React / JSX / TSX → \`\`\`tsx
  - TypeScript (non-JSX) → \`\`\`typescript
  - JavaScript (non-JSX) → \`\`\`javascript
  - Python → \`\`\`python
  - SQL → \`\`\`sql
  (match the language the user asked for or implied)
- After the code, write a SHORT explanation (3–6 sentences) covering key design
  decisions and any non-obvious parts.
- Do NOT use the DSA interview section headings (## Approach / ## Technique /
  ## Dry Run / ## Complexity / ## Interviewer Follow-up Points) unless the user
  explicitly asks for them.
- This is a complete, ready-to-run implementation — not an interview walkthrough.`;

/**
 * TEMPLATE CONFORMANCE — the answer must be written INTO the template the
 * question already supplies, not into one the model invents.
 *
 * The surface this exists for: a LeetCode/HackerRank stub read off the screen
 * (`class Solution: def twoSum(self, nums: List[int], target: int) -> List[int]:`),
 * a signature the interviewer dictated, or a starter block the user pasted. The
 * six-section contract independently tells the model to write ```python with
 * its own entry point, so before this rule the produced code did not compile
 * against the editor the user was actually typing in.
 *
 * Deliberately STATIC and conditional (no per-turn text): the question, screen
 * context, and supplied files are already in the turn content, so the model can
 * see the template — it just was never told the template outranks the default.
 * Keeping it text-free also keeps promptSystemV2's prompt registry bounded.
 */
export const CODING_TEMPLATE_CONFORMANCE = `TEMPLATE CONFORMANCE — outranks every default here:
- If the question, screen, transcript, or an attached file already shows a function signature, method stub, class skeleton, or starter block, WRITE YOUR SOLUTION INTO IT: keep its names, parameter order, type hints, class wrapper, and return type exactly. Never rename, re-order, "improve", or re-wrap the given entry point.
- Use the LANGUAGE of that template even if another would fit better. A Java stub gets Java.
- Add helpers alongside the given entry point, never in place of it.
- Choose the signature and language yourself ONLY when none is supplied.`;

/** One-line variant for tiny-model prompts. Same rule, compressed. */
export const CODING_TEMPLATE_CONFORMANCE_TINY = `TEMPLATE CONFORMANCE (outranks the defaults): if the question/screen/files already contain a function signature, stub, class skeleton, or starter code, write your solution INTO it — keep the exact names, parameters, type hints, class wrapper, return type, and LANGUAGE as supplied. Only pick your own signature and language when none is given.`;

/**
 * Optional verification-spec instruction. Appended to the coding prompt ONLY
 * when code-execution verification is enabled. Asks the model to emit a hidden
 * machine-readable test block AFTER the answer so Natively can run the
 * code against test cases in the background. The block is stripped before the
 * answer is shown (see stripVerificationSpec) — the user never sees it.
 *
 * `input` is the ARGUMENT LIST for the entry function (a one-arg function still
 * uses a one-element array), and `expected` is the value it should return.
 */
export const CODING_VERIFICATION_INSTRUCTION = `After your answer, output a hidden test block EXACTLY in this form (it is removed before display, so the user never sees it — keep it strictly valid JSON):

<verification_spec>
{"entry":"<the function or method name in your Code, e.g. twoSum>","language":"<python|javascript|java|cpp|...>","cases":[{"input":[<arg1>,<arg2>],"expected":<return value>}]}
</verification_spec>

Rules for the spec:
- "entry" MUST be the exact name of the function/method a caller would invoke in your Code (for a "class Solution" method, use the method name).
- "input" is the ARGUMENT LIST passed to that function, in order (wrap a single argument in a one-element array).
- Include EVERY example from the problem statement, PLUS 1-3 edge cases (empty input, duplicates, boundaries) you are confident about.
- Use only concrete JSON values (numbers, strings, booleans, arrays, objects, null). No code, no expressions, no comments.
- LINKED LISTS / BINARY TREES: if any argument or the return value is a linked list (ListNode) or binary tree (TreeNode), add "argTypes" and/or "retType" so the runner can build/compare them. Use "list" for a linked list, "tree" for a binary tree, "value" (or omit) otherwise. Encode a linked list as a plain array [1,2,3]; encode a binary tree in LeetCode LEVEL-ORDER with null for missing nodes, e.g. [3,9,20,null,null,15,7]. Example: \`{"entry":"reverseList","language":"python","argTypes":["list"],"retType":"list","cases":[{"input":[[1,2,3]],"expected":[3,2,1]}]}\`.
- SQL: if your Code is a SQL query, set "language":"sql" and OMIT "entry"/"cases". Instead provide "schema" (array of CREATE TABLE statements), "seeds" (array of INSERT statements), and "expected" (the result-set rows as {column: value} objects using your SELECT's output column names/aliases). Add "ordered":true ONLY if the problem requires a specific row order; otherwise omit it (rows compare order-insensitively). Write standard SQL that runs on SQLite. Only a single read-only SELECT is verified. Example: \`{"language":"sql","schema":["CREATE TABLE T(id INT, v INT)"],"seeds":["INSERT INTO T VALUES (1,10),(2,20)"],"expected":[{"id":2,"v":20}]}\`. If you cannot give reliable schema/seed/expected, emit \`{"language":"sql","schema":[],"seeds":[],"expected":[]}\` to skip verification rather than guess.
- If you genuinely cannot produce reliable expected outputs, output \`<verification_spec>{"entry":"<name>","language":"<lang>","cases":[]}</verification_spec>\` rather than guessing wrong values.`;

/**
 * The regex that finds the hidden spec block (for stash-and-strip). The close
 * tag is OPTIONAL: a truncated stream (max-tokens / network cutoff / model
 * error) can emit the opening tag with no close — we must still strip from the
 * opening tag to end-of-string so the raw spec never leaks into the displayed
 * or persisted answer. `[\s\S]*?` + the `(?:</verification_spec>|$)` alternation
 * strips a terminated block minimally, or an unterminated one to EOF.
 */
export const VERIFICATION_SPEC_RE = /\s*<verification_spec>[\s\S]*?(?:<\/verification_spec>|$)/i;

/**
 * Remove EVERY hidden <verification_spec> block from an answer before display.
 * A fresh GLOBAL regex is created per call (not the exported constant) so we
 * strip ALL blocks — a model that hallucinates a second/trailing spec must not
 * leak it — without the shared-`lastIndex` footgun of a module-level /g regex.
 * Idempotent and safe on answers that never had one.
 */
export const stripVerificationSpec = (answer: string): string =>
  typeof answer === 'string'
    ? answer.replace(/\s*<verification_spec>[\s\S]*?(?:<\/verification_spec>|$)/gi, '\n').trim()
    : answer;

/**
 * Stateful, streaming-safe suppressor for the hidden <verification_spec> block.
 * The spec is always emitted AFTER the six visible sections, so once we see the
 * opening tag (even partially, across chunk boundaries) we suppress it and
 * everything after it — the spec never reaches the UI mid-stream. Used per
 * stream in the WTA + chat coding paths. A small tail buffer holds back a
 * possible partial "<verification_spec" prefix until we know it isn't the tag.
 */
export class StreamingSpecStripper {
  private suppressing = false;
  private tail = '';
  private static readonly OPEN = '<verification_spec';
  // Longest prefix of OPEN we might be mid-emitting; hold back at most this much.
  private static readonly HOLD = StreamingSpecStripper.OPEN.length;

  push(chunk: string): string {
    if (this.suppressing) return '';
    let buf = this.tail + chunk;
    const idx = buf.indexOf(StreamingSpecStripper.OPEN);
    if (idx >= 0) {
      this.suppressing = true;
      this.tail = '';
      return buf.slice(0, idx); // emit text before the spec, drop the rest
    }
    // No full tag yet. Hold back a trailing slice that could be a partial tag so
    // we don't emit "<verification_sp" and then suppress the rest next chunk.
    const keep = Math.max(0, buf.length - StreamingSpecStripper.HOLD);
    const emit = buf.slice(0, keep);
    this.tail = buf.slice(keep);
    return emit;
  }

  /** Flush any safely-non-tag tail at stream end. */
  finish(): string {
    if (this.suppressing) return '';
    const out = this.tail;
    this.tail = '';
    return out;
  }
}
