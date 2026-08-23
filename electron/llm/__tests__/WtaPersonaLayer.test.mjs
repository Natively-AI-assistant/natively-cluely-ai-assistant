// electron/llm/__tests__/WtaPersonaLayer.test.mjs
//
// The global AI Persona / Custom Context textareas (and their LLMHelper
// personaPrompt/customNotes plumbing) were removed — Modes Manager's
// per-mode "Real-time prompt" (customContext) is the sole supported
// mechanism now. What remains here is the route-table invariant for the
// still-live 'ai_persona' AnswerPlanner/contextRoute layer, unrelated to
// the removed feature.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');
const { planAnswer } = await import(pathToFileURL(path.join(distRoot, 'llm/AnswerPlanner.js')).href);
const { buildContextRoute } = await import(pathToFileURL(path.join(distRoot, 'llm/contextRoute.js')).href);

describe('W4: route-table invariant that makes unconditional injection safe', () => {
    // ai_persona must never be a FORBIDDEN layer for any answer type — if some
    // future type forbids it, the unconditional choke-point injection becomes a
    // leak and must be gated. This test turns that assumption into a tripwire.
    const PROBES = [
        'what is your name?',                       // identity
        'tell me about your projects',              // project
        'solve two sum',                            // dsa
        'write a function to merge intervals',      // coding
        'explain BFS',                              // technical concept
        'what salary are you expecting?',           // negotiation
        'why is your product better?',              // sales
        'summarize the last five minutes',          // meeting recap
        'how do I stay undetected in interviews?',  // ethical_usage (safety)
        'tell me about a time you failed',          // behavioral
        'how do you fit this data analyst role?',   // jd fit
    ];

    test('no answer type forbids the ai_persona layer', () => {
        for (const q of PROBES) {
            const plan = planAnswer({ question: q, source: 'what_to_answer', speakerPerspective: 'interviewer' });
            assert.ok(!plan.forbiddenContextLayers.includes('ai_persona'),
                `${plan.answerType} forbids ai_persona — the unconditional persona injection in _streamChatInner is now a leak; gate it on isLayerAllowed(plan,'ai_persona')`);
        }
    });

    test('profile answer types select ai_persona with a bounded budget', () => {
        const plan = planAnswer({ question: 'tell me about your projects', source: 'what_to_answer', speakerPerspective: 'interviewer' });
        const route = buildContextRoute(plan);
        const persona = route.layers.find(l => l.layer === 'ai_persona');
        assert.ok(persona?.selected, 'ai_persona selected for profile answers');
        assert.ok(persona.tokenBudget > 0 && persona.tokenBudget <= 400, `budget=${persona.tokenBudget}`);
    });
});
