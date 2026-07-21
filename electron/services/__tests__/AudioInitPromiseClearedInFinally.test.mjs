import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../main.ts');
const source = fs.readFileSync(mainPath, 'utf8');

// ── Function isolation ──────────────────────────────────────────────────────
const startMeetingStart = source.indexOf('public async startMeeting');
const endMeetingStart = source.indexOf('public async endMeeting', startMeetingStart);
const ragStart = source.indexOf('private async processCompletedMeetingForRAG', endMeetingStart);

const startMeetingSource = source.slice(startMeetingStart, endMeetingStart);
const endMeetingSource = source.slice(endMeetingStart, ragStart);

// ── Balanced-brace body extractor ───────────────────────────────────────────
// Given a source string and an index that points at a '{', return the
// substring INSIDE that brace pair (excluding the outer braces). Tracks
// quotes minimally so we don't get tripped by `}` inside strings/comments
// at the depths we care about (the main.ts source uses standard formatting).
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

test('startMeeting exists and contains the audio-init IIFE pattern', () => {
  assert.ok(startMeetingStart >= 0, 'startMeeting should exist');
  assert.ok(endMeetingStart > startMeetingStart, 'endMeeting should follow startMeeting');
  assert.match(
    startMeetingSource,
    /this\._audioInitPromise\s*=\s*\(async\s*\(\)\s*=>\s*\{/,
    'startMeeting should contain the audio-init IIFE pattern'
  );
});

test('audio-init IIFE finally block clears the promise slot when this init still owns it', () => {
  // B9 invariant (pattern-independent): after the init body settles
  // (success, error, or abort), the promise slot must be nulled IF this
  // init body is still the active one. The "still active" check can be
  // implemented as either:
  //   (a) strict reference: `this._audioInitController === audioInitController`
  //   (b) generation match:  `this._meetingGeneration === meetingGeneration`
  // Both are semantically equivalent — what matters is that we DON'T clobber
  // a NEWER init that took over while this one was still draining cleanup.
  //
  // Pre-fix the slot was deliberately left non-null after init, with the
  // (incorrect) rationale that endMeeting's `await this._audioInitPromise`
  // would race. That rationale is wrong: `await promise` captures the
  // promise object at the await point, so clearing the property afterward
  // doesn't affect in-flight awaits.

  // 1. Locate the IIFE opening brace.
  const iifeAssignMatch = startMeetingSource.match(/this\._audioInitPromise\s*=\s*\(async\s*\(\)\s*=>\s*\{/);
  assert.ok(iifeAssignMatch, 'IIFE assignment regex must match');
  const iifeBraceIdx = iifeAssignMatch.index + iifeAssignMatch[0].length - 1;
  const iifeBody = extractBracedBody(startMeetingSource, iifeBraceIdx);

  // 2. Locate `finally {` within the IIFE body and extract its body.
  //    If the implementation uses a single-line gate (e.g. `if (gen) clear`)
  //    outside of an explicit finally block, also accept that — what matters
  //    is that the clear happens after the try/catch.
  const finallyMatch = iifeBody.match(/\}\s*finally\s*\{/);
  let trailingCleanupScope;
  if (finallyMatch) {
    const finallyOpenBraceIdx = finallyMatch.index + finallyMatch[0].length - 1;
    trailingCleanupScope = extractBracedBody(iifeBody, finallyOpenBraceIdx);
  } else {
    // No finally block — accept inline cleanup at IIFE tail.
    trailingCleanupScope = iifeBody;
  }

  // 3. Find the guarded clear. Accept either pattern (controller or generation).
  const controllerPattern =
    /if\s*\(\s*this\._audioInitController\s*===\s*audioInitController\s*\)[^]*?this\._audioInitPromise\s*=\s*null/;
  const generationPattern =
    /if\s*\(\s*this\._meetingGeneration\s*===\s*meetingGeneration\s*\)[^]*?this\._audioInitPromise\s*=\s*null/;

  const hasControllerClear = controllerPattern.test(trailingCleanupScope);
  const hasGenerationClear = generationPattern.test(trailingCleanupScope);

  assert.ok(
    hasControllerClear || hasGenerationClear,
    'B9 regression: the audio-init trailing cleanup must clear this._audioInitPromise ' +
      'when this init is still active. Expected either:\n' +
      '  (controller pattern) `if (this._audioInitController === audioInitController) { ... this._audioInitPromise = null; }`\n' +
      '  (generation pattern) `if (this._meetingGeneration === meetingGeneration) this._audioInitPromise = null;`\n' +
      'Found neither — the stale-promise hazard has been re-introduced.'
  );
});

test('B9 negative regression: stale "intentionally do NOT clear" rationale must be GONE', () => {
  // If a future contributor revives the old (incorrect) rationale that
  // warned against clearing _audioInitPromise in the finally block, this
  // assertion fails.
  assert.ok(
    !source.includes('intentionally do NOT clear'),
    'Pre-fix comment "intentionally do NOT clear" must not reappear in main.ts. ' +
      'The promise slot SHOULD be cleared in lockstep with the controller (see B9).'
  );
});

test('endMeeting either awaits in-flight init or relies on IIFE finally clear', () => {
  assert.ok(endMeetingStart >= 0, 'endMeeting should exist');
  assert.ok(ragStart > endMeetingStart, 'endMeeting source should be isolated');
  // Two valid patterns:
  //   (a) endMeeting explicitly awaits the in-flight init and clears the slot
  //       as defense-in-depth: `await this._audioInitPromise; this._audioInitPromise = null;`
  //   (b) endMeeting relies on the IIFE's own finally clear (the simpler
  //       pattern the codebase ended up using) — in that case endMeeting
  //       may not touch _audioInitPromise at all, which is fine because the
  //       IIFE clears it as soon as it settles.
  // The key invariant: there must be SOME path that nulls the slot. If
  // neither endMeeting clears it nor the IIFE finally clears it, the bug
  // is back. The IIFE finally clear is already asserted by the previous
  // test, so this test only loosely sanity-checks that endMeeting either
  // touches _audioInitPromise (awaits it or clears it) OR relies on the
  // IIFE-side clear (in which case the previous test guards us).
  const endMeetingTouchesInitPromise = /_audioInitPromise/.test(endMeetingSource);
  // Loose acceptance: if endMeeting doesn't reference the slot at all,
  // the previous test still proves the IIFE clears it, so we don't fail here.
  // The assertion below documents the codebase's chosen pattern for future
  // contributors.
  if (endMeetingTouchesInitPromise) {
    // Verify it's either an await or a clear, not some bizarre new pattern.
    assert.match(
      endMeetingSource,
      /(await\s+this\._audioInitPromise|this\._audioInitPromise\s*=\s*null)/,
      'If endMeeting references _audioInitPromise, it should either await it or clear it'
    );
  }
});
