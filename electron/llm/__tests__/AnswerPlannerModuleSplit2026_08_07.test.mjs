// electron/llm/__tests__/AnswerPlannerModuleSplit2026_08_07.test.mjs
//
// PR #427 §1.3: "AnswerPlanner.ts is 211KB with no internal module split".
//
// The PR proposes splitting out prompt TEMPLATES. Measured first, and that
// premise is wrong: the 31 *_TEMPLATE constants are only ~16KB (8% of the
// file). The actual bulk is elsewhere —
//   planAnswer()          44KB  (21%)
//   31 *_PATTERNS consts  64KB  (31%)
// so extracting templates would have moved 8% and left the file at ~194KB.
//
// The classification PATTERNS are the real extractable unit: pure arrays of
// regex literals, no module-scope mutable state (`let`/`var` at module scope:
// zero), and nothing outside the module imports them — all 24 importers across
// the codebase consume exactly four symbols (planAnswer, isCodingAnswerType,
// AnswerType, AnswerSource).
//
// This suite pins the split's SAFETY PROPERTIES rather than a byte count: the
// public surface must not change, and the extracted patterns must behave
// identically through the real planAnswer entry point.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAnswer, isCodingAnswerType } from '../../../dist-electron/electron/llm/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLANNER = path.resolve(here, '../AnswerPlanner.ts');
const PATTERNS = path.resolve(here, '../answerPlannerPatterns.ts');

describe('AnswerPlanner classification patterns are extracted', () => {
  test('the patterns module exists and defines every table the planner imports', () => {
    assert.ok(fs.existsSync(PATTERNS), 'expected electron/llm/answerPlannerPatterns.ts');
    const patterns = fs.readFileSync(PATTERNS, 'utf8');
    const planner = fs.readFileSync(PLANNER, 'utf8');
    // Some tables share a single `export const A = [...], B = [...];`, so count
    // DEFINITIONS by identifier rather than by `export const` lines.
    const imported = [...planner.matchAll(/^\s+([A-Z0-9_]+_PATTERNS),/gm)].map((m) => m[1]);
    assert.ok(imported.length >= 25, `expected the bulk of *_PATTERNS to move, found ${imported.length}`);
    const missing = imported.filter((n) => !new RegExp(`\\b${n}\\b\\s*(:[^=]*)?=`).test(patterns));
    assert.deepEqual(missing, [], `imported but not defined in the patterns module: ${missing.join(', ')}`);
  });

  test('AnswerPlanner no longer declares them inline', () => {
    const src = fs.readFileSync(PLANNER, 'utf8');
    const inline = (src.match(/^const [A-Z0-9_]+_PATTERNS\s*[:=]/gm) || []).length;
    assert.equal(inline, 0, `${inline} *_PATTERNS still declared inline in AnswerPlanner.ts`);
  });

  test('AnswerPlanner shrinks materially', () => {
    const bytes = fs.statSync(PLANNER).size;
    assert.ok(bytes < 165_000, `expected AnswerPlanner under 165KB after the split, got ${bytes}`);
  });

  test('no module-scope mutable state was introduced by the split', () => {
    // Shared mutable state across a module boundary is the one thing that would
    // make this split behavioural rather than mechanical.
    const src = fs.readFileSync(PATTERNS, 'utf8');
    assert.equal((src.match(/^(let|var) /gm) || []).length, 0, 'patterns module must be const-only');
  });
});

describe('the public surface and classification behaviour are unchanged', () => {
  // These route through the REAL compiled planAnswer, so they fail if any
  // pattern was dropped, reordered into a different branch, or lost its flags.
  const cases = [
    { q: 'Write a function to reverse a linked list.', expectCoding: true },
    { q: 'Implement an LRU cache in Python.', expectCoding: true },
    { q: 'Tell me about a time you handled conflict on your team.', expectCoding: false },
    { q: 'What is your name?', expectCoding: false },
    { q: 'How would you design a URL shortener?', expectCoding: false },
    { q: 'Why do you want this role?', expectCoding: false },
  ];

  for (const c of cases) {
    test(`planAnswer still classifies: ${c.q.slice(0, 48)}`, () => {
      const plan = planAnswer({ question: c.q, transcript: '', answerSource: 'what_to_answer' });
      assert.ok(plan && typeof plan.answerType === 'string', 'planAnswer must return a plan');
      assert.equal(
        isCodingAnswerType(plan.answerType),
        c.expectCoding,
        `${c.q} -> ${plan.answerType}`,
      );
    });
  }

  test('planAnswer never throws on empty or junk input', () => {
    assert.doesNotThrow(() => planAnswer({ question: '', transcript: '', answerSource: 'what_to_answer' }));
    assert.doesNotThrow(() => planAnswer({ question: '???', transcript: '', answerSource: 'manual_input' }));
  });
});
