// electron/llm/routing/__tests__/routerGate.test.mjs
//
// PR 7 safety properties, proved against the real compiled sources rather than
// a description of them.
//
// The gate skips retrieval and generation when the router is confident the turn
// needs no response. The failure it must never have is silencing a turn the
// user explicitly asked for, so these check the guards that make that
// impossible rather than the happy path.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const engine = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');

describe('the gate can never silence an explicit user action', () => {
    test('it is reachable only under isSpeculative', () => {
        const i = engine.indexOf('PR 7: INTERACTION ROUTER PRE-CHECK');
        assert.ok(i > 0, 'the gate must exist');
        const block = engine.slice(i, i + 2400);
        const guard = block.indexOf('if (isSpeculative) {');
        const call = block.indexOf('routerSaysStaySilent');
        assert.ok(guard > 0, 'the gate must be guarded by isSpeculative');
        assert.ok(call > guard, 'the router must be consulted INSIDE the speculative guard');
    });

    test('it sits after the cooldown check, so throttling still decides first', () => {
        const cooldown = engine.indexOf('shouldThrottleTrigger({');
        const gate = engine.indexOf('PR 7: INTERACTION ROUTER PRE-CHECK');
        assert.ok(cooldown > 0 && gate > cooldown, 'the gate must not pre-empt the cooldown');
    });

    test('it sits before generation, which is the point of it', () => {
        const gate = engine.indexOf('PR 7: INTERACTION ROUTER PRE-CHECK');
        const assist = engine.indexOf('if (this.assistCancellationToken) {', gate);
        assert.ok(assist > gate, 'the gate must run before the generation path begins');
    });
});

describe('the gate leaves the engine in the state the generated path would have', () => {
    // Skipping a mutation would make the next turn behave differently purely
    // because the router fired, which is a behaviour change rather than a cost
    // saving. These are the five the post-generation sentinel path performs.
    const block = (() => {
        const i = engine.indexOf('PR 7: INTERACTION ROUTER PRE-CHECK');
        return engine.slice(i, i + 2400);
    })();

    for (const mutation of [
        'this.speculativeText = null;',
        'this.speculativeTextExpiry = Infinity;',
        'this.lastTriggerTime = Date.now();',
        'this.lastTriggerQuestion = question ?? null;',
        "this.setMode('idle');",
    ]) {
        test(`it performs ${mutation}`, () => {
            assert.ok(block.includes(mutation), `the gate must perform: ${mutation}`);
        });
    }

    test('and returns null, matching the speculative sentinel outcome', () => {
        assert.ok(/return null;/.test(block), 'the gate must return null');
    });
});

describe('every uncertainty generates', () => {
    const helper = (() => {
        const i = engine.indexOf('private async routerSaysStaySilent');
        const end = engine.indexOf('private getActiveModeId', i);
        return engine.slice(i, end > i ? end : i + 4000);
    })();

    test('a null prediction means no opinion, not no', () => {
        assert.ok(helper.includes('if (!pred) return false;'), 'a null prediction must fall through to generation');
    });

    test('anything other than needs_response=no generates', () => {
        assert.ok(helper.includes("if (pred.needs_response !== 'no') return false;"));
    });

    test('an unavailable router generates', () => {
        assert.ok(helper.includes('if (!router.isAvailable()) return false;'));
    });

    test('an empty turn generates', () => {
        assert.ok(helper.includes('if (!turn) return false;'));
    });

    test('a throw anywhere generates', () => {
        // The outermost catch must return false, so a throw generates rather
        // than propagating into the turn.
        const tail = helper.slice(helper.lastIndexOf('} catch {'));
        assert.ok(tail.includes('return false;'), `the outer catch must generate, saw: ${tail.slice(0, 120)}`);
    });

    test('the confidence bar is high, and it is a constant not a literal', () => {
        assert.ok(helper.includes('IntelligenceEngine.ROUTER_SILENCE_CONFIDENCE'));
        const m = /ROUTER_SILENCE_CONFIDENCE = ([0-9.]+)/.exec(engine);
        assert.ok(m, 'the threshold must be a named constant');
        assert.ok(Number(m[1]) >= 0.85, `the bar must stay high, found ${m[1]}`);
    });
});

describe('it reads accessors that exist', () => {
    const tracker = fs.readFileSync(path.join(repoRoot, 'electron/SessionTracker.ts'), 'utf8');

    test('getContext is a real SessionTracker method', () => {
        assert.ok(/^\s{4}getContext\(/m.test(tracker), 'getContext must exist on SessionTracker');
    });

    test('the gate does not call the accessor that never existed', () => {
        // An optional chain onto a missing method returns undefined silently,
        // the fallback yields an empty history, and the router runs cold on
        // every turn with nothing saying so. That shipped once in this file.
        // Matching the bare word would hit the comment that explains this very
        // defect, which is the documented "your own comment moves the anchor"
        // trap. Match the CALL.
        assert.ok(!/this\.session\.getConversationHistory/.test(engine),
            'the gate must not call getConversationHistory, which SessionTracker does not define');
    });
});
