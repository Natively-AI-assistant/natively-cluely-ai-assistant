// Typed text reaches the model exactly as written (2026-10-04, owner's decision).
//
// The STT filler stripper (stripSttFillers) ran on EVERY question, typed ones
// included. Measured in the real app on a typed question:
//   typed: "I would like the right answer: is the policy basically kind of strict,
//           or is it actually strict? I mean the the travel policy."
//   sent:  "I would like the answer: is the policy kind of strict, or is it
//           actually strict? the travel policy."
// "right", "basically", "I mean" and a repeated word were deleted from what the
// user deliberately typed; the original wording appeared nowhere in the request.
// Fillers are transcriber noise, so the stripping stays for SPEECH — including
// speech handed over as a "manual" question (Auto Answer, speculative and
// pinned questions on the what-to-answer surface). Only typed chat
// (surface 'manual-chat') is left verbatim.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { decide } = await load('orchestration/orchestrator.js');
const { composePrompt } = await load('generation/prompt-composer.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');

const TYPED = 'I would like the right answer: is the policy basically kind of strict, or is it actually strict? I mean the the travel policy.';
const req = (extra) => ({ requestId: 'r', requestSequence: 1, modeId: 'general', scope: { userId: 'u' }, sessionId: 's', hasAttachedDocuments: false, ...extra });

describe('typed chat is not run through the speech filler stripper', () => {
  test('a typed question is resolved word for word', () => {
    const d = decide(req({ surface: 'manual-chat', manualQuestion: TYPED }));
    assert.equal(d.resolvedQuestion, TYPED);
  });

  test('the prompt the model reads carries the typed words', () => {
    const d = decide(req({ surface: 'manual-chat', manualQuestion: TYPED }));
    const c = composePrompt({ decision: d, policy: MODE_POLICIES.general, evidence: [] });
    assert.ok(c.user.includes(`# Question\n${TYPED}`), 'the # Question line is the typed text');
  });

  test('speech handed over as a manual question is still cleaned', () => {
    const d = decide(req({ surface: 'what-to-answer', manualQuestion: 'What is arh the enterprise floor discount um pct?' }));
    assert.equal(d.resolvedQuestion, 'What is the enterprise floor discount pct?');
  });

  test('a transcript question is still cleaned', () => {
    const d = decide(req({ surface: 'what-to-answer', transcriptQuestion: 'What is erm the erm basically period for churn pct?' }));
    assert.equal(d.resolvedQuestion, 'What is the period for churn pct?');
  });
});
