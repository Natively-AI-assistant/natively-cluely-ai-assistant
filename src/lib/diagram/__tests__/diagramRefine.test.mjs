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
