// electron/llm/__tests__/GracefulRetry.test.mjs
//
// PI v3 (W6b): buildGracefulRetry replaces the single fixed "Could you repeat
// that?…" canned reply at the three live failure sites. Invariants:
//   1. Deterministic: same question → same output.
//   2. Topic-aware: a clear question yields a retry that names the topic.
//   3. Safe: never echoes comp/salary topics, never dumps long questions,
//      never fabricates an answer (it is always a retry/clarify line).
//   4. Variation: different questions can land different templates.
//   5. Wired: the three IntelligenceEngine sites + the WTA catch use it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');
const { buildGracefulRetry } = await import(pathToFileURL(path.join(distRoot, 'llm/manualProfileIntelligence.js')).href);

const engineSrc = readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
const wtaSrc = readFileSync(path.resolve(__dirname, '../WhatToAnswerLLM.ts'), 'utf8');

describe('W6b: buildGracefulRetry behavior', () => {
    test('deterministic — same input, same output', () => {
        const q = 'can you walk me through the database design?';
        assert.equal(buildGracefulRetry(q), buildGracefulRetry(q));
    });

    test('topic-aware for a clear question', () => {
        const out = buildGracefulRetry('can you walk me through the database design?');
        assert.match(out, /database design/i);
        assert.match(out, /\?$/, 'still a question (retry, not an answer)');
    });

    test('no hint → safe generic retry, never empty', () => {
        for (const q of [undefined, null, '', '   ', 'ok']) {
            const out = buildGracefulRetry(q);
            assert.ok(out.length > 20, `q=${JSON.stringify(q)} → "${out}"`);
            assert.match(out, /\?/);
        }
    });

    test('never echoes salary/comp topics back', () => {
        const out = buildGracefulRetry('what salary are you expecting for this role?');
        assert.doesNotMatch(out, /salary|compensation|pay/i);
    });

    test('never dumps very long questions', () => {
        const long = 'so tell me, considering everything we have discussed so far about the architecture and the team and the roadmap and the budget and the constraints, '.repeat(3);
        const out = buildGracefulRetry(long);
        assert.ok(out.length < 160, `len=${out.length}`);
    });

    test('phrasing varies across different questions', () => {
        const outs = new Set([
            buildGracefulRetry('tell me about the caching layer'),
            buildGracefulRetry('what do you think about microservices here'),
            buildGracefulRetry('how does the deployment pipeline work'),
            buildGracefulRetry('explain the indexing strategy'),
            buildGracefulRetry('walk me through the auth flow'),
        ]);
        assert.ok(outs.size >= 2, `all five collapsed to one phrasing: ${[...outs][0]}`);
    });
});

describe('W6b: wiring (source pins)', () => {
    test('the fixed canned line is gone from IntelligenceEngine', () => {
        assert.doesNotMatch(engineSrc, /return "Could you repeat that\?/);
        assert.doesNotMatch(engineSrc, /fullAnswer = "Could you repeat that\?/);
        assert.match(engineSrc, /buildGracefulRetry\(/);
    });

    test('WhatToAnswerLLM catch path uses buildGracefulRetry (provider-failure branch unchanged)', () => {
        assert.doesNotMatch(wtaSrc, /yield "Could you repeat that\?/);
        assert.match(wtaSrc, /buildGracefulRetry\(/);
        assert.match(wtaSrc, /API key or rate-limit issue/);
    });
});
