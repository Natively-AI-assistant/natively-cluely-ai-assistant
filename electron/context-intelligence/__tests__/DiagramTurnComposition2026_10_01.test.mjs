// Context Intelligence V3 — a system-design diagram turn in the composed prompt.
//
// The diagram CONTRACT rides the persona (the system prompt's first block). The
// composer's own rules come after it and would win on recency: "aim for two to
// four sentences" and the numbered-list line for "steps"/"three ways" asks. So
// a diagram turn adds one section to the USER message — a note saying the
// contract is in force and that a sentence limit governs the prose, not the
// Mermaid block — plus, on a follow-up, the design already on the table.
//
// Pinned here:
//   - no diagram turn ⇒ the composition is byte-identical to before;
//   - the section sits after the app's length default and before the user's
//     instructions (the user still has the last word);
//   - the numbered-list line stands down on a diagram turn;
//   - the design block is carried verbatim (Mermaid arrows unescaped) and
//     never enters the system prompt.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { composePrompt } = await import(pathToFileURL(path.join(base, 'generation/prompt-composer.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

const decision = (q, modeId = 'general') =>
  decide({ requestId: 'r1', requestSequence: 1, surface: 'manual-chat', modeId, scope: { userId: 'u1' }, sessionId: 's1', manualQuestion: q });
const policyFor = (id) => MODE_POLICIES[id] ?? MODE_POLICIES.general ?? Object.values(MODE_POLICIES)[0];
const compose = (q, extra = {}, modeId = 'general') => composePrompt({ decision: decision(q, modeId), policy: policyFor(modeId), evidence: [], ...extra });

const NOTE = 'The diagram contract in the system prompt applies to this turn. Any sentence or word limit, here or in the rules, governs the prose around the Mermaid block and never the block itself.';
const DESIGN_BLOCK = '<active_design view="architecture" version="1">\nThis is the design currently on the table.\n```mermaid\nflowchart LR\n    api["API"] -->|"enqueue"| queue["Queue"]\n```\n</active_design>';
const APP_LENGTH = 'LENGTH: aim for about 22s spoken — roughly 40 to 60 words. Hard ceiling: never go past 75 words.';

describe('a diagram turn in the V3 composition', () => {
  test('no diagram turn ⇒ byte-identical composition and no new section', () => {
    const q = 'Design a notification service with retries.';
    const before = compose(q, { defaultLengthDirective: APP_LENGTH, realtimeInstruction: 'Be direct.' });
    const same = compose(q, { defaultLengthDirective: APP_LENGTH, realtimeInstruction: 'Be direct.', diagramTurn: undefined });
    assert.equal(same.system, before.system);
    assert.equal(same.user, before.user);
    assert.ok(!before.sections.includes('diagram_turn'));
  });

  test('the note sits after the length default and before the user instructions', () => {
    const c = compose('Design a notification service with retries.', {
      defaultLengthDirective: APP_LENGTH,
      realtimeInstruction: 'Be direct.',
      diagramTurn: { note: NOTE },
    });
    assert.ok(c.sections.includes('diagram_turn'));
    assert.deepEqual(c.sections.slice(-3), ['default_length', 'diagram_turn', 'user_instructions']);
    assert.ok(c.user.indexOf('40 to 60 words') < c.user.indexOf(NOTE));
    assert.ok(c.user.indexOf(NOTE) < c.user.indexOf('<user_instructions'));
    assert.match(c.user, /<presentation_instruction note="Diagram for this turn\. Affects layout ONLY\.">/);
    assert.ok(c.user.trimEnd().endsWith('</user_instructions>'), 'the user keeps the last word');
  });

  test('the note is app text and never enters the system prompt', () => {
    const c = compose('Design a notification service.', { diagramTurn: { note: NOTE, activeDesignBlock: DESIGN_BLOCK } });
    assert.ok(!c.system.includes(NOTE));
    assert.ok(!c.system.includes('<active_design'));
  });

  test('the design on the table is carried verbatim, arrows intact', () => {
    const c = compose('Add a dead-letter queue.', { diagramTurn: { note: NOTE, activeDesignBlock: DESIGN_BLOCK } });
    assert.ok(c.user.includes(DESIGN_BLOCK));
    assert.ok(c.user.includes('api["API"] -->|"enqueue"| queue["Queue"]'));
    assert.ok(!c.user.includes('--&gt;'));
    assert.ok(c.user.indexOf(NOTE) < c.user.indexOf('<active_design'));
  });

  test('a design block with no note still rides (a coding turn grounded in the design)', () => {
    const c = compose('Now write the worker in TypeScript.', { diagramTurn: { activeDesignBlock: DESIGN_BLOCK } });
    assert.ok(c.sections.includes('diagram_turn'));
    assert.ok(c.user.includes(DESIGN_BLOCK));
    assert.doesNotMatch(c.user, /Diagram for this turn/);
  });

  test('an empty diagram turn renders nothing', () => {
    const c = compose('Design a notification service.', { diagramTurn: {} });
    assert.ok(!c.sections.includes('diagram_turn'));
  });

  test('the numbered-list line stands down on a diagram turn', () => {
    const q = 'What are the three steps to design a scalable notification system?';
    const plain = compose(q);
    const withDiagram = compose(q, { diagramTurn: { note: NOTE } });
    // Only meaningful if the list line fires for this question at all.
    if (plain.sections.includes('list_form')) {
      assert.ok(!withDiagram.sections.includes('list_form'), 'a design answer takes its shape from the diagram contract');
    }
    assert.ok(withDiagram.sections.includes('diagram_turn'));
  });
});
