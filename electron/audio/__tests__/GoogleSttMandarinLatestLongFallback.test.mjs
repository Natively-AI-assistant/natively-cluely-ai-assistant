// Regression test for the "Google STT never transcribes when the language
// is set to Chinese" bug.
//
// Symptom: selecting Chinese in Settings maps to bcp47 'zh-CN'
// (RECOGNITION_LANGUAGES in electron/config/languages.ts), which GoogleSTT
// forwarded verbatim as languageCode while hardcoding model: 'latest_long'.
// Google STT v1 accepts Mandarin only as 'cmn-Hans-CN', and latest_long does
// not cover Mandarin at all — the very first streamingRecognize request
// failed with INVALID_ARGUMENT (gRPC code 3), which PERMANENT_GRPC_CODES
// escalated to a session-wide STT shutdown ("disabling STT for this
// session"). English worked because en-US + latest_long is a valid pair.
//
// Fix: GoogleSTT translates zh-* tags to their cmn-* equivalents at
// setRecognitionLanguage() time (Google-local — other providers still need
// 'zh-CN'), and startStream() falls back to the 'default' model for
// languages latest_long does not support.
//
// Strategy: structural assertion against GoogleSTT.ts source, matching
// GoogleSttPendingLanguageChangeCleared.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gPath = path.resolve(__dirname, '../../../electron/audio/GoogleSTT.ts');
const gSource = readFileSync(gPath, 'utf8');

function extractMethodBody(methodName) {
  const re = new RegExp(`(?:^|\\n)\\s*(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(gSource);
  assert.ok(m, `could not locate ${methodName} declaration in GoogleSTT.ts`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < gSource.length && depth > 0) {
    const ch = gSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return gSource.slice(start, i - 1);
}

test('zh-CN is translated to cmn-Hans-CN for Google v1', () => {
  assert.ok(
    /'zh-CN'\s*:\s*'cmn-Hans-CN'/.test(gSource),
    "BUG: V1_LANGUAGE_CODE_OVERRIDES must map 'zh-CN' -> 'cmn-Hans-CN'. Google STT v1 does not list zh-CN as a language code; sending it fails the stream with INVALID_ARGUMENT.",
  );
  const setLangBody = extractMethodBody('setRecognitionLanguage');
  assert.ok(
    /V1_LANGUAGE_CODE_OVERRIDES\s*\[\s*config\.bcp47\s*\]\s*\?\?\s*config\.bcp47/.test(setLangBody),
    'BUG: setRecognitionLanguage() must apply V1_LANGUAGE_CODE_OVERRIDES to config.bcp47 before assigning this.languageCode — otherwise the shared zh-CN tag reaches the Google API verbatim.',
  );
});

test('startStream() falls back from latest_long for unsupported languages', () => {
  const startStreamBody = extractMethodBody('startStream');
  assert.ok(
    !/model\s*:\s*'latest_long'\s*,/.test(startStreamBody),
    "BUG: startStream() must not hardcode model: 'latest_long' — Mandarin (cmn-Hans-CN) only supports the 'default' and 'command_and_search' models in STT v1, and an unsupported model+language pair is a permanent gRPC code-3 error that disables STT for the whole session.",
  );
  assert.ok(
    /LANGUAGES_WITHOUT_LATEST_LONG\.has\s*\(\s*this\.languageCode\s*\)/.test(startStreamBody),
    'BUG: startStream() must consult LANGUAGES_WITHOUT_LATEST_LONG to pick the model per language.',
  );
  assert.ok(
    /'cmn-Hans-CN'/.test(gSource) && /LANGUAGES_WITHOUT_LATEST_LONG\s*=\s*new Set\(/.test(gSource),
    'sanity: LANGUAGES_WITHOUT_LATEST_LONG must exist and cover cmn-Hans-CN.',
  );
});
