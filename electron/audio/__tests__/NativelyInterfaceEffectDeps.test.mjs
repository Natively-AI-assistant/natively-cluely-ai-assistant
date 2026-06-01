// Regression test for: NativelyInterface.tsx mega-effect dep array must be []
//
// Bug: The large useEffect at ~L1434 in src/components/NativelyInterface.tsx
// — the one that registers ~20 IPC subscriptions including
// onNativeAudioConnected, onIntelligenceManualResult, onIntelligenceError,
// etc. — previously declared `[isExpanded]` as its dep array. Every expand
// or collapse toggle would therefore:
//   1. Run the cleanup forEach, removing all ~20 IPC listeners.
//   2. Re-run the effect body, re-registering all ~20 IPC listeners.
//
// Under React 18 strict mode this produced (a) listener leaks because the
// cleanup of the previous effect can run AFTER the next effect schedules,
// detaching the NEW listener; and (b) dropped IPC events that arrived in
// the teardown gap. Concrete symptoms: duplicate streaming tokens, double
// transcripts, stuck isProcessing, missed intelligence results.
//
// Fix: change `}, [isExpanded]);` to `}, []);` — the effect runs once at
// mount and tears down at unmount only. Any handler that needs the live
// expanded state already reads `isExpandedRef.current` (the ref is kept
// in sync by a separate effect).
//
// Strategy: source-level static check on NativelyInterface.tsx. Rendering
// this 4065-line component in RTL would require a massive IPC/electronAPI
// mock surface and would not actually validate the dep array semantics.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.resolve(
    __dirname,
    '../../../src/components/NativelyInterface.tsx',
);

const source = readFileSync(filePath, 'utf8');
const lines = source.split('\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Locate the mega-effect by its unique anchor: onNativeAudioConnected.
//    Walk backward from that line to find the enclosing `useEffect(() => {`.
// ─────────────────────────────────────────────────────────────────────────────
function findMegaEffect(srcLines) {
    let anchorLine = -1;
    for (let i = 0; i < srcLines.length; i++) {
        if (srcLines[i].includes('onNativeAudioConnected')) {
            anchorLine = i;
            break;
        }
    }
    assert.ok(
        anchorLine >= 0,
        'could not find onNativeAudioConnected anchor — has the IPC API renamed?',
    );

    // Walk backward to find the opening `useEffect(() => {`.
    let openLine = -1;
    for (let i = anchorLine; i >= 0; i--) {
        if (/useEffect\(\(\)\s*=>\s*\{/.test(srcLines[i])) {
            openLine = i;
            break;
        }
    }
    assert.ok(
        openLine >= 0,
        'could not find enclosing useEffect(() => { for the onNativeAudioConnected anchor',
    );

    // Brace-balance from the opening `{` of the arrow body forward to find
    // the matching close. The closing token is `}, deps);` on its own line.
    const openIdxInSrc = (() => {
        let abs = 0;
        for (let i = 0; i < openLine; i++) abs += srcLines[i].length + 1;
        const openMatch = /useEffect\(\(\)\s*=>\s*\{/.exec(srcLines[openLine]);
        return abs + openMatch.index + openMatch[0].length - 1; // index of `{`
    })();

    let depth = 0;
    let closeAbs = -1;
    for (let i = openIdxInSrc; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                closeAbs = i;
                break;
            }
        }
    }
    assert.ok(closeAbs > 0, 'unbalanced braces while scanning mega-effect body');

    // Convert closeAbs back to a line number.
    let closeLine = 0;
    let running = 0;
    for (let i = 0; i < srcLines.length; i++) {
        running += srcLines[i].length + 1;
        if (running > closeAbs) {
            closeLine = i;
            break;
        }
    }

    const body = source.slice(openIdxInSrc + 1, closeAbs);
    const closeStmt = srcLines[closeLine]; // line containing `}, deps);`

    return { openLine, closeLine, body, closeStmt };
}

const effect = findMegaEffect(lines);

test('mega-effect anchored on onNativeAudioConnected is the expected ~1434-1807 block', () => {
    // Sanity: this should be the largest useEffect in the file (>200 lines).
    const span = effect.closeLine - effect.openLine;
    assert.ok(
        span > 200,
        `expected mega-effect to span >200 lines, got ${span} (open=${effect.openLine + 1}, close=${effect.closeLine + 1}). ` +
        `Has the file been restructured? Update the test anchor.`,
    );
});

test('mega-effect dep array does not include expansion state', () => {
    const stripped = effect.closeStmt.trim();

    assert.ok(
        /^\},\s*\[[\s\S]*\]\s*\)\s*;/.test(stripped),
        `BUG REGRESSION: could not parse mega-effect dependency array. Found closing line:\n` +
        `  ${effect.closeStmt}\n` +
        `(line ${effect.closeLine + 1}).`,
    );

    assert.ok(
        !/\bisExpanded\b/.test(stripped),
        `BUG REGRESSION: mega-effect dep array contains isExpanded. This is the exact bug ` +
        `the fix removed. Stable callback deps are allowed, but expansion state must not ` +
        `tear down and re-register IPC listeners on every expand/collapse.`,
    );
});

test('mega-effect body does NOT read bare isExpanded (only isExpandedRef.current is OK)', () => {
    // Strip comments so example/explanatory mentions don't trip us.
    const stripComments = (s) =>
        s
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .map((line) => line.replace(/\/\/.*$/, ''))
            .join('\n');

    const code = stripComments(effect.body);

    // Find any `isExpanded` token that is NOT followed by `Ref` (i.e. not isExpandedRef).
    const bareRefs = [];
    const re = /\bisExpanded\b(?!Ref)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        // Capture a small context window for the error message.
        const start = Math.max(0, m.index - 40);
        const end = Math.min(code.length, m.index + 60);
        bareRefs.push(code.slice(start, end).replace(/\s+/g, ' ').trim());
    }

    assert.equal(
        bareRefs.length,
        0,
        `BUG HAZARD: mega-effect body reads bare \`isExpanded\` ${bareRefs.length} time(s). ` +
        `Because the effect is mount-only ([] deps), bare \`isExpanded\` captures the initial ` +
        `value and goes stale. Read \`isExpandedRef.current\` instead. Occurrences:\n  - ` +
        bareRefs.join('\n  - '),
    );
});
