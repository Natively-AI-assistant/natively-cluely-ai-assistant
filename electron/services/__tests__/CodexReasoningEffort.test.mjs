// electron/services/__tests__/CodexReasoningEffort.test.mjs
//
// Regression test for the Codex CLI reasoning_effort 400 bug.
//
// The codex CLI binary enforces the same per-family constraints as the direct
// OpenAI API. The Codex CLI provider used to unconditionally emit
// `-c model_reasoning_effort="<user pick>"` regardless of whether the
// currently-selected model accepts that value — so the DEFAULT fast model
// (gpt-5.3-codex) with pick='xhigh' was rejected by the codex CLI with a
// turn.failed event, the run threw "Codex CLI returned an empty response.",
// and the user saw the canned "Let me come back to that in just a moment."
// fallback. resolveCodexReasoningEffort() (electron/services/CodexCliService.ts)
// downgrades unsupported picks to the lowest-latency valid value before
// buildArgs emits the -c flag. This test pins the per-family VALID map so the
// regression can't return.
//
// Supported sets (OpenAI docs, 2026-06; same constraint on the codex CLI
// binary that proxies the underlying API):
//   gpt-5 / -mini / -nano (-2025-08-07)  low, medium, high
//   gpt-5.1                              none, low, medium, high
//   gpt-5.2 / 5.4 / 5.5                  none, low, medium, high, xhigh
//   gpt-5-codex / 5.1-codex              low, medium, high
//   gpt-5.2-codex / 5.4-codex / 5.5-codex low, medium, high, xhigh
//   gpt-5.3-codex / 5.3-codex-spark      low, medium, high

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCodexReasoningEffort } from '../../../dist-electron/electron/services/CodexCliService.js';

// The valid effort set per model — used to assert our pick is actually
// accepted by the codex CLI binary. The values that are NOT in the valid
// set must be downgraded by the resolver to the lowest-latency valid value
// (first entry of the valid array).
const VALID = {
    'gpt-5':               ['low', 'medium', 'high'],
    'gpt-5-mini':          ['low', 'medium', 'high'],
    'gpt-5-nano':          ['low', 'medium', 'high'],
    'gpt-5-2025-08-07':    ['low', 'medium', 'high'],
    'gpt-5.1':             ['none', 'low', 'medium', 'high'],
    'gpt-5.2':             ['none', 'low', 'medium', 'high', 'xhigh'],
    'gpt-5.4':             ['none', 'low', 'medium', 'high', 'xhigh'],
    'gpt-5.5':             ['none', 'low', 'medium', 'high', 'xhigh'],
    'gpt-5-codex':         ['low', 'medium', 'high'],
    'gpt-5.1-codex':       ['low', 'medium', 'high'],
    'gpt-5.2-codex':       ['low', 'medium', 'high', 'xhigh'],
    'gpt-5.3-codex':       ['low', 'medium', 'high'],
    'gpt-5.3-codex-spark': ['low', 'medium', 'high'],
    'gpt-5.4-codex':       ['low', 'medium', 'high', 'xhigh'],
    'gpt-5.5-codex':       ['low', 'medium', 'high', 'xhigh'],
};

describe('resolveCodexReasoningEffort — picks a VALID effort per family (no 400 from codex CLI)', () => {
    for (const [model, valid] of Object.entries(VALID)) {
        test(`${model}: every pick from the union is downgraded to a valid value`, () => {
            for (const pick of ['none', 'low', 'medium', 'high', 'xhigh']) {
                const result = resolveCodexReasoningEffort(model, pick);
                if (result !== undefined) {
                    assert.ok(
                        valid.includes(result),
                        `${model} pick='${pick}' → resolved='${result}', not in valid set [${valid.join(', ')}] → codex CLI 400`,
                    );
                }
            }
        });
    }

    test('gpt-5.4 with pick="xhigh" → accepted (in valid set)', () => {
        assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'xhigh'), 'xhigh');
    });

    test('gpt-5.4 with pick="none" → accepted (in valid set)', () => {
        assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'none'), 'none');
    });

    test('gpt-5.3-codex with pick="xhigh" → downgraded to lowest valid (low)', () => {
        // gpt-5.3-codex does NOT support xhigh per OpenAI docs. The resolver
        // must downgrade to the highest-valid entry so the codex CLI binary
        // doesn't reject the turn. We pick the FIRST entry of the valid set
        // (lowest-latency), which is 'low' for gpt-5.3-codex.
        assert.equal(resolveCodexReasoningEffort('gpt-5.3-codex', 'xhigh'), 'low');
    });

    test('gpt-5.3-codex with pick="none" → downgraded to lowest-latency valid (low)', () => {
        assert.equal(resolveCodexReasoningEffort('gpt-5.3-codex', 'none'), 'low');
    });

    test('gpt-5-codex with pick="xhigh" → downgraded to lowest-latency valid (low)', () => {
        assert.equal(resolveCodexReasoningEffort('gpt-5-codex', 'xhigh'), 'low');
    });

    test('gpt-5-codex with pick="none" → downgraded (none not supported)', () => {
        assert.equal(resolveCodexReasoningEffort('gpt-5-codex', 'none'), 'low');
    });

    test('gpt-5.1 with pick="xhigh" → downgraded (xhigh not supported on 5.1)', () => {
        assert.equal(resolveCodexReasoningEffort('gpt-5.1', 'xhigh'), 'low');
    });

    test('original gpt-5 line keeps low/medium/high (no none)', () => {
        for (const m of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano']) {
            assert.equal(resolveCodexReasoningEffort(m, 'low'), 'low');
            assert.equal(resolveCodexReasoningEffort(m, 'medium'), 'medium');
            assert.equal(resolveCodexReasoningEffort(m, 'high'), 'high');
            assert.equal(resolveCodexReasoningEffort(m, 'none'), 'low'); // none → low
        }
    });

    test('undefined pick → undefined result (omits the -c flag entirely)', () => {
        for (const m of Object.keys(VALID)) {
            assert.equal(resolveCodexReasoningEffort(m, undefined), undefined);
        }
    });

    test('null/empty pick → undefined result (omits the -c flag entirely)', () => {
        assert.equal(resolveCodexReasoningEffort('gpt-5.4', null), undefined);
        assert.equal(resolveCodexReasoningEffort('gpt-5.4', ''), undefined);
    });

    test('is case-insensitive (model id only — picks must match the union exactly)', () => {
        assert.equal(resolveCodexReasoningEffort('GPT-5.4', 'xhigh'), 'xhigh');
        assert.equal(resolveCodexReasoningEffort('Gpt-5-Codex', 'medium'), 'medium');
        assert.equal(resolveCodexReasoningEffort('GPT-5.3-CODEX', 'high'), 'high');
    });

    test('longest match wins: gpt-5.4-codex picks xhigh over generic gpt-5', () => {
        // gpt-5.4-codex accepts xhigh; generic gpt-5 does not.
        assert.equal(resolveCodexReasoningEffort('gpt-5.4-codex', 'xhigh'), 'xhigh');
        // gpt-5.4 (chat) also accepts xhigh.
        assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'xhigh'), 'xhigh');
    });

    test('unknown model id falls back to conservative [low, medium, high] set', () => {
        // For an unknown model we don't know what the binary accepts, so we
        // conservatively omit the flag. The resolver returns the first entry
        // of the fallback set (low) when a pick is provided.
        assert.equal(resolveCodexReasoningEffort('some-future-model-2027', 'xhigh'), 'low');
        assert.equal(resolveCodexReasoningEffort('some-future-model-2027', 'low'), 'low');
    });

    test('5.5 series uses xhigh when valid (gpt-5.5)', () => {
        assert.equal(resolveCodexReasoningEffort('gpt-5.5', 'xhigh'), 'xhigh');
        assert.equal(resolveCodexReasoningEffort('gpt-5.5-codex', 'xhigh'), 'xhigh');
    });
});
