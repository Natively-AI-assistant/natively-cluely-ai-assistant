import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { preserveDiagramsInRefinement, refinementTouchesDesign, REFINE_DIAGRAM_RULE } from '../diagramRefine.mjs';
import { extractMermaidBlocks } from '../fencedBlocks.mjs';

const DIAGRAM = 'flowchart LR\n    client["Client"] --> api["API Service"]\n    api --> db[("URL Store")]';
const PREVIOUS = `I'd split creation from redirects and cache the hot path, assuming reads dominate.\n\n\`\`\`mermaid\n${DIAGRAM}\n\`\`\`\n\nThe database is the source of truth. Cache misses fall back to it, and entries expire with the link.`;

describe('preserveDiagramsInRefinement', () => {
  test('a refinement that kept the diagram is returned untouched', () => {
    const refined = `Split creation from redirects.\n\n\`\`\`mermaid\n${DIAGRAM}\n\`\`\`\n\nThe database is the truth.`;
    const out = preserveDiagramsInRefinement(PREVIOUS, refined);
    assert.equal(out.changed, false);
    assert.equal(out.text, refined);
  });

  test('a refinement that dropped the diagram gets it back after the lead paragraph', () => {
    const refined = 'Split creation from redirects.\n\nThe database is the truth.';
    const out = preserveDiagramsInRefinement(PREVIOUS, refined);
    assert.equal(out.changed, true);
    assert.equal(out.restored, 1);
    const [block] = extractMermaidBlocks(out.text);
    assert.equal(block.source, DIAGRAM);
    assert.ok(out.text.indexOf('Split creation') < out.text.indexOf('```mermaid'));
    assert.ok(out.text.indexOf('```mermaid') < out.text.indexOf('The database is the truth.'));
  });

  test('a one-paragraph refinement gets the diagram appended', () => {
    const out = preserveDiagramsInRefinement(PREVIOUS, 'Split creation from redirects; the database is the truth.');
    assert.equal(extractMermaidBlocks(out.text)[0].source, DIAGRAM);
    assert.ok(out.text.startsWith('Split creation'));
  });

  test('a refinement that "shortened" the diagram has the original put back in place', () => {
    const refined = 'Shorter.\n\n```mermaid\nflowchart LR\n    client --> api\n```\n\nDone.';
    const out = preserveDiagramsInRefinement(PREVIOUS, refined);
    assert.equal(out.changed, true);
    const blocks = extractMermaidBlocks(out.text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].source, DIAGRAM);
    assert.ok(out.text.startsWith('Shorter.\n\n```mermaid\n'));
    assert.ok(out.text.endsWith('```\n\nDone.'));
  });

  test('ordinary code blocks in the refinement are never touched', () => {
    const refined = `Short.\n\n\`\`\`mermaid\n${DIAGRAM}\n\`\`\`\n\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    const out = preserveDiagramsInRefinement(PREVIOUS, refined);
    assert.equal(out.changed, false);
    assert.ok(out.text.includes('```ts\nconst x = 1;\n```'));
  });

  test('a previous answer without a diagram enforces nothing', () => {
    const out = preserveDiagramsInRefinement('Plain answer.', 'Plainer.');
    assert.deepEqual(out, { text: 'Plainer.', changed: false, restored: 0 });
  });

  test('an empty refinement is left empty (nothing to attach a diagram to)', () => {
    assert.equal(preserveDiagramsInRefinement(PREVIOUS, '').changed, false);
  });

  test('two diagrams: the changed one is restored, order kept', () => {
    const second = 'sequenceDiagram\n    A->>B: hi';
    const previous = `${PREVIOUS}\n\n\`\`\`mermaid\n${second}\n\`\`\``;
    const refined = `Short.\n\n\`\`\`mermaid\n${DIAGRAM}\n\`\`\`\n\nMid.\n\n\`\`\`mermaid\nsequenceDiagram\n    A->>B: changed\n\`\`\``;
    const out = preserveDiagramsInRefinement(previous, refined);
    const blocks = extractMermaidBlocks(out.text);
    assert.deepEqual(blocks.map((b) => b.source), [DIAGRAM, second]);
    assert.equal(out.restored, 1);
  });
});

describe('refinementTouchesDesign', () => {
  test('wording requests do not touch the design', () => {
    for (const r of ['shorten', 'rephrase', 'make it more casual', 'Make your answer shorter', 'simplify']) {
      assert.equal(refinementTouchesDesign(r), false, r);
    }
  });
  test('requests about the diagram do', () => {
    for (const r of ['simplify the diagram', 'shorten it and drop the cache node', 'make the architecture simpler']) {
      assert.equal(refinementTouchesDesign(r), true, r);
    }
  });
  test('the rule names the block and the constraint', () => {
    assert.match(REFINE_DIAGRAM_RULE, /mermaid/);
    assert.match(REFINE_DIAGRAM_RULE, /exactly/);
  });
});

// Found in review (2026-10-01): blocks were paired by position.
describe('which block stands for which diagram is decided by content', () => {
  const D = 'flowchart LR\n    a["A"] --> b["B"]\n    b --> c["C"]';
  const previous = `Lead sentence.\n\n\`\`\`mermaid\n${D}\n\`\`\`\n\nExplanation here.`;
  const blocks = (text) => text.split('```mermaid').length - 1;

  test('a diagram returned in a fence with no tag is retagged in place, not duplicated', () => {
    const r = preserveDiagramsInRefinement(previous, `Short lead.\n\n\`\`\`\n${D}\n\`\`\`\n\nShort.`);
    assert.equal(blocks(r.text), 1);
    assert.equal(r.text, `Short lead.\n\n\`\`\`mermaid\n${D}\n\`\`\`\n\nShort.`);
  });

  test('…also when the model trimmed it on the way', () => {
    const r = preserveDiagramsInRefinement(previous, `Short lead.\n\n\`\`\`\nflowchart LR\n    a["A"] --> b["B"]\n\`\`\`\n\nShort.`);
    assert.equal(blocks(r.text), 1);
    assert.ok(r.text.includes(D));
    assert.doesNotMatch(r.text, /```\nflowchart/);
  });

  test('a new chart placed above the kept diagram is left alone, and nothing is added', () => {
    const refined = `Lead.\n\n\`\`\`natively-chart\n{"v":1,"type":"bar"}\n\`\`\`\n\n\`\`\`mermaid\n${D}\n\`\`\`\n\nTail.`;
    const r = preserveDiagramsInRefinement(previous, refined);
    assert.equal(r.changed, false);
    assert.equal(r.text, refined);
  });

  test('a code listing that is not the diagram is not mistaken for it', () => {
    const r = preserveDiagramsInRefinement(previous, 'Lead.\n\n```python\nprint(1)\n```\n\n```\nflowchart TD\n    x --> y\n    y --> z\n```\n\nTail.');
    assert.ok(r.text.includes('```python\nprint(1)\n```'));
    assert.ok(r.text.includes('```\nflowchart TD\n    x --> y'), 'another diagram entirely stays as written');
    assert.equal(blocks(r.text), 1, 'and the original is restored once');
  });

  test('two diagrams swapped by the model both survive unchanged', () => {
    const E = 'sequenceDiagram\n    A->>B: hi';
    const two = `One.\n\n\`\`\`mermaid\n${D}\n\`\`\`\n\nTwo.\n\n\`\`\`mermaid\n${E}\n\`\`\``;
    const swapped = `Two.\n\n\`\`\`mermaid\n${E}\n\`\`\`\n\nOne.\n\n\`\`\`mermaid\n${D}\n\`\`\``;
    const r = preserveDiagramsInRefinement(two, swapped);
    assert.equal(r.changed, false);
    assert.equal(r.text, swapped);
  });
});

describe('a request that edits what is drawn, without the word "diagram"', () => {
  test('is a change to the design, so the old diagram is not forced back', () => {
    for (const q of ['Add a cache layer', 'Remove the queue', 'Replace Postgres with DynamoDB', 'Swap the broker for Kafka', 'Rename the worker to Delivery Service', 'Split the API into two services']) {
      assert.equal(refinementTouchesDesign(q), true, q);
    }
  });

  test('a rewording is not', () => {
    for (const q of ['Make it shorter', 'Rephrase that', 'More casual', 'Expand on this', 'Add more detail', 'Remove the filler words', 'Make it sound more confident', 'Drop the jargon', 'Add an example']) {
      assert.equal(refinementTouchesDesign(q), false, q);
    }
  });
});

describe('a percentage in a rewording request', () => {
  test('"50% shorter" is about the words; "at 8%" is about the chart', () => {
    assert.equal(refinementTouchesDesign('Make it 50% shorter'), false);
    assert.equal(refinementTouchesDesign('Cut it by 30% of the length'), false);
    assert.equal(refinementTouchesDesign('Redo it at 8%'), true);
    assert.equal(refinementTouchesDesign('Use Kafka instead'), true);
  });
});

// Second review (2026-10-02): the first widening took rewording requests for design changes.
describe('a request to change WORDS leaves the diagram protected', () => {
  test('swapping words, cutting length, editing a sentence', () => {
    for (const q of ['Use simpler words instead.', 'Use bullet points instead.', "Replace 'utilize' with 'use'.", 'Cut it by 30%', 'Remove the last sentence about the database.', 'at any rate, shorten it', 'Drop the jargon', 'Add an example']) {
      assert.equal(refinementTouchesDesign(q), false, q);
    }
  });

  test('swapping a part, a technology or a named product is a design change', () => {
    for (const q of ['Use Kafka instead', 'use kafka instead', 'Replace Stripe with Adyen', 'Replace the queue with a stream', 'Swap the broker for Kafka', 'Change the growth rate to 3%']) {
      assert.equal(refinementTouchesDesign(q), true, q);
    }
  });

  test('a dropped diagram goes back after the lead on CRLF text too', () => {
    const D = 'flowchart LR\n    a["A"] --> b["B"]';
    const previous = `Lead.\r\n\r\n\`\`\`mermaid\r\n${D.replace(/\n/g, '\r\n')}\r\n\`\`\`\r\n\r\nTail.`;
    const kept = preserveDiagramsInRefinement(previous, 'Short lead.\r\n\r\nShort tail.');
    assert.equal(kept.restored, 1);
    assert.ok(kept.text.indexOf('```mermaid') < kept.text.indexOf('Short tail.'), kept.text);
  });
});
