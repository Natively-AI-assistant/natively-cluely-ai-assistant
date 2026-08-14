// Regression test for UX1 fix (2026-05-28/29) in
// electron/main.ts.
//
// Pre-fix: at app startup, initializeApp's macOS TCC handler called
// systemPreferences.getMediaAccessStatus('screen') and surfaced a banner
// via appState.sendSystemAudioPermissionDenied(...) when screen-recording
// permission was 'denied'. The microphone permission was NOT checked at
// startup — returning users with a denied mic grant received NO feedback
// until they actually tried to start a meeting, at which point the
// ensureMacMicrophoneAccess path would finally surface the banner.
//
// Post-fix: a symmetric microphone permission check is performed AFTER the
// screen-recording check (still inside the `process.platform === 'darwin'`
// guard). It calls systemPreferences.getMediaAccessStatus('microphone')
// and emits appState.sendAudioCaptureFailed({ channel:'mic', terminal:true,
// ... }) for both 'denied' (using formatPermissionMessage('mic-denied'))
// and 'restricted' (with an admin-contact message). 'granted' and
// 'not-determined' do nothing — the latter is resolved later at first
// meeting start via ensureMacMicrophoneAccess. The whole mic check is
// wrapped in its own try/catch so it cannot break the outer screen check.
//
// Regression guarded: a future contributor removes the startup mic check,
// silently restoring the gap where returning users with denied mic
// permission don't see a banner until they try to start a meeting.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const source = fs.readFileSync(mainPath, 'utf8');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Skip strings/comments while walking braces so we don't get confused by
// template-literal braces or `{` inside comments.
function extractBracedBody(src, openBraceIdx) {
  assert.equal(src[openBraceIdx], '{', 'extractBracedBody expects pointer at opening brace');
  let depth = 0;
  let inString = null; // ', ", or `
  let inLineComment = false;
  let inBlockComment = false;
  let i = openBraceIdx;
  const bodyStart = openBraceIdx + 1;
  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(bodyStart, i);
      }
    }
  }
  throw new Error('extractBracedBody: unterminated brace at index ' + openBraceIdx);
}

// Find `async function initializeApp(...) {` and return the body.
function getInitializeAppBody() {
  const re = /async\s+function\s+initializeApp\s*\([^)]*\)\s*\{/g;
  const m = re.exec(source);
  assert.ok(m, 'could not locate `async function initializeApp(...) {` in electron/main.ts');
  // m.index + m[0].length - 1 points at the opening `{`.
  const openIdx = m.index + m[0].length - 1;
  return { body: extractBracedBody(source, openIdx), openIdx };
}

// Locate the darwin guard inside initializeApp that wraps the TCC startup
// handler (the one containing `getMediaAccessStatus('screen')`). Returns
// the body of THAT specific `if (process.platform === 'darwin') { ... }`.
function getStartupDarwinBlockBody(initBody) {
  const guardRe = /if\s*\(\s*process\.platform\s*===\s*['"]darwin['"]\s*\)\s*\{/g;
  let m;
  while ((m = guardRe.exec(initBody)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const block = extractBracedBody(initBody, openIdx);
    if (block.includes("getMediaAccessStatus('screen')") || block.includes('getMediaAccessStatus("screen")')) {
      return block;
    }
  }
  assert.fail('could not locate the startup darwin guard containing the screen TCC check');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UX1: startup mic permission banner (returning-user feedback)', () => {
  it('initializeApp function exists in electron/main.ts', () => {
    assert.match(
      source,
      /async\s+function\s+initializeApp\s*\(/,
      'BUG: `async function initializeApp(...)` not found in electron/main.ts — fix UX1 has no anchor.',
    );
  });

  it("initializeApp body contains a call to getMediaAccessStatus('microphone')", () => {
    const { body } = getInitializeAppBody();
    assert.match(
      body,
      /getMediaAccessStatus\(\s*['"]microphone['"]\s*\)/,
      "BUG: initializeApp must call systemPreferences.getMediaAccessStatus('microphone'). " +
        "Without it, returning users with denied mic permission get no startup banner (UX1 regression).",
    );
  });

  it("the mic check lives inside the existing `if (process.platform === 'darwin')` startup TCC block", () => {
    const { body } = getInitializeAppBody();
    const darwinBlock = getStartupDarwinBlockBody(body);
    assert.match(
      darwinBlock,
      /getMediaAccessStatus\(\s*['"]microphone['"]\s*\)/,
      "BUG: the mic permission check must be inside the same `if (process.platform === 'darwin')` " +
        "block that already houses the screen-recording startup check (UX1).",
    );
    // Negative: must NOT live inside a win32 (or other non-darwin) guard.
    // Scan all win32 guard blocks and assert none of them contain the mic check.
    const win32Re = /if\s*\(\s*process\.platform\s*===\s*['"]win32['"]\s*\)\s*\{/g;
    let m;
    while ((m = win32Re.exec(body)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const block = extractBracedBody(body, openIdx);
      assert.doesNotMatch(
        block,
        /getMediaAccessStatus\(\s*['"]microphone['"]\s*\)/,
        "BUG: startup mic permission check leaked into a `process.platform === 'win32'` block. " +
          "macOS TCC APIs (getMediaAccessStatus) are no-ops on Windows and the banner would never fire (UX1).",
      );
    }
  });

  it("the mic check emits sendAudioCaptureFailed with channel:'mic' AND terminal:true", () => {
    const { body } = getInitializeAppBody();
    const darwinBlock = getStartupDarwinBlockBody(body);
    // Slice the darwin block down to the part starting at the mic check so
    // we don't accidentally pick up an unrelated upstream sendAudioCaptureFailed.
    const micIdx = darwinBlock.search(/getMediaAccessStatus\(\s*['"]microphone['"]\s*\)/);
    assert.ok(micIdx >= 0, 'mic check not found inside darwin startup block');
    const afterMic = darwinBlock.slice(micIdx);

    // Match a sendAudioCaptureFailed({ ... }) object literal that includes
    // both channel:'mic' and terminal:true, in any order, across newlines.
    const callRe = /sendAudioCaptureFailed\s*\(\s*\{[\s\S]*?\}\s*\)/g;
    const calls = afterMic.match(callRe) ?? [];
    assert.ok(
      calls.length >= 1,
      "BUG: no sendAudioCaptureFailed({...}) call found after the startup mic check. " +
        "Without an emission, the banner can never appear at startup (UX1).",
    );
    const channelTerminalCalls = calls.filter((c) =>
      /channel\s*:\s*['"]mic['"]/.test(c) && /terminal\s*:\s*true/.test(c),
    );
    assert.ok(
      channelTerminalCalls.length >= 1,
      "BUG: startup mic check must call sendAudioCaptureFailed with `channel:'mic'` AND " +
        "`terminal:true` (so the banner persists until the user fixes the permission). UX1 regression.",
    );
  });

  it("the mic check handles BOTH 'denied' and 'restricted' statuses", () => {
    const { body } = getInitializeAppBody();
    const darwinBlock = getStartupDarwinBlockBody(body);
    const micIdx = darwinBlock.search(/getMediaAccessStatus\(\s*['"]microphone['"]\s*\)/);
    assert.ok(micIdx >= 0, 'mic check not found inside darwin startup block');
    // Take a generous window after the mic getMediaAccessStatus call.
    const window = darwinBlock.slice(micIdx, micIdx + 2000);
    assert.match(
      window,
      /['"]denied['"]/,
      "BUG: startup mic check must branch on the 'denied' status. " +
        "Otherwise returning users with denied mic permission see no banner (UX1).",
    );
    assert.match(
      window,
      /['"]restricted['"]/,
      "BUG: startup mic check must branch on the 'restricted' status (MDM/parental controls). " +
        "Without it, restricted users see a generic mic-init failure with no diagnostic context (UX1).",
    );
  });

  it("the 'denied' branch uses formatPermissionMessage('mic-denied')", () => {
    const { body } = getInitializeAppBody();
    const darwinBlock = getStartupDarwinBlockBody(body);
    const micIdx = darwinBlock.search(/getMediaAccessStatus\(\s*['"]microphone['"]\s*\)/);
    const window = darwinBlock.slice(micIdx, micIdx + 2000);
    assert.match(
      window,
      /formatPermissionMessage\(\s*['"]mic-denied['"]\s*\)/,
      "BUG: the denied-mic branch must use `formatPermissionMessage('mic-denied')` so the banner " +
        "text matches the rest of the app (single source of truth for permission messaging). UX1.",
    );
  });

  it('the mic check is wrapped in its own try/catch (independent of the outer screen-check try/catch)', () => {
    const { body } = getInitializeAppBody();
    const darwinBlock = getStartupDarwinBlockBody(body);
    const micIdx = darwinBlock.search(/getMediaAccessStatus\(\s*['"]microphone['"]\s*\)/);
    assert.ok(micIdx >= 0, 'mic check not found inside darwin startup block');

    // Find the nearest `try {` opening BEFORE the mic call, then extract its
    // body and assert the mic call is inside it AND that this `try` is NOT
    // the same outer try that contains `getMediaAccessStatus('screen')`.
    const tryRe = /try\s*\{/g;
    let lastTryBefore = -1;
    let m;
    while ((m = tryRe.exec(darwinBlock)) !== null) {
      if (m.index < micIdx) lastTryBefore = m.index + m[0].length - 1; // pointer at `{`
      else break;
    }
    assert.ok(
      lastTryBefore >= 0,
      "BUG: startup mic check is not wrapped in any `try { ... }`. A thrown error from " +
        "getMediaAccessStatus would propagate and break the outer screen-check flow (UX1).",
    );
    const tryBody = extractBracedBody(darwinBlock, lastTryBefore);
    assert.ok(
      tryBody.includes("getMediaAccessStatus('microphone')") ||
        tryBody.includes('getMediaAccessStatus("microphone")'),
      "BUG: the nearest `try` before the mic call does not actually enclose it.",
    );
    assert.ok(
      !tryBody.includes("getMediaAccessStatus('screen')") &&
        !tryBody.includes('getMediaAccessStatus("screen")'),
      "BUG: the mic check shares the SAME try/catch as the screen-recording check. " +
        "It must have its OWN try/catch so a mic-side throw cannot break the outer screen flow (UX1).",
    );
    // And the try must be followed by a `catch`.
    const afterTry = darwinBlock.slice(lastTryBefore);
    // Re-walk to find the matching `}` then check for `catch` after it.
    let depth = 0;
    let endIdx = -1;
    for (let i = 0; i < afterTry.length; i++) {
      const ch = afterTry[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    assert.ok(endIdx > 0, 'failed to find end of mic try-block');
    const tail = afterTry.slice(endIdx + 1, endIdx + 80);
    assert.match(
      tail,
      /^\s*catch\b/,
      "BUG: the mic check's `try` block is not followed by a `catch`. " +
        "An uncaught throw would surface as an unhandled rejection at startup (UX1).",
    );
  });

  it("NEGATIVE: the mic check is NOT nested inside an `else if (screenStatus === 'denied')` branch", () => {
    const { body } = getInitializeAppBody();
    const darwinBlock = getStartupDarwinBlockBody(body);

    // Walk every `else if (screenStatus === 'denied') {` block and assert
    // none of them contain the mic check — otherwise mic feedback would
    // only appear when screen was ALSO denied, defeating the purpose of
    // diagnosing mic and screen independently (UX1).
    const elseIfRe =
      /else\s+if\s*\(\s*screenStatus\s*===\s*['"]denied['"]\s*\)\s*\{|if\s*\(\s*screenStatus\s*===\s*['"]denied['"]\s*\)\s*\{/g;
    let m;
    while ((m = elseIfRe.exec(darwinBlock)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const block = extractBracedBody(darwinBlock, openIdx);
      assert.doesNotMatch(
        block,
        /getMediaAccessStatus\(\s*['"]microphone['"]\s*\)/,
        "BUG: startup mic check is nested inside an `if (screenStatus === 'denied')` branch. " +
          "It must be INDEPENDENT of the screen-recording status so users see a mic banner even " +
          "when screen-recording is granted (UX1).",
      );
    }
  });
});
