// Claim types the live answer may not invent (2026-09-30).
//
// Measured on the 9-mode dev set (blind judge, baseline 04333d2d): 30/360
// answers invented a fact about the USER (background, preference, status,
// decision, a stitched story) and 17 invented a company fact, 12 of them in
// Sales. The rules pinned here are the instructions that replaced the ones that
// produced them ("what they value", "never stall … give the decision now").
// Also pinned: typed overlay turns carry the meeting's speech window, and code
// shapes carry the self-check.
//
// Platform: pure string composition — identical on macOS and Windows.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const ci = path.join(base, 'context-intelligence');
const composer = await import(pathToFileURL(path.join(ci, 'generation/prompt-composer.js')).href);
const { decide } = await import(pathToFileURL(path.join(ci, 'orchestration/orchestrator.js')).href);
const { MODE_POLICIES, MODE_IDS } = await import(pathToFileURL(path.join(ci, 'policies/mode-policy-registry.js')).href);
const v2 = await import(pathToFileURL(path.join(base, 'llm/promptSystemV2.js')).href);
const coding = await import(pathToFileURL(path.join(base, 'llm/codingContract.js')).href);

const heard = (q, modeId) => decide({
  requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId,
  scope: { userId: 'u1', sessionId: 's' }, sessionId: 's', transcriptQuestion: q,
});
const compose = (d, modeId, extra = {}) => composer.composePrompt({
  decision: d, policy: MODE_POLICIES[modeId], evidence: [], attachedSourceCount: 0, profileSourceCount: 0, ...extra,
});

describe("the user's own facts", () => {
  for (const id of MODE_IDS) {
    test(`${id}: the rule and its relocation pair reach the system prompt`, () => {
      const p = compose(heard('Would you be open to relocating to Denver?', id), id, { heardQuestion: true });
      assert.match(p.system, /Speaking as the user, never state a fact about the user themselves that nothing above states/);
      assert.match(p.system, /I\\?'m open to talking about relocation\. What timeline/);
      assert.match(p.system, /never merge two separate items into one story/);
    });
  }
  test('no prompt text asks for "what they value" any more', () => {
    for (const id of MODE_IDS) {
      const p = compose(heard('Tell me about yourself.', id), id, { heardQuestion: true });
      assert.ok(!/what they value/.test(p.system + p.user), id);
    }
  });
});

describe('Sales grounds company claims', () => {
  test('capabilities/terms only as the material states; no decide-now push', () => {
    const p = v2.buildSystemPromptV2({ mode: 'sales', action: 'what_to_say', tier: 'cloud', surface: 'live' });
    assert.match(p, /Capabilities, integrations, security, compliance, SLAs, support, timelines, prices/);
    assert.match(p, /never guess or commit: offer to confirm/);
    assert.ok(!/give the decision now/.test(p));
    assert.ok(!/never stall with a clarifying question/.test(p));
  });
});

describe('typed overlay turns see the meeting', () => {
  test('the typed V3 call passes the speech window on the live surface only', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/ipcHandlers.ts'), 'utf8');
    const i = src.indexOf("surface: 'manual-chat',");
    assert.ok(i > 0);
    const call = src.slice(i, i + 4000);
    assert.match(call, /conversationSummary: answerSurface === 'live' \? \(\(\) => \{/);
    assert.match(call, /getFormattedContext\?\.\(180\)/);
    assert.match(call, /speechWindowForPrompt\(formatted\)/);
  });
});

describe('code shapes carry the self-check', () => {
  for (const shape of ['code', 'solve', 'optimize', 'debug']) {
    test(shape, () => assert.ok(coding.CODING_SHAPE_CONTRACTS[shape].includes(coding.CODE_SELF_CHECK), shape));
  }
  test('debug traces a concrete input before naming the bug and allows "it is correct"', () => {
    const d = coding.CODING_SHAPE_CONTRACTS.debug;
    assert.match(d, /First find a concrete input/);
    assert.match(d, /If the code is actually correct, say so/);
  });
  test('non-code shapes stay free of it', () => {
    for (const shape of ['approach', 'complexity', 'dry_run', 'explain', 'walkthrough', 'brute_force']) {
      assert.ok(!coding.CODING_SHAPE_CONTRACTS[shape].includes(coding.CODE_SELF_CHECK), shape);
    }
  });
});

describe('denials are claims too', () => {
  test('the company-fact rule covers "not offered / not possible / no outage"', () => {
    const p = compose(heard('Can you just reset my password by text?', 'call-center'), 'call-center', { heardQuestion: true });
    assert.match(p.system, /This includes saying something is NOT offered, possible, allowed or happening/);
    assert.match(p.system, /neither confirm nor refuse; say what you will check and do next/);
  });
});

describe('heard commitment questions get the notice next to the question', () => {
  const pref = [
    "Just so it's on the table, this is hybrid, Tuesday through Thursday in our LoDo office. Does that work for you?",
    'And you are out in Columbus right now, right? So would you be moving out here?',
    'Before we go too far, what are you looking for in terms of base salary?',
    "You've been at Larkspur a few years now. Why leave?",
    'The role has travel to Frankfurt about twice a year. Is that okay?',
    "What's something you're still working on getting better at?",
  ];
  for (const q of pref) {
    test(`preference: ${q.slice(0, 40)}`, () => {
      const n = composer.personalCommitmentNotice(q, 'looking-for-work', true);
      assert.match(n, /asks for the user's own preference, commitment or reason/);
      const p = compose(heard(q, 'looking-for-work'), 'looking-for-work', { heardQuestion: true });
      assert.ok(p.user.includes(n));
    });
  }
  test('experience question', () => {
    assert.match(composer.personalCommitmentNotice('Have you run Postgres in production?', 'technical-interview', true), /asks whether the user has done something/);
    assert.match(composer.personalCommitmentNotice('Any experience with Kafka?', 'looking-for-work', true), /asks whether the user has done something/);
  });
  test('ordinary questions, typed turns, and recruiting/lecture stay free of it', () => {
    assert.equal(composer.personalCommitmentNotice('How do goroutines get scheduled?', 'technical-interview', true), '');
    assert.equal(composer.personalCommitmentNotice('Tell me about Project Tern.', 'looking-for-work', true), '');
    assert.equal(composer.personalCommitmentNotice('Would you be open to relocating?', 'looking-for-work', false), '');
    assert.equal(composer.personalCommitmentNotice('Would I need to relocate for this?', 'recruiting', true), '');
    assert.equal(composer.personalCommitmentNotice('Why did the empire leave the province?', 'lecture', true), '');
    const p = compose(heard('How do goroutines get scheduled?', 'technical-interview'), 'technical-interview', { heardQuestion: true });
    assert.ok(!/asks for the user's own preference/.test(p.user));
  });
});

describe('background and familiarity questions count as experience', () => {
  for (const q of ['How long have you been doing this?', "What's your background, were you ever an engineer yourself?", 'Are you familiar with the HVAC space?', 'Tell me about your background.']) {
    // Any of the no-invention notices (2026-09-30: the personal-life notice now takes the user's own background and tenure).
    test(q, () => assert.match(composer.personalCommitmentNotice(q, 'sales', true), /asks whether the user has done something|asks for the user's own preference|asks about the user's own life/));
  }
  test('an ordinary product question does not', () => {
    assert.equal(composer.personalCommitmentNotice('How long does onboarding usually take?', 'sales', true), '');
  });
});
