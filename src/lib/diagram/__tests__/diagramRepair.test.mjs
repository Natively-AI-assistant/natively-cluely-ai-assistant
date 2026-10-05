import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiagramRepairRequest,
  extractRepairedDiagram,
  createRepairBudget,
  isRepairableStage,
  DIAGRAM_REPAIR_LIMITS,
  DIAGRAM_REPAIR_SYSTEM_PROMPT,
} from '../diagramRepair.mjs';

const BROKEN = 'flowchart LR\n    a["Client" --> b[API';
const FIXED = 'flowchart LR\n    a["Client"] --> b["API"]';

describe('buildDiagramRepairRequest', () => {
  test('sends only the diagram and a bounded diagnostic', () => {
    const req = buildDiagramRepairRequest({ source: BROKEN, diagnostic: 'Parse error on line 2: ' + 'x'.repeat(5000), stage: 'parse' });
    assert.ok(req);
    assert.equal(req.system, DIAGRAM_REPAIR_SYSTEM_PROMPT);
    assert.ok(req.user.includes(BROKEN));
    assert.ok(req.user.length < BROKEN.length + DIAGRAM_REPAIR_LIMITS.maxDiagnosticChars + 200, 'diagnostic is capped');
    assert.ok(!/transcript|meeting|conversation/i.test(req.user), 'nothing about the meeting rides along');
  });

  test('refuses policy / load / timeout failures: a retry cannot fix them', () => {
    for (const stage of ['policy', 'load', 'timeout', 'output']) {
      assert.equal(buildDiagramRepairRequest({ source: BROKEN, stage }), null, stage);
      assert.equal(isRepairableStage(stage), false);
    }
    assert.equal(isRepairableStage('parse'), true);
    assert.equal(isRepairableStage('render'), true);
  });

  test('refuses an empty or oversized diagram', () => {
    assert.equal(buildDiagramRepairRequest({ source: '   ' }), null);
    assert.equal(buildDiagramRepairRequest({ source: 'flowchart LR\n' + 'a --> b\n'.repeat(2000) }), null);
  });

  test('a diagram containing backticks cannot break out of its wrapper', () => {
    const req = buildDiagramRepairRequest({ source: 'flowchart LR\n    a["```"] --> b' });
    assert.ok(req.user.includes('~~~~mermaid\nflowchart LR\n    a["```"] --> b\n~~~~'));
  });
});

describe('the repair prompt', () => {
  // Measured live (DeepSeek, 2026-10-01): Mermaid reports one error at a time,
  // and a model shown only that message fixed that line and left a second
  // broken line (`api ->> cache`) in place. With this sentence it fixed both, 3/3.
  test('tells the model the message names only the first problem', () => {
    assert.match(DIAGRAM_REPAIR_SYSTEM_PROMPT, /names only the FIRST problem/);
    assert.match(DIAGRAM_REPAIR_SYSTEM_PROMPT, /Check every line and fix all of them/);
    assert.match(DIAGRAM_REPAIR_SYSTEM_PROMPT, /never ->, ->> or =>/);
  });
});

describe('extractRepairedDiagram', () => {
  test('bare Mermaid is accepted', () => {
    assert.deepEqual(extractRepairedDiagram(FIXED, BROKEN), { ok: true, source: FIXED });
  });

  test('a fenced reply is unwrapped, with or without the tag', () => {
    assert.deepEqual(extractRepairedDiagram('```mermaid\n' + FIXED + '\n```', BROKEN), { ok: true, source: FIXED });
    assert.deepEqual(extractRepairedDiagram('Here you go:\n```\n' + FIXED + '\n```\nHope that helps.', BROKEN), { ok: true, source: FIXED });
  });

  test('prose, an empty reply and an unchanged diagram are refused', () => {
    assert.deepEqual(extractRepairedDiagram('I could not fix this diagram, sorry.', BROKEN), { ok: false, reason: 'policy' });
    assert.deepEqual(extractRepairedDiagram('   ', BROKEN), { ok: false, reason: 'empty' });
    assert.deepEqual(extractRepairedDiagram(BROKEN, BROKEN), { ok: false, reason: 'unchanged' });
  });

  test('a "repair" that smuggles in active content or another diagram family is refused', () => {
    assert.equal(extractRepairedDiagram('flowchart LR\n    a["<img src=x onerror=alert(1)>"] --> b', BROKEN).ok, false);
    assert.equal(extractRepairedDiagram('pie title Pets\n    "Dogs" : 3', BROKEN).ok, false);
  });
});

describe('createRepairBudget', () => {
  test('one automatic attempt per diagram source', () => {
    const budget = createRepairBudget();
    assert.deepEqual(budget.take(BROKEN), { allowed: true });
    assert.deepEqual(budget.take(BROKEN), { allowed: false, reason: 'already_tried' });
    assert.deepEqual(budget.take(BROKEN + '\n'), { allowed: false, reason: 'already_tried' }, 'whitespace does not make it a new diagram');
    assert.deepEqual(budget.take('flowchart LR\n    other[ --> x'), { allowed: true });
  });

  test('a manual retry is always allowed and spends nothing', () => {
    const budget = createRepairBudget();
    budget.take(BROKEN);
    assert.deepEqual(budget.take(BROKEN, { manual: true }), { allowed: true });
    assert.equal(budget.used(), 1);
  });

  test('automatic repairs are capped per window and recover after it', () => {
    let t = 0;
    const budget = createRepairBudget({ now: () => t });
    for (let i = 0; i < DIAGRAM_REPAIR_LIMITS.automaticPerWindow; i += 1) {
      assert.equal(budget.take(`flowchart LR\n    a${i}[ --> b`).allowed, true);
    }
    assert.deepEqual(budget.take('flowchart LR\n    z[ --> b'), { allowed: false, reason: 'rate_limited' });
    t += DIAGRAM_REPAIR_LIMITS.windowMs + 1;
    assert.equal(budget.take('flowchart LR\n    z[ --> b').allowed, true);
  });
});
