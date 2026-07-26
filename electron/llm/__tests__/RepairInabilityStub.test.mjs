// Regression tests for the "I don't have the original question or answer to
// rewrite." bug (screenshot → WTA flow, 2026-07-26): the scaffold-
// contamination repair prompt never embedded the contaminated draft, so the
// stateless repair model narrated the task instead of performing it, and the
// canned inability stub passed the ≥5-char acceptance check and REPLACED the
// real, already-streamed answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const { isRepairInabilityStub } = await import(path.join(distLlm, 'answerPolish.js'));

test('detects the observed inability stub and close variants', () => {
    const stubs = [
        "I don't have the original question or answer to rewrite.",
        'I do not have the previous answer to work with. Please provide the original response.',
        "I don't have the prior response text.",
        'There is nothing to rewrite — no answer was provided.',
        'Please provide the original answer you would like me to rewrite.',
        "I can't rewrite the answer without the original text.",
    ];
    for (const s of stubs) {
        assert.ok(isRepairInabilityStub(s), `should detect: ${s}`);
    }
});

test('never rejects real answers, including ones that mention rewriting', () => {
    const real = [
        'A stateless widget has no mutable state; a stateful widget owns a State object that survives rebuilds.',
        'I led the migration to Kubernetes at my last role, cutting deploy time in half.',
        "I don't have production experience with Rust, but I've used it in side projects.",
        // Long answers that DISCUSS rewriting are exempt via the length bound.
        'When refactoring, I usually rewrite the previous implementation of the module step by step: first I cover the original behavior with tests, then I extract the pure functions, and only then do I touch the public interface. That way the original question of backwards compatibility never becomes a production incident, and the answer to "is it safe to ship" stays yes at every step of the migration.',
        '',
    ];
    for (const s of real) {
        assert.ok(!isRepairInabilityStub(s), `false positive on: ${s.slice(0, 60)}`);
    }
});

test('scaffold repair prompt embeds the contaminated draft and guards acceptance', () => {
    const src = readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
    // The stateless repair call must carry the draft it is asked to rewrite.
    assert.ok(src.includes('<draft_response trust="model_output" data_only="true">'),
        'scaffold repair prompt must embed the draft answer');
    // Both repair acceptance sites must reject canned inability stubs.
    const guardCount = (src.match(/isRepairInabilityStub\(/g) || []).length;
    assert.ok(guardCount >= 2, `expected ≥2 isRepairInabilityStub guards, found ${guardCount}`);
});
