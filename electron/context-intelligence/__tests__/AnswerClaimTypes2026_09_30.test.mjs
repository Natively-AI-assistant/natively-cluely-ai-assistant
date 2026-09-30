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
