// Multi-file evidence capacity (2026-09-19, owner-approved; measured with
// experiments/retrieval-scale). The accepted-slice fill round-robins across
// source types and documents, so with three files attached each gets two of
// six slots and the chunk that answers — ranked 7th–9th — is cut. A turn with
// TWO OR MORE mode files gets a floor of 8 items / 2400 evidence tokens; one
// file is unchanged (zero measured benefit), and the count is an explicit
// signal from the engine bridge, never inferred.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { decide, MULTI_FILE_EVIDENCE } = await load('orchestration/orchestrator.js');
const { resolveModePolicy } = await load('policies/mode-policy-registry.js');
const { createModeRetrievalPort } = await load('retrieval/mode-retrieval-port.js');
const { composePrompt } = await load('generation/prompt-composer.js');

const Q = 'What is the burst limit per tenant on the public API?';
const d = (extra = {}, q = Q) => decide({ requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: 'general', scope: { userId: 'u' }, sessionId: 's', manualQuestion: q, hasAttachedDocuments: true, attachedFileNames: ['a.md'], ...extra });

describe('plan', () => {
  const policy = resolveModePolicy('general');
  test('one file, or an unknown count: the mode policy stands', () => {
    for (const extra of [{ attachedSourceCount: 1 }, {}, { attachedSourceCount: 0 }]) {
      const plan = d(extra).retrievalPlan;
      assert.equal(plan.maximumAcceptedEvidence, policy.retrievalPolicy.maximumAcceptedEvidence);
      assert.equal(plan.evidenceTokens, undefined);
    }
  });
  test('two or more files: the floor applies', () => {
    const plan = d({ attachedSourceCount: 3 }).retrievalPlan;
    assert.equal(plan.maximumAcceptedEvidence, MULTI_FILE_EVIDENCE.accepted);
    assert.equal(plan.evidenceTokens, MULTI_FILE_EVIDENCE.tokens);
  });
  test('a FLOOR, never a cut: seminar already budgets 2400 tokens and 8 items', () => {
    const seminar = resolveModePolicy('seminar');
    const plan = d({ attachedSourceCount: 3, modeId: 'seminar' }).retrievalPlan;
    assert.ok(plan.maximumAcceptedEvidence >= seminar.retrievalPolicy.maximumAcceptedEvidence);
    assert.ok(plan.evidenceTokens >= seminar.contextBudget.evidenceTokens);
  });
  test('an exhaustive request multiplies the raised cap, not the old one', () => {
    const plan = d({ attachedSourceCount: 3 }, 'List every latency number that appears in the documents').retrievalPlan;
    assert.equal(plan.exhaustive, true);
    assert.equal(plan.maximumAcceptedEvidence, MULTI_FILE_EVIDENCE.accepted * 3);
  });
  test('a turn that does not retrieve is untouched', () => {
    const plan = d({ attachedSourceCount: 3 }, 'Reverse a linked list in Python').retrievalPlan;
    assert.equal(plan.shouldRetrieve, false);
    assert.equal(plan.evidenceTokens, undefined);
  });
});

describe('the retriever and the packer read the SAME budget from the plan', () => {
  const files = [{ id: 'f1', fileName: 'a.md', content: 'alpha' }, { id: 'f2', fileName: 'b.md', content: 'beta' }];
  const budgetSeen = async (decision) => {
    let seen = null;
    const port = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async (_m, _f, o) => { seen = o.tokenBudget; return { chunks: [] }; } },
      modeInfo: { id: 'm' }, files, allowedSourceTypes: resolveModePolicy('general').allowedSourceTypes, tokenBudget: 1500, userId: 'u',
    });
    await port.retrieve({ decision });
    return seen;
  };
  test('mode port: the plan budget wins over the policy budget the port was built with', async () => {
    assert.equal(await budgetSeen(d({ attachedSourceCount: 1 })), 1500);
    assert.equal(await budgetSeen(d({ attachedSourceCount: 2 })), MULTI_FILE_EVIDENCE.tokens);
  });
  test('composer: eight ~290-token items fit on a multi-file turn and do not on a single-file one', () => {
    const policy = resolveModePolicy('general');
    // Shape copied from DeepTestDefects2026_08_01's mkEvidence (the composer
    // reads more fields than the ports populate in a stub).
    const evidence = Array.from({ length: 8 }, (_, i) => ({
      evidenceId: `e${i}`, sourceType: 'REFERENCE_FILE', sourceId: `f${i % 2 + 1}`, versionId: 'v1', retrievedVersionId: 'v1', scopeId: 's',
      documentTitle: 'a.md', content: `Section ${i}: ` + 'burst limit per tenant detail '.repeat(34), acceptedFor: ['DOCUMENT_FACT'], authorityFor: [],
      finalScore: 1 - i * 0.01, isDirectFact: true, isInferred: false, trustLevel: 'untrusted_reference', metadata: {},
    }));
    const count = (decision) => composePrompt({ decision, policy, evidence }).packed.includedEvidenceIds.length;
    const single = count(d({ attachedSourceCount: 1 }));
    const multi = count(d({ attachedSourceCount: 2 }));
    assert.ok(multi > single, `multi ${multi} vs single ${single}`);
    assert.equal(multi, 8);
  });
});
