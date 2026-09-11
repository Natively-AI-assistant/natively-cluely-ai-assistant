// electron/llm/routing/__tests__/legacyShim.test.mjs
//
// The shim is what lets the router be switched on without rewriting the prompt
// layer in the same change. These check that it is honest about what it cannot
// recover, because a shim that quietly guesses looks correct right up until the
// shadow run blames the router for a prompt-layer misroute.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const { toLegacyIntent, SHIM_REACHABLE_INTENTS } = await import(
    pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/routing/legacyShim.js')).href
);

const frame = (over = {}) => ({
    task: 'answer', answer_form: 'explanation', mode_intent: '',
    confidence: { task: 0.8 }, ...over,
});

describe('code wins outright', () => {
    // The six-section DSA contract keys off this one, so it is the only legacy
    // label the downstream prompt genuinely changes shape for.
    test('answer_form code maps to coding', () => {
        assert.equal(toLegacyIntent(frame({ answer_form: 'code' })).intent, 'coding');
    });
    test('task debug maps to coding even without a code answer_form', () => {
        assert.equal(toLegacyIntent(frame({ task: 'debug' })).intent, 'coding');
    });
    test('and it is never reported ambiguous', () => {
        assert.equal(toLegacyIntent(frame({ answer_form: 'code' })).ambiguous, false);
    });
});

describe('mode_intent separates the pairs task cannot', () => {
    // These three pairs collapse onto identical task and answer_form values.
    // Without mode_intent the shim would pick one of each and look right.
    test('behavioral_star is behavioral, not example_request', () => {
        const r = toLegacyIntent(frame({ answer_form: 'example', mode_intent: 'behavioral_star' }));
        assert.equal(r.intent, 'behavioral');
        assert.equal(r.via, 'mode_intent');
        assert.equal(r.ambiguous, false);
    });
    test('worked_example is example_request, not behavioral', () => {
        assert.equal(toLegacyIntent(frame({ answer_form: 'example', mode_intent: 'worked_example' })).intent, 'example_request');
    });
    test('new_concept is deep_dive, not clarification', () => {
        assert.equal(toLegacyIntent(frame({ task: 'explain', mode_intent: 'new_concept' })).intent, 'deep_dive');
    });
    test('clarification_request is clarification, not deep_dive', () => {
        assert.equal(toLegacyIntent(frame({ task: 'explain', mode_intent: 'clarification_request' })).intent, 'clarification');
    });
    test('dsa_problem is coding even when the frame says explain', () => {
        assert.equal(toLegacyIntent(frame({ task: 'explain', mode_intent: 'dsa_problem' })).intent, 'coding');
    });
});

describe('it says when it is guessing', () => {
    test('an unresolved example is flagged ambiguous', () => {
        const r = toLegacyIntent(frame({ answer_form: 'example' }));
        assert.equal(r.intent, 'example_request');
        assert.equal(r.ambiguous, true, 'behavioral and example_request are indistinguishable here');
    });
    test('an unresolved explain is flagged ambiguous', () => {
        const r = toLegacyIntent(frame({ task: 'explain' }));
        assert.equal(r.ambiguous, true, 'clarification and deep_dive are indistinguishable here');
    });
    test('the terminal default is flagged ambiguous', () => {
        assert.equal(toLegacyIntent(frame()).ambiguous, true);
    });
    test('a resolved mapping is not flagged', () => {
        assert.equal(toLegacyIntent(frame({ mode_intent: 'dsa_problem' })).ambiguous, false);
    });
});

describe('follow_up is unreachable, deliberately', () => {
    // Nothing in the frame separates it from general: both are task=answer with
    // answer_form=explanation. It is 0.2% of live traffic against general's
    // 37.5%, so emitting it on a coin flip would misroute one turn in three.
    test('the default is general, not follow_up', () => {
        assert.equal(toLegacyIntent(frame()).intent, 'general');
    });
    test('follow_up is not in the reachable set', () => {
        assert.ok(!SHIM_REACHABLE_INTENTS.includes('follow_up'));
    });
    test('and no input produces it', () => {
        const tasks = ['answer', 'explain', 'create', 'debug', 'summarize', 'compare', 'rewrite', 'plan', 'research', 'extract', 'none'];
        const forms = ['code', 'fact', 'explanation', 'example', 'recommendation', 'summary', 'rebuttal', 'steps', 'table', 'none'];
        const intents = ['', 'dsa_problem', 'behavioral_star', 'new_concept', 'worked_example', 'meeting_capture', 'unknown_thing'];
        for (const task of tasks) {
            for (const answer_form of forms) {
                for (const mode_intent of intents) {
                    const r = toLegacyIntent(frame({ task, answer_form, mode_intent }));
                    assert.notEqual(r.intent, 'follow_up', `${task}/${answer_form}/${mode_intent} produced follow_up`);
                    assert.ok(SHIM_REACHABLE_INTENTS.includes(r.intent), `${r.intent} is outside the declared reachable set`);
                }
            }
        }
    });
});

describe('it always returns something usable', () => {
    test('an unknown mode_intent does not throw', () => {
        assert.ok(toLegacyIntent(frame({ mode_intent: 'not_a_real_label' })).intent);
    });
    test('a missing confidence does not produce NaN', () => {
        const r = toLegacyIntent({ task: 'answer', answer_form: 'explanation', mode_intent: '', confidence: {} });
        assert.ok(Number.isFinite(r.confidence), 'confidence must stay a number');
    });
});
