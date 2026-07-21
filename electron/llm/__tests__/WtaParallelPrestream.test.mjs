// electron/llm/__tests__/WtaParallelPrestream.test.mjs
//
// PI v3 (W5): the three pre-stream stages (intent classification, profile
// grounding, mode-context retrieval) run CONCURRENTLY in runWhatShouldISay —
// wall time = max(stages), not sum(stages). Invariants:
//   1. IntelligenceEngine kicks classifyIntent + mode retrieval as promises
//      BEFORE the grounding await (source-level pin: the awaits overlap).
//   2. WhatToAnswerLLM accepts a prefetched mode-context promise and races it
//      under the same HYBRID_RETRIEVAL_BUDGET_MS guard.
//   3. The reference_files route gate still wins — a forbidden layer DISCARDS
//      the prefetched result (leak surface unchanged).
//   4. A slow prefetch promise cannot stall first-token past the budget.
//   5. The intent promise carries an inline .catch (it floats unawaited —
//      a rejection would otherwise be unhandled).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineSrc = readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
const wtaSrc = readFileSync(path.resolve(__dirname, '../WhatToAnswerLLM.ts'), 'utf8');

const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');
const { WhatToAnswerLLM } = await import(pathToFileURL(path.join(distRoot, 'llm/WhatToAnswerLLM.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distRoot, 'llm/AnswerPlanner.js')).href);

describe('W5: pipeline shape (source pins)', () => {
    test('classifyIntent is kicked as a promise, awaited only at planAnswer time', () => {
        assert.match(engineSrc, /const intentPromise = classifyIntent\(/);
        assert.match(engineSrc, /const intentResult = await intentPromise/);
        // The grounding await sits BETWEEN kick and join — that's the overlap.
        const kick = engineSrc.indexOf('const intentPromise = classifyIntent(');
        const ground = engineSrc.indexOf('await withTimeout(orchestrator.processQuestion(');
        const join = engineSrc.indexOf('const intentResult = await intentPromise');
        assert.ok(kick > 0 && ground > kick && join > ground,
            `expected kick(${kick}) < grounding(${ground}) < join(${join})`);
    });

    test('mode retrieval is kicked as a promise and handed to generateStream', () => {
        assert.match(engineSrc, /const modeContextPromise: Promise<string>/);
        // The prefetch promise is still threaded; the request snapshot (audit #6)
        // is appended after it, so allow an optional trailing arg.
        assert.match(engineSrc, /generateStream\([^)]*modeContextPromise(?:, requestSnapshot)?\)/s);
    });

    test('the floating intent promise carries an inline rejection handler', () => {
        const kickBlock = engineSrc.slice(
            engineSrc.indexOf('const intentPromise = classifyIntent('),
            engineSrc.indexOf('const modeContextPromise'),
        );
        assert.match(kickBlock, /\.catch\(/);
    });

    test('prefetched retrieval is raced under the same budget in WhatToAnswerLLM', () => {
        assert.match(wtaSrc, /preFetchedModeContext\?: Promise<string>/);
        assert.match(wtaSrc, /raceWithBudget\(\s*preFetchedModeContext, HYBRID_RETRIEVAL_BUDGET_MS/);
    });
});

describe('W5: behavior through the real WhatToAnswerLLM', () => {
    // Minimal llmHelper stub: records the assembled message, streams one token.
    function makeHelperStub() {
        const seen = { userMessage: '', scopes: [] };
        return {
            seen,
            getPromptTier: () => 'full',
            getCapabilities: () => ({ outputBudgetTokens: 2000 }),
            fitContextForCurrentModel: (t) => t,
            canUseLocalFallback: async () => false,
            thinkingBudgetForAnswerType: () => 0,
            streamChat: async function* (userMessage, _img, _ctx, _prompt, _ik, _sm, scopes) {
                seen.userMessage = userMessage;
                seen.scopes = scopes || [];
                yield 'ok';
            },
        };
    }

    const modesManagerStub = {
        getActiveModeSystemPromptSuffix: () => '',
        getActiveModePinnedInstructions: () => '',
        buildActiveModeContextBlock: () => '',
        buildRetrievedActiveModeContextBlock: () => '',
    };

    const drain = async (gen) => { let out = ''; for await (const t of gen) out += t; return out; };

    test('prefetched mode context lands in the prompt when the route allows reference_files', async () => {
        const helper = makeHelperStub();
        const wta = new WhatToAnswerLLM(helper, modesManagerStub);
        const plan = planAnswer({ question: 'why is your product better than competitors?', source: 'what_to_answer', speakerPerspective: 'interviewer' });
        assert.ok(!plan.forbiddenContextLayers.includes('reference_files'), `precondition: ${plan.answerType} allows reference_files`);

        const prefetched = Promise.resolve('<active_mode_retrieved_context><snippet><text>PREFETCHED-EVIDENCE</text></snippet></active_mode_retrieved_context>');
        await drain(wta.generateStream(
            'interviewer: why is your product better than competitors?',
            undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, // +domContext slot (main added it before candidateProfile in the merge)
            plan, prefetched,
        ));
        assert.match(helper.seen.userMessage, /PREFETCHED-EVIDENCE/);
        assert.ok(helper.seen.scopes.includes('reference_files'));
    });

    test('prefetched mode context is DISCARDED when the route forbids reference_files', async () => {
        const helper = makeHelperStub();
        const wta = new WhatToAnswerLLM(helper, modesManagerStub);
        const plan = planAnswer({ question: 'solve two sum', source: 'what_to_answer', speakerPerspective: 'interviewer' });
        assert.ok(plan.forbiddenContextLayers.includes('reference_files'), `precondition: ${plan.answerType} forbids reference_files`);

        const prefetched = Promise.resolve('<active_mode_retrieved_context><snippet><text>PREFETCHED-EVIDENCE</text></snippet></active_mode_retrieved_context>');
        await drain(wta.generateStream(
            'interviewer: solve two sum',
            undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, // +domContext slot (main added it before candidateProfile in the merge)
            plan, prefetched,
        ));
        assert.doesNotMatch(helper.seen.userMessage, /PREFETCHED-EVIDENCE/);
        assert.ok(!helper.seen.scopes.includes('reference_files'));
    });

    test('a hung prefetch promise cannot stall first-token past the budget', async () => {
        const helper = makeHelperStub();
        const wta = new WhatToAnswerLLM(helper, modesManagerStub);
        const plan = planAnswer({ question: 'why is your product better than competitors?', source: 'what_to_answer', speakerPerspective: 'interviewer' });

        const never = new Promise(() => { /* hangs forever */ });
        const t0 = performance.now();
        const out = await drain(wta.generateStream(
            'interviewer: why is your product better than competitors?',
            undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, // +domContext slot (main added it before candidateProfile in the merge)
            plan, never,
        ));
        const elapsed = performance.now() - t0;
        assert.equal(out, 'ok');
        // HYBRID_RETRIEVAL_BUDGET_MS is 1500 — generous margin for CI jitter.
        assert.ok(elapsed < 4000, `stalled ${elapsed.toFixed(0)}ms — budget race not applied to prefetch`);
        assert.doesNotMatch(helper.seen.userMessage, /PREFETCHED/);
    });
});
