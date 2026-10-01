import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAnswerForDiagrams } from '../diagramSegments.mjs';

const DIAGRAM = 'flowchart LR\n    a["Client \\(web\\)"] --> b["**API** Service"]\n    b --> c[("Store $5")]';
const ANSWER = `Lead sentence with \\(x\\) math.\n\n\`\`\`mermaid\n${DIAGRAM}\n\`\`\`\n\n1. First point\n2. Second point\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\nClosing line.`;

describe('splitAnswerForDiagrams', () => {
  test('an answer without a diagram is one untouched Markdown chunk', () => {
    const text = 'Plain **answer** with `code` and\n\n```py\nprint(1)\n```\n';
    assert.deepEqual(splitAnswerForDiagrams(text), [{ type: 'markdown', key: 'm0', text }]);
    assert.deepEqual(splitAnswerForDiagrams('The word mermaid appears, no fence.'), [{ type: 'markdown', key: 'm0', text: 'The word mermaid appears, no fence.' }]);
    assert.deepEqual(splitAnswerForDiagrams(''), []);
    assert.deepEqual(splitAnswerForDiagrams(null), []);
  });

  test('the diagram is cut out byte for byte; everything else stays one chunk per side', () => {
    const parts = splitAnswerForDiagrams(ANSWER);
    assert.deepEqual(parts.map((p) => p.type), ['markdown', 'diagram', 'markdown']);
    assert.equal(parts[1].source, DIAGRAM, 'no prose/math normalisation touched the source');
    assert.equal(parts[1].complete, true);
    assert.equal(parts[1].diagramIndex, 0);
    assert.equal(parts[0].text, 'Lead sentence with \\(x\\) math.\n\n');
    // The list and the code block after the diagram travel together, so list
    // numbering and the code fence are parsed in one Markdown pass.
    assert.ok(parts[2].text.includes('1. First point\n2. Second point'));
    assert.ok(parts[2].text.includes('```ts\nconst x = 1;\n```'));
    assert.ok(parts[2].text.endsWith('Closing line.'));
  });

  test('the diagram is described by the prose just before it', () => {
    assert.equal(splitAnswerForDiagrams(ANSWER)[1].description, 'Lead sentence with \\(x\\) math.');
  });

  test('keys are stable as a streaming answer grows', () => {
    const keysAt = (n) => splitAnswerForDiagrams(ANSWER.slice(0, n), { streaming: true }).map((p) => p.key);
    const seen = new Map();
    for (let n = 1; n <= ANSWER.length; n += 1) {
      keysAt(n).forEach((key, index) => {
        if (seen.has(key)) assert.equal(seen.get(key), index, `key ${key} moved at ${n}`);
        else seen.set(key, index);
      });
    }
    assert.deepEqual(splitAnswerForDiagrams(ANSWER).map((p) => p.key), ['m0', 'd0', 'm1']);
  });

  test('while the block is arriving it is a diagram segment that is not complete', () => {
    const upto = ANSWER.indexOf('    b --> c');
    const parts = splitAnswerForDiagrams(ANSWER.slice(0, upto), { streaming: true });
    assert.deepEqual(parts.map((p) => p.type), ['markdown', 'diagram']);
    assert.equal(parts[1].complete, false);
  });

  test('a fence line turning into ```mermaid is hidden, not shown as text or code', () => {
    for (const partial of ['```m', '```merm', '```mermaid']) {
      const parts = splitAnswerForDiagrams('Lead.\n\n' + partial, { streaming: true });
      assert.deepEqual(parts, [{ type: 'markdown', key: 'm0', text: 'Lead.\n\n' }], partial);
    }
  });

  test('other streaming tails stay with the Markdown so nothing is dropped', () => {
    const text = 'Lead.\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\nThen code:\n```py';
    const parts = splitAnswerForDiagrams(text, { streaming: true });
    assert.equal(parts[2].type, 'markdown');
    assert.ok(parts[2].text.endsWith('```py'));
    // every character is accounted for: markdown chunks + the diagram block's raw text
    const md = parts.filter((p) => p.type === 'markdown').map((p) => p.text).join('');
    assert.equal(md.length + '```mermaid\nflowchart LR\n  a --> b\n```\n'.length, text.length);
  });

  test('a finished answer cut off inside the diagram reports it incomplete', () => {
    const parts = splitAnswerForDiagrams('Lead.\n\n```mermaid\nflowchart LR\n  a --> b');
    assert.equal(parts[1].type, 'diagram');
    assert.equal(parts[1].complete, false);
  });

  test('two diagrams get two keys; whitespace-only gaps make no Markdown chunk', () => {
    const text = '```mermaid\nflowchart LR\n  a --> b\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n';
    assert.deepEqual(splitAnswerForDiagrams(text).map((p) => p.key), ['d0', 'd1']);
  });

  test('"mermaid source" keeps its info string for the card to read', () => {
    const parts = splitAnswerForDiagrams('```mermaid source\nflowchart LR\n  a --> b\n```');
    assert.equal(parts[0].info, 'mermaid source');
  });
});
