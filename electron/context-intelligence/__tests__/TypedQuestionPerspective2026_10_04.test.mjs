// A question typed into the overlay is answered to the user (2026-10-04, E15). See typedQuestionPerspective.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { decide } = await load('orchestration/orchestrator.js');
const { composePrompt, typedQuestionPerspective } = await load('generation/prompt-composer.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');

const Q = 'they need the netsuite link and sso. can both be had on operations?';
const d = (mode, extra = {}) => decide({ requestId: 'r', requestSequence: 1, surface: 'manual-chat', modeId: mode, scope: { userId: 'u' }, sessionId: 's', manualQuestion: Q, hasAttachedDocuments: false, ...extra });

describe('typed question perspective', () => {
  test('the note names both roles of the mode', () => {
    assert.equal(typedQuestionPerspective('sales'), '\n(Typed to you privately by the seller you are helping; the prospect cannot see or hear it. Reply to the user, not to the prospect: "you" means the user.)');
    assert.match(typedQuestionPerspective('call-center'), /the support agent you are helping; the customer cannot/);
    assert.match(typedQuestionPerspective('general'), /^\n\(Typed to you privately by the user\./);
  });
  test('a question typed into the overlay carries it, right after the question', () => {
    const c = composePrompt({ decision: d('sales'), policy: MODE_POLICIES.sales, evidence: [], typedInOverlay: true });
    assert.ok(c.user.includes(`# Question\n${Q}\n(Typed to you privately by the seller you are helping;`));
  });
  test('a heard question keeps its own note and never gets the typed one', () => {
    const dec = decide({ requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId: 'sales', scope: { userId: 'u' }, sessionId: 's', transcriptQuestion: 'Can both be had on Operations?', hasAttachedDocuments: false });
    const c = composePrompt({ decision: dec, policy: MODE_POLICIES.sales, evidence: [], heardQuestion: true, typedInOverlay: true });
    assert.match(c.user, /Said aloud by the prospect/);
    assert.doesNotMatch(c.user, /Typed to you privately/);
  });
  test('the launcher chat (reading surface) and an unflagged turn get none', () => {
    const c = composePrompt({ decision: d('sales'), policy: MODE_POLICIES.sales, evidence: [], readingSurface: true });
    assert.doesNotMatch(c.user, /Typed to you privately/);
  });
});
