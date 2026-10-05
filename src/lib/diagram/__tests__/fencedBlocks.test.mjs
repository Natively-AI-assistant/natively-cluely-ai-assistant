import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFencedBlocks,
  createFencedBlockTracker,
  hasMermaidFence,
  extractMermaidBlocks,
  stripMermaidBlocks,
  replaceMermaidBlock,
} from '../fencedBlocks.mjs';

const ANSWER = [
  "I'd split creation from redirects and cache the hot path.",
  '',
  '```mermaid',
  'flowchart LR',
  '    client["Client"] --> api["API Service"]',
  '    api --> db[("URL Store")]',
  '```',
  '',
  'The database is the source of truth.',
  '',
  '```python',
  'def shorten(url):',
  '    return encode(next_id())',
  '```',
  '',
  'Cache misses fall back to the database.',
].join('\n');

const kinds = (parse) => parse.blocks.map((b) => b.kind);

/** Deterministic PRNG so a failing partition can be replayed from its seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomChunks(text, rand) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const size = 1 + Math.floor(rand() * 9);
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks;
}

describe('parseFencedBlocks — finished answers', () => {
  test('separates prose, a Mermaid block and ordinary code, in order', () => {
    const parse = parseFencedBlocks(ANSWER);
    assert.deepEqual(kinds(parse), ['prose', 'mermaid', 'prose', 'code', 'prose']);
    const [, diagram, , code] = parse.blocks;
    assert.equal(diagram.closed, true);
    assert.equal(diagram.lang, 'mermaid');
    assert.equal(diagram.diagramIndex, 0);
    assert.equal(diagram.fenceIndex, 0);
    assert.equal(
      diagram.source,
      'flowchart LR\n    client["Client"] --> api["API Service"]\n    api --> db[("URL Store")]',
    );
    assert.equal(code.lang, 'python');
    assert.equal(code.diagramIndex, -1);
    assert.equal(code.fenceIndex, 1);
  });

  test('block offsets tile the whole answer with no gap and no overlap', () => {
    const parse = parseFencedBlocks(ANSWER);
    let cursor = 0;
    for (const b of parse.blocks) {
      assert.equal(b.start, cursor);
      cursor = b.end;
    }
    assert.equal(cursor, ANSWER.length);
  });

  test('untagged code that merely mentions a diagram keyword is never Mermaid', () => {
    const text = '```\nflowchart LR\n  a --> b\n```\n';
    const parse = parseFencedBlocks(text);
    assert.deepEqual(kinds(parse), ['code']);
    assert.equal(hasMermaidFence(text), false);
  });

  test('a language tag other than mermaid stays code even if the body is Mermaid', () => {
    assert.equal(hasMermaidFence('```text\nsequenceDiagram\n  A->>B: hi\n```'), false);
  });

  test('the Mermaid tag is case-insensitive and tolerates trailing info', () => {
    const blocks = extractMermaidBlocks('```Mermaid title="x"\nflowchart TD\n  a --> b\n```');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].info, 'Mermaid title="x"');
  });

  test('tilde fences work, and a backtick line inside does not close them', () => {
    const text = '~~~mermaid\nflowchart TD\n  a["`x`"] --> b\n```\n  b --> c\n~~~\nafter';
    const parse = parseFencedBlocks(text);
    assert.deepEqual(kinds(parse), ['mermaid', 'prose']);
    assert.match(parse.blocks[0].source, /```\n {2}b --> c$/);
  });

  test('a closing fence must be at least as long as the opening one', () => {
    const text = '````mermaid\nflowchart TD\n  a --> b\n```\n  b --> c\n````\n';
    const [block] = extractMermaidBlocks(text);
    assert.equal(block.closed, true);
    assert.match(block.source, /```\n {2}b --> c$/);
  });

  test('a closing fence may carry trailing spaces but not other text', () => {
    const closed = extractMermaidBlocks('```mermaid\nflowchart TD\n  a --> b\n```   \nmore');
    assert.equal(closed[0].closed, true);
    const open = extractMermaidBlocks('```mermaid\nflowchart TD\n  a --> b\n``` nope\n');
    assert.equal(open[0].closed, false);
  });

  test('"```js```" on one line is not an opening fence', () => {
    assert.deepEqual(kinds(parseFencedBlocks('```js```\nplain\n')), ['prose']);
  });

  test('an answer cut off inside a block reports it as not closed', () => {
    const [block] = extractMermaidBlocks('Intro\n```mermaid\nflowchart LR\n  a --> b');
    assert.equal(block.closed, false);
    assert.equal(block.source, 'flowchart LR\n  a --> b');
  });

  test('a final closing fence without a trailing newline closes the block', () => {
    const [block] = extractMermaidBlocks('```mermaid\nflowchart LR\n  a --> b\n```');
    assert.equal(block.closed, true);
    assert.equal(block.source, 'flowchart LR\n  a --> b');
  });

  test('an answer that ends on the opening fence line is an empty unclosed block', () => {
    const parse = parseFencedBlocks('Intro\n```mermaid');
    assert.deepEqual(kinds(parse), ['prose', 'mermaid']);
    assert.equal(parse.blocks[1].closed, false);
    assert.equal(parse.blocks[1].source, '');
  });

  test('a fence under a list item keeps its content, minus the fence indent', () => {
    const text = '1. Flow:\n   ```mermaid\n   flowchart TD\n     a --> b\n   ```\n2. Next';
    const [block] = extractMermaidBlocks(text);
    assert.equal(block.closed, true);
    assert.equal(block.source, 'flowchart TD\n  a --> b');
  });

  test('CRLF line endings are handled', () => {
    const [block] = extractMermaidBlocks('```mermaid\r\nflowchart TD\r\n  a --> b\r\n```\r\nafter');
    assert.equal(block.closed, true);
    assert.equal(block.source, 'flowchart TD\r\n  a --> b');
  });

  test('punctuation, quotes and Unicode labels survive byte for byte', () => {
    const body = 'flowchart LR\n  a["Kunde — «Größe» 日本語 $5 * 2 _x_"] -->|"a|b"| b[("DB #1")]';
    const [block] = extractMermaidBlocks('```mermaid\n' + body + '\n```\n');
    assert.equal(block.source, body);
  });

  test('several diagrams get stable ordinals; code fences do not consume them', () => {
    const text = [
      '```mermaid\nflowchart LR\n  a --> b\n```',
      '```ts\nconst x = 1;\n```',
      '```mermaid\nsequenceDiagram\n  A->>B: hi\n```',
    ].join('\n\n');
    const diagrams = extractMermaidBlocks(text);
    assert.deepEqual(diagrams.map((d) => d.diagramIndex), [0, 1]);
    assert.deepEqual(diagrams.map((d) => d.fenceIndex), [0, 2]);
  });
});

describe('parseFencedBlocks — streaming prefixes', () => {
  test('one or two fence characters at line start are held back, not painted', () => {
    for (const partial of ['`', '``', '~~']) {
      const parse = parseFencedBlocks('Intro\n' + partial, { final: false });
      assert.deepEqual(kinds(parse), ['prose']);
      assert.equal(parse.blocks[0].text, 'Intro\n');
      assert.deepEqual(parse.tail, { kind: 'maybe-fence', text: partial });
    }
  });

  test('inline code at line start stops being held as soon as it is not a fence', () => {
    const parse = parseFencedBlocks('Intro\n`map', { final: false });
    assert.equal(parse.tail.kind, 'none');
    assert.equal(parse.blocks[0].text, 'Intro\n`map');
  });

  test('an opening fence whose tag is still arriving is reported, with no block yet', () => {
    for (const partial of ['```', '```mer', '```mermaid']) {
      const parse = parseFencedBlocks('Intro\n' + partial, { final: false });
      assert.deepEqual(kinds(parse), ['prose']);
      assert.deepEqual(parse.tail, { kind: 'opening-fence', text: partial });
    }
  });

  test('the block exists, open, once the opening line is complete', () => {
    const parse = parseFencedBlocks('Intro\n```mermaid\nflowchart', { final: false });
    assert.deepEqual(kinds(parse), ['prose', 'mermaid']);
    assert.equal(parse.blocks[1].closed, false);
    assert.equal(parse.blocks[1].source, 'flowchart');
  });

  test('a half-arrived closing fence is neither source nor a close', () => {
    for (const partial of ['`', '``', '```', '```  ']) {
      const parse = parseFencedBlocks('```mermaid\nflowchart LR\n  a --> b\n' + partial, { final: false });
      const block = parse.blocks[0];
      assert.equal(block.closed, false, `closed early on ${JSON.stringify(partial)}`);
      assert.equal(block.source, 'flowchart LR\n  a --> b');
      assert.equal(parse.tail.kind, 'maybe-closing-fence');
    }
  });

  test('the block closes when the closing line is complete, while prose is still streaming', () => {
    const parse = parseFencedBlocks('```mermaid\nflowchart LR\n  a --> b\n```\nThe databa', { final: false });
    assert.deepEqual(kinds(parse), ['mermaid', 'prose']);
    assert.equal(parse.blocks[0].closed, true);
    assert.equal(parse.blocks[1].text, 'The databa');
  });

  test('a partial content line that cannot be a fence is shown as source', () => {
    const parse = parseFencedBlocks('```mermaid\nflowchart LR\n  a --', { final: false });
    assert.equal(parse.blocks[0].source, 'flowchart LR\n  a --');
    assert.equal(parse.tail.kind, 'none');
  });
});

describe('createFencedBlockTracker', () => {
  test('every random chunking converges on the same blocks as a one-shot parse', () => {
    const samples = [
      ANSWER,
      ANSWER.replace(/\n/g, '\r\n'),
      '~~~mermaid\nstateDiagram-v2\n  [*] --> Placed\n  Placed --> Paid: pay\n~~~\n\nDone.',
      'Lead.\n\n````mermaid\nsequenceDiagram\n  A->>B: "```"\n````\ntail `inline` text\n```\nuntagged\n```',
      '1. Flow:\n   ```mermaid\n   flowchart TD\n     a --> b\n   ```\n2. Next\n',
    ];
    for (const sample of samples) {
      const expected = parseFencedBlocks(sample);
      for (let seed = 1; seed <= 60; seed += 1) {
        const tracker = createFencedBlockTracker();
        let acc = '';
        let closedSeen = 0;
        for (const chunk of randomChunks(sample, mulberry32(seed))) {
          acc += chunk;
          const parse = tracker.update(acc);
          // Same answer for the same prefix whether tracked or parsed fresh.
          assert.deepEqual(parse, parseFencedBlocks(acc, { final: false }), `seed ${seed}`);
          // A block never un-closes, and never changes source once closed.
          const closed = parse.blocks.filter((b) => b.kind !== 'prose' && b.closed);
          assert.ok(closed.length >= closedSeen, `seed ${seed}: a closed block disappeared`);
          closedSeen = closed.length;
          for (const b of closed) {
            const final = expected.blocks.find((e) => e.kind !== 'prose' && e.fenceIndex === b.fenceIndex);
            assert.equal(b.source, final.source, `seed ${seed}: closed source changed`);
            assert.equal(b.kind, final.kind);
          }
        }
        assert.deepEqual(tracker.update(acc, { final: true }), expected, `seed ${seed}`);
      }
    }
  });

  test('a Mermaid block is never reported closed before its closing line is complete', () => {
    const text = 'Intro\n```mermaid\nflowchart LR\n  a --> b\n```\nafter';
    const closeAt = text.indexOf('```\nafter') + 4; // index just past the closing newline
    const tracker = createFencedBlockTracker();
    for (let i = 1; i <= text.length; i += 1) {
      const parse = tracker.update(text.slice(0, i));
      const diagram = parse.blocks.find((b) => b.kind === 'mermaid');
      if (i < closeAt) assert.ok(!diagram || !diagram.closed, `closed at ${i}`);
      else assert.equal(diagram.closed, true);
    }
  });

  test('replacement text that is not an extension restarts the scan', () => {
    const tracker = createFencedBlockTracker();
    tracker.update('```mermaid\nflowchart LR\n  a --> b\n');
    const parse = tracker.update('Repaired.\n\n```mermaid\nflowchart TD\n  x --> y\n```\n', { final: true });
    assert.deepEqual(kinds(parse), ['prose', 'mermaid']);
    assert.equal(parse.blocks[1].source, 'flowchart TD\n  x --> y');
    assert.equal(parse.blocks[1].diagramIndex, 0);
  });
});

describe('helpers', () => {
  test('stripMermaidBlocks keeps prose and ordinary code', () => {
    const out = stripMermaidBlocks(ANSWER);
    assert.ok(!out.includes('flowchart'));
    assert.ok(out.includes('```python'));
    assert.ok(out.includes('source of truth'));
    assert.ok(!/\n{3,}/.test(out));
  });

  test('replaceMermaidBlock swaps only the targeted diagram', () => {
    const text = '```mermaid\nflowchart LR\n  a --> b\n```\n\nmid\n\n```mermaid\nflowchart LR\n  c --> d\n```\nend';
    const out = replaceMermaidBlock(text, 1, 'flowchart TD\n  x --> y\n');
    const diagrams = extractMermaidBlocks(out);
    assert.equal(diagrams[0].source, 'flowchart LR\n  a --> b');
    assert.equal(diagrams[1].source, 'flowchart TD\n  x --> y');
    assert.ok(out.endsWith('```\nend'));
    assert.ok(out.includes('\n\nmid\n\n'));
  });

  test('replaceMermaidBlock leaves the text alone when the diagram does not exist', () => {
    assert.equal(replaceMermaidBlock('plain', 0, 'flowchart TD'), 'plain');
  });
});

// Found in review (2026-10-01): "1. ```bash" was prose, so its closing fence
// opened a block that swallowed the diagram after it.
describe('a fence on a list item\'s own line', () => {
  const B = 'flowchart LR\n    a --> b';

  test('opens a block, and the diagram after it is still a diagram', () => {
    const text = `Steps:\n\n1. \`\`\`bash\n   npm install\n   \`\`\`\n2. Then draw:\n\n\`\`\`mermaid\n${B}\n\`\`\`\n`;
    const { blocks } = parseFencedBlocks(text, { final: true });
    assert.deepEqual(blocks.map((b) => b.kind), ['prose', 'code', 'prose', 'mermaid']);
    assert.equal(blocks[1].source, 'npm install');
    assert.equal(blocks[1].closed, true);
    assert.equal(blocks[3].source, B);
  });

  test('bullets and "2)" markers too; the incremental tracker agrees with a fresh parse', () => {
    for (const marker of ['- ', '* ', '+ ', '2) ', '10. ']) {
      const text = `${marker}\`\`\`sh\n${' '.repeat(marker.length)}ls\n${' '.repeat(marker.length)}\`\`\`\n\n\`\`\`mermaid\n${B}\n\`\`\`\n`;
      const fresh = parseFencedBlocks(text, { final: true }).blocks.map((b) => `${b.kind}:${b.closed}`);
      assert.ok(fresh.includes('mermaid:true'), marker);
      const tracker = createFencedBlockTracker();
      for (let i = 3; i < text.length; i += 3) tracker.update(text.slice(0, i));
      const settled = tracker.update(text, { final: true });
      assert.deepEqual(settled.blocks.map((b) => `${b.kind}:${b.closed}`), fresh, marker);
    }
  });

  test('a list item that only mentions backticks in its text is prose', () => {
    const { blocks } = parseFencedBlocks('1. Use ``` to open a block\n2. Done\n', { final: true });
    assert.deepEqual(blocks.map((b) => b.kind), ['prose']);
  });

  test('a tag in any case is the same tag', () => {
    const { blocks } = parseFencedBlocks(`\`\`\`Mermaid\n${B}\n\`\`\`\n`, { final: true });
    assert.equal(blocks[0].kind, 'mermaid');
  });
});

// Second review (2026-10-02): what the list-item fence rule got wrong.
describe('a fence on a list item\'s line, second pass', () => {
  const B = 'flowchart LR\n    a --> b';

  test('a bullet that talks about fences is a sentence, and the diagram after it is still a diagram', () => {
    const { blocks } = parseFencedBlocks(`- \`\`\` opens a code block\n- so does ~~~\n\n\`\`\`mermaid\n${B}\n\`\`\`\n`, { final: true });
    assert.deepEqual(blocks.map((b) => b.kind), ['prose', 'mermaid']);
  });

  test('content under a list marker keeps its own indentation (a mind map is nothing else)', () => {
    const flat = parseFencedBlocks('1. ```mermaid\nmindmap\n root\n  A\n  B\n```\n', { final: true }).blocks.find((b) => b.kind === 'mermaid');
    assert.equal(flat.source, 'mindmap\n root\n  A\n  B');
    const indented = parseFencedBlocks('1. ```mermaid\n   mindmap\n     root\n       A\n   ```\n', { final: true }).blocks.find((b) => b.kind === 'mermaid');
    assert.equal(indented.source, 'mindmap\n  root\n    A');
    assert.equal(indented.closed, true);
  });

  test('a final text that ends in a carriage return has closed its block', () => {
    const { blocks } = parseFencedBlocks(`x\n\n\`\`\`mermaid\n${B}\n\`\`\`\r`, { final: true });
    assert.equal(blocks.find((b) => b.kind === 'mermaid').closed, true);
  });
});
