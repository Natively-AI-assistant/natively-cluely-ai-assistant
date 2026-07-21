// Regression test for: mic recovery handler must use canonical wireMicCapture
// instead of hand-rolled data/sample_rate_changed/speech_ended wiring.
//
// Bug: setupMicRecoveryHandler in electron/main.ts used to hand-roll the new
// MicrophoneCapture instance's wiring after a recovery error, omitting the
// stuck-watchdog and zero-fill detector that wireMicCapture provides. After
// a mic recovery the user could silently get zero-filled audio with no UI
// signal — exactly the failure mode the watchdog was built to surface.
//
// Fix: replaced hand-rolled wiring with
//   this.wireMicCapture(this.microphoneCapture, '(Recovery)');
//
// Strategy: source-level static check on electron/main.ts. If anyone
// re-introduces the hand-rolled pattern inside setupMicRecoveryHandler,
// this test fails. Much more practical than driving the 5000+ line
// main.ts module (which instantiates DB, IPC, intelligence engine, etc.
// on import).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainTsPath = path.resolve(__dirname, '../../../electron/main.ts');

const source = readFileSync(mainTsPath, 'utf8');

// Extract the setupMicRecoveryHandler method body so we only assert on the
// recovery handler's wiring, not unrelated callsites elsewhere in the file.
function extractMethodBody(src, methodName) {
    const sigRe = new RegExp(`private\\s+${methodName}\\s*\\([^)]*\\)\\s*:\\s*\\w+\\s*\\{`);
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

const recoveryBody = extractMethodBody(source, 'setupMicRecoveryHandler');

test('setupMicRecoveryHandler uses canonical wireMicCapture with (Recovery) tag', () => {
    assert.ok(
        recoveryBody.includes(`this.wireMicCapture(this.microphoneCapture, '(Recovery)')`),
        `BUG: setupMicRecoveryHandler must delegate wiring to wireMicCapture(this.microphoneCapture, '(Recovery)'). ` +
        `Without this, the post-recovery MicrophoneCapture instance is missing the stuck-watchdog and zero-fill ` +
        `detector, so silent/zero-filled audio after a mic recovery goes undetected.`,
    );
});

test('setupMicRecoveryHandler does NOT hand-roll data/sample_rate_changed/speech_ended wiring', () => {
    const forbiddenPatterns = [
        `this.microphoneCapture.on('data'`,
        `this.microphoneCapture.on('sample_rate_changed'`,
        `this.microphoneCapture.on('speech_ended'`,
    ];
    for (const pat of forbiddenPatterns) {
        assert.ok(
            !recoveryBody.includes(pat),
            `BUG: setupMicRecoveryHandler contains hand-rolled wiring "${pat}". ` +
            `This is the exact regression: hand-rolled wiring drifts from wireMicCapture and ` +
            `omits the stuck-watchdog/zero-fill detector. Use this.wireMicCapture(...) instead.`,
        );
    }
});

test('setupMicRecoveryHandler still constructs a fresh MicrophoneCapture before wiring', () => {
    // Sanity check: the recovery path must actually recreate the capture, otherwise
    // wireMicCapture would re-wire a torn-down instance.
    assert.ok(
        /this\.microphoneCapture\s*=\s*new\s+MicrophoneCapture\s*\(/.test(recoveryBody),
        'recovery handler must instantiate a new MicrophoneCapture before wiring it',
    );
    // And the wireMicCapture call must come AFTER the new MicrophoneCapture(...) line.
    const newIdx = recoveryBody.search(/this\.microphoneCapture\s*=\s*new\s+MicrophoneCapture\s*\(/);
    const wireIdx = recoveryBody.indexOf(`this.wireMicCapture(this.microphoneCapture, '(Recovery)')`);
    assert.ok(newIdx >= 0 && wireIdx > newIdx, 'wireMicCapture must be called after the fresh MicrophoneCapture is constructed');
});
