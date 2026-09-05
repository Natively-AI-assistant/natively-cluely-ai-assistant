// electron/llm/routing/__tests__/shadowRun.test.mjs
//
// The shadow run must be invisible: off by default, never awaited on the live
// path, and unable to break the turn it observes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const { isShadowRunEnabled, SHADOW_ENV_KEY, recordShadowDecision } = await import(
    pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/routing/shadowRun.js')).href
);
const engine = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');
const { scrubTelemetry } = await import(
    pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/piTelemetry.js')).href
);

describe('shadow logging is off by default', () => {
    test('no env means off', () => {
        delete process.env[SHADOW_ENV_KEY];
        assert.equal(isShadowRunEnabled(), false);
    });
    test('an explicit truthy value turns it on', () => {
        process.env[SHADOW_ENV_KEY] = '1';
        assert.equal(isShadowRunEnabled(), true);
        delete process.env[SHADOW_ENV_KEY];
    });
    test('an unrecognised value is off, not on', () => {
        process.env[SHADOW_ENV_KEY] = 'perhaps';
        assert.equal(isShadowRunEnabled(), false);
        delete process.env[SHADOW_ENV_KEY];
    });
    test('it is a DIFFERENT flag from the router itself', () => {
        // They answer different questions and carry different risk. Shadow
        // logging can run for two weeks on a build where the router is off.
        const shadow = fs.readFileSync(path.join(repoRoot, 'electron/llm/routing/shadowRun.ts'), 'utf8');
        assert.ok(shadow.includes('NATIVELY_ROUTER_SHADOW'));
        assert.ok(!shadow.includes("'NATIVELY_INTERACTION_ROUTER'"), 'the shadow run must not read the router flag');
    });
});

describe('it cannot break the turn it observes', () => {
    test('it returns without throwing when disabled', async () => {
        delete process.env[SHADOW_ENV_KEY];
        await recordShadowDecision({
            turn: 'anything', mode: 'general', channel: 'system', history: [],
            modeHasReferenceFiles: false, legacyIntent: 'general', legacyConfidence: 0.5,
            liveWasSilent: false, surface: 'speculative',
        });
    });

    test('a malformed input does not throw', async () => {
        process.env[SHADOW_ENV_KEY] = '1';
        await recordShadowDecision({});
        delete process.env[SHADOW_ENV_KEY];
    });

    test('the call site does not await it', () => {
        const i = engine.indexOf('PR 9: SHADOW RUN');
        assert.ok(i > 0, 'the shadow call must exist');
        const block = engine.slice(i, i + 2000);
        assert.ok(block.includes('void recordShadowDecision('), 'must be fire-and-forget');
        assert.ok(!/await\s+recordShadowDecision/.test(block), 'must never be awaited on the live path');
    });

    test('the call site is wrapped so a require failure cannot reach the turn', () => {
        const i = engine.indexOf('PR 9: SHADOW RUN');
        // End-anchored on the sentinel branch that follows the shadow block; a
        // fixed 2000-char window stopped covering the catch once an argument grew.
        const end = engine.indexOf('if (IntelligenceEngine.isNonAnswerSentinel(fullAnswer)) {', i);
        const block = engine.slice(i, end);
        assert.ok(/try \{[\s\S]*recordShadowDecision[\s\S]*\} catch/.test(block));
    });

    test('it runs after the answer is final, not before', () => {
        // Observing a turn it could still influence would not be a shadow run.
        const shadow = engine.indexOf('PR 9: SHADOW RUN');
        const sentinel = engine.indexOf('if (IntelligenceEngine.isNonAnswerSentinel(fullAnswer)) {', shadow);
        assert.ok(sentinel > shadow, 'the shadow call must sit where fullAnswer is already final');
    });
});

describe('it records the cell that decides safety', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/llm/routing/shadowRun.ts'), 'utf8');
    for (const cell of ['agree_silent', 'agree_answer', 'router_would_silence', 'router_would_speak']) {
        test(`the ${cell} cell is emitted`, () => {
            assert.ok(src.includes(cell), `the comparison must distinguish ${cell}`);
        });
    }
    test('and it records whether the shim agreed with the shipped label', () => {
        assert.ok(src.includes('legacy_agrees'));
        assert.ok(src.includes('shim_ambiguous'), 'an ambiguous shim result must be visible in the analysis');
    });
});

describe('the markers actually survive the privacy scrubber', () => {
    // The allowlist drops unknown keys OUTRIGHT. Without these entries the
    // shadow run emits two weeks of events carrying nothing but mode and
    // surface, and the omission surfaces only when the analysis finds no data.
    const payload = {
        mode: 'team-meet', surface: 'speculative', outcome: 'compared',
        router_needs_response: 'no', router_dialogue_act: 'backchannel', router_confidence: 0.979,
        live_was_silent: true, cell: 'agree_silent',
        legacy_intent: 'general', legacy_confidence: 0.5, legacy_agrees: true,
        shim_intent: 'general', shim_ambiguous: true, shim_via: 'default', elapsed_ms: 18,
    };

    for (const key of Object.keys(payload)) {
        test(`${key} survives`, () => {
            assert.ok(key in scrubTelemetry(payload), `${key} is dropped by the allowlist`);
        });
    }

    test('the pre-check markers survive too', () => {
        const out = scrubTelemetry({
            mode: 'general', surface: 'speculative', needs_response: 'no',
            dialogue_act: 'backchannel', confidence: 0.93, acted: true,
        });
        for (const k of ['needs_response', 'dialogue_act', 'confidence', 'acted']) {
            assert.ok(k in out, `${k} is dropped`);
        }
    });

    test('and raw content still cannot pass', () => {
        const out = scrubTelemetry({
            ...payload,
            turn: 'the raw transcript line which must never be emitted',
            history: ['[SYSTEM] something private'],
            answer: 'the generated answer',
        });
        assert.ok(!('turn' in out), 'raw turn text must be dropped');
        assert.ok(!('history' in out), 'history must be dropped');
        assert.ok(!('answer' in out), 'the answer must be dropped');
    });
});
