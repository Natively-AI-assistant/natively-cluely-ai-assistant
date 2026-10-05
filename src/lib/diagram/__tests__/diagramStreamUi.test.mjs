import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldUseStreamingDiagramUi,
  hasOpeningMermaidFence,
  isMermaidOpeningTail,
  fastForwardDiagramReveal,
  completedDiagramCount,
  previousVersionFor,
  describeDiagramFromLead,
} from '../diagramStreamUi.mjs';
import { parseFencedBlocks, createFencedBlockTracker } from '../fencedBlocks.mjs';

const LEAD = "I'd queue every send and retry from a dead-letter queue.\n\n";
const DIAGRAM = 'flowchart LR\n    producer["Producer Service"] --> queue["Notification Queue"]\n    queue --> worker["Delivery Worker"]';
const ANSWER = `${LEAD}\`\`\`mermaid\n${DIAGRAM}\n\`\`\`\n\nThe queue absorbs bursts and the worker owns delivery.`;

describe('shouldUseStreamingDiagramUi', () => {
  test('true once the opening fence reads mermaid, on any chunking', () => {
    for (let cut = 1; cut < ANSWER.length; cut += 1) {
      const prev = ANSWER.slice(0, cut);
      const token = ANSWER.slice(cut, cut + 3);
      const expected = hasOpeningMermaidFence(prev + token);
      assert.equal(shouldUseStreamingDiagramUi(token, prev) || hasOpeningMermaidFence(prev), expected, `cut ${cut}`);
    }
  });

  test('fires exactly when the tag completes across a token boundary', () => {
    assert.equal(shouldUseStreamingDiagramUi('aid\n', LEAD + '```merm'), true);
    assert.equal(shouldUseStreamingDiagramUi('`mermaid', LEAD + '``'), true);
    assert.equal(shouldUseStreamingDiagramUi('merm', LEAD + '```'), false);
  });

  test('ordinary code fences and the word "mermaid" in prose do not trigger it', () => {
    assert.equal(shouldUseStreamingDiagramUi('```python\nprint(1)', 'Here:\n'), false);
    assert.equal(shouldUseStreamingDiagramUi(' mermaid syntax is neat', 'I think'), false);
    assert.equal(shouldUseStreamingDiagramUi('`mermaid` is a tool', 'Note: '), false);
    assert.equal(shouldUseStreamingDiagramUi('```mermaidjs\n', ''), false);
  });

  test('tilde fences and indented fences count', () => {
    assert.equal(shouldUseStreamingDiagramUi('~~~mermaid\n', 'Lead\n'), true);
    assert.equal(shouldUseStreamingDiagramUi('   ```mermaid\n', '1. Flow:\n'), true);
  });
});

describe('isMermaidOpeningTail', () => {
  test('a fence line that is becoming "```mermaid" is hidden; other fences are not', () => {
    for (const partial of ['```m', '```mer', '```mermaid', '~~~merm']) {
      assert.equal(isMermaidOpeningTail(parseFencedBlocks('x\n' + partial, { final: false }).tail), true, partial);
    }
    for (const partial of ['```', '```py', '```markdown', '```mermaidx']) {
      assert.equal(isMermaidOpeningTail(parseFencedBlocks('x\n' + partial, { final: false }).tail), false, partial);
    }
    assert.equal(isMermaidOpeningTail(null), false);
  });
});

describe('fastForwardDiagramReveal — the artifact fast-forward', () => {
  const blocksAt = (arrived) => parseFencedBlocks(arrived, { final: false }).blocks;
  const blockStart = ANSWER.indexOf('```mermaid');
  const blockEnd = ANSWER.indexOf('```\n\nThe queue') + 4;

  test('text before the block is never skipped', () => {
    const blocks = blocksAt(ANSWER);
    for (let revealed = 0; revealed < blockStart; revealed += 7) {
      assert.equal(fastForwardDiagramReveal(blocks, revealed, ANSWER.length), revealed);
    }
  });

  test('reaching the block jumps to the end of the block, not past it', () => {
    const blocks = blocksAt(ANSWER);
    assert.equal(fastForwardDiagramReveal(blocks, blockStart, ANSWER.length), blockEnd);
    assert.equal(fastForwardDiagramReveal(blocks, blockStart + 15, ANSWER.length), blockEnd);
    assert.equal(ANSWER.slice(blockEnd), '\nThe queue absorbs bursts and the worker owns delivery.');
  });

  test('prose after the block keeps its own pace', () => {
    const blocks = blocksAt(ANSWER);
    for (let revealed = blockEnd; revealed <= ANSWER.length; revealed += 5) {
      assert.equal(fastForwardDiagramReveal(blocks, revealed, ANSWER.length), revealed);
    }
  });

  test('while the block is still arriving, the reveal tracks arrival (no lag behind the source)', () => {
    const tracker = createFencedBlockTracker();
    let revealed = blockStart; // the paced reveal has just reached the fence
    for (let arrived = blockStart + 12; arrived <= blockEnd + 20; arrived += 9) {
      const text = ANSWER.slice(0, arrived);
      const next = fastForwardDiagramReveal(tracker.update(text).blocks, revealed, text.length);
      assert.ok(next >= revealed, 'never moves backwards');
      if (arrived <= blockEnd - 4) assert.equal(next, text.length, `arrived ${arrived}: all arrived source is revealed`);
      revealed = next;
    }
    assert.ok(revealed >= blockEnd - 1 && revealed <= blockEnd, 'ends at the end of the block');
  });

  test('ordinary code blocks are NOT fast-forwarded (code keeps its line reveal)', () => {
    const text = 'Here:\n\n```python\nprint(1)\nprint(2)\n```\ndone';
    const blocks = parseFencedBlocks(text, { final: false }).blocks;
    const inside = text.indexOf('print(1)');
    assert.equal(fastForwardDiagramReveal(blocks, inside, text.length), inside);
  });

  test('bad input is returned unchanged', () => {
    assert.equal(fastForwardDiagramReveal(null, 5, 10), 5);
    assert.equal(fastForwardDiagramReveal([], NaN, 10), NaN);
  });

  test('completedDiagramCount counts only closed Mermaid blocks', () => {
    assert.equal(completedDiagramCount(blocksAt(ANSWER.slice(0, blockEnd - 3))), 0);
    assert.equal(completedDiagramCount(blocksAt(ANSWER)), 1);
    assert.equal(completedDiagramCount(parseFencedBlocks('```ts\nx\n```\n').blocks), 0);
  });
});

describe('previousVersionFor', () => {
  const previous = DIAGRAM;
  test('an update of the same design keeps the previous version on screen', () => {
    const partial = 'flowchart LR\n    producer["Producer Service"] --> queue["Notification Queue"]\n    queue --> retry["Retry';
    assert.equal(previousVersionFor(partial, previous), previous);
  });
  test('a different design does not', () => {
    const partial = 'flowchart LR\n    gate["Entry Gate"] --> allocator["Spot Allocator"]\n    allocator --> floors[("Floor Map")]';
    assert.equal(previousVersionFor(partial, previous), undefined);
  });
  test('too little has arrived to tell: no previous version yet', () => {
    assert.equal(previousVersionFor('flowchart LR\n    prod', previous), undefined);
    assert.equal(previousVersionFor('', previous), undefined);
    assert.equal(previousVersionFor('flowchart LR', undefined), undefined);
  });
});

describe('describeDiagramFromLead', () => {
  test('uses the answer\'s own lead, without markdown', () => {
    assert.equal(describeDiagramFromLead('**I\'d** queue every `send`.\n\n'), "I'd queue every send.");
  });
  test('bounded, cut at a sentence when possible', () => {
    const long = 'First sentence about the approach and its assumptions here. '.repeat(10);
    const out = describeDiagramFromLead(long);
    assert.ok(out.length <= 281);
    assert.ok(out.endsWith('.'));
  });
  test('empty lead → empty description', () => {
    assert.equal(describeDiagramFromLead('  \n'), '');
    assert.equal(describeDiagramFromLead(null), '');
  });
});

describe('mayHoldMermaidFence', () => {
  test('true for any text naming mermaid; while streaming, also for a fence line turning into it', async () => {
    const { mayHoldMermaidFence } = await import('../diagramStreamUi.mjs');
    assert.equal(mayHoldMermaidFence('x\n```mermaid\nflowchart LR'), true);
    assert.equal(mayHoldMermaidFence('Lead.\n\n```m', true), true);
    assert.equal(mayHoldMermaidFence('Lead.\n\n~~~merm', true), true);
    assert.equal(mayHoldMermaidFence('Lead.\n\n```m', false), false, 'a finished answer ending in "```m" is not a diagram');
    assert.equal(mayHoldMermaidFence('Lead.\n\n```py', true), false);
    assert.equal(mayHoldMermaidFence('plain prose', true), false);
    assert.equal(mayHoldMermaidFence('', true), false);
  });
});

// Found in review (2026-10-01): the gates in front of the scanner were each
// stricter than it in a different way.
describe('every gate reads a fence line the way the scanner does', async () => {
  const { parseFencedBlocks, isVisualBlock, mentionsVisualTag } = await import('../fencedBlocks.mjs');
  const { mayHoldMermaidFence } = await import('../diagramStreamUi.mjs');
  const B = 'flowchart LR\n    a --> b';
  const OPENINGS = [
    ['```mermaid', '```'], ['``` mermaid', '```'], ['~~~ mermaid', '~~~'], ['```Mermaid', '```'], ['~~~mermaid', '~~~'],
    ['   ```mermaid', '   ```'], ['1. ```mermaid', '   ```'], ['- ```natively-chart', '  ```'], ['```mermaid title', '```'], ['````natively-diagram', '````'],
  ];

  test('what the scanner calls a visual block, every gate lets through', () => {
    for (const [open, close] of OPENINGS) {
      const text = `Lead.\n\n${open}\n${B}\n${close}\nTail.`;
      assert.equal(parseFencedBlocks(text, { final: true }).blocks.filter(isVisualBlock).length, 1, `scanner: ${open}`);
      assert.equal(hasOpeningMermaidFence(text), true, `opening: ${open}`);
      assert.equal(mentionsVisualTag(text), true, `mentions: ${open}`);
      assert.equal(mayHoldMermaidFence(text, false), true, `mayHold: ${open}`);
      assert.equal(shouldUseStreamingDiagramUi(open.slice(-3), `Lead.\n\n${open.slice(0, -3)}`), true, `stream: ${open}`);
    }
  });

  test('a fence line whose tag is finished stays hidden while the line is not', () => {
    for (const tail of ['```m', '```merm', '```mermaid', '```mermaid ', '```mermaid\r', '```mermaid source', '``` merm', '~~~ natively-ch', '1. ```merm']) {
      assert.equal(isMermaidOpeningTail({ kind: 'opening-fence', text: tail }), true, JSON.stringify(tail));
    }
    for (const tail of ['```', '```python', '```python ', '```js title', '```mermaidx', '```mermaid-like ']) {
      assert.equal(isMermaidOpeningTail({ kind: 'opening-fence', text: tail }), false, JSON.stringify(tail));
    }
  });

  test('prose that only talks about fences does not look like one', () => {
    assert.equal(hasOpeningMermaidFence('Use a mermaid block, three backticks then the word.'), false);
    assert.equal(hasOpeningMermaidFence('1. mermaid is a tool\n2. so is graphviz'), false);
  });
});
