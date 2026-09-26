/**
 * ParakeetSingleSessionLayout2026_08_06.test.mjs
 *
 * Parakeet CTC is the first single-session model in the catalog, and every
 * layout assumption in modelManager was written for encoder-decoder Whisper.
 *
 * THE FAILURE MODE THIS PINS: isModelCached resolves the files a model will load
 * and requires them present. For Whisper/Distil/Moonshine that is
 * `encoder_model.onnx` plus a decoder layout. Parakeet ships ONE `model.onnx` —
 * CTC collapses frame-level logits and has no autoregressive decoder to load.
 *
 * Get that wrong and nothing throws. The cache check simply hunts for an encoder
 * that will never exist, reports the model missing forever, and the download
 * service re-fetches 583 MB on every launch while the UI insists it is not
 * installed. Silent, expensive, and indistinguishable from a network problem —
 * the same shape as the truncated-download bug this catalog already carries a
 * guard for.
 *
 * Run: node --test electron/audio/__tests__/ParakeetSingleSessionLayout2026_08_06.test.mjs
 * (pure source scan — no build, no electron `app` import)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

const managerSrc = readFileSync(join(REPO_ROOT, 'electron/audio/whisper/modelManager.ts'), 'utf8');
const typesSrc = readFileSync(join(REPO_ROOT, 'electron/audio/whisper/types.ts'), 'utf8');
const inferenceSrc = readFileSync(join(REPO_ROOT, 'electron/audio/whisper/inferenceConfig.ts'), 'utf8');
const panelSrc = readFileSync(join(REPO_ROOT, 'src/components/LocalWhisperModelPanel.tsx'), 'utf8');

const PARAKEET_ID = 'onnx-community/parakeet-ctc-0.6b-ONNX';

/**
 * Re-implements the resolution chain under test — dtypeForFile → onnxFilename →
 * externalDataFilesFor — from the constants actually in the source, so a change
 * to the real suffix map is picked up here rather than drifting.
 */
function dtypeSuffixMap() {
    const start = managerSrc.indexOf('const DTYPE_SUFFIX');
    const open = managerSrc.indexOf('{', start);
    const close = managerSrc.indexOf('};', open);
    const map = {};
    for (const line of managerSrc.slice(open, close).split('\n')) {
        const m = line.match(/^\s*(\w+):\s*'([^']*)'/);
        if (m) map[m[1]] = m[2];
    }
    return map;
}

describe('Parakeet single-session layout', () => {
    test('the catalog entry declares the single-session layout', () => {
        const entry = managerSrc.split('\n').find(l => l.includes(PARAKEET_ID) && l.includes('name:'));
        assert.ok(entry, `No catalog entry for ${PARAKEET_ID}`);
        assert.match(
            entry,
            /sessionLayout:\s*'single'/,
            'Parakeet MUST declare sessionLayout: single. Without it the cache check looks for ' +
            'encoder_model.onnx, never finds it, and the model re-downloads on every launch.',
        );
    });

    test('external data is declared for EVERY dtype, not one filename', () => {
        const entry = managerSrc.split('\n').find(l => l.includes(PARAKEET_ID) && l.includes('name:'));
        // Every variant in that repo (fp32/fp16/q8/int8/q4/uint8/bnb4) has a
        // `*.onnx_data` companion. A per-filename map would silently stop
        // covering it the moment the active dtype changed.
        assert.match(
            entry,
            /externalDataFormat:\s*true/,
            'Parakeet must use a bare `true`: every dtype variant has a .onnx_data companion, so a ' +
            'per-filename map would miss it after a dtype change and ORT would abort on load.',
        );
    });

    test('expectedOnnxFiles returns a satisfiable decoder set for single-session', () => {
        // The subtle one. isModelCached ends in
        //   decoderOptions.some(opt => opt.every(present))
        // `[[]]` means "one layout, requiring no files" → .every on an empty
        // array is true → satisfied. `[]` would mean "no valid layout at all"
        // → .some on an empty array is FALSE → the model could never be cached,
        // and nothing would ever say why.
        const start = managerSrc.indexOf("if (sessionLayout === 'single')");
        assert.ok(start > -1, 'expectedOnnxFiles has no single-session branch');
        const branch = managerSrc.slice(start, start + 500);
        assert.match(
            branch,
            /decoderOptions:\s*\[\[\]\]/,
            'Single-session must return decoderOptions: [[]] (one layout needing no files). ' +
            '[] means NO valid layout and makes the model permanently uncacheable.',
        );
        assert.match(branch, /onnxFilename\('model'/, 'Single-session must resolve the `model` module');
    });

    test('isModelCached passes the layout through', () => {
        // A branch nothing reaches is a branch that does not exist.
        assert.match(
            managerSrc,
            /expectedOnnxFiles\(dtype,\s*externalDataFormat,\s*sessionLayout\)/,
            'isModelCached must forward sessionLayout, or the single-session branch is dead code.',
        );
        assert.match(
            managerSrc,
            /MODEL_CATALOG\.find\(m => m\.id === modelId\)\?\.sessionLayout/,
            'sessionLayout must be resolved from the catalog for the model being checked.',
        );
    });

    test('the dtype map keeps Parakeet off the 2.4GB fp32 weights', () => {
        // dtypeForFile falls back to fp32 for any key it does not find. For
        // Parakeet that is 2.4GB of weights instead of 583MB, for a WER
        // difference within noise.
        assert.match(
            inferenceSrc,
            /^\s*model:\s*'q8',/m,
            "WHISPER_SAFE_DTYPE must map the `model` module to q8, or Parakeet resolves to fp32 " +
            'and downloads 2.4GB instead of 583MB.',
        );
    });

    test('q8 resolves to the filename the repo actually publishes', () => {
        // onnx-community/parakeet-ctc-0.6b-ONNX ships onnx/model_quantized.onnx
        // (+ .onnx_data). If DTYPE_SUFFIX ever stops mapping q8 → _quantized the
        // cache check would look for a file that is not there.
        const suffix = dtypeSuffixMap();
        assert.equal(
            suffix.q8, '_quantized',
            'q8 must map to _quantized — the published file is onnx/model_quantized.onnx.',
        );
    });

    test('the id is in the WhisperModelId union', () => {
        assert.ok(
            typesSrc.includes(`'${PARAKEET_ID}'`),
            `${PARAKEET_ID} must be added to WhisperModelId or the catalog will not typecheck.`,
        );
    });

    test('the UI groups Parakeet as its own family', () => {
        // The family list is ordered and ends in a catch-all that claims
        // everything for "Whisper". Without its own rule Parakeet would be
        // filed under "Original OpenAI checkpoints", which it is not.
        const parakeetRule = panelSrc.indexOf("id: 'parakeet'");
        const catchAll = panelSrc.indexOf("id: 'whisper'");
        assert.ok(parakeetRule > -1, 'LocalWhisperModelPanel needs a Parakeet family rule');
        assert.ok(
            parakeetRule < catchAll,
            'The Parakeet rule must precede the Whisper catch-all — first match wins, and the ' +
            'catch-all matches everything.',
        );
    });
});
