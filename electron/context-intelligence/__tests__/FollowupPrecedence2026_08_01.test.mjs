// Pattern F — precedence follow-ups answer from the RECORDED prior decision
// (live turns 18/92, 2026-08-01): after a current-vs-retired value answer,
// "Why did you ignore the other values?" confabulated a rationale and "Why are
// the lower values not current?" refused with "no access to source material".
// The prior turn's source decision is now persisted on conversation state and
// rendered by the composer when a why-follow-up asks about it.
//
// Pattern E — the "# Conversation so far" section header must carry the
// referent-only rule itself: some surfaces pass a raw transcript window in
// which the assistant's own prior output appears.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);

const { orchestrate } = await load('orchestration/orchestrator.js');
const { createLegacyRetrievalPort } = await load('retrieval/legacy-retrieval-port.js');
const { composePrompt } = await load('generation/prompt-composer.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { clearConversationState } = await load('question/conversation-state-store.js');

const registry = {
  sourceTypes: new Map([['cur', 'REFERENCE_FILE'], ['old', 'REFERENCE_FILE']]),
  activeVersions: new Map([['cur', 'v1'], ['old', 'v1']]),
  chunkVersions: new Map([['cur', 'v1'], ['old', 'v1']]),
  sourceScopes: new Map([['cur', { userId: 'u' }], ['old', { userId: 'u' }]]),
};
const chunks = [
  { sourceId: 'cur', fileName: 'current-plans.md', chunkIndex: 0, text: 'Team plan costs $499 per month.', score: 0.7, metadata: { documentStatus: 'current' } },
  { sourceId: 'old', fileName: 'superseded-plans.md', chunkIndex: 0, text: 'Team plan costs $299 per month.', score: 0.9, metadata: { documentStatus: 'retired' } },
];

const req = (q, sessionId) => ({
  requestId: `r-${q.slice(0, 8)}`, requestSequence: 1, surface: 'manual_chat', modeId: 'sales',
  scope: { userId: 'u', modeId: 'sales' }, sessionId, manualQuestion: q,
});

describe('pattern F: precedence follow-ups use the recorded prior decision', () => {
  test('a why-follow-up carries the prior selected/ignored record with reason', async () => {
    clearConversationState();
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    const first = await orchestrate(req('What is the current Team price?', 'sess-f1'), port);
    assert.ok(first.evidence.length > 0, 'first turn must retrieve');

    const second = await orchestrate(req('Why are the lower values not current?', 'sess-f1'), port);
    const h = second.decision.precedenceHistory;
    assert.ok(h, 'precedenceHistory must be attached to the follow-up decision');
    assert.match(h.question, /current Team price/);
    assert.ok(h.selectedSources.some((s) => s.sourceId === 'cur'), JSON.stringify(h));
    const all = [...h.selectedSources, ...h.ignoredSources];
    assert.ok(all.some((s) => s.status === 'retired'),
      `the retired source must appear in the record: ${JSON.stringify(h)}`);
  });

  test('"Why did you ignore the other values?" also matches', async () => {
    clearConversationState();
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    await orchestrate(req('What is the current Team price?', 'sess-f2'), port);
    const second = await orchestrate(req('Why did you ignore the other values?', 'sess-f2'), port);
    assert.ok(second.decision.precedenceHistory, 'history must attach');
  });

  test('an unrelated why-question does NOT get the record', async () => {
    clearConversationState();
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    await orchestrate(req('What is the current Team price?', 'sess-f3'), port);
    const second = await orchestrate(req('Why should a customer choose the Team plan?', 'sess-f3'), port);
    assert.equal(second.decision.precedenceHistory, undefined);
  });

  test('no recorded decision (fresh session) ⇒ nothing attaches', async () => {
    clearConversationState();
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    const only = await orchestrate(req('Why are the lower values not current?', 'sess-f4'), port);
    assert.equal(only.decision.precedenceHistory, undefined);
  });

  test('an intervening FAST turn preserves the decision record', async () => {
    clearConversationState();
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    await orchestrate(req('What is the current Team price?', 'sess-f5'), port);
    await orchestrate(req('What is a mutex?', 'sess-f5'), port); // FAST, no retrieval
    const third = await orchestrate(req('Why are the lower values not current?', 'sess-f5'), port);
    assert.ok(third.decision.precedenceHistory,
      'a definition question in between must not erase the recorded decision');
  });

  test('the composer renders the record with an answer-from-this instruction', async () => {
    clearConversationState();
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    await orchestrate(req('What is the current Team price?', 'sess-f6'), port);
    const second = await orchestrate(req('Why are the lower values not current?', 'sess-f6'), port);
    const composed = composePrompt({ decision: second.decision, policy: MODE_POLICIES.sales, evidence: second.evidence });
    assert.ok(composed.sections.includes('precedence_history'), composed.sections.join(','));
    assert.match(composed.system, /Previous source decision \(recorded\)/);
    assert.match(composed.system, /never\s+claim you lack access/i);
    // Without the record, the section must not render.
    const plain = composePrompt({
      decision: (await orchestrate(req('What is the current Team price?', 'sess-f7'), port)).decision,
      policy: MODE_POLICIES.sales, evidence: [],
    });
    assert.ok(!plain.sections.includes('precedence_history'));
  });
});

describe('pattern E: conversation section carries the referent-only rule', () => {
  test('the section header states history is not evidence', async () => {
    clearConversationState();
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    const r = await orchestrate(req('What is the current Team price?', 'sess-e1'), port);
    const composed = composePrompt({
      decision: r.decision, policy: MODE_POLICIES.sales, evidence: r.evidence,
      conversationSummary: 'USER: earlier question\nASSISTANT: earlier answer',
    });
    assert.ok(composed.sections.includes('conversation'));
    assert.match(composed.user, /Conversation so far \(unverified context/);
    assert.match(composed.user, /never a source of facts/);
    assert.match(composed.user, /prior generated output, not evidence/);
  });
});
