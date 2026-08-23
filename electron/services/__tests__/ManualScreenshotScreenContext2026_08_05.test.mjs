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
    assert.doesNotMatch(source, /hasScreenContext: Boolean\(options\?\.screenContext\),/,
      'the OCR-only guard must be widened to cover imagePaths');
    assert.match(source, /hasScreenContext: Boolean\(options\?\.screenContext\) \|\| \(imagePaths\?\.length \?\? 0\) > 0,/,
      'hasScreenContext must be true when manual screenshots ride in imagePaths');
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
