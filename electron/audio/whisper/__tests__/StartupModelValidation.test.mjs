// Regression test for the "app crashes on startup" bug.
//
// Symptom: a corrupted/retired `localWhisperModel` setting (e.g. a modelId
// pointing to a fork the user no longer has, or a typo introduced by a
// settings migration) caused the whisper worker to crash on init. The
// preload path (and the per-meeting spin-up path) would throw and leave
// the user locked out of audio — the only recovery was to manually edit
// the settings JSON.
//
// Fix:
//   1. MODEL_CATALOG_IDS is exported from modelManager — a Set of every
//      modelId in the catalog. Callers can ask "is this persisted id valid?"
//      in O(1).
//   2. main.ts preload block validates the persisted localWhisperModel
//      against MODEL_CATALOG_IDS. If the id isn't in the catalog, log a
//      warning, overwrite with `Xenova/whisper-tiny.en` via
//      SettingsManager.set, and SKIP preload.
//   3. modelPreloader preloader now persists a recentFailures map to
//      userData so a bad modelId isn't retried on every app launch for
//      the next 5 minutes.
//   4. modelPreloader preloader validates workerPath with fs.existsSync
//      before new Worker(workerPath) — a missing path now logs a
//      structured error and returns instead of throwing.
//   5. modelManager catalog: distil-medium.en now declares
//      externalDataFormat (defensive — same pattern as distil-large-v*).
//   6. New IPC `local-whisper-reset-to-default` gives the user an in-app
//      recovery path. Clears the global + per-channel overrides to the
//      safe fallback and clears the recent-failure cooldown.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// modelManager + modelPreloader both pull in `electron` for getModelsDir() /
// app.getPath('userData'). Point userData at a fresh temp dir.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-startup-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (k) => (k === 'userData' ? userData : os.tmpdir()),
        isReady: () => true,
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const distRoot = path.resolve(__dirname, '../../../../dist-electron/electron/audio/whisper');
const modelMgrPath = path.join(distRoot, 'modelManager.js');

const { MODEL_CATALOG_IDS, getModelExternalDataFormat } = await import(
  pathToFileURL(modelMgrPath).href
);

const modelMgrSrc = readFileSync(
  path.resolve(__dirname, '../modelManager.ts'),
  'utf-8',
);
const modelPreloaderSrc = readFileSync(
  path.resolve(__dirname, '../modelPreloader.ts'),
  'utf-8',
);
const mainSrc = readFileSync(
  path.resolve(__dirname, '../../../../electron/main.ts'),
  'utf-8',
);
const ipcSrc = readFileSync(
  path.resolve(__dirname, '../../../../electron/ipcHandlers.ts'),
  'utf-8',
);

describe('catalog invariants', () => {
  test('MODEL_CATALOG_IDS is a Set containing every catalog entry', () => {
    assert.ok(MODEL_CATALOG_IDS instanceof Set, 'MODEL_CATALOG_IDS must be a Set');
    // The catalog array itself isn't exported, so we verify the Set's
    // membership by checking every id we know is in the catalog against
    // MODEL_CATALOG_IDS. If a future contributor drops an entry from the
    // catalog, the corresponding assertion below will fail.
    const expectedIds = [
      'onnx-community/moonshine-tiny-ONNX',
      'onnx-community/moonshine-base-ONNX',
      'distil-whisper/distil-small.en',
      'distil-whisper/distil-medium.en',
      'distil-whisper/distil-large-v3',
      'distil-whisper/distil-large-v2',
      'onnx-community/whisper-large-v3-turbo-ONNX',
      'Xenova/whisper-tiny.en',
      'Xenova/whisper-tiny',
      'Xenova/whisper-base.en',
      'Xenova/whisper-base',
      'Xenova/whisper-small.en',
      'Xenova/whisper-small',
      'Xenova/whisper-medium.en',
      'Xenova/whisper-medium',
    ];
    for (const id of expectedIds) {
      assert.ok(
        MODEL_CATALOG_IDS.has(id),
        `MODEL_CATALOG_IDS must include catalog entry "${id}"`,
      );
    }
  });

  test('MODEL_CATALOG_IDS contains the safe default Xenova/whisper-tiny.en', () => {
    // The fallback we use everywhere. Must always be present.
    assert.ok(
      MODEL_CATALOG_IDS.has('Xenova/whisper-tiny.en'),
      'safe default Xenova/whisper-tiny.en must be in the catalog',
    );
  });

  test('MODEL_CATALOG_IDS rejects unknown modelIds', () => {
    assert.equal(MODEL_CATALOG_IDS.has('not-a-real-model'), false);
    assert.equal(MODEL_CATALOG_IDS.has(''), false);
    assert.equal(MODEL_CATALOG_IDS.has('Xenova/whisper-tiny.enX'), false);
  });

  test('distil-medium.en declares externalDataFormat (defensive audit fix)', () => {
    // Per the fix spec: distil-medium.en may or may not self-declare in its
    // own config.json — recording the layout in the catalog forces
    // isModelCached to require the encoder_model.onnx_data companion,
    // avoiding the "stub downloads, ORT aborts at file_size" failure mode
    // that bit large-v3-turbo.
    const ext = getModelExternalDataFormat('distil-whisper/distil-medium.en');
    assert.ok(
      ext && typeof ext === 'object',
      'distil-whisper/distil-medium.en must declare externalDataFormat (object form)',
    );
    assert.ok(
      ext['encoder_model.onnx'] === true,
      'distil-medium.en externalDataFormat must include encoder_model.onnx: true',
    );
  });
});

describe('source: modelPreloader recent-failures + workerPath validation', () => {
  test('preload() checks fs.existsSync on workerPath before new Worker()', () => {
    // The fix: a missing/moved workerPath no longer throws a cryptic
    // "Worker not constructed"; it logs a structured error and returns.
    const preloadBody = extractMethodBody(modelPreloaderSrc, 'preload');
    assert.ok(preloadBody, 'preload method must be locatable');
    assert.match(
      preloadBody,
      /fs\.existsSync\(\s*workerPath\s*\)/,
      'preload must validate workerPath with fs.existsSync before new Worker()',
    );
    // The existsSync check must gate the new Worker call. Walk the body and
    // confirm fs.existsSync appears BEFORE new Worker.
    const existsIdx = preloadBody.search(/fs\.existsSync\(\s*workerPath\s*\)/);
    const newWorkerIdx = preloadBody.search(/new\s+Worker\(\s*workerPath\s*\)/);
    assert.ok(existsIdx >= 0, 'fs.existsSync(workerPath) must be present');
    assert.ok(newWorkerIdx >= 0, 'new Worker(workerPath) must be present');
    assert.ok(
      existsIdx < newWorkerIdx,
      'fs.existsSync check must run BEFORE new Worker() (so a missing path doesn\'t throw)',
    );
  });

  test('preload() short-circuits when modelId is in the recent-failures cooldown', () => {
    // The fix: persist a recentFailures map (modelId -> expiry epoch ms) so
    // a bad modelId isn't retried on every preload call. TTL is 5 minutes.
    const preloadBody = extractMethodBody(modelPreloaderSrc, 'preload');
    assert.ok(preloadBody, 'preload method must be locatable');
    assert.match(
      preloadBody,
      /recentFailures/,
      'preload must consult the recentFailures map before spawning a worker',
    );
    assert.match(
      preloadBody,
      /failureExpiry\s*>\s*Date\.now\(\)/,
      'preload must compare the cooldown expiry against Date.now() to decide whether to skip',
    );
    // And the skip path must return without spawning a worker. The skip
    // block has arbitrary indent (the implementation uses 8-space indent
    // inside a 4-space method body), so we walk braces rather than
    // relying on a fixed indent count.
    const skipOpenIdx = preloadBody.indexOf('if (failureExpiry');
    assert.ok(skipOpenIdx >= 0, 'recent-failures if guard must exist');
    const skipBraceStart = preloadBody.indexOf('{', skipOpenIdx);
    assert.ok(skipBraceStart >= 0, 'recent-failures if guard must open a block');
    let d = 1;
    let j = skipBraceStart + 1;
    while (j < preloadBody.length && d > 0) {
      const ch = preloadBody[j];
      if (ch === '{') d++;
      else if (ch === '}') d--;
      j++;
    }
    assert.equal(d, 0, 'recent-failures if block must have a matching close brace');
    const skipBody = preloadBody.slice(skipBraceStart + 1, j - 1);
    assert.match(
      skipBody,
      /return\s*;?/,
      'recent-failures skip block must return (or otherwise exit) so a bad id is not retried',
    );
  });

  test('recent-failures map is persisted to userData (survives restarts)', () => {
    // TTL is short (5 min) but app restarts within that window would
    // otherwise re-trigger the crash. Persist the map.
    assert.match(
      modelPreloaderSrc,
      /userData/,
      'recent-failures map must be persisted to userData (not just in-memory)',
    );
    assert.match(
      modelPreloaderSrc,
      /recentFailuresPath|recent-failures\.json/,
      'persisted file path must be a stable name (recent-failures.json) under userData',
    );
    // load + save helpers exist.
    assert.match(
      modelPreloaderSrc,
      /function\s+loadRecentFailures|loadRecentFailures\s*\(/,
      'loadRecentFailures helper must exist (read map on construction)',
    );
    assert.match(
      modelPreloaderSrc,
      /function\s+saveRecentFailures|saveRecentFailures\s*\(/,
      'saveRecentFailures helper must exist (write map on each failure record)',
    );
  });
});

describe('source: main.ts startup validation gate', () => {
  test('preload block validates persisted localWhisperModel against MODEL_CATALOG_IDS', () => {
    // The fix: the preload setImmediate must NOT pass a corrupted modelId
    // straight to the worker. It must consult MODEL_CATALOG_IDS, fall back
    // to the safe default, and skip preload for invalid ids.
    const block = extractSetImmediateBody(mainSrc, 'Preloading local Whisper model');
    assert.ok(block, 'preload setImmediate block must be locatable');
    assert.match(
      block,
      /MODEL_CATALOG_IDS/,
      'preload block must consult MODEL_CATALOG_IDS to validate the persisted modelId',
    );
    assert.match(
      block,
      /Xenova\/whisper-tiny\.en/,
      'preload block must fall back to Xenova/whisper-tiny.en for invalid ids',
    );
  });
});

describe('source: local-whisper-reset-to-default IPC', () => {
  test('IPC handler exists and clears global + per-channel overrides', () => {
    const handler = extractSafeHandleBody(ipcSrc, 'local-whisper-reset-to-default');
    assert.ok(
      handler,
      'local-whisper-reset-to-default safeHandle must exist in ipcHandlers.ts',
    );
    assert.match(
      handler,
      /localWhisperModel/,
      'reset handler must clear localWhisperModel',
    );
    assert.match(
      handler,
      /localWhisperModelMic/,
      'reset handler must clear localWhisperModelMic (or leave it alone if empty)',
    );
    assert.match(
      handler,
      /localWhisperModelSystem/,
      'reset handler must clear localWhisperModelSystem (or leave it alone if empty)',
    );
    // The handler must use the safe fallback modelId.
    assert.match(
      handler,
      /Xenova\/whisper-tiny\.en/,
      'reset handler must use the safe Xenova/whisper-tiny.en fallback',
    );
  });

  test('preload forwards the new IPC to the renderer', () => {
    const preloadSrc = readFileSync(
      path.resolve(__dirname, '../../../../electron/preload.ts'),
      'utf-8',
    );
    assert.match(
      preloadSrc,
      /local-whisper-reset-to-default/,
      'preload.ts must forward local-whisper-reset-to-default IPC',
    );
  });

  test('modelPreloader exposes clearRecentFailure for the recovery path', () => {
    // The reset IPC calls clearRecentFailure on the safe fallback so the
    // cooldown doesn't block future selections. The parameter has a TS type
    // annotation (modelId: string), so the regex must allow for that.
    assert.match(
      modelPreloaderSrc,
      /clearRecentFailure\s*\(\s*modelId(?:\s*:\s*string)?\s*\)/,
      'modelPreloader.clearRecentFailure(modelId) must exist',
    );
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function extractMethodBody(source, methodName) {
  // Find the method DEFINITION. The signature is always at the start of a
  // line (after optional whitespace and an optional access modifier /
  // `async` keyword). JSDoc comments and call sites look similar but are
  // indented differently and preceded by other text on the same line.
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

function extractSetImmediateBody(source, anchor) {
  // Find a setImmediate(() => { … }) block, then return its body. If `anchor`
  // is given, the block must contain a line that includes the anchor text
  // (used to disambiguate multiple setImmediate blocks in main.ts).
  const re = /setImmediate\s*\(\s*(?:\(\s*\)\s*=>|\(\s*\)\s*:\s*\w+\s*=>|async\s*\(\s*\)\s*=>)/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    let i = source.indexOf('{', match.index + match[0].length);
    if (i < 0) continue;
    let depth = 1;
    i++;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth !== 0) continue;
    const body = source.slice(start, i - 1);
    if (!anchor || body.includes(anchor)) return body;
  }
  return null;
}

function extractSafeHandleBody(source, channel) {
  // Locate `safeHandle('channel',` and find the body of the arrow function
  // passed as the second argument.
  //
  // The arrow function is `async (...) => { ... }` and its opening `{` is
  // the FIRST `{` immediately following the `=>`.
  const re = new RegExp(
    `safeHandle\\(\\s*['"]${channel.replace(/[-]/g, '\\-')}['"]`,
  );
  const match = re.exec(source);
  if (!match) return null;
  // Search forward from the end of the match for `=>` then `{`.
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