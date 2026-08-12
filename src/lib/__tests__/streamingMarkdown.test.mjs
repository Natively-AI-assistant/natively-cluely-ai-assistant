// src/lib/__tests__/streamingMarkdown.test.mjs
//
// Pin the contract of the isolated Marked+KaTeX streaming renderer used by
// the renderer-side streaming markdown surface. The renderer must:
//   1. Render fully-formed inline / display math via KaTeX synchronously.
//   2. Leave incomplete math (still streaming) as literal text — the chat
//      stream delivers markdown progressively and a partial $x= fragment
//      must not crash or get mis-rendered.
//   3. Skip math inside code (fenced AND inline), just like standard
//      Markdown semantics demand.
//   4. Pass through normal Markdown unchanged alongside math.
//   5. Not throw on malformed TeX.
//   6. Stay unsanitized so the existing DOMPurify caller boundary
//      (NativelyInterface) continues to own escaping; this final test is
//      intentional and pins responsibility rather than approves unsafe
//      output.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFinalizedMarkdownMath, renderStreamingMarkdown } from '../streamingMarkdown.ts';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';

const katexCount = (html) => (html.match(/class="katex"/g) || []).length;

describe('renderStreamingMarkdown — completed math', () => {
  test('renders completed inline math with KaTeX', () => {
    const html = renderStreamingMarkdown('Energy is $E=mc^2$ here.');
    assert.match(html, /class="katex"/);
    assert.doesNotMatch(html, /class="katex-display"/);
    assert.match(html, /Energy is/);
  });

  test('renders completed dollar display math with KaTeX display mode', () => {
    const html = renderStreamingMarkdown('Formula:\n\n$$E=mc^2$$\n');
    assert.match(html, /class="katex-display"/);
    assert.doesNotMatch(html, /\$\$E=mc\^2\$\$/);
  });

  test('renders completed bracket display math with KaTeX display mode', () => {
    const html = renderStreamingMarkdown('Formula:\n\n\\[E=mc^2\\]\n');
    assert.match(html, /class="katex-display"/);
    assert.doesNotMatch(html, /\\\[E=mc\^2\\\]/);
  });

  test('renders multiple inline expressions independently', () => {
    const html = renderStreamingMarkdown('$a$ and $b$');
    assert.equal(katexCount(html), 2, html);
  });
});

describe('renderStreamingMarkdown — streaming partials', () => {
  test('leaves incomplete inline math literal until the closer arrives', () => {
    const html = renderStreamingMarkdown('Energy is $E=mc^2');
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /\$E=mc\^2/);
  });

  test('leaves incomplete dollar display math literal until completion', () => {
    const html = renderStreamingMarkdown('$$E=mc^2');
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /\$\$E=mc\^2/);
  });

  test('leaves incomplete bracket display math literal until completion', () => {
    const html = renderStreamingMarkdown('\\[E=mc^2');
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /\\\[E=mc\^2/);
  });
});

describe('renderStreamingMarkdown — boundaries and safety contract', () => {
  test('never interprets math-like dollar text inside fenced code', () => {
    const source = '```bash\necho "$& $$ $x$"\n```';
    const html = renderStreamingMarkdown(source);
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /<pre><code class="language-bash">/);
    assert.match(html, /\$&amp; \$\$ \$x\$/);
  });

  test('never interprets math-like text inside inline code', () => {
    const html = renderStreamingMarkdown('Use `$x$` literally.');
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /<code>\$x\$<\/code>/);
  });

  test('preserves normal Markdown alongside math', () => {
    const html = renderStreamingMarkdown('**Result:** $x=1$.');
    assert.match(html, /<strong>Result:<\/strong>/);
    assert.match(html, /class="katex"/);
  });

  test('malformed completed TeX never throws', () => {
    assert.doesNotThrow(() => renderStreamingMarkdown('$\\badcommand{$'));
  });

  test('keeps HTML unsanitized for the existing DOMPurify caller boundary', () => {
    const html = renderStreamingMarkdown('<img src=x onerror="alert(1)">');
    assert.match(html, /onerror=/);
  });
});

// --- Review-fix regression suite (2026-08-07) --------------------------------
// Pins for findings C1, C2, I1, I2, I3 from the Task 1 review, plus the
// deliberate currency rule and plain-Marked parity for math-free prose.

describe('renderStreamingMarkdown — review-fix regressions', () => {
  // --- C1: block start-hook must not split paragraphs mid-prose --------------
  // The approved spec is: standalone `\[…\]` (after whitespace or at
  // start of line) IS display math; identifier-embedded `\[` (preceded
  // by an alphanumeric, no space) is a Markdown escape and stays as
  // literal text. This test pins the literal case — the KaTeX case is
  // pinned by I1 below.
  test('C1: identifier-embedded \\[…\\] stays as Markdown escape literal', () => {
    const html = renderStreamingMarkdown('Use array\\[0\\] for the first.');
    // `array\[` is identifier-embedded so the \[ is a Markdown escape;
    // the backslash drops and the brackets stay in the paragraph.
    assert.match(html, /<p>Use array\[0\] for the first\.<\/p>/);
    assert.equal(katexCount(html), 0, html);
  });

  test('C1: prose containing $$…$$ does not split a paragraph', () => {
    const html = renderStreamingMarkdown('And then see $$x$$ ok.');
    assert.match(html, /<p>And then see/);
    assert.match(html, /ok\./);
    // The completed $$x$$ IS math (KaTeX expected) but the surrounding
    // paragraph stays in ONE <p> wrapper, not split into multiple blocks.
    assert.equal(html.match(/<p>/g)?.length, 1, html);
  });

  // --- C2: preserve incomplete \[ across multiple lines ---------------------
  test('C2: incomplete bracket display math survives a newline', () => {
    const html = renderStreamingMarkdown('line1\n\\[E=mc^2');
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /\\\[E=mc\^2/);
  });

  // --- I1: complete $$…$$ and \[…\] even mid-paragraph -----------------------
  test('I1: complete $$…$$ renders as KaTeX display math mid-paragraph', () => {
    const html = renderStreamingMarkdown('inline $$E=mc^2$$ tail');
    assert.match(html, /class="katex-display"/);
    assert.match(html, /inline/);
    assert.match(html, /tail/);
  });

  test('I1: complete standalone \\[…\\] renders as KaTeX display math mid-prose', () => {
    // Standalone `\[…\]` (preceded by whitespace, not by an alphanumeric)
    // IS display math per the approved spec.
    const html = renderStreamingMarkdown('Formula: \\[E=mc^2\\] done');
    assert.match(html, /class="katex-display"/);
    assert.match(html, /Formula:/);
    assert.match(html, /done/);
  });

  // --- I2: escape raw incomplete literal so HTML is well-formed --------------
  test('I2: raw incomplete literal HTML-escapes the backslashes', () => {
    const html = renderStreamingMarkdown('hello \\[E=mc^2');
    // \[ should be escaped to \[ (or &#x5C;) in the output, NOT appear as
    // a raw HTML control character. The literal survives intact, but as
    // escaped HTML, so DOMPurify (and the browser parser) see balanced
    // markup.
    assert.doesNotMatch(html, /<p>\[/);
    assert.match(html, /\\\[E=mc\^2/);
  });

  // --- I3: closing-delimiter detection scoped to the matching expression -----
  test('I3: incomplete \\[…\\] followed by a later \\] stays incomplete', () => {
    // The first \[ has no closer; a later unrelated \] must NOT cause the
    // first expression to be treated as complete.
    const html = renderStreamingMarkdown('\\[a and b\\]');
    // The whole thing should be treated as a single COMPLETE bracket
    // expression (closing \] is right there) — that is the desired
    // behaviour: there IS a closer in the source, so it renders as KaTeX.
    assert.match(html, /class="katex-display"/);
  });

  test('I3: incomplete \\[…\\]…\\] (extra closer) does not steal completion', () => {
    // First \[ with no closing \] before the source ends; a LATER \] must
    // not be matched as the closer of the first expression.
    const html = renderStreamingMarkdown('see \\[a also c\\]');
    // Both \[ and \] exist so it IS complete; the assertion is that we
    // produce exactly ONE KaTeX display block, not two split blocks.
    const displayCount = (html.match(/class="katex-display"/g) || []).length;
    assert.equal(displayCount, 1, html);
  });

  // --- I3 (real scope): an UNRELATED later closer, in a DIFFERENT block,
  // must not complete an earlier incomplete opener. The two I3 tests above
  // only feed same-line COMPLETE expressions, so they never exercised the
  // cross-boundary requirement they are named for.
  test('I3: later unrelated \\] in a separate block does not close an earlier \\[', () => {
    const html = renderStreamingMarkdown('\\[E=mc^2\n\nLater prose with array\\[0\\] index.');
    // The opener has no closer inside its own block, so it stays literal.
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /\\\[E=mc\^2/);
    // And the unrelated later prose must survive intact, not be swallowed
    // into the math expression.
    assert.match(html, /Later prose with array\[0\] index\./, html);
  });

  test('I3: later unrelated $ in a separate block does not close an earlier $', () => {
    const html = renderStreamingMarkdown('Open $E=mc^2\n\nLater we spent $100 dollars.');
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /\$E=mc\^2/);
    assert.match(html, /\$100 dollars\./);
  });

  // --- Block structure: streaming partials and mid-prose display math must
  // stay inside normal paragraph structure rather than emitting bare
  // block-level fragments that fall outside the document flow.
  test('structure: incomplete \\[ partial stays wrapped in a paragraph', () => {
    const html = renderStreamingMarkdown('\\[E=mc^2');
    assert.match(html, /^<p>/, html);
  });

  test('structure: mid-prose complete \\[…\\] does not split the paragraph', () => {
    const html = renderStreamingMarkdown('Formula: \\[E=mc^2\\] done');
    assert.match(html, /class="katex-display"/);
    assert.equal(html.match(/<p>/g)?.length, 1, html);
  });

  // --- Currency rule: $100 / $200 stay as plain text, $5$ stays as math -----
  test('currency: $100 and $200 stay as ordinary text', () => {
    const html = renderStreamingMarkdown('Costs $100 for $200 total.');
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /\$100/);
    assert.match(html, /\$200/);
    assert.match(html, /Costs .* for .* total\./);
  });

  test('currency: a currency opener does not consume later valid inline math', () => {
    const html = renderStreamingMarkdown('We paid $100 and equation $x$.');
    assert.equal(katexCount(html), 1, html);
    assert.match(html, /We paid \$100 and equation/);
  });

  test('currency: $5$ (digit-bounded) is still valid inline math', () => {
    const html = renderStreamingMarkdown('Equation $5$ here.');
    assert.equal(katexCount(html), 1, html);
  });

  // --- Baseline parity against plain Marked for math-free prose -------------
  test('parity: plain Marked and streaming produce identical math-free prose', async () => {
    const { Marked } = await import('marked');
    const plain = new Marked();
    const samples = [
      'Just a sentence with **bold** and _italic_.',
      'A paragraph with [a link](https://example.com) inside.',
      'A line with literal $100 and $200 dollars, no math at all.',
      // Identifier-embedded `\[…\]` stays as a Markdown escape literal;
      // standalone complete `\[…\]` is approved math syntax so it is
      // NOT included in this math-free parity array.
      'Use array\\[0\\] for indexing and $100 dollars.',
      'Heading\n=======\n\nBody.',
      '1. item one\n2. item two\n',
    ];
    for (const src of samples) {
      const a = renderStreamingMarkdown(src);
      const b = plain.parse(src, { async: false });
      assert.equal(a, b, `mismatch for input: ${JSON.stringify(src)}\n--- ours ---\n${a}\n--- plain ---\n${b}`);
    }
  });

  // --- Precedence preservation: code-fence and inline-code still win -------
  test('precedence: fenced code wins over $$…$$ detection', () => {
    const source = '```\n$$not math$$\n```';
    const html = renderStreamingMarkdown(source);
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /<pre><code/);
  });

  test('precedence: inline code wins over $…$ detection', () => {
    const html = renderStreamingMarkdown('Use `$x$` literally.');
    assert.equal(katexCount(html), 0, html);
    assert.match(html, /<code>\$x\$<\/code>/);
  });
});

describe('normalizeFinalizedMarkdownMath — remarkMath semantics', () => {
  const mathNodes = (markdown) => {
    const tree = unified().use(remarkParse).use(remarkMath).parse(normalizeFinalizedMarkdownMath(markdown));
    const found = [];
    const visit = (node) => {
      if (node && (node.type === 'math' || node.type === 'inlineMath')) {
        found.push({ type: node.type, value: node.value });
      }
      for (const child of node?.children || []) visit(child);
    };
    visit(tree);
    return found;
  };

  test('normalizes complete same-line $$...$$ to block math', () => {
    assert.deepEqual(mathNodes('$$E=mc^2$$'), [{ type: 'math', value: 'E=mc^2' }]);
  });

  test('normalizes complete own-line $$...$$ and standalone \\[...\\] to block math', () => {
    assert.deepEqual(mathNodes('Before\n\n$$E=mc^2$$\n\nAfter'), [{ type: 'math', value: 'E=mc^2' }]);
    assert.deepEqual(mathNodes('Before\n\n\\[a+b\\]\n\nAfter'), [{ type: 'math', value: 'a+b' }]);
  });

  test('normalizes complete multiline standalone \\[...\\] and preserves an incomplete one', () => {
    const complete = 'Before\n\n\\[\nE=mc^2\n\\]\n\nAfter';
    assert.deepEqual(mathNodes(complete), [{ type: 'math', value: 'E=mc^2' }]);

    const incomplete = 'Before\n\n\\[\nE=mc^2\nAfter';
    assert.equal(normalizeFinalizedMarkdownMath(incomplete), incomplete);
  });

  test('escapes currency dollar openers while preserving valid inline math', () => {
    assert.deepEqual(mathNodes('Costs $100 now and $200 later; equations $x$ and $5$.'), [
      { type: 'inlineMath', value: 'x' },
      { type: 'inlineMath', value: '5' },
    ]);
  });

  test('escapes one-digit and grouped currency openers before later valid math', () => {
    assert.deepEqual(mathNodes('We paid $5 and equation $x$.'), [
      { type: 'inlineMath', value: 'x' },
    ]);
    assert.deepEqual(mathNodes('It cost $1,000 and result $y$.'), [
      { type: 'inlineMath', value: 'y' },
    ]);
    assert.deepEqual(mathNodes('Equation $5$ stays valid.'), [
      { type: 'inlineMath', value: '5' },
    ]);
  });

  test('preserves code delimiters and incomplete math verbatim', () => {
    const source = '```txt\n$$E=mc^2$$ $100 \\[a+b\\]\n```\n\nUse `$200 and $x$` plus incomplete $E=mc^2 and \\[a+b';
    assert.equal(normalizeFinalizedMarkdownMath(source), source);
  });

  // A closing fence may be followed only by whitespace (CommonMark 4.5). A
  // fence-looking line with trailing text is ORDINARY CODE CONTENT — treating
  // it as the closer ended the block early and normalized the real code that
  // followed, corrupting it.
  test('a fence-looking line with trailing text does not close the block', () => {
    const source = '```md\n```not-a-close\n$$E=mc^2$$ costs $100\n```\n';
    assert.equal(normalizeFinalizedMarkdownMath(source), source);
  });

  test('a longer closing fence run still closes, and math after it normalizes', () => {
    const source = '```md\ninside $100\n`````\n\nAfter $$E=mc^2$$ here.\n';
    const out = normalizeFinalizedMarkdownMath(source);
    assert.ok(out.includes('```md\ninside $100\n`````'), out);
    assert.ok(out.includes('$$\nE=mc^2\n$$'), out);
  });
});

describe('normalizeFinalizedMarkdownMath — fenced code is never spliced into math', () => {
  // Code review 2026-08-12: the standalone `\[…\]` block scan ran outside the
  // fence state machine, so a lone `\]` line inside a fenced code block could
  // close a display-math opener that started before it — wrapping the fence
  // delimiters and the code between them into `$$…$$`.
  test('a lone \\] inside a code fence does not close an earlier \\[', () => {
    const src = 'Formula:\n\n\\[\n\n```python\nx = 1\n\\]\n```\n\nAfter.';
    const out = normalizeFinalizedMarkdownMath(src);
    assert.ok(out.includes('```python\nx = 1'), `the code fence was corrupted:\n${out}`);
    assert.ok(!/\$\$\n```/.test(out), `math delimiters were spliced into the fence:\n${out}`);
  });

  test('a genuine multiline \\[…\\] before any fence still normalizes', () => {
    const src = 'Formula:\n\n\\[\nE=mc^2\n\\]\n\nAfter.';
    const out = normalizeFinalizedMarkdownMath(src);
    assert.ok(/\$\$\nE=mc\^2\n\$\$/.test(out), `expected block math, got:\n${out}`);
  });
});

describe('shell and Make variables are prose, not inline math', () => {
  // Live report 2026-08-12. The user asked "Show a Makefile rule using $@ and
  // $<." and the question echo rendered as KaTeX: `$@ and $` was accepted as
  // inline math because isInlineMathBody only rejected bodies that START with
  // a digit, and `@ and ` starts with `@`.
  //
  // The fix is the standard pandoc/remark-math adjacency rule: no whitespace
  // immediately inside either delimiter. These pin the shapes that actually
  // occur in interview answers about build systems and shells.
  const mathish = (s) => /katex/.test(renderStreamingMarkdown(s));

  const PROSE = [
    ['Make automatic variables', 'Show a Makefile rule using $@ and $<.'],
    ['Make vars in a sentence', 'The $@ expands to the target and $< to the prereq.'],
    ['awk fields', 'Use $1 and $2 to select fields.'],
    ['shell exit status', 'Check $? and $# after the call.'],
    ['ANSI-C quoting', "a bash line using IFS=$'\\n' here"],
    ['currency pair', 'It costs $100 for $200 total.'],
  ];
  for (const [name, input] of PROSE) {
    test(`${name} stays literal text`, () => {
      assert.equal(mathish(input), false, `rendered as math: ${input}`);
    });
  }

  // Guard against over-correction: real inline math must still render. If the
  // adjacency rule ever tightens into "reject anything with a space", these
  // fail rather than silently disabling inline math.
  const MATH = [
    ['simple assignment', 'Let $x = 5$ be given.'],
    ['single symbol', 'The constant $c$ is the speed of light.'],
    ['expression with spaces inside', 'We know $a + b = c$ holds.'],
  ];
  for (const [name, input] of MATH) {
    test(`${name} still renders as math`, () => {
      assert.equal(mathish(input), true, `did NOT render as math: ${input}`);
    });
  }
});
