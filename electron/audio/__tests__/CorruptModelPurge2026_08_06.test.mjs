/**
 * CorruptModelPurge2026_08_06.test.mjs
 *
 * THE BUG THIS PINS — a truncated download that presents as "every model fails
 * to install", and survives restarts:
 *
 *   isModelCached() asserts only `size > 0` per file. That was written to catch a
 *   0-byte stub, and it does. But a download that stopped part-way through — the
 *   observed case was 121,049,440 bytes of a 352,839,390-byte encoder — passes
 *   every check it makes. LocalModelDownloadService then verifies the install by
 *   calling isModelCached, sees "cached", and marks it COMPLETE. The UI shows the
 *   model installed. Every load fails with "Protobuf parsing failed", because ORT
 *   walks the file and hits EOF mid-message. And because the cache check still
 *   returns true, nothing ever re-fetches it.
 *
 *   The state is therefore self-perpetuating: the user presses Install, the
 *   service short-circuits on the cache check, and the same bad bytes fail again.
 *
 * The fix is to treat a load failure as a corrupt-cache signal and purge, so the
 * next Install genuinely re-downloads. These tests cover the classification —
 * which errors mean "bad bytes" versus "this machine cannot run models at all" —
 * because getting that boundary wrong is expensive in both directions: too broad
 * and a macOS-12 user loses a good 350 MB download to an environment error too
 * narrow and the stuck state comes back.
 *
 * 2026-10-14 — THE OPPOSITE BUG, pinned here too. The classifier matched the
 * phrase "failed to load model", believing it to be ONNX Runtime's own wrapper.
 * It is the prefix whisperWorker.ts puts on EVERY init error. So every load
 * failure was "corrupt": out of memory, no network, a file still in use, a
 * missing Windows runtime DLL — each one deleted the user's model, told them to
 * reinstall, and the reinstall failed the same way and deleted it again. The
 * classification now lives in whisper/loadFailure.ts and purges only on positive
 * evidence that the bytes are bad. Both platforms are exercised explicitly.
 *
 * Run: npm run build:electron && node --test electron/audio/__tests__/CorruptModelPurge2026_08_06.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

const whisperSrc = readFileSync(join(REPO_ROOT, 'electron/audio/LocalWhisperSTT.ts'), 'utf8');
const managerSrc = readFileSync(join(REPO_ROOT, 'electron/audio/whisper/modelManager.ts'), 'utf8');

// loadFailure.ts is a pure module (no electron), so the built file imports as-is.
const {
    classifyLocalModelLoadFailure,
    describeLocalModelLoadFailure,
    isCorruptModelFailure,
} = await import(pathToFileURL(join(REPO_ROOT, 'dist-electron/electron/audio/whisper/loadFailure.js')).href);

const PLATFORMS = ['darwin', 'win32'];
const isCorrupt = (msg, platform) => isCorruptModelFailure(msg, { platform });

describe('corrupt local model purge', () => {
    test('the real observed failure is classified as corrupt, on both platforms', () => {
        // Verbatim from the reported log.
        const real = 'Load model from /Users/evin/Library/Application Support/natively/'
            + 'whisper-models/distil-whisper/distil-small.en/onnx/encoder_model.onnx '
            + 'failed:Protobuf parsing failed.';
        for (const platform of PLATFORMS) {
            assert.equal(isCorrupt(real, platform), true,
                `[${platform}] The exact protobuf error from the field must trigger a purge, or the model stays stuck forever.`);
            assert.equal(isCorrupt(`Failed to load model: ${real}`, platform), true,
                `[${platform}] ...and still does with the worker's prefix on it.`);
        }
    });

    test('environment failures are NOT treated as corrupt', () => {
        // macOS 12: onnxruntime-node links libc++ symbols only exported on 13+.
        // NO model can load on this host. Purging would delete a perfectly good
        // multi-hundred-megabyte download to fix nothing.
        const envFailures = [
            'Failed to load model: Symbol not found: __ZNSt3__18to_charsEPcS0_d',
            'dlopen(libonnxruntime.1.22.0.dylib): image not found',
            'Error: Symbol not found, expected in flat namespace',
        ];
        for (const platform of PLATFORMS) {
            for (const msg of envFailures) {
                assert.equal(isCorrupt(msg, platform), false,
                    `[${platform}] "${msg}" is an environment failure, not bad bytes — purging would destroy a valid download.`);
            }
        }
    });

    test('THE PREFIX IS NOT EVIDENCE: a load that failed for another reason keeps its files', () => {
        // Each of these arrives prefixed "Failed to load model: " and each used to
        // delete the model directory.
        const notTheFiles = [
            ['out of memory', 'Failed to load model: bad allocation'],
            ['out of memory', 'Failed to load model: std::bad_alloc'],
            ['no network', 'Failed to load model: fetch failed'],
            ['proxy / DNS', 'Failed to load model: getaddrinfo ENOTFOUND huggingface.co'],
            ['HTTP error', 'Failed to load model: Failed to download encoder.onnx: HTTP 503'],
            ['short read (downloader already removed its partial)',
                'Failed to load model: Truncated download for encoder.onnx.data: expected 693000000 bytes, received 1200'],
            ['file in use (Windows)', 'Failed to load model: EBUSY: resource busy or locked, open \'C:\\Users\\a\\whisper-models\\x\\onnx\\encoder_model.onnx\''],
            ['no ONNX slot', 'Failed to load model: no ONNX session slot became free within 20000ms'],
            ['anything unrecognised', 'Failed to load model: something nobody has seen before'],
        ];
        for (const platform of PLATFORMS) {
            for (const [why, msg] of notTheFiles) {
                assert.equal(isCorrupt(msg, platform), false,
                    `[${platform}] BUG (${why}): "${msg}" deleted a good download and sent the user to a reinstall that fails the same way.`);
            }
        }
    });

    test('Windows: a binding that cannot load is a missing runtime, never a corrupt model', () => {
        // Node appends the path it tried to open; the sentence before it is in
        // the system language, so the file name is the only stable signal.
        const en = 'Failed to load model: The specified module could not be found.\n\\\\?\\C:\\Users\\a\\AppData\\Local\\Programs\\Natively\\resources\\app.asar.unpacked\\node_modules\\onnxruntime-node\\bin\\napi-v6\\win32\\x64\\onnxruntime_binding.node';
        const de = en.replace('The specified module could not be found.', 'Das angegebene Modul wurde nicht gefunden.');
        for (const msg of [en, de]) {
            assert.equal(classifyLocalModelLoadFailure(msg, { platform: 'win32' }), 'missing-windows-runtime');
            assert.equal(isCorrupt(msg, 'win32'), false);
            const shown = describeLocalModelLoadFailure(msg, { platform: 'win32' });
            assert.match(shown, /Visual C\+\+/);
            assert.match(shown, /aka\.ms\/vs\/17\/release\/vc_redist\.x64\.exe/);
            assert.doesNotMatch(shown, /macOS|Monterey|Ventura/, 'never show a Windows user the macOS remedy');
            assert.doesNotMatch(shown, /unavailable/i, 'sttErrorMapper titles "unavailable" as "Trying to reconnect"');
        }
        // The machine was probed and every runtime DLL is there: something else broke.
        assert.notEqual(
            classifyLocalModelLoadFailure(en, { platform: 'win32', missingWindowsRuntimeDlls: [] }),
            'missing-windows-runtime',
            'a PC that HAS the runtime must not be told to install it',
        );
        assert.equal(
            classifyLocalModelLoadFailure(en, { platform: 'win32', missingWindowsRuntimeDlls: ['MSVCP140_1.dll'] }),
            'missing-windows-runtime',
        );
    });

    test('each platform is only ever shown its own remedy', () => {
        const macSymbol = 'Failed to load model: Symbol not found: __ZNSt3__18to_charsEPcS0_d';
        assert.equal(classifyLocalModelLoadFailure(macSymbol, { platform: 'darwin' }), 'unsupported-macos');
        assert.match(describeLocalModelLoadFailure(macSymbol, { platform: 'darwin' }), /need macOS 13\.3 or later/);
        assert.doesNotMatch(describeLocalModelLoadFailure(macSymbol, { platform: 'win32' }), /macOS/,
            'a Windows machine is never told to upgrade macOS');
        const winBinding = 'Failed to load model: The specified module could not be found.\n\\\\?\\C:\\x\\onnxruntime_binding.node';
        assert.doesNotMatch(describeLocalModelLoadFailure(winBinding, { platform: 'darwin' }), /Visual C\+\+/,
            'a Mac is never told to install a Windows runtime');
    });

    test('other malformed-file shapes are covered', () => {
        for (const platform of PLATFORMS) {
            for (const msg of [
                'Failed to load model: invalid model',
                'Load model from /x/encoder_model.onnx failed:No such file or directory',
                'Failed to load model: Unexpected end of JSON input',
            ]) {
                assert.equal(isCorrupt(msg, platform), true, `[${platform}] Expected "${msg}" to be treated as corrupt`);
            }
        }
    });

    test('damaged Parakeet CoreML bundles (Neural Engine helper) are corrupt on macOS only', () => {
        // Messages the helper printed for copies of the real v2 download that
        // were truncated, zeroed or overwritten (paths shortened).
        const damaged = [
            "Failed to load model: Failed to load Parakeet CoreML models: Failed to build the model execution plan using a model architecture file '/m/FluidInference/parakeet-tdt-0.6b-v2-coreml/Encoder.mlmodelc/model.mil' with error code: -14.",
            'Failed to load model: Failed to load Parakeet CoreML models: Unable to load model: file:///m/FluidInference/parakeet-tdt-0.6b-v2-coreml/Encoder.mlmodelc/. Compile the model with Xcode or `MLModel.compileModel(at:)`. ',
            'Failed to load model: Failed to load Parakeet CoreML models: Failed to load ASR models: Vocabulary parsing failed',
        ];
        for (const msg of damaged) {
            assert.equal(isCorrupt(msg, 'darwin'), true, `Expected "${msg}" to be treated as corrupt on macOS`);
            assert.equal(isCorrupt(msg, 'win32'), false, 'the CoreML helper never runs on Windows');
        }
        // A crash is not evidence that the files are bad: keep the download.
        assert.equal(isCorrupt('Failed to load model: The Parakeet Neural Engine helper exited (SIGSEGV)', 'darwin'), false);
    });

    test('empty and junk input do not throw or purge', () => {
        // Defensive: this runs on an error path, where the last thing wanted is a
        // second exception, and an unrecognised message must not delete anything.
        for (const msg of ['', undefined, null]) {
            assert.doesNotThrow(() => isCorrupt(msg, 'darwin'));
            assert.equal(isCorrupt(msg, 'darwin'), false);
            assert.equal(isCorrupt(msg, 'win32'), false);
        }
    });

    test('after a purge the user is told the files were removed; without one, never that', () => {
        const corrupt = 'Failed to load model: Load model from /x/encoder_model.onnx failed:Protobuf parsing failed.';
        assert.match(describeLocalModelLoadFailure(corrupt, { platform: 'darwin', purged: true }),
            /files were incomplete and have been removed/);
        assert.doesNotMatch(describeLocalModelLoadFailure(corrupt, { platform: 'win32', purged: false }),
            /have been removed/, 'the purge can fail on Windows while a file is open — do not claim it happened');
        // The old copy claimed "model not found" for every unrecognised failure,
        // pointing the user at a download that could not help.
        const unknown = describeLocalModelLoadFailure('Failed to load model: something else', { platform: 'darwin' });
        assert.doesNotMatch(unknown, /not found/i);
        assert.match(unknown, /something else/, 'the underlying reason is shown, not swallowed');
    });

    test('LocalWhisperSTT purges ONLY behind the corruption classifier, on both failure paths', () => {
        // The wiring, not just the predicate: a classifier nothing calls fixes nothing.
        const helper = whisperSrc.slice(whisperSrc.indexOf('private modelLoadFailure(message: string): Error {'));
        const body = helper.slice(0, helper.indexOf('\n    }\n'));
        const guardIdx = body.indexOf("if (classifyLocalModelLoadFailure(message, ctx) === 'corrupt-files') {");
        const purgeIdx = body.indexOf('purgeCorruptModel(this.modelId');
        assert.ok(guardIdx > -1, 'the purge must be gated on the corruption classifier');
        assert.ok(purgeIdx > guardIdx, 'the guard must wrap the purge, not follow it');
        assert.equal(whisperSrc.split('purgeCorruptModel(this.modelId').length - 1, 1,
            'exactly one purge site: every load failure goes through modelLoadFailure()');
        assert.match(whisperSrc, /this\.emit\('error', this\.modelLoadFailure\(msg\.message\)\);/, 'worker-message path');
        assert.match(whisperSrc, /throw this\.modelLoadFailure\(message\);/, 'Nemotron shared-worker path');
    });

    test('modelManager.isCorruptModelError no longer matches the worker prefix itself', () => {
        const start = managerSrc.indexOf('export function isCorruptModelError');
        const body = managerSrc.slice(start, managerSrc.indexOf('\n}\n', start));
        assert.match(body, /return isCorruptModelFailure\(message, \{ platform \}\);/);
        assert.doesNotMatch(body, /failed to load model/i);
    });
});
