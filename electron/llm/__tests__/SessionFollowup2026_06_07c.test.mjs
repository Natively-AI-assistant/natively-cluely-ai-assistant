// electron/llm/__tests__/SessionFollowup2026_06_07c.test.mjs
//
// Release 2026-06-07c — long-range follow-up resolution via SessionMemory +
// FollowUpResolver. Proves the Phase 4 scenario classes (A–G) end to end at the
// resolver layer (deterministic; no LLM).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { SessionMemory, resolveSessionFollowup } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);
const MIN = 60;

describe('C. One-hour-later follow-ups resolve the remembered entity', () => {
  test('C1: 60-min later "hardest part of that project?" → Natively', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    const r = resolveSessionFollowup({ latestQuestion: 'what was the hardest part of that project?', previousQuestion: 'filler', now: 62 * MIN, mode: 'technical-interview', surface: 'what_to_answer', memory: m });
    assert.equal(r.recalledEntity, 'Natively');
    assert.equal(r.resolvedAnswerType, 'project_followup_answer');
    assert.match(r.resolvedQuestion, /Natively/);
    assert.ok((r.recalledAgeSeconds || 0) >= 60 * MIN);
  });
  test('C2: 65-min later "how strong are you in that?" → SQL', () => {
    const m = new SessionMemory();
    m.note('skill', 'SQL', 2 * MIN, 'technical-interview');
    const r = resolveSessionFollowup({ latestQuestion: 'how strong are you in that?', now: 65 * MIN, mode: 'technical-interview', surface: 'what_to_answer', memory: m, expectedKind: 'skill' });
    assert.equal(r.recalledEntity, 'SQL');
    assert.equal(r.resolvedAnswerType, 'skill_experience_answer');
  });
  test('C3: 70-min later sales "what were they worried about?" → Acme', () => {
    const m = new SessionMemory();
    m.note('company', 'Acme', 3 * MIN, 'sales');
    const r = resolveSessionFollowup({ latestQuestion: 'what were they worried about?', now: 70 * MIN, mode: 'sales', surface: 'sales', memory: m, expectedKind: 'company' });
    assert.equal(r.recalledEntity, 'Acme');
  });
  test('C5: meeting action item owner recalled 60 min later', () => {
    const m = new SessionMemory();
    m.note('decision', 'ship by Friday — owner Mark', 4 * MIN, 'team-meet');
    const r = resolveSessionFollowup({ latestQuestion: 'who owns that?', now: 63 * MIN, mode: 'team-meet', surface: 'meeting', memory: m, expectedKind: 'decision' });
    assert.equal(r.recalledEntity, 'ship by Friday — owner Mark');
  });
});

describe('B. Delayed follow-ups after filler still resolve "that/there/it"', () => {
  for (const phrase of ['what was the tech stack there?', 'tell me about that project', 'how did you build it?']) {
    test(`"${phrase}" after 8 filler turns → Natively`, () => {
      const m = new SessionMemory();
      m.note('project', 'Natively', 1 * MIN, 'technical-interview');
      const r = resolveSessionFollowup({ latestQuestion: phrase, previousQuestion: 'small talk filler', now: 12 * MIN, mode: 'technical-interview', surface: 'what_to_answer', memory: m, expectedKind: 'project' });
      assert.equal(r.recalledEntity, 'Natively', `→ via ${r.resolvedVia}`);
    });
  }
});

describe('D. Cross-mode boundaries — no leak unless explicitly asked', () => {
  test('D1: project NOT recalled in coding mode', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    const r = resolveSessionFollowup({ latestQuestion: 'solve two sum and tell me about that', now: 5 * MIN, mode: 'coding', surface: 'coding', memory: m, expectedKind: 'project' });
    assert.equal(r.recalledEntity, undefined, 'coding must not pull the interview project');
  });
  test('D1b: EXPLICIT cross-mode "have you used that in your project?" recalls it', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'technical-interview');
    const r = resolveSessionFollowup({ latestQuestion: 'have you used that project here?', now: 5 * MIN, mode: 'coding', surface: 'coding', memory: m, explicitCrossMode: true, expectedKind: 'project' });
    assert.equal(r.recalledEntity, 'Natively');
  });
  test('D4: comp NOT recalled in coding (no salary leak)', () => {
    const m = new SessionMemory();
    m.note('comp', '12 LPA', 1 * MIN, 'negotiation');
    const r = resolveSessionFollowup({ latestQuestion: 'what about that?', now: 5 * MIN, mode: 'coding', surface: 'coding', memory: m, expectedKind: 'comp' });
    assert.equal(r.recalledEntity, undefined);
  });
});

describe('E. Corrections override earlier memory', () => {
  test('E1: "use TalentScope" correction → that project, not Natively', () => {
    const m = new SessionMemory();
    m.note('project', 'Natively', 1 * MIN, 'looking-for-work');
    m.note('project', 'TalentScope', 10 * MIN, 'looking-for-work', { corrects: true });
    const r = resolveSessionFollowup({ latestQuestion: 'why is that project your best?', now: 20 * MIN, mode: 'looking-for-work', surface: 'manual', memory: m, expectedKind: 'project' });
    assert.equal(r.recalledEntity, 'TalentScope');
  });
  test('E3: sales customer correction Acme → Globex', () => {
    const m = new SessionMemory();
    m.note('company', 'Acme', 1 * MIN, 'sales');
    m.note('company', 'Globex', 5 * MIN, 'sales', { corrects: true });
    const r = resolveSessionFollowup({ latestQuestion: 'what did they ask?', now: 10 * MIN, mode: 'sales', surface: 'sales', memory: m, expectedKind: 'company' });
    assert.equal(r.recalledEntity, 'Globex');
  });
});

describe('F. Bare follow-up with NO memory → clarification (no guess, no leak)', () => {
  for (const q of ['why?', 'and?', 'continue', 'what about it?']) {
    test(`"${q}" with empty memory → clarification`, () => {
      const r = resolveSessionFollowup({ latestQuestion: q, now: 5 * MIN, mode: 'technical-interview', surface: 'what_to_answer', memory: new SessionMemory() });
      assert.equal(r.isClarification, true, `→ ${r.resolvedVia}`);
      assert.equal(r.resolvedVia, 'clarification');
    });
  }
});
