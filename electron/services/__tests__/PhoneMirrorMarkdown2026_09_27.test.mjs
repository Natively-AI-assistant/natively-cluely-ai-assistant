// electron/services/__tests__/PhoneMirrorMarkdown2026_09_27.test.mjs
//
// "Gist is not rendering, also check markdown renders correctly" (Phone
// Mirror). The page rendered answers with a small hand-written renderer that
// showed the [[GIST]] line as text and had no tables, display math,
// strikethrough, h4-h6 or nested lists. Answers are now rendered on the
// desktop by renderPhoneAnswer with the overlay's own pieces (marked + the
// streaming renderer's math extensions + the [[GIST]] split). Pinned here:
// every construct the overlay renders, the gist split (final and streaming),
// and that the output is safe with no DOMPurify on the phone.
//
// Platform-agnostic: pure string rendering, same on macOS and Windows.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const bundle = process.env.PHONE_MIRROR_MARKDOWN_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_MARKDOWN_BUNDLE)
  : path.resolve(__dirname, '../../../dist-electron/electron/services/phoneMirrorMarkdown.js');
const { renderPhoneAnswer } = require(bundle);

const ANSWER = [
  '## Approach',
  '',
  'Use a **monotonic stack**: $O(n)$ time versus $O(n^2)$.',
  '',
  '1. Walk the array once',
  '   - push indices while values **decrease**',
  '   - pop on a *greater* value',
  '2. Record each answer',
  '3. Return `out`',
  '',
  '| Approach | Time |',
  '|---|---|',
  '| Brute force | $O(n^2)$ |',
  '',
  '```python',
  'def f(nums):',
  '    return [x < 3 for x in nums]',
  '```',
  '',
  '$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$',
  '',
  '> Say the complexity **first**.',
  '',
  '~~Sorting~~ is not needed. See [docs](https://docs.python.org/3/).',
  '',
  '#### Edge cases',
  '- [x] empty array',
  '',
  '[[GIST]] Monotonic stack, one pass, O(n) time',
].join('\n');

describe('answers render like the overlay renders them', () => {
  const { html, gist } = renderPhoneAnswer(ANSWER);

  test('the [[GIST]] line becomes the gist, not text', () => {
    assert.equal(gist, 'Monotonic stack, one pass, O(n) time');
    assert.doesNotMatch(html, /\[\[GIST\]\]/);
    assert.doesNotMatch(html, /Monotonic stack, one pass/);
  });

  test('headings (incl. h4), bold, italic, strikethrough, blockquote, inline code', () => {
    assert.match(html, /<h2>Approach<\/h2>/);
    assert.match(html, /<h4>Edge cases<\/h4>/);
    assert.match(html, /<strong>monotonic stack<\/strong>/);
    assert.match(html, /<em>greater<\/em>/);
    assert.match(html, /<del>Sorting<\/del>/);
    assert.match(html, /<blockquote>[\s\S]*<strong>first<\/strong>[\s\S]*<\/blockquote>/);
    assert.match(html, /<code>out<\/code>/);
  });

  test('a nested bullet list stays inside its numbered item; numbering continues', () => {
    const ol = html.match(/<ol>([\s\S]*?)<\/ol>/);
    assert.ok(ol, 'one ordered list');
    assert.match(ol[1], /<ul>[\s\S]*decrease[\s\S]*<\/ul>/);
    assert.equal((ol[1].match(/<li>/g) || []).length, 5, '3 numbered + 2 nested items');
    assert.equal((html.match(/<ol/g) || []).length, 1, 'not split into several lists');
  });

  test('tables are real tables, wrapped to scroll sideways', () => {
    assert.match(html, /<div class="table-wrap"><table>[\s\S]*<th>Approach<\/th>[\s\S]*<\/table><\/div>/);
  });

  test('inline and display math render as MathML (the page hides KaTeX\'s HTML half)', () => {
    assert.ok((html.match(/<math/g) || []).length >= 4, 'inline math in text and table + display');
    assert.match(html, /class="katex-display"/);
    assert.doesNotMatch(html, /\$O\(n\)\$/);
  });

  test('code blocks: the page\'s block, language, Copy, escaped code', () => {
    assert.match(html, /<div class="codeblock" data-lang="python"><div class="codeblock-head"><span>python<\/span><button type="button" class="codeblock-copy">Copy<\/button><\/div><pre><code>def f\(nums\):/);
    assert.match(html, /x &lt; 3/);
  });

  test('links open outside the page', () => {
    assert.match(html, /<a href="https:\/\/docs\.python\.org\/3\/" target="_blank" rel="noopener noreferrer">docs<\/a>/);
  });

  test('task lists render checkboxes', () => {
    assert.match(html, /<input[^>]*checked[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked/);
  });
});

describe('gist split follows the overlay rules', () => {
  test('a bullet-prefixed marker line is still the gist', () => {
    const r = renderPhoneAnswer('Body.\n- [[GIST]] Use backtracking');
    assert.equal(r.gist, 'Use backtracking');
    assert.doesNotMatch(r.html, /GIST/);
  });

  test('a marker mid-sentence is prose and stays visible', () => {
    const r = renderPhoneAnswer('You sort them [[GIST]] first, then subtract. More text follows here');
    assert.equal(r.gist, null);
    assert.match(r.html, /\[\[GIST\]\]/);
  });

  test('while streaming, a half-arrived marker never shows', () => {
    for (const partial of ['Answer.\n[[', 'Answer.\n[[GI', 'Answer.\n- [[GIS']) {
      const r = renderPhoneAnswer(partial, { streaming: true });
      assert.doesNotMatch(r.html, /\[\[/, partial);
      assert.match(r.html, /Answer\./);
    }
    assert.equal(renderPhoneAnswer('Answer.\n[[GIST]] Almost th', { streaming: true }).gist, 'Almost th');
  });

  test('no gist → gist null, body intact', () => {
    const r = renderPhoneAnswer('Just **one** line.');
    assert.equal(r.gist, null);
    assert.match(r.html, /Just <strong>one<\/strong> line\./);
  });
});

describe('safe without a sanitizer on the phone', () => {
  const hostile = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(2)</script>',
    '<b onclick="alert(3)">b</b>',
    '[x](javascript:alert(4)) [y](data:text/html,hi) [z](vbscript:msgbox)',
    '![pic](https://example.com/p.png) ![local](file:///etc/passwd)',
    '$\\href{javascript:alert(5)}{click}$',
  ].join('\n\n');
  const { html } = renderPhoneAnswer(hostile);

  test('raw HTML is text', () => {
    assert.doesNotMatch(html, /<img|<script|<b /i);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;script&gt;/);
  });

  test('only http(s)/mailto links; other schemes keep just the label', () => {
    assert.doesNotMatch(html, /href="(javascript|data|vbscript|file):/i);
    assert.match(html, /x/);
  });

  test('images become links (remote images are blocked by the page CSP anyway)', () => {
    assert.match(html, /<a href="https:\/\/example\.com\/p\.png" target="_blank" rel="noopener noreferrer">pic<\/a>/);
    assert.doesNotMatch(html, /file:\/\//);
  });

  test('KaTeX does not honour \\href', () => {
    assert.doesNotMatch(html, /href="javascript/i);
  });

  test('no event-handler attributes anywhere in the output', () => {
    assert.doesNotMatch(html, /<[^>]+\son[a-z]+=/i);
  });
});
