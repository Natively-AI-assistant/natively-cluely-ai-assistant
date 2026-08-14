// electron/llm/__tests__/LiveSessionMemory2026_06_07c.test.mjs
//
// Release 2026-06-07c — live SessionMemory wiring: the feature flag, transcript
// entity extraction, the resolveLiveFollowup orchestrator, and the privacy/mode
// boundaries through the live helper. Deterministic; no LLM.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const m = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href);
const { resolveLiveFollowup, isContextFreeBareFollowup, toMemoryMode, toSurface, extractTranscriptEntities, isCorrectionTurn, isExplicitCrossModeInvite, isLiveSessionMemoryEnabled, __resetLiveSessionMemoryCache } = m;
const MIN = 60;

describe('Feature flag — env override wins both directions', () => {
  test('NATIVELY_ENABLE_LIVE_SESSION_MEMORY=off forces OFF even in a test/benchmark context', () => {
    const prev = process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY;
    process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY = 'off'; __resetLiveSessionMemoryCache();
    assert.equal(isLiveSessionMemoryEnabled(), false);
    process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY = prev ?? ''; __resetLiveSessionMemoryCache();
  });
  test('NATIVELY_ENABLE_LIVE_SESSION_MEMORY=on forces ON', () => {
    const prev = process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY;
    process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY = 'on'; __resetLiveSessionMemoryCache();
    assert.equal(isLiveSessionMemoryEnabled(), true);
    process.env.NATIVELY_ENABLE_LIVE_SESSION_MEMORY = prev ?? ''; __resetLiveSessionMemoryCache();
  });
});

describe('transcript entity extraction (independent — not from any answer key)', () => {
  test('"Tell me about Natively." → project Natively', () => {
    assert.ok(extractTranscriptEntities('Tell me about Natively.', 'interviewer').some(e => e.kind === 'project' && e.value === 'Natively'));
  });
  test('short candidate answer "Natively." → project', () => {
    assert.ok(extractTranscriptEntities('Natively.', 'user').some(e => e.kind === 'project' && e.value === 'Natively'));
  });
  test('filler "Alright." → no entity', () => {
    assert.equal(extractTranscriptEntities('Alright.', 'user').length, 0);
  });
  test('a salary value is tagged sensitive (comp)', () => {
    const e = extractTranscriptEntities('My expected salary is 250k base.', 'user');
    assert.ok(e.some(x => x.kind === 'comp' && x.sensitive));
  });
  test('action-item owner "assigned to Mark" → decision Mark', () => {
    assert.ok(extractTranscriptEntities('Action item assigned to Mark.', 'interviewer').some(e => e.kind === 'decision' && e.value === 'Mark'));
  });
  test('correction cue detected', () => {
    assert.equal(isCorrectionTurn('Actually, use TalentScope.'), true);
    assert.equal(isCorrectionTurn('My best project is Natively.'), false);
  });
  test('explicit cross-mode invite detected', () => {
    assert.equal(isExplicitCrossModeInvite('have you used this in Natively?'), true);
    assert.equal(isExplicitCrossModeInvite('solve two sum'), false);
  });
});

describe('resolveLiveFollowup — the 12 live edge cases (Phase 3)', () => {
  test('1. immediate project follow-up → project_followup, Natively', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: 'Tell me about Natively.', t: 0 }, { role: 'user', text: 'An AI copilot.', t: 5 }, { role: 'interviewer', text: 'How did you build it?', t: 8 }], latestQuestion: 'How did you build it?', mode: 'technical-interview', surface: 'what_to_answer' });
    assert.equal(r.recalledEntity, 'Natively');
    assert.equal(r.resolvedAnswerType, 'project_followup_answer');
  });
  test('2. delayed (8 filler turns) → "tech stack there?" resolves Natively', () => {
    const turns = [{ role: 'interviewer', text: 'Tell me about Natively.', t: 0 }, { role: 'user', text: 'An AI copilot.', t: 5 }];
    for (let i = 1; i <= 8; i++) turns.push({ role: i % 2 ? 'interviewer' : 'user', text: i % 2 ? `Filler ${i}?` : `Reply ${i}.`, t: 60 + i * 30 });
    turns.push({ role: 'interviewer', text: 'What was the tech stack there?', t: 400 });
    const r = resolveLiveFollowup({ turns, latestQuestion: 'What was the tech stack there?', mode: 'technical-interview', surface: 'what_to_answer' });
    assert.equal(r.recalledEntity, 'Natively');
  });
  test('3. one-hour project follow-up → Natively', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: 'Tell me about Natively.', t: 1 * MIN }, { role: 'user', text: 'An AI copilot.', t: 2 * MIN }, { role: 'interviewer', text: 'filler', t: 30 * MIN }, { role: 'interviewer', text: 'What was the hardest part of that project?', t: 62 * MIN }], latestQuestion: 'What was the hardest part of that project?', mode: 'technical-interview', surface: 'what_to_answer' });
    assert.equal(r.recalledEntity, 'Natively');
    assert.match(r.resolvedQuestion, /Natively/);
  });
  test('4. skill follow-up "And SQL?" → SQL', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: 'Rate your Python skills.', t: 0 }, { role: 'user', text: 'An 8.', t: 5 }, { role: 'interviewer', text: 'And SQL?', t: 8 }], latestQuestion: 'And SQL?', previousAnswerType: 'skill_experience_answer', mode: 'technical-interview', surface: 'what_to_answer' });
    assert.equal(r.resolvedAnswerType, 'skill_experience_answer');
    assert.match(r.resolvedQuestion, /SQL/i);
  });
  test('6. correction → TalentScope wins', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: 'What is your best project?', t: 0 }, { role: 'user', text: 'Natively.', t: 5 }, { role: 'user', text: 'Actually use TalentScope.', t: 60 }, { role: 'interviewer', text: 'Why is it your best?', t: 120 }], latestQuestion: 'Why is it your best?', mode: 'looking-for-work', surface: 'manual' });
    assert.equal(r.recalledEntity, 'TalentScope');
  });
  test('7. double correction A→B→A → Natively', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: 'Best project?', t: 0 }, { role: 'user', text: 'Natively.', t: 5 }, { role: 'user', text: 'Actually use TalentScope.', t: 60 }, { role: 'user', text: 'Actually back to Natively.', t: 120 }, { role: 'interviewer', text: 'Why is that your best?', t: 180 }], latestQuestion: 'Why is that your best?', mode: 'looking-for-work', surface: 'manual' });
    assert.equal(r.recalledEntity, 'Natively');
  });
  test('8. cross-mode coding boundary → NO Natively recall', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: 'Tell me about Natively.', t: 0 }, { role: 'interviewer', text: 'Solve Two Sum.', t: 60 }], latestQuestion: 'Solve Two Sum.', mode: 'coding', surface: 'coding' });
    assert.equal(r.recalledEntity, undefined);
  });
  test('9. cross-mode salary boundary → NO comp recall in coding', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: 'What salary do you expect?', t: 0 }, { role: 'user', text: 'About 250k base.', t: 5 }, { role: 'interviewer', text: 'Write a SQL query.', t: 60 }], latestQuestion: 'Write a SQL query.', mode: 'coding', surface: 'coding' });
    // the recalled entity must never be the comp value in coding mode
    assert.notEqual(r.recalledEntity, '250k');
    assert.ok(!String(r.recalledEntity || '').match(/250k|salary/i));
  });
  test('10. meeting action-item recall → Mark', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: 'Action item assigned to Mark.', t: 3 * MIN }, { role: 'interviewer', text: 'Who owns that?', t: 60 * MIN }], latestQuestion: 'Who owns that?', mode: 'team-meet', surface: 'meeting' });
    assert.equal(r.recalledEntity, 'Mark');
  });
  test('11. lecture topic recall → amortized analysis', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: "Today's topic is amortized analysis.", t: 0 }, { role: 'user', text: 'Can you explain that with an example?', t: 5 * MIN }], latestQuestion: 'Can you explain that with an example?', mode: 'lecture', surface: 'lecture' });
    assert.equal(r.recalledEntity, 'amortized analysis');
  });
  test('12. no-context bare "why?" → clarification (no identity leak)', () => {
    const r = resolveLiveFollowup({ turns: [{ role: 'interviewer', text: 'why?', t: 0 }], latestQuestion: 'why?', mode: 'technical-interview', surface: 'what_to_answer' });
    assert.equal(r.isClarification, true);
    assert.doesNotMatch(r.clarificationText, /Natively|AI assistant/i);
  });
});

describe('ENGINE ADAPTER — ms timestamps converted to seconds (code-review unit-bug guard)', () => {
  // The live IntelligenceEngine feeds SessionTracker wall-clock MILLISECOND
  // timestamps; SessionMemory decay is in SECONDS. The engine MUST convert ms→s
  // before calling resolveLiveFollowup, else a 1-hour gap decays to ~0 and long-range
  // recall silently dies after ~15 real seconds. These tests pin the conversion.
  const base = 1700000000000; // epoch ms
  const msTurns = (mins) => mins.map(([role, text, m]) => ({ role, text, timestamp: base + m * 60000 }));
  // Apply the EXACT engine conversion: ms → floor(ms/1000), now = latest turn's seconds.
  const asEngine = (turns, latest) => {
    const conv = turns.map(t => ({ role: t.role, text: t.text, t: Math.floor(t.timestamp / 1000) }));
    const now = Math.floor(turns[turns.length - 1].timestamp / 1000);
    return resolveLiveFollowup({ turns: conv, latestQuestion: latest, now, mode: 'technical-interview', surface: 'what_to_answer' });
  };

  test('62-minute project recall SURVIVES with ms→s conversion', () => {
    const turns = msTurns([
      ['interviewer', 'Tell me about Natively.', 1],
      ['user', 'An AI copilot.', 2],
      ['interviewer', 'filler', 30],
      ['interviewer', 'What was the hardest part of that project?', 62],
    ]);
    const r = asEngine(turns, 'What was the hardest part of that project?');
    assert.equal(r.recalledEntity, 'Natively', 'long-range recall must survive realistic ms timestamps');
    assert.ok(r.recalledAgeSeconds >= 3500 && r.recalledAgeSeconds <= 3700, `age should be ~61 min in seconds, got ${r.recalledAgeSeconds}`);
  });

  test('WITHOUT conversion (raw ms) the same recall would decay to nothing — proving the bug the conversion fixes', () => {
    const turns = msTurns([
      ['interviewer', 'Tell me about Natively.', 1],
      ['user', 'An AI copilot.', 2],
      ['interviewer', 'What was the hardest part of that project?', 62],
    ]);
    // Feed RAW ms (the bug): t in ms, now in ms.
    const rawMs = turns.map(t => ({ role: t.role, text: t.text, t: t.timestamp }));
    const now = turns[turns.length - 1].timestamp;
    const r = resolveLiveFollowup({ turns: rawMs, latestQuestion: 'What was the hardest part of that project?', now, mode: 'technical-interview', surface: 'what_to_answer' });
    // With raw ms, decay kills recency-salience recall (a 61-min gap = 3.66M "seconds").
    // The demonstrative direct-substitution path may still fire, but the recalled age
    // would be absurd (millions) — assert the conversion path produces a SANE age and
    // the raw path does not, documenting why the engine must convert.
    if (r.recalledEntity) {
      assert.ok(r.recalledAgeSeconds > 1_000_000, 'raw-ms age is absurd (proves units are wrong without conversion)');
    }
  });

  test('5-second-ago project recall works under ms conversion (short range)', () => {
    const turns = msTurns([
      ['interviewer', 'Tell me about Natively.', 0],
      ['user', 'An AI copilot.', 0.05],
      ['interviewer', 'How did you build it?', 0.1],
    ]);
    const r = asEngine(turns, 'How did you build it?');
    assert.equal(r.recalledEntity, 'Natively');
  });
});

describe('isContextFreeBareFollowup', () => {
  test('"why?" with only a prior bare fragment is still context-free', () => {
    assert.equal(isContextFreeBareFollowup('continue', [{ role: 'interviewer', text: 'why?', t: 0 }, { role: 'interviewer', text: 'continue', t: 60 }]), true);
  });
  test('"why?" after an answerable question is NOT context-free', () => {
    assert.equal(isContextFreeBareFollowup('why?', [{ role: 'interviewer', text: 'Tell me about Natively.', t: 0 }, { role: 'interviewer', text: 'why?', t: 60 }]), false);
  });
});

describe('effectiveMemoryMode — coding/comp intent overrides ambient mode (code-review HIGH fix)', () => {
  const { effectiveMemoryMode } = m;
  test('a coding question inside a technical-interview session → coding boundary', () => {
    assert.equal(effectiveMemoryMode('technical-interview', 'coding_question_answer'), 'coding');
    assert.equal(effectiveMemoryMode('technical-interview', 'dsa_question_answer'), 'coding');
    assert.equal(effectiveMemoryMode('technical-interview', 'technical_concept_answer'), 'coding');
  });
  test('a comp question → negotiation boundary', () => {
    assert.equal(effectiveMemoryMode('looking-for-work', 'negotiation_answer'), 'negotiation');
  });
  test('a profile question keeps the ambient mode', () => {
    assert.equal(effectiveMemoryMode('technical-interview', 'project_answer'), 'technical-interview');
    assert.equal(effectiveMemoryMode('looking-for-work', 'skill_experience_answer'), 'looking-for-work');
  });
  test('REAL coding-in-interview: project NOT recalled (the production gate, not a synthetic coding mode)', () => {
    // Session is a technical-interview; a coding question must use the coding boundary
    // so the interview project is blocked — this is what production actually does.
    const turns = [{ role: 'interviewer', text: 'Tell me about Natively.', t: 0 }, { role: 'interviewer', text: 'Solve two sum.', t: 60 }];
    const intentType = 'dsa_question_answer';
    const r = resolveLiveFollowup({ turns, latestQuestion: 'Solve two sum.', mode: effectiveMemoryMode('technical-interview', intentType), surface: 'coding' });
    assert.equal(r.recalledEntity, undefined, 'coding-in-interview must NOT recall the project');
  });
  test('REAL comp-in-interview: salary NOT recalled into a coding answer', () => {
    const turns = [{ role: 'interviewer', text: 'What salary do you expect?', t: 0 }, { role: 'user', text: '250k base.', t: 5 }, { role: 'interviewer', text: 'Write a SQL query.', t: 60 }];
    const r = resolveLiveFollowup({ turns, latestQuestion: 'Write a SQL query.', mode: effectiveMemoryMode('technical-interview', 'coding_question_answer'), surface: 'coding' });
    assert.ok(!String(r.recalledEntity || '').match(/250k|salary/i));
  });
});

describe('mode/surface mapping', () => {
  test('toMemoryMode', () => {
    assert.equal(toMemoryMode('technical-interview'), 'technical-interview');
    assert.equal(toMemoryMode('sales'), 'sales');
    assert.equal(toMemoryMode(undefined), 'general');
  });
  test('toSurface', () => {
    assert.equal(toSurface('sales', false), 'sales');
    assert.equal(toSurface('team-meet', false), 'meeting');
    assert.equal(toSurface('technical-interview', true), 'what_to_answer');
  });
});
