// Regression test for the "What to Answer sends previous answer" bug.
//
// Symptom: user manually pressed the "What to Say" button. The expected behavior
// is a fresh answer for the current question. The observed behavior was that
// the engine sometimes surfaced a stale speculativeText draft from an earlier
// question — the Jaccard-similarity gate in handleSuggestionTrigger was
// inadvertently matching a previous question's draft against a new manual
// press, and the manual path was inheriting the stale cache state.
//
// Fix:
//   1. IntelligenceEngine.runWhatShouldISay now accepts a `forceFresh` option.
//      When true (and the call is NOT speculative), it clears speculativeText
//      and speculativeTextExpiry before any other work, so the Jaccard gate
//      never sees a stale value.
//   2. The IPC handler `generate-what-to-say` always passes forceFresh: true.
//      The user explicitly pressed the button — they want a fresh answer.
//   3. IntelligenceManager.runWhatShouldISay forwards forceFresh to the engine.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineSrc = readFileSync(
  path.resolve(__dirname, '../../IntelligenceEngine.ts'),
  'utf-8',
);
const ipcSrc = readFileSync(
  path.resolve(__dirname, '../../ipcHandlers.ts'),
  'utf-8',
);
const mgrSrc = readFileSync(
  path.resolve(__dirname, '../../IntelligenceManager.ts'),
  'utf-8',
);

describe('source: engine honors forceFresh option', () => {
  test('runWhatShouldISay options type includes forceFresh', () => {
    // The fix added a new option. Pin the type signature so a future refactor
    // that drops the option is caught.
    const sigMatch = engineSrc.match(
      /runWhatShouldISay\(\s*question\??:\s*string[^)]*\)\s*:\s*Promise<string\s*\|\s*null>\s*\{/,
    );
    assert.ok(sigMatch, 'runWhatShouldISay method must be locatable');
    // Locate the signature, then walk the options type with a balanced-brace
    // counter so nested object literals (e.g. activeSkill?: { id, name, … })
    // don't fool the regex. The simpler `[^}]*` pattern breaks on the first
    // nested close-brace.
    const sigStart = sigMatch.index;
    const optsStart = engineSrc.indexOf('options?:', sigStart);
    assert.ok(optsStart >= 0, 'options?: must appear after the runWhatShouldISay signature');
    // Walk from the opening `{` after `options?:` until its matching close.
    const openBrace = engineSrc.indexOf('{', optsStart);
    assert.ok(openBrace >= 0, 'options type must open with `{`');
    let depth = 1;
    let i = openBrace + 1;
    while (i < engineSrc.length && depth > 0) {
      const ch = engineSrc[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    const optsType = engineSrc.slice(openBrace, i);
    assert.match(
      optsType,
      /forceFresh\??:\s*boolean/,
      'runWhatShouldISay options type must include forceFresh?: boolean — otherwise the manual button press has no way to opt out of the speculative cache',
    );
  });

  test('runWhatShouldISay clears speculativeText when forceFresh && !isSpeculative', () => {
    // The fix: at the start of the method, when forceFresh is true and the
    // call is NOT speculative, reset speculativeText and speculativeTextExpiry.
    const methodBody = extractMethodBody(engineSrc, 'runWhatShouldISay');
    assert.ok(methodBody, 'runWhatShouldISay method body must be locatable');
    assert.match(
      methodBody,
      /if\s*\(\s*forceFresh\s*&&\s*!isSpeculative\s*\)\s*\{/,
      'forceFresh guard block must exist in runWhatShouldISay — the bug is the absence of this defensive clear',
    );
    assert.match(
      methodBody,
      /this\.speculativeText\s*=\s*null/,
      'forceFresh branch must set speculativeText = null (not "the new question" — that would defeat the clear)',
    );
    assert.match(
      methodBody,
      /this\.speculativeTextExpiry\s*=\s*Infinity/,
      'forceFresh branch must reset speculativeTextExpiry to Infinity (so the Jaccard gate never sees a stale expiry)',
    );
  });
});

describe('source: IPC handler always passes forceFresh on manual press', () => {
  test('generate-what-to-say handler passes forceFresh: true', () => {
    // The "What to Say" handler MUST mark forceFresh — the user pressed a
    // button, they want a fresh answer. Without this flag the Jaccard gate
    // can match a previous question's speculative draft.
    const handlerBody = extractSafeHandleBody(ipcSrc, 'generate-what-to-say');
    assert.ok(handlerBody, 'generate-what-to-say handler must be locatable in ipcHandlers.ts');
    assert.match(
      handlerBody,
      /forceFresh\s*:\s*true/,
      'generate-what-to-say handler must pass forceFresh: true in the options sent to runWhatShouldISay',
    );
  });
});

describe('source: IntelligenceManager forwards forceFresh', () => {
  test('IntelligenceManager.runWhatShouldISay type includes forceFresh and forwards it', () => {
    // Without forwarding, the IPC handler's forceFresh is silently dropped.
    const sigMatch = mgrSrc.match(
      /runWhatShouldISay\s*\(/,
    );
    assert.ok(sigMatch, 'IntelligenceManager.runWhatShouldISay must be locatable');
    // Walk the parameter list with a paren-depth counter.
    const openParen = mgrSrc.indexOf('(', sigMatch.index);
    let depth = 1;
    let i = openParen + 1;
    while (i < mgrSrc.length && depth > 0) {
      const ch = mgrSrc[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    const paramsAndReturn = mgrSrc.slice(openParen, i);
    assert.match(
      paramsAndReturn,
      /forceFresh\??:\s*boolean/,
      'IntelligenceManager.runWhatShouldISay signature must include forceFresh?: boolean',
    );
    // Forwarding: the body must call engine.runWhatShouldISay with the
    // full options object intact.
    const methodBody = extractMethodBody(mgrSrc, 'runWhatShouldISay');
    assert.ok(methodBody, 'IntelligenceManager.runWhatShouldISay body must be locatable');
    assert.match(
      methodBody,
      /this\.engine\.runWhatShouldISay\s*\(\s*question\s*,\s*confidence\s*,\s*imagePaths\s*,\s*options\s*\)/,
      'IntelligenceManager.runWhatShouldISay must forward the full options object (including forceFresh) to the engine',
    );
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Locate a method/function with the given name and return its body.
 * Scans line by line for a method definition (starts with optional
 * access modifier / `async` followed by the method name), then walks
 * the parameter list and body with balanced-brace counters.
 */
function extractMethodBody(source, methodName) {
  const lines = source.split('\n');
  const sigRegex = new RegExp(
    `^\\s*(?:public\\s+|private\\s+|protected\\s+|async\\s+)*${methodName}\\s*\\(`,
  );
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    if (!sigRegex.test(lines[lineIdx])) continue;
    const offset = lines.slice(0, lineIdx).join('\n').length + (lineIdx > 0 ? 1 : 0);
    let i = offset;
    const parenStart = source.indexOf('(', i);
    if (parenStart < 0) continue;
    let depth = 1;
    i = parenStart + 1;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    if (depth !== 0) continue;
    while (i < source.length && source[i] !== '{') i++;
    if (i >= source.length) continue;
    i++;
    depth = 1;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth !== 0) continue;
    return source.slice(start, i - 1);
  }
  return null;
}

/**
 * Locate the body of an IPC handler registered with `safeHandle('channel', ...)`.
 * The arrow function body opens with `{` immediately after the `=>`.
 */
function extractSafeHandleBody(source, channel) {
  const re = new RegExp(
    `safeHandle\\(\\s*['"]${channel.replace(/[-]/g, '\\-')}['"]`,
  );
  const match = re.exec(source);
  if (!match) return null;
  const arrowIdx = source.indexOf('=>', match.index + match[0].length);
  if (arrowIdx < 0) return null;
  let i = arrowIdx + 2;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== '{') return null;
  i++;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return source.slice(start, i - 1);
}