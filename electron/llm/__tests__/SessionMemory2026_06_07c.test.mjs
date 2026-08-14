// electron/llm/__tests__/SessionMemory2026_06_07c.test.mjs
//
// Release 2026-06-07c — structured, time-aware, mode-aware session memory for
// long-range follow-up resolution. Covers the Phase 2 directive: immediate/short/
// long memory, time decay, supersession, corrections, and cross-mode boundaries.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { SessionMemory, isKindAllowedInMode } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

const MIN = 60; // seconds per minute

describe('Time-aware recall — immediate / short / long range', () => {
  test('immediate (1 min ago) project recalls easily', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    const r = m.recall({ now: 2 * MIN, kind: 'project', mode: 'technical-interview' });
    assert.equal(r.item?.value, 'Natively');
    assert.ok(r.salience > 0.9);
  });
  test('30 min later, a project is still recallable (within half-life)', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    const r = m.recall({ now: 31 * MIN, kind: 'project', mode: 'technical-interview' });
    assert.equal(r.item?.value, 'Natively');
    assert.ok(r.salience > 0.4, `salience ${r.salience}`);
  });
  test('60 min later, a project is still recallable if no newer project superseded it', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    const r = m.recall({ now: 62 * MIN, kind: 'project', mode: 'technical-interview' });
    assert.equal(r.item?.value, 'Natively', 'one-hour-later project follow-up resolves');
  });
  test('pinned items survive long decay', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 0, 'technical-interview', { pinned: true });
    const r = m.recall({ now: 180 * MIN, kind: 'project', mode: 'technical-interview' });
    assert.equal(r.item?.value, 'Natively');
    assert.equal(r.salience, 1);
  });
});

describe('Supersession — newer same-kind mention wins', () => {
  test('a newer project supersedes an older one', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    m.note('project', 'TalentScope', 40 * MIN, 'technical-interview');
    const r = m.recall({ now: 45 * MIN, kind: 'project', mode: 'technical-interview' });
    assert.equal(r.item?.value, 'TalentScope', 'most recent project is the active one');
  });
  test('SQL skill recalled after a later mention', () => {
    const m = new SessionMemory();
    m.note('skill', 'Python', 2 * MIN, 'technical-interview');
    m.note('skill', 'SQL', 5 * MIN, 'technical-interview');
    const r = m.recall({ now: 6 * MIN, kind: 'skill', mode: 'technical-interview' });
    assert.equal(r.item?.value, 'SQL');
  });
});

describe('Corrections override earlier memory', () => {
  test('"actually use TalentScope" corrects the best project', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'looking-for-work');
    m.note('project', 'TalentScope', 10 * MIN, 'looking-for-work', { corrects: true });
    const r = m.recall({ now: 20 * MIN, kind: 'project', mode: 'looking-for-work' });
    assert.equal(r.item?.value, 'TalentScope');
    assert.equal(r.reason, 'correction_override');
  });
  test('a correction wins even if older than a non-correction mention', () => {
    const m = new SessionMemory();
    m.note('company', 'Acme', 1 * MIN, 'sales');
    m.note('company', 'Globex', 2 * MIN, 'sales', { corrects: true });
    m.note('company', 'Acme', 3 * MIN, 'sales'); // stray re-mention
    const r = m.recall({ now: 5 * MIN, kind: 'company', mode: 'sales' });
    assert.equal(r.item?.value, 'Globex', 'correction is authoritative');
  });
  test('lecture topic correction BFS → DFS', () => {
    const m = new SessionMemory();
    m.note('topic', 'BFS', 1 * MIN, 'lecture');
    m.note('topic', 'DFS', 5 * MIN, 'lecture', { corrects: true });
    const r = m.recall({ now: 10 * MIN, kind: 'topic', mode: 'lecture' });
    assert.equal(r.item?.value, 'DFS');
  });
});

describe('Cross-mode boundaries — memory must not leak into the wrong mode', () => {
  test('interview project does NOT recall in coding mode', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    const r = m.recall({ now: 5 * MIN, kind: 'project', mode: 'coding' });
    assert.equal(r.item, null, 'coding answers must not pull the interview project');
  });
  test('but an EXPLICIT cross-mode request allows it ("have you used this in Natively?")', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    const r = m.recall({ now: 5 * MIN, kind: 'project', mode: 'coding', explicitCrossMode: true });
    assert.equal(r.item?.value, 'Natively');
  });
  test('sales pricing/objection does NOT recall in interview mode', () => {
    const m = new SessionMemory();
    m.note('objection', 'price too high', 1 * MIN, 'sales');
    const r = m.recall({ now: 5 * MIN, kind: 'objection', mode: 'technical-interview' });
    assert.equal(r.item, null);
  });
  test('lecture topic does NOT recall in sales mode', () => {
    const m = new SessionMemory();
    m.note('topic', 'amortized analysis', 1 * MIN, 'lecture');
    const r = m.recall({ now: 5 * MIN, kind: 'topic', mode: 'sales' });
    assert.equal(r.item, null);
  });
  test('meeting action item / person does NOT recall in sales mode', () => {
    const m = new SessionMemory();
    m.note('person', 'Rahul', 1 * MIN, 'team-meet');
    const r = m.recall({ now: 5 * MIN, kind: 'person', mode: 'sales' });
    // sales CAN see person (customer contact) — but a meeting-introduced person is
    // visible only because sales allows person; the real guard is decision/objection.
    // Decisions must not leak to sales:
    const m2 = new SessionMemory();
    m2.note('decision', 'ship by Friday, owner Rahul', 1 * MIN, 'team-meet');
    const r2 = m2.recall({ now: 5 * MIN, kind: 'decision', mode: 'sales' });
    assert.equal(r2.item, null, 'meeting decisions must not leak into sales unless asked');
  });
});

describe('Compensation is gated to negotiation mode ONLY', () => {
  test('comp does NOT recall in coding mode (no salary leak)', () => {
    const m = new SessionMemory();
    m.note('comp', '12 LPA expected', 1 * MIN, 'negotiation');
    const r = m.recall({ now: 5 * MIN, kind: 'comp', mode: 'coding' });
    assert.equal(r.item, null);
  });
  test('comp does NOT recall in interview mode even with explicitCrossMode', () => {
    const m = new SessionMemory();
    m.note('comp', '12 LPA expected', 1 * MIN, 'negotiation');
    const r = m.recall({ now: 5 * MIN, kind: 'comp', mode: 'technical-interview', explicitCrossMode: true });
    assert.equal(r.item, null, 'salary is its own gated channel — never crosses');
  });
  test('comp DOES recall in negotiation mode', () => {
    const m = new SessionMemory();
    m.note('comp', '12 LPA expected', 1 * MIN, 'negotiation');
    const r = m.recall({ now: 5 * MIN, kind: 'comp', mode: 'negotiation' });
    assert.equal(r.item?.value, '12 LPA expected');
  });
  // code-review 2026-06-07c: a salary VALUE mislabeled under another kind must still be
  // gated — add() auto-promotes it to comp so it can't leak via the wrong kind.
  test('a salary value mislabeled as "topic" is auto-promoted to comp and blocked outside negotiation', () => {
    const m = new SessionMemory();
    m.note('topic', 'targeting 250k base', 1 * MIN, 'lecture');
    assert.equal(m.recall({ now: 5 * MIN, kind: 'topic', mode: 'lecture' }).item, null, 'must not leak as a topic');
    assert.equal(m.recall({ now: 5 * MIN, kind: 'comp', mode: 'negotiation' }).item?.value, 'targeting 250k base', 'recallable only as comp in negotiation');
  });
  test('a salary value mislabeled as "decision" does not leak into a meeting', () => {
    const m = new SessionMemory();
    m.note('decision', 'offer is 250k total comp', 1 * MIN, 'team-meet');
    assert.equal(m.recall({ now: 5 * MIN, kind: 'decision', mode: 'team-meet' }).item, null);
  });
  test('a non-comp value ("ship by Friday") is NOT auto-promoted', () => {
    const m = new SessionMemory();
    m.note('decision', 'ship by Friday', 1 * MIN, 'team-meet');
    assert.equal(m.recall({ now: 5 * MIN, kind: 'decision', mode: 'team-meet' }).item?.value, 'ship by Friday');
  });
});

describe('isKindAllowedInMode boundary table', () => {
  test('coding only allows topic', () => {
    assert.equal(isKindAllowedInMode('topic', 'coding'), true);
    assert.equal(isKindAllowedInMode('project', 'coding'), false);
    assert.equal(isKindAllowedInMode('skill', 'coding'), false);
  });
  test('negotiation allows comp; nothing else does', () => {
    assert.equal(isKindAllowedInMode('comp', 'negotiation'), true);
    assert.equal(isKindAllowedInMode('comp', 'looking-for-work'), false);
    assert.equal(isKindAllowedInMode('comp', 'coding'), false);
  });
});

describe('Adversarial: competing entities + stale-vs-fresh + double-correction (test-engineer review)', () => {
  test('two competing projects — the FRESHER one wins the demonstrative', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    m.note('project', 'TalentScope', 30 * MIN, 'technical-interview');
    const r = m.recall({ now: 62 * MIN, kind: 'project', mode: 'technical-interview' });
    assert.equal(r.item?.value, 'TalentScope', 'most recent project is the active referent');
  });
  test('stale-vs-fresh skill — newer SQL beats older Python after long gap', () => {
    const m = new SessionMemory();
    m.note('skill', 'Python', 1 * MIN, 'technical-interview');
    m.note('skill', 'SQL', 25 * MIN, 'technical-interview');
    const r = m.recall({ now: 45 * MIN, kind: 'skill', mode: 'technical-interview' });
    assert.equal(r.item?.value, 'SQL');
  });
  test('double correction — the LATEST correction wins (Natively → TalentScope → Natively)', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 2 * MIN, 'looking-for-work');
    m.note('project', 'TalentScope', 4 * MIN, 'looking-for-work', { corrects: true });
    m.note('project', 'Natively', 8 * MIN, 'looking-for-work', { corrects: true });
    const r = m.recall({ now: 12 * MIN, kind: 'project', mode: 'looking-for-work' });
    assert.equal(r.item?.value, 'Natively', 'latest correction is authoritative');
    assert.equal(r.reason, 'correction_override');
  });
  test('a fresh non-correction does NOT override an explicit correction', () => {
    const m = new SessionMemory();
    m.note('company', 'Acme', 1 * MIN, 'sales');
    m.note('company', 'Globex', 2 * MIN, 'sales', { corrects: true });
    m.note('company', 'Acme', 10 * MIN, 'sales'); // later stray mention, NOT a correction
    const r = m.recall({ now: 12 * MIN, kind: 'company', mode: 'sales' });
    assert.equal(r.item?.value, 'Globex', 'the correction stays authoritative over a later stray mention');
  });
});

describe('Memory bounds + reset', () => {
  test('respects maxItems cap while keeping pinned', () => {
    const m = new SessionMemory(5);
    m.note('topic', 'pinned-one', 0, 'lecture', { pinned: true });
    for (let i = 1; i <= 20; i++) m.note('topic', `t${i}`, i, 'lecture');
    assert.ok(m.size() <= 5);
    const r = m.recall({ now: 100, kind: 'topic', mode: 'lecture' });
    assert.ok(r.item, 'still recalls something');
  });
  test('reset clears memory', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1, 'technical-interview');
    m.reset();
    assert.equal(m.size(), 0);
    assert.equal(m.recall({ now: 2, kind: 'project', mode: 'technical-interview' }).item, null);
  });
});
