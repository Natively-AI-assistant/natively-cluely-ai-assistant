// Regression test for PR #429 Bug 002: "screenshot attached but code not
// generated" — a manually-attached screenshot never set hasScreenContext, so
// the V3 turn classifier never added SCREEN_SPECIFIC / SCREEN_FACT and the
// screen was not treated as authoritative evidence.
//
// Two drop sites, one per surface:
//
//  1. WTA overlay (IntelligenceEngine.ts, buildV3Prompt input):
//     `hasScreenContext: Boolean(options?.screenContext)` — options.screenContext
//     is the periodic-capture OCR object; a manually-attached screenshot rides
//     in `imagePaths` with screenContext null, so the flag was always false.
//
//  2. Manual chat (ipcHandlers.ts, gemini-chat-stream buildV3Prompt call):
//     hasScreenContext was omitted entirely, defaulting to undefined/false
//     even when the user attached screenshots.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('Bug 002: manually attached screenshots set hasScreenContext', () => {
  test('WTA surface: hasScreenContext covers the imagePaths channel, not just periodic OCR', () => {
    const source = read('electron/IntelligenceEngine.ts');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // The OCR-only form is still forbidden — that was the bug.
    assert.doesNotMatch(code, /hasScreenContext: Boolean\(options\?\.screenContext\),/,
      'the OCR-only guard must be widened to cover imagePaths');

    // But the widened form is no longer written inline. It became the named
    // predicate _wtaHasVisualContext, which the engine also uses for its
    // no-context guard and the clarification bypass — one definition instead of
    // three subtly different ones. Pinning the old inline expression made this
    // test fail on a refactor that strictly IMPROVED what it guards (the
    // predicate adds browser-DOM capture as a third visual channel).
    //
    // So: assert the property. hasScreenContext must come from the predicate,
    // and the predicate must count imagePaths.
    assert.match(code, /hasScreenContext: _wtaHasVisualContext,/,
      'hasScreenContext must be derived from the shared visual-context predicate');
    const defn = code.match(/const _wtaHasVisualContext =([\s\S]{0,220}?);/);
    assert.ok(defn, '_wtaHasVisualContext is gone — hasScreenContext has no definition to check');
    assert.match(defn[1], /\(imagePaths\?\.length \?\? 0\) > 0/,
      'the predicate must count manually attached screenshots, which is the whole bug (#429 Bug 002)');
    assert.match(defn[1], /options\?\.screenContext/,
      'and must still count periodic OCR');
  });

  test('manual-chat surface: the gemini-chat-stream buildV3Prompt call passes hasScreenContext from imagePaths', () => {
    const source = read('electron/ipcHandlers.ts');
    // Scope the assertion to the manual-chat V3 composition block.
    const start = source.indexOf("surface: 'manual-chat'");
    assert.ok(start !== -1, 'manual-chat V3 composition must exist');
    const block = source.slice(start, start + 4000);
    assert.match(block, /hasScreenContext: \(imagePaths\?\.length \?\? 0\) > 0,/,
      'the manual-chat buildV3Prompt call must derive hasScreenContext from attached imagePaths');
  });
});
