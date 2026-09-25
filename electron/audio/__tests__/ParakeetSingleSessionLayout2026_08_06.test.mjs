/**
 * ParakeetSingleSessionLayout2026_08_06.test.mjs
 *
 * Updated 2026-09-25: Parakeet TDT 0.6B v3 layout tests.
 * Asserts catalog configuration, sessionLayout 'parakeet-tdt', cache checking,
 * and UI family grouping for the FastConformer TDT multilingual model.
 *
 * Run: node --test electron/audio/__tests__/ParakeetSingleSessionLayout2026_08_06.test.mjs
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
const panelSrc = readFileSync(join(REPO_ROOT, 'src/components/LocalWhisperModelPanel.tsx'), 'utf8');
const workerSrc = readFileSync(join(REPO_ROOT, 'electron/audio/whisper/whisperWorker.ts'), 'utf8');

const PARAKEET_ID = 'istupakov/parakeet-tdt-0.6b-v3-onnx';

describe('Parakeet TDT v3 layout & integration', () => {
    test('the catalog entry declares the parakeet-tdt layout and multilingual', () => {
        const lines = managerSrc.split('\n');
        const idIdx = lines.findIndex(l => l.includes(PARAKEET_ID));
        assert.ok(idIdx > -1, `No catalog entry for ${PARAKEET_ID}`);
        const entryBlock = lines.slice(idIdx, idIdx + 15).join('\n');
        assert.match(
            entryBlock,
            /sessionLayout:\s*'parakeet-tdt'/,
            'Parakeet TDT MUST declare sessionLayout: parakeet-tdt.',
        );
        assert.match(
            entryBlock,
            /multilingual:\s*true/,
            'Parakeet TDT MUST declare multilingual: true.',
        );
    });

    test('isParakeetModelCached checks all required files', () => {
        assert.ok(
            managerSrc.includes('PARAKEET_TDT_REQUIRED_FILES'),
            'modelManager must export PARAKEET_TDT_REQUIRED_FILES',
        );
        assert.ok(managerSrc.includes("'encoder-model.int8.onnx'"));
        assert.ok(managerSrc.includes("'decoder_joint-model.int8.onnx'"));
        assert.ok(managerSrc.includes("'nemo128.onnx'"));
        assert.ok(managerSrc.includes("'vocab.txt'"));
        assert.ok(managerSrc.includes("'config.json'"));
    });

    test('isModelCached passes the parakeet-tdt layout through', () => {
        assert.match(
            managerSrc,
            /if\s*\(sessionLayout\s*===\s*'parakeet-tdt'\)\s*return\s*isParakeetModelCached\(modelDir\);/,
            'isModelCached must branch on parakeet-tdt sessionLayout to call isParakeetModelCached.',
        );
    });

    test('the id is in the WhisperModelId union', () => {
        assert.ok(
            typesSrc.includes(`'${PARAKEET_ID}'`),
            `${PARAKEET_ID} must be added to WhisperModelId or the catalog will not typecheck.`,
        );
    });

    test('whisperWorker handles parakeet-tdt sessionLayout', () => {
        assert.ok(
            workerSrc.includes("msg.sessionLayout === 'parakeet-tdt'"),
            'whisperWorker must handle sessionLayout parakeet-tdt in init',
        );
        assert.ok(
            workerSrc.includes('initParakeetChannel'),
            'whisperWorker must call initParakeetChannel',
        );
    });

    test('the UI groups Parakeet as its own family with multilingual note', () => {
        const parakeetRule = panelSrc.indexOf("id: 'parakeet'");
        const catchAll = panelSrc.indexOf("id: 'whisper'");
        assert.ok(parakeetRule > -1, 'LocalWhisperModelPanel needs a Parakeet family rule');
        assert.ok(
            parakeetRule < catchAll,
            'The Parakeet rule must precede the Whisper catch-all — first match wins, and the catch-all matches everything.',
        );
        assert.ok(
            panelSrc.includes('Multilingual (25 languages)'),
            'LocalWhisperModelPanel must reflect Multilingual support for Parakeet TDT',
        );
    });
});

