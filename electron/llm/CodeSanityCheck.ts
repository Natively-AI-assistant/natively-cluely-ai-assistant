// electron/llm/CodeSanityCheck.ts
//
// Post-generation sanity checks for code answers produced by the LLM.
// The checks here run on the final assistant text (after streaming finishes)
// and look for high-confidence bug shapes that the model occasionally emits
// despite the prompt-level invariants in SHARED_CODING_RULES.
//
// Design intent:
//   - Deterministic and side-effect free (returns a structured result).
//   - Caller decides what to do with a hit (telemetry / log / retry / strip).
//   - We do NOT auto-rewrite the answer. Rewriting one line while leaving the
//     dry-run narration unchanged produces an internally inconsistent answer
//     that's worse than the original bug. The right product response is to
//     mark the answer for regeneration or surface a warning to the user.
//
// See: docs/testing/MODES_PROFILE_INTELLIGENCE_BUGFIX_LOG.md FINDING-012.

export type CodeSanityIssueCode =
    | 'subtraction_as_tuple'
    | 'assignment_in_conditional'
    | 'narration_subtraction_as_tuple'
    | 'truncated_code';

export interface CodeSanityIssue {
    code: CodeSanityIssueCode;
    /** Short, redaction-safe label for telemetry / logs. */
    label: string;
    /** The matched line, truncated to 200 chars. */
    excerpt: string;
}

export interface CodeSanityResult {
    ok: boolean;
    issues: CodeSanityIssue[];
}

const MAX_EXCERPT_LENGTH = 200;

function truncate(line: string): string {
    if (line.length <= MAX_EXCERPT_LENGTH) return line;
    return line.slice(0, MAX_EXCERPT_LENGTH - 1) + '…';
}

/**
 * Detect a small set of high-confidence bug shapes in code blocks inside
 * the model output. Only inspects content between triple-backtick fences
 * (so prose mentioning these tokens is not flagged) — except for narration
 * shapes that explicitly mirror the bug in plain English.
 */
export function checkAnswerForCodeBugs(answer: string): CodeSanityResult {
    if (!answer || typeof answer !== 'string') return { ok: true, issues: [] };

    const issues: CodeSanityIssue[] = [];

    // 1) SUBTRACTION-AS-TUPLE inside fenced code blocks.
    //    `complement = target, num` — a 2-tuple, not subtraction.
    //    Allow either '=' or '==' or ':=' on the LHS to catch python walrus too.
    //    The variable names are deliberately permissive so we catch every
    //    common shape: complement/diff/remainder/needed/missing/target.
    const fencedBlocks = extractFencedCodeBlocks(answer);
    const tupleBugRe =
        /^\s*(?:const|let|var)?\s*(?:complement|diff|difference|remainder|needed|missing|gap|delta)\s*(?:=|:=)\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*;?\s*$/m;
    for (const block of fencedBlocks) {
        const match = block.content.match(tupleBugRe);
        if (match) {
            issues.push({
                code: 'subtraction_as_tuple',
                label: 'code block assigns a tuple where a subtraction is expected',
                excerpt: truncate(match[0]),
            });
        }
    }

    // 2) ASSIGNMENT-IN-CONDITIONAL inside fenced code blocks.
    //    `if x = target` — single `=` inside `if (...)` or `if x = ...:`.
    //    JavaScript: `if (x = foo)` is legal but almost always a typo for `==`.
    //    Python: `if x = foo:` is a syntax error; we still flag it.
    const assignInIfRe =
        /^\s*if\s*(?:\(\s*)?[A-Za-z_$][\w$.\[\]]*\s*=\s*[^=!<>]/m;
    for (const block of fencedBlocks) {
        const match = block.content.match(assignInIfRe);
        if (match) {
            // Exclude `if x === y` (===) and `if x !== y` (!==) — those are
            // safe; the regex above already excludes them via the negative
            // character class `[^=!<>]`. Double-check by re-matching the line
            // for assignment specifically, not equality.
            const line = match[0];
            if (!/===|!==|==/.test(line)) {
                issues.push({
                    code: 'assignment_in_conditional',
                    label: 'conditional uses assignment (`=`) instead of equality (`==`/`===`)',
                    excerpt: truncate(line),
                });
            }
        }
    }

    // 3) NARRATION-LEVEL TUPLE BUG — even if the code block was rewritten by
    //    a later edit, the dry-run prose sometimes still reads
    //    "calculate `9, 7 = 2`" which is the same bug surfaced in narration.
    //    Look for: digits or names, comma, digits or names, '=' digit/name —
    //    inside backtick prose or plain prose.
    const narrationBugRe = /`?\s*[\w\d-]+\s*,\s*[\w\d-]+\s*=\s*[\w\d-]+\s*`?/;
    // Restrict to lines that include the words 'calculate', 'compute', 'find',
    // or 'gives' so we don't false-positive on legitimate tuple narration.
    const proseLines = answer.split(/\n+/);
    for (const line of proseLines) {
        if (!/calculat|comput|find|gives|see\s/i.test(line)) continue;
        if (narrationBugRe.test(line)) {
            // Ignore lines that look like correct subtraction narration:
            // "calculate 9 - 7 = 2".
            if (/\s-\s/.test(line)) continue;
            issues.push({
                code: 'narration_subtraction_as_tuple',
                label: 'dry-run narration writes "X, Y = Z" where "X - Y = Z" was intended',
                excerpt: truncate(line.trim()),
            });
            break;
        }
    }

    return { ok: issues.length === 0, issues };
}

interface FencedBlock {
    lang: string;
    content: string;
}

function extractFencedCodeBlocks(text: string): FencedBlock[] {
    const blocks: FencedBlock[] = [];
    const re = /```([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)\n```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        blocks.push({ lang: m[1] || '', content: m[2] });
    }
    return blocks;
}

// ── CODE-ONLY COMPLETENESS (spoken-answer-quality sprint, 2026-06-15) ──────────
//
// A code-only answer that streamed past max-tokens or was cut by a network error ships
// TRUNCATED code (unbalanced brackets, an unclosed function, a dangling operator, an
// unterminated string). Displaying it is worse than nothing. This detector is CONSERVATIVE:
// it masks strings/comments first, only flags an UNCLOSED imbalance (more opens than closes,
// the truncation signature — never an extra close), and falls back to language-agnostic
// signals (unterminated string, trailing operator) when the language is unknown.

const PROGRAMMING_LANGS = new Set([
    'python', 'py', 'javascript', 'js', 'typescript', 'ts', 'java', 'cpp', 'c++', 'c',
    'csharp', 'cs', 'go', 'golang', 'rust', 'rs', 'kotlin', 'swift', 'scala', 'php', 'ruby', 'rb', 'sql',
]);

// Languages where a single quote is NOT a string delimiter (char literals, lifetimes),
// so we must not scan `'…'` as a string — doing so eats Rust lifetimes ('a) and C/C++/Java
// char literals like '{' (code-review HIGH 2026-06-15).
const SINGLE_QUOTE_NOT_STRING = new Set(['rust', 'rs', 'c', 'cpp', 'c++', 'java', 'csharp', 'cs', 'go', 'golang', 'kotlin', 'swift', 'scala']);
// Languages with regex literals (/…/) that contain brackets we must mask out.
const HAS_REGEX_LITERALS = new Set(['javascript', 'js', 'typescript', 'ts']);

/**
 * Mask string literals, comments, and (for JS/TS) regex literals to a neutral filler so
 * bracket-balance and trailing-token checks only see real code structure. Returns the
 * masked skeleton AND a flag for an UNTERMINATED string at EOF (a strong truncation signal).
 * Conservative: an unterminated string only counts when the opening quote is unmatched at
 * end-of-input. `lang` tunes single-quote handling (char literals / lifetimes) and regex.
 */
function maskStringsAndComments(code: string, lang = ''): { skeleton: string; unterminatedString: boolean } {
    const singleQuoteIsChar = SINGLE_QUOTE_NOT_STRING.has(lang);
    const hasRegex = HAS_REGEX_LITERALS.has(lang);
    let out = '';
    let unterminated = false;
    let i = 0;
    let lastSignificant = ''; // last non-space char emitted to the skeleton (for regex detection)
    const n = code.length;
    while (i < n) {
        const c = code[i];
        const two = code.slice(i, i + 2);
        const three = code.slice(i, i + 3);
        // Line comments: // and #
        if (two === '//' || c === '#') {
            const nl = code.indexOf('\n', i);
            i = nl === -1 ? n : nl;
            continue;
        }
        // Block comments: /* ... */
        if (two === '/*') {
            const end = code.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }
        // Triple-quoted strings (python): ''' or """
        if (three === "'''" || three === '"""') {
            const q = three;
            const end = code.indexOf(q, i + 3);
            if (end === -1) { unterminated = true; i = n; } else { out += ' '; i = end + 3; }
            continue;
        }
        // JS/TS regex literal: a '/' in a regex-allowed position, scanned to the closing
        // unescaped '/'. Masks brackets inside /[(){}]/ so they don't false-flag.
        if (hasRegex && c === '/' && two !== '//' && two !== '/*' && /^$|[=([{,;:!&|?+\-*%<>~^]/.test(lastSignificant)) {
            let j = i + 1;
            let closed = false;
            let inClass = false;
            while (j < n) {
                if (code[j] === '\\') { j += 2; continue; }
                if (code[j] === '\n') break; // regex literals don't span lines
                if (code[j] === '[') inClass = true;
                else if (code[j] === ']') inClass = false;
                else if (code[j] === '/' && !inClass) { closed = true; break; }
                j++;
            }
            if (closed) { out += ' '; lastSignificant = ' '; i = j + 1; continue; }
            // Not a regex (e.g. a division) — fall through and treat '/' as a normal char.
        }
        // Single quote in C-family/Rust: it's a CHAR LITERAL or a lifetime, NOT a string.
        // A char literal is short: '<one char or escape>'. Mask exactly that (so '{' or '('
        // can't unbalance the bracket count). A lifetime ('a) or anything longer is emitted
        // as-is (the bracket check tolerates a stray quote). Never scan to the next quote
        // (that ate Rust lifetimes — code-review HIGH 2026-06-15).
        if (c === "'" && singleQuoteIsChar) {
            // '\x' (escape) → 4 chars incl quotes; 'x' → 3 chars incl quotes.
            if (code[i + 1] === '\\' && code[i + 3] === "'") { out += ' '; lastSignificant = ' '; i += 4; continue; }
            if (code[i + 1] !== '\\' && code[i + 1] !== "'" && code[i + 2] === "'") { out += ' '; lastSignificant = ' '; i += 3; continue; }
            // Not a short char literal → a lifetime or apostrophe-in-context; emit as-is.
            out += c; lastSignificant = c; i++;
            continue;
        }
        // Single/double/back-quoted strings.
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1;
            let closed = false;
            while (j < n) {
                if (code[j] === '\\') { j += 2; continue; } // escape
                if (code[j] === c) { closed = true; break; }
                if (code[j] === '\n' && c !== '`') break; // normal strings don't span lines
                j++;
            }
            if (!closed) {
                // Unterminated only when we ran off the END of input (truncation), not a
                // mid-code newline (which is just a normal one-line string the model wrote oddly).
                if (j >= n) unterminated = true;
                i = j >= n ? n : j + 1;
            } else {
                out += ' ';
                i = j + 1;
            }
            lastSignificant = ' ';
            continue;
        }
        out += c;
        if (!/\s/.test(c)) lastSignificant = c;
        i++;
    }
    return { skeleton: out, unterminatedString: unterminated };
}

/** Is the masked skeleton missing a closer (more opens than closes)? Truncation signature. */
function hasUnclosedBracket(skeleton: string): boolean {
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const stack: string[] = [];
    for (const ch of skeleton) {
        if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
        else if (ch === ')' || ch === ']' || ch === '}') {
            // An EXTRA close (stack empty / mismatch) is NOT a truncation — ignore it to
            // stay conservative; we only care about unclosed opens at the end.
            if (stack.length && stack[stack.length - 1] === pairs[ch]) stack.pop();
        }
    }
    return stack.length > 0;
}

/** Does the code end mid-token (dangling operator / continuation / open delimiter)? */
function endsMidToken(skeleton: string): boolean {
    const trimmed = skeleton.replace(/\s+$/g, '');
    if (!trimmed) return false;
    // A trailing '.' after a digit is a valid float ("x = 3."), not truncation — exclude it.
    if (/\.$/.test(trimmed) && /\d\.$/.test(trimmed)) return false;
    // Trailing line-continuation backslash, or a binary/assignment operator with nothing after.
    return /[+\-*/%=&|^<>,.([{\\]$/.test(trimmed) && !/[)}\]]$/.test(trimmed);
}

/**
 * Check fenced code blocks for TRUNCATION. Only meaningful for code-producing answers;
 * the caller gates on that. Returns ok=true (no issues) for prose, diagrams, or
 * non-programming fences. Conservative: balanced, terminated code never flags.
 */
export function checkCodeCompleteness(answer: string): CodeSanityResult {
    if (!answer || typeof answer !== 'string') return { ok: true, issues: [] };
    const issues: CodeSanityIssue[] = [];
    for (const block of extractFencedCodeBlocks(answer)) {
        const lang = (block.lang || '').toLowerCase();
        // Skip diagrams / pseudo / unknown non-programming fences for brace checks.
        const isProgramming = PROGRAMMING_LANGS.has(lang);
        const code = block.content;
        if (!code.trim()) continue;

        const { skeleton, unterminatedString } = maskStringsAndComments(code, lang);
        const isPython = lang === 'python' || lang === 'py';
        const isSql = lang === 'sql';

        let truncated = false;
        let why = '';
        if (unterminatedString) { truncated = true; why = 'unterminated string at end of code'; }
        // Brace balance: skip for python (braces aren't structural) and for unknown langs
        // (lower confidence). SQL also skips brace-balance.
        else if (isProgramming && !isPython && !isSql && hasUnclosedBracket(skeleton)) {
            truncated = true; why = 'unclosed bracket/brace/paren (code appears cut off)';
        }
        else if (endsMidToken(skeleton)) { truncated = true; why = 'code ends mid-token (dangling operator/delimiter)'; }

        if (truncated) {
            issues.push({
                code: 'truncated_code',
                label: `code-only answer looks truncated: ${why}`,
                excerpt: truncate(code.slice(-Math.min(code.length, MAX_EXCERPT_LENGTH))),
            });
        }
    }
    return { ok: issues.length === 0, issues };
}
