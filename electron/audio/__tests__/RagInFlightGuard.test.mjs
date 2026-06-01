// Regression test for: processCompletedMeetingForRAG must guard against
// concurrent invocations for the same meetingId.
//
// Bug: processCompletedMeetingForRAG(meetingId) could be called twice in rapid
// succession (e.g. recovery retry + normal completion, or back-to-back
// endMeeting calls) before the first invocation completed. Each call
// re-reads the transcript, re-chunks, and re-queues embeddings —
// duplicating ~100ms-2s of work and racing the SQLite INSERT-OR-IGNORE
// dedupe.
//
// Fix: AppState now holds `private _ragProcessingInFlight: Set<string>`.
// processCompletedMeetingForRAG short-circuits if the id is already in the
// set, adds the id at the top of the body (before the try {), and removes
// it in the finally clause.
//
// Strategy: source-level static check on electron/main.ts, identical to the
// MicRecoveryUsesCanonicalWiring regression test. main.ts is 5000+ lines and
// instantiates DB/IPC/intelligence on import, so we cannot import the class.
// Brace-balancing extraction scopes the assertions to the
// processCompletedMeetingForRAG method body only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainTsPath = path.resolve(__dirname, '../../../electron/main.ts');

const source = readFileSync(mainTsPath, 'utf8');

// Extract a method body by brace-balancing. Accepts return types containing
// generics (e.g. `Promise<void>`), `async` modifiers, and trailing whitespace.
function extractMethodBody(src, methodName) {
    const sigRe = new RegExp(
        `(?:private|public|protected)?\\s*(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*:\\s*[\\w<>,\\s|]+\\s*\\{`,
    );
    const m = sigRe.exec(src);
    assert.ok(m, `could not locate ${methodName} signature in main.ts`);
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
    return src.slice(start, i - 1);
}

// Extract the final `finally { ... }` block within a method body using the
// same brace-balancing approach. Returns the body of the finally block.
function extractFinallyBlock(body) {
    const finallyRe = /\bfinally\s*\{/g;
    let match;
    let lastBody = null;
    while ((match = finallyRe.exec(body)) !== null) {
        let i = match.index + match[0].length;
        let depth = 1;
        const start = i;
        while (i < body.length && depth > 0) {
            const ch = body[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            i++;
        }
        if (depth === 0) lastBody = body.slice(start, i - 1);
    }
    return lastBody;
}

const ragBody = extractMethodBody(source, 'processCompletedMeetingForRAG');

test('AppState declares private _ragProcessingInFlight: Set<string> field', () => {
    // The field declaration lives at class scope, not inside the method body,
    // so search the full source.
    assert.ok(
        /private\s+_ragProcessingInFlight\s*:\s*Set<string>/.test(source),
        'BUG: AppState must declare `private _ragProcessingInFlight: Set<string>` to ' +
        'track in-flight RAG processing per meetingId. Without this field, ' +
        'concurrent processCompletedMeetingForRAG calls duplicate embedding work.',
    );
});

test('processCompletedMeetingForRAG short-circuits when id is already in flight', () => {
    assert.ok(
        ragBody.includes('this._ragProcessingInFlight.has('),
        'BUG: processCompletedMeetingForRAG must early-return via ' +
        '`this._ragProcessingInFlight.has(meetingId)` to skip duplicate work. ' +
        'Without this check, rapid stop→start→stop cycles re-chunk and re-embed ' +
        'the same transcript.',
    );
});

test('processCompletedMeetingForRAG adds meetingId to the set BEFORE the try block', () => {
    const addIdx = ragBody.indexOf('this._ragProcessingInFlight.add(');
    assert.ok(
        addIdx >= 0,
        'BUG: processCompletedMeetingForRAG must record the in-flight meetingId ' +
        'via `this._ragProcessingInFlight.add(meetingId)`.',
    );
    // Find the FIRST `try {` in the body (the one wrapping the embedding work).
    const tryRe = /\btry\s*\{/;
    const tryMatch = tryRe.exec(ragBody);
    assert.ok(tryMatch, 'expected a try { block inside processCompletedMeetingForRAG');
    assert.ok(
        addIdx < tryMatch.index,
        'BUG: `this._ragProcessingInFlight.add(...)` must run BEFORE the try block. ' +
        'If it runs inside try{}, an early throw before .add() leaves the guard ' +
        'unset; if it runs after the work, the guard provides no concurrency protection.',
    );
});

test('finally clause deletes meetingId from the in-flight set', () => {
    const finallyBody = extractFinallyBlock(ragBody);
    assert.ok(
        finallyBody !== null,
        'BUG: processCompletedMeetingForRAG must have a finally { ... } block ' +
        'that releases the in-flight guard, otherwise a thrown error would leave ' +
        'the meetingId stuck in the set and permanently block reprocessing.',
    );
    assert.ok(
        finallyBody.includes('this._ragProcessingInFlight.delete('),
        'BUG: the finally clause must call ' +
        '`this._ragProcessingInFlight.delete(meetingId)` so the guard releases ' +
        'on both success and failure paths.',
    );
});

test('duplicate-skip log message is present for observability', () => {
    assert.ok(
        ragBody.includes('already in flight') && ragBody.includes('skipping duplicate'),
        'BUG: the in-flight short-circuit must log "already in flight — skipping ' +
        'duplicate" (or contain both phrases). Without this log, silent dedupe ' +
        'masks any future regression in the calling code.',
    );
});
