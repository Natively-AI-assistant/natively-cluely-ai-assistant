// src/lib/streamingMarkdown.ts
//
// Pure streaming Marked+KaTeX renderer plus finalized remark-math normalizer.
//
// Why this module exists:
//   The chat stream delivers markdown progressively, including math like
//   `$E=mc^2$` that may not yet have its closer when the renderer is
//   invoked. The default marked pipeline treats `$...$` as ordinary text,
//   and adding math via `marked.use(...)` mutates a global singleton that
//   can accumulate extensions across test reloads or affect other consumers.
//
// Why it stays unsanitized:
//   The renderer-side caller (NativelyInterface) sanitizes the rendered
//   streaming HTML via DOMPurify AFTER appending the escaped gist. Moving DOMPurify
//   into this pure module would either require a fake DOM under node:test
//   or risk sanitizing the body and gist inconsistently. The "keeps HTML
//   unsanitized" test in streamingMarkdown.test.mjs pins this contract.
//
// Design (2026-08-07 review-fix pass):
//   - Each math flavor uses a SINGLE extension that tries the COMPLETE
//     regex first and falls back to an INCOMPLETE variant if no closer is
//     reachable. Marked's extension list is iterated via `.some()` with
//     `unshift`-prepend semantics, so splitting "complete" and
//     "incomplete" into two extensions makes whichever was registered
//     LAST win — and that would silently disable the COMPLETE branch for
//     any input the incomplete regex can also match. Keeping them in
//     one tokenizer is the only safe ordering.
//   - Inline `$$…$$` (review I1): registered as an INLINE extension so
//     it renders mid-paragraph; no block `start` hook means paragraphs
//     never split on mid-prose `$$`.
//   - Block `\[…\]`: registered as a BLOCK extension but with a `start`
//     hook gated on STANDALONE-OPENER. Mid-prose `\[` (e.g.
//     `array\[0\]`) is preceded by an alphanumeric and falls through to
//     Marked's Markdown-escape path (review C1). Standalone complete
//     `\[…\]` IS display math per the approved spec.
//   - Inline `$…$`: a shared body-policy helper rejects multi-digit
//     currency-shaped bodies while preserving `$5$`, `$x$`, and numeric
//     operator expressions. The finalized normalizer uses the same policy.
//   - Incomplete math (review C2): the tokenizer falls back to the
//     incomplete regex which has no closing-`$` requirement, so
//     streaming partials like `\[E=mc^2` or `$E=mc^2` survive
//     multi-line input.
//   - HTML-escape the literal output (review I2): incomplete tokens are
//     passed through `htmlEscape` so the browser parser and DOMPurify
//     see well-formed markup.
//   - Closing-delimiter scope (review I3): every tokenizer inspects only
//     the remaining inline source — never at later unmatched closers in
//     unrelated text.

import { renderToString } from 'katex';
import { Marked } from 'marked';

interface MathToken {
  type: string;
  raw: string;
  text: string;
}

const KATEX_OPTIONS = {
  throwOnError: false,
  strict: false,
  errorColor: '#cc0000',
} as const;

function renderMath(text: string, displayMode: boolean): string {
  return renderToString(text.trim(), { ...KATEX_OPTIONS, displayMode });
}

// HTML-escape a string of literal text. The literal may contain characters
// like `<` or `&` from the raw user input; we want the browser parser and
// DOMPurify to see them as text, not as markup. Review finding I2.
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// True iff the preceding inline token does NOT end in an alphanumeric.
//
// The approved spec for `\[…\]`: treat it as display math only when the
// opener is STANDALONE — at the start of the input, or preceded by
// whitespace / a non-alphanumeric. When preceded by an alphanumeric
// (`array\[`), the backslash is a Markdown escape and the brackets stay
// literal in the prose.
//
// An INLINE tokenizer receives only the remaining source, so it cannot look
// at the character before the cursor. Marked does, however, pass the tokens
// accumulated so far; the tail of the previous token is exactly the
// character that precedes our opener. An empty list means start-of-inline,
// which is standalone.
function isStandaloneOpener(tokens: { raw?: string }[] | undefined): boolean {
  if (!tokens || tokens.length === 0) return true;
  const prevRaw = tokens[tokens.length - 1]?.raw;
  if (!prevRaw) return true;
  return !/[A-Za-z0-9]$/.test(prevRaw);
}

// Inline regex for `$$…$$` display math. Opener must NOT be followed by
// another `$`. Body cannot span newlines.
const DOLLAR_DISPLAY_RE = /^\$\$([^$][\s\S]*?)\$\$(?!\$)/;
const INCOMPLETE_DOLLAR_DISPLAY_RE = /^\$\$([\s\S]+)$/;

// Inline regexes for `\[…\]` display math. Fires only when the opener is
// standalone (gated by `isStandaloneOpener`). Marked has already split the
// source into blocks by the time an inline tokenizer runs, so neither regex
// can reach past the current paragraph — that is what scopes the closer to
// the matching expression (review I3).
const BRACKET_DISPLAY_RE = /^\\\[([\s\S]+?)\\\]/;
const INCOMPLETE_BRACKET_DISPLAY_RE = /^\\\[([\s\S]+)$/;

// Inline regex for `$…$` inline math.
//
// Currency rule (the deliberate rule the Task 1 review pinned):
//   `Costs $100 for $200 total.` stays as ordinary text; `$5$ here.`
//   renders as math. The discriminator is whether the body LOOKS like
//   a currency amount (multi-digit, no operator) or like a math
//   expression (starts with non-digit, OR starts with a single digit
//   that is the WHOLE body, OR contains an operator).
//
// Algorithm:
//   - Opener is a single `$` (not `$$`).
//   - Body is non-greedy, no newlines, no `$` inside.
//   - Three accept patterns:
//       (a) body starts with a non-digit: always math.
//       (b) body is exactly one digit: math (e.g. `$5$`).
//       (c) body starts with a digit and contains an operator
//           (`=`, `+`, `-`, `/`, `*`, `^`): math.
//   - Otherwise (body is multi-digit with no operator): reject — the
//     pattern is currency, not math.
const INLINE_MATH_RE = /^\$(?!\$)([^\n$]+)\$(?!\$)/;
// Incomplete inline: a `$` opener (not followed by `$`) with no closing
// `$` before end of source.
const INCOMPLETE_INLINE_RE = /^\$(?!\$)([^\n$]+)$/;

/** Shared streaming/finalized policy for deciding whether `$body$` is math. */
function isInlineMathBody(body: string): boolean {
  if (!body) return false;
  // Adjacency rule (pandoc / remark-math): the opening `$` must not be followed
  // by whitespace and the closing `$` must not be preceded by whitespace.
  //
  // Live report 2026-08-12: "Show a Makefile rule using $@ and $<." rendered
  // `$@ and $` as MATH, because the currency rule below only asks whether the
  // body starts with a digit — `@ and ` starts with `@`, so it was accepted.
  // Shell and Make variables (`$@`, `$<`, `$1`, `$?`) are ordinary prose in an
  // interview answer about Makefiles or bash, and turning them into KaTeX
  // mangles the text beyond recognition.
  //
  // Adjacency is the standard discriminator and subsumes the special cases
  // without a blacklist that would need a new entry per sigil:
  //   `$@ and $<`      closer preceded by a space  -> text
  //   `Let $x = 5$`    closer preceded by `5`      -> math
  //   `$100 for $200`  closer preceded by a space  -> text
  // Real math is written tight against its delimiters; incidental `$` pairs in
  // prose almost never are.
  if (/^\s/.test(body) || /\s$/.test(body)) return false;
  if (!/^\d/.test(body)) return true;
  return /^\d$/.test(body) || /[=+\-*/^]/.test(body);
}

// Currency opener: a dollar followed by a numeric amount and then prose,
// punctuation, or end-of-input. A dollar immediately closing that amount is
// valid digit math (`$5$`) and is deliberately excluded.
function currencyOpenerLength(source: string): number {
  const amount = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/.exec(source);
  if (!amount || source[amount[0].length] === '$') return 0;
  const next = source[amount[0].length];
  return next === undefined || /[\s.,;:!?)]/.test(next) ? amount[0].length : 0;
}

// --- Inline $…$ (complete-or-incomplete in one extension) -------------------

const inlineMath = {
  name: 'streamInlineMath',
  level: 'inline' as const,
  start(src: string): number | undefined {
    const idx = src.indexOf('$');
    return idx >= 0 ? idx : undefined;
  },
  tokenizer(src: string): MathToken | undefined {
    const complete = INLINE_MATH_RE.exec(src);
    if (complete && isInlineMathBody(complete[1])) {
      return { type: 'streamInlineMath', raw: complete[0], text: complete[1] };
    }
    const incomplete = INCOMPLETE_INLINE_RE.exec(src);
    if (incomplete) {
      return {
        type: 'streamInlineMath',
        raw: incomplete[0],
        text: incomplete[0],
        // Tag the token so the renderer knows to escape.
        ...({ incomplete: true } as Record<string, unknown>),
      };
    }
    return undefined;
  },
  renderer(token: MathToken & { incomplete?: boolean }): string {
    if (token.incomplete) return htmlEscape(token.raw);
    return renderMath(token.text, false);
  },
};

// --- Inline $$…$$ (complete-or-incomplete) ----------------------------------

const inlineDollarDisplay = {
  name: 'streamInlineDollarDisplay',
  level: 'inline' as const,
  start(src: string): number | undefined {
    const idx = src.indexOf('$$');
    return idx >= 0 ? idx : undefined;
  },
  tokenizer(src: string): MathToken | undefined {
    const complete = DOLLAR_DISPLAY_RE.exec(src);
    if (complete) {
      return { type: 'streamInlineDollarDisplay', raw: complete[0], text: complete[1] };
    }
    const incomplete = INCOMPLETE_DOLLAR_DISPLAY_RE.exec(src);
    if (incomplete) {
      return {
        type: 'streamInlineDollarDisplay',
        raw: incomplete[0],
        text: incomplete[0],
        ...({ incomplete: true } as Record<string, unknown>),
      };
    }
    return undefined;
  },
  renderer(token: MathToken & { incomplete?: boolean }): string {
    if (token.incomplete) return htmlEscape(token.raw);
    return `${renderMath(token.text, true)}\n`;
  },
};

// --- Inline \[…\] (standalone-opener gated; complete-or-incomplete) ---------
//
// Registered at INLINE level, not block level. A block extension is handed
// the whole remaining document, so `BRACKET_DISPLAY_RE` would scan across
// blank lines and let an UNRELATED later `\]` close an earlier incomplete
// `\[`, swallowing the prose in between into one KaTeX node. It also emitted
// bare block-level output that split `Formula: \[x\] done` into three blocks.
// At inline level marked has already segmented the source, so the tokenizer
// can only ever see the current paragraph — which is exactly the closing
// scope the spec requires — and the result stays inside one <p>.

const bracketDisplayInline = {
  name: 'streamBracketDisplay',
  level: 'inline' as const,
  start(src: string): number | undefined {
    const idx = src.indexOf('\\[');
    return idx >= 0 ? idx : undefined;
  },
  tokenizer(src: string, tokens?: { raw?: string }[]): MathToken | undefined {
    if (!isStandaloneOpener(tokens)) return undefined;
    const complete = BRACKET_DISPLAY_RE.exec(src);
    if (complete) {
      return { type: 'streamBracketDisplay', raw: complete[0], text: complete[1] };
    }
    const incomplete = INCOMPLETE_BRACKET_DISPLAY_RE.exec(src);
    if (incomplete) {
      return {
        type: 'streamBracketDisplay',
        raw: incomplete[0],
        text: incomplete[0],
        ...({ incomplete: true } as Record<string, unknown>),
      };
    }
    return undefined;
  },
  renderer(token: MathToken & { incomplete?: boolean }): string {
    if (token.incomplete) return htmlEscape(token.raw);
    return renderMath(token.text, true);
  },
};

const streamingMarked = new Marked({
  extensions: [inlineMath, inlineDollarDisplay, bracketDisplayInline],
});

/**
 * Normalize finalized answer math for remark-math.
 *
 * Code spans/fences and incomplete delimiters are byte-for-byte preserved.
 * Complete display delimiters become remark-math blocks, while currency-style
 * dollar openers are escaped so they cannot pair with a later currency/math `$`.
 */
export function normalizeFinalizedMarkdownMath(markdown: string): string {
  let fenced = false;
  let fenceChar = '';
  let fenceLength = 0;
  const lines = markdown.split(/(?<=\n)/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^( {0,3})(`{3,}|~{3,})([\s\S]*)$/.exec(line);
    if (fenced) {
      // CommonMark 4.5: a CLOSING fence may be followed only by whitespace.
      // Without the trailing-text check, a code line like ```` ```not-a-close ````
      // ended the block early and the real code after it got normalized.
      const closesBlock = fence
        && fence[2][0] === fenceChar
        && fence[2].length >= fenceLength
        && fence[3].trim() === '';
      if (closesBlock) fenced = false;
      output.push(line);
      continue;
    }
    if (fence) {
      fenced = true;
      fenceChar = fence[2][0];
      fenceLength = fence[2].length;
      output.push(line);
      continue;
    }

    if (/^\s*\\\[\s*(?:\n)?$/.test(line)) {
      // Stop the search at the first code fence. Code review 2026-08-12: this
      // scan ran outside the fence state machine above, so a lone `\]` line
      // INSIDE a fenced block could close a display-math opener that started
      // before it — splicing the fence delimiters and the code between them
      // into a `$$…$$` block. Reproduced: a `\[` opener followed by a python
      // fence containing a `\]` line emitted "$$\n```python\nx = 1\n$$\n```",
      // corrupting the code and breaking this module's stated guarantee that
      // fenced content is preserved byte-for-byte. Display math never spans a
      // code fence, so refusing to look past one loses nothing.
      const fenceAhead = lines.findIndex((candidate, candidateIndex) =>
        candidateIndex > index && /^( {0,3})(`{3,}|~{3,})/.test(candidate),
      );
      const searchLimit = fenceAhead >= 0 ? fenceAhead : lines.length;
      const closingIndex = lines.findIndex((candidate, candidateIndex) =>
        candidateIndex > index && candidateIndex < searchLimit && /^\s*\\\]\s*(?:\n)?$/.test(candidate),
      );
      if (closingIndex >= 0) {
        const body = lines.slice(index + 1, closingIndex).join('').trim();
        if (body) {
          output.push(`$$\n${body}\n$$${lines[closingIndex].endsWith('\n') ? '\n' : ''}`);
          index = closingIndex;
          continue;
        }
      }
    }

    output.push(normalizeOutsideInlineCode(line));
  }

  return output.join('');
}

function normalizeOutsideInlineCode(line: string): string {
  let output = '';
  let proseStart = 0;
  let cursor = 0;

  while (cursor < line.length) {
    if (line[cursor] !== '`') {
      cursor += 1;
      continue;
    }
    let runEnd = cursor + 1;
    while (line[runEnd] === '`') runEnd += 1;
    const delimiter = line.slice(cursor, runEnd);
    const closer = line.indexOf(delimiter, runEnd);
    if (closer < 0) break;
    output += normalizeProse(line.slice(proseStart, cursor));
    output += line.slice(cursor, closer + delimiter.length);
    cursor = closer + delimiter.length;
    proseStart = cursor;
  }

  return output + normalizeProse(line.slice(proseStart));
}

function normalizeProse(source: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < source.length) {
    if (source.startsWith('$$', cursor) && !isEscaped(source, cursor)) {
      const closer = source.indexOf('$$', cursor + 2);
      if (closer >= 0) {
        const body = source.slice(cursor + 2, closer);
        if (body.trim() && !body.includes('\n')) {
          output += toRemarkMathBlock(body, source.slice(0, cursor), source.slice(closer + 2));
          cursor = closer + 2;
          continue;
        }
      }
    }

    if (source.startsWith('\\[', cursor) && !isEscaped(source, cursor) && isStandaloneCharacter(source[cursor - 1])) {
      const closer = source.indexOf('\\]', cursor + 2);
      if (closer >= 0) {
        const body = source.slice(cursor + 2, closer);
        if (body.trim() && !body.includes('\n')) {
          output += toRemarkMathBlock(body, source.slice(0, cursor), source.slice(closer + 2));
          cursor = closer + 2;
          continue;
        }
      }
    }

    if (source[cursor] === '$' && source[cursor + 1] !== '$' && !isEscaped(source, cursor)) {
      const amountLength = currencyOpenerLength(source.slice(cursor + 1));
      if (amountLength > 0) {
        output += '\\$';
        cursor += 1;
        continue;
      }

      const closer = source.indexOf('$', cursor + 1);
      if (closer >= 0 && source[closer + 1] !== '$') {
        const body = source.slice(cursor + 1, closer);
        if (isInlineMathBody(body)) {
          output += source.slice(cursor, closer + 1);
          cursor = closer + 1;
          continue;
        }
      }
    }

    output += source[cursor];
    cursor += 1;
  }

  return output;
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function isStandaloneCharacter(char: string | undefined): boolean {
  return char === undefined || !/[A-Za-z0-9]/.test(char);
}

function toRemarkMathBlock(body: string, before: string, after: string): string {
  const block = `$$\n${body.trim()}\n$$`;
  const needsLeadingBreak = before.length > 0 && !/\n\s*$/.test(before);
  const needsTrailingBreak = after.length > 0 && !/^\s*\n/.test(after);
  return `${needsLeadingBreak ? '\n\n' : ''}${block}${needsTrailingBreak ? '\n\n' : ''}`;
}

export function renderStreamingMarkdown(markdown: string): string {
  return streamingMarked.parse(markdown || '', { async: false }) as string;
}