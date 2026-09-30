// TODAY in the prompt (2026-09-30).
//
// The composed prompt carried no date, so a partner sheet "Valid through
// December 31, 2025" read as current in September 2026 and a résumé dated
// November 2022 was taken as the newest (external judge, I5 dev: DSALES-023/026,
// DJOB-018/032 — all capped). The line appears only when the question,
// conversation or evidence mentions a date, so every other prompt is unchanged.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron', p)).href);
const { composePrompt, todayNotice } = await dist('context-intelligence/generation/prompt-composer.js');
const { decide } = await dist('context-intelligence/orchestration/orchestrator.js');
const { resolveModePolicy } = await dist('context-intelligence/policies/mode-policy-registry.js');

const NOW = new Date(2026, 8, 30, 10, 0, 0); // local Wednesday 30 September 2026
const compose = (q, conversationSummary) => composePrompt({
  decision: decide({ requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId: 'sales', scope: { userId: 'local' }, sessionId: 's', transcriptQuestion: q }),
  policy: resolveModePolicy('sales'), evidence: [], heardQuestion: true, conversationSummary, now: NOW,
});

describe('todayNotice', () => {
  test('names the local weekday, day, month and year', () => {
    assert.equal(todayNotice(NOW, 'Valid through December 31, 2025.'),
      '# Today\nIt is Wednesday 30 September 2026 where the user is. Read validity dates, deadlines, ages and which version is current against it.');
  });
  for (const m of ['Valid through December 31, 2025', 'the 2022 résumé', 'due Oct 28', 'by 16 November', "let's meet Thursday", 'Mondays work best']) {
    test(`fires on: ${m}`, () => assert.notEqual(todayNotice(NOW, m), ''));
  }
  for (const m of ['How much is Growth per seat?', 'May I ask what you use today?', 'We sell 44 units', undefined, '']) {
    test(`silent on: ${String(m)}`, () => assert.equal(todayNotice(NOW, m), ''));
  }
});

describe('in the composed prompt', () => {
  test('rendered in the USER message when the material carries a date, never in the system prompt', () => {
    const { system, user, sections } = compose('So we are good at forty-four, right?', 'THEM: this sheet is valid through December 31, 2025');
    assert.match(user, /# Today\nIt is Wednesday 30 September 2026/);
    assert.doesNotMatch(system, /# Today/);
    assert.ok(sections.includes('today'));
  });
  test('absent when nothing mentions a date', () => {
    const { user, sections } = compose('How much is Growth per seat?', 'THEM: how much is Growth per seat?');
    assert.doesNotMatch(user, /# Today/);
    assert.ok(!sections.includes('today'));
  });
});
