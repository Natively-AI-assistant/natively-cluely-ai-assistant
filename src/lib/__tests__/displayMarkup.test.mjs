// src/lib/__tests__/displayMarkup.test.mjs
//
// Renderer-side twin of the main-process [[GIST]] helpers
// (electron/llm/promptSystemV2.ts). The two implementations are duplicated
// on purpose (renderer cannot import main-process modules), so this suite
// pins the renderer copy to the SAME semantics the main-process suite pins:
// the marker is honored only when it starts the last non-empty line;
// anywhere else it is malformed output and stays visible.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIST_MARKER,
  splitGistLine,
  splitGistLineStreaming,
  stripDisplayMarkup,
  collapseBlockGaps,
} from '../displayMarkup.ts';

describe('splitGistLine', () => {
  test('splits a trailing gist line off the spoken body', () => {
    assert.deepEqual(
      splitGistLine('Body one.\nBody two.\n[[GIST]] five word essence here'),
      { body: 'Body one.\nBody two.', gist: 'five word essence here' },
    );
  });

  test('no marker → body unchanged, gist null', () => {
    assert.deepEqual(splitGistLine('No gist here.'), { body: 'No gist here.', gist: null });
  });

  test('marker mid-line is malformed and stays visible', () => {
    assert.equal(splitGistLine('text [[GIST]] inline').gist, null);
  });

  test('marker with content after it on later lines stays visible (top placement is malformed)', () => {
    assert.equal(splitGistLine('[[GIST]] top\nreal body').gist, null);
  });

  test('marker as the entire single line', () => {
    assert.deepEqual(splitGistLine('[[GIST]] only line'), { body: '', gist: 'only line' });
  });

  test('empty gist text after the marker → gist null', () => {
    assert.equal(splitGistLine('Body.\n[[GIST]]   ').gist, null);
  });

  test('trailing whitespace after the gist line is tolerated', () => {
    assert.deepEqual(splitGistLine('Body.\n[[GIST]] short essence\n  \n'), {
      body: 'Body.',
      gist: 'short essence',
    });
  });
});

describe('splitGistLineStreaming', () => {
  test('hides a trailing partial marker while it streams in', () => {
    for (const partial of ['[[', '[[G', '[[GIST', '[[GIST]]']) {
      assert.deepEqual(splitGistLineStreaming(`Body.\n${partial}`), { body: 'Body.', gist: null });
    }
  });

  test('complete marker streams its gist text into the chip', () => {
    assert.deepEqual(splitGistLineStreaming('Body.\n[[GIST]] par'), { body: 'Body.', gist: 'par' });
  });

  test('a non-marker last line is untouched', () => {
    assert.equal(splitGistLineStreaming('Body.\n[[NOT').body, 'Body.\n[[NOT');
  });

  test('finished text behaves exactly like splitGistLine', () => {
    const text = 'Body one.\n[[GIST]] essence';
    assert.deepEqual(splitGistLineStreaming(text), splitGistLine(text));
  });
});

describe('stripDisplayMarkup', () => {
  test('removes hot-word marks and the gist line — the pure spoken stream', () => {
    assert.equal(
      stripDisplayMarkup('The **key term** here.\n[[GIST]] essence'),
      'The key term here.',
    );
  });

  test('marker constant matches the prompt contract', () => {
    assert.equal(GIST_MARKER, '[[GIST]]');
  });
});

describe('collapseBlockGaps — inter-block newlines under whitespace-pre-wrap', () => {
  test('drops the newline marked emits between blocks', () => {
    const html = '<p>Save your script:</p>\n<pre><code class="language-python">print("hi")\n</code></pre>\n<p>Run it with:</p>\n';
    assert.equal(
      collapseBlockGaps(html),
      '<p>Save your script:</p><pre><code class="language-python">print("hi")\n</code></pre><p>Run it with:</p>',
    );
  });

  test('a code block\'s OWN newlines survive untouched', () => {
    const html = '<pre><code>line one\nline two\nline three\n</code></pre>\n<p>after</p>';
    const out = collapseBlockGaps(html);
    assert.ok(out.includes('line one\nline two\nline three\n'), out);
    assert.ok(!out.includes('</pre>\n'), out);
  });

  test('escaped markup inside a fence is not treated as a block boundary', () => {
    // marked escapes tags inside code, so a literal `</p>` can never appear in
    // code content — this pins that assumption.
    const html = '<pre><code>&lt;/p&gt;\n&lt;p&gt;still here&lt;/p&gt;\n</code></pre>';
    assert.equal(collapseBlockGaps(html), html);
  });

  test('newlines inside running text are preserved (pre-wrap still meaningful)', () => {
    const html = '<p>first line\nsecond line</p>';
    assert.equal(collapseBlockGaps(html), html);
  });

  test('empty and nullish input are safe', () => {
    assert.equal(collapseBlockGaps(''), '');
    assert.equal(collapseBlockGaps(undefined), '');
  });
});

describe('collapseBlockGaps — opening-tag boundaries (2026-08-02 round 2)', () => {
  test('list markup loses ALL structural newlines, items intact', () => {
    const html = '<p><strong>Core concepts:</strong></p>\n<ul>\n<li>GET reads</li>\n<li>POST creates</li>\n</ul>\n<h3>Header</h3>\n<p>text</p>\n';
    const out = collapseBlockGaps(html);
    assert.ok(!/\n/.test(out.replace(/<pre>[\s\S]*?<\/pre>/g, '')), `structural newline survived: ${JSON.stringify(out)}`);
    assert.ok(out.includes('<ul><li>GET reads</li><li>POST creates</li></ul>'), out);
  });

  test('loose-list text→block boundary is collapsed', () => {
    const html = '<li>intro text\n<ul>\n<li>nested</li>\n</ul>\n</li>';
    assert.equal(collapseBlockGaps(html), '<li>intro text<ul><li>nested</li></ul></li>');
  });

  test('soft break between inline elements is PRESERVED (not a block boundary)', () => {
    // "See **docs**\n**Note:** …" inside one paragraph — the newline touches
    // </strong> and <strong>, both inline; collapsing it would merge two lines
    // the author separated on purpose.
    const html = '<p>See <strong>docs</strong>\n<strong>Note:</strong> details</p>';
    assert.equal(collapseBlockGaps(html), html);
  });

  test('code fences keep their newlines under all three rules', () => {
    const html = '<pre><code class="language-cpp">#include &lt;vector&gt;\nint main() {\n  return 0;\n}\n</code></pre>\n<p>after</p>';
    const out = collapseBlockGaps(html);
    assert.ok(out.includes('#include &lt;vector&gt;\nint main() {\n  return 0;\n}\n'), out);
    assert.ok(out.endsWith('</pre><p>after</p>'), out);
  });
});
