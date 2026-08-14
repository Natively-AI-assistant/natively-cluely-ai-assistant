// LEGACY OCR PATH — TESTS SKIPPED (2026-05-17)
// =====================================================================
// ScreenContextService is the legacy OCR-backed screen context service.
// Natively no longer uses it in the default runtime path (vision-first
// pivot). These tests are kept on disk so the OCR contract can be
// re-validated if a future opt-in OCR mode is reintroduced. Until then,
// set NATIVELY_RUN_LEGACY_OCR_TESTS=1 to opt in.
// =====================================================================
import { test as _test, describe as _describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LEGACY_OCR_ENABLED = process.env.NATIVELY_RUN_LEGACY_OCR_TESTS === '1';
const skipReason = LEGACY_OCR_ENABLED ? undefined : 'legacy OCR path disabled — set NATIVELY_RUN_LEGACY_OCR_TESTS=1 to run';
const test = (name, opts, fn) => {
  if (typeof opts === 'function') return _test(name, { skip: skipReason }, opts);
  return _test(name, { ...(opts || {}), skip: skipReason }, fn);
};
const describe = (name, opts, fn) => {
  if (typeof opts === 'function') return _describe(name, { skip: skipReason }, opts);
  return _describe(name, { ...(opts || {}), skip: skipReason }, fn);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');

// Load compiled modules
async function loadScreenModules() {
    const hashPath = pathToFileURL(path.join(screenDir, 'ImageHashService.js')).href;
    const contextPath = pathToFileURL(path.join(screenDir, 'ScreenContextService.js')).href;

    const [hashMod, contextMod] = await Promise.all([
        import(hashPath),
        import(contextPath),
    ]);

    return {
        ImageHashService: hashMod.ImageHashService,
        ScreenContextService: contextMod.ScreenContextService,
    };
}

test('ImageHashService has required methods', async () => {
    const { ImageHashService } = await loadScreenModules();
    const hashService = new ImageHashService();

    assert.strictEqual(typeof hashService.computeHash, 'function', 'should have computeHash');
    assert.strictEqual(typeof hashService.quickHash, 'function', 'should have quickHash');
});

test('ScreenContextService has required methods and interface', async () => {
    const { ScreenContextService } = await loadScreenModules();
    const service = new ScreenContextService();

    assert.strictEqual(typeof service.captureScreen, 'function', 'should have captureScreen');
    assert.strictEqual(typeof service.captureCropper, 'function', 'should have captureCropper');
    assert.strictEqual(typeof service.captureScreenFromPath, 'function', 'should have captureScreenFromPath');
    assert.strictEqual(typeof service.clearCache, 'function', 'should have clearCache');
    assert.strictEqual(typeof service.getCacheStats, 'function', 'should have getCacheStats');

    // Check cache stats structure
    const stats = service.getCacheStats();
    assert.strictEqual(typeof stats.size, 'number', 'size should be number');
    assert.ok(Array.isArray(stats.entries), 'entries should be array');
});

test('ScreenContextService clearCache works', async () => {
    const { ScreenContextService } = await loadScreenModules();
    const service = new ScreenContextService();

    service.clearCache();
    const stats = service.getCacheStats();
    assert.strictEqual(stats.size, 0, 'should have no entries after clear');
});

test('ScreenContextService captureScreenFromPath handles non-existent file gracefully', async () => {
    const { ScreenContextService } = await loadScreenModules();
    const service = new ScreenContextService();

    // The method should handle the error gracefully and return context with empty ocrText
    // even when the file doesn't exist (hash computation will fail first)
    try {
        const result = await service.captureScreenFromPath('/non/existent/file.png');
        // If it returns, check the structure
        assert.ok(result.hasOwnProperty('ocrText'));
        assert.ok(result.hasOwnProperty('imagePath'));
        assert.ok(result.hasOwnProperty('hash'));
        assert.ok(result.hasOwnProperty('timestamp'));
    } catch (error) {
        // It's acceptable for this to throw if the hash computation fails completely
        // The important thing is it doesn't crash the process
        assert.ok(error.message.includes('Failed to compute'), 'should fail gracefully');
    }
});

test('ScreenContextService does not expose cached context across different image hashes', async () => {
    const { ScreenContextService } = await loadScreenModules();
    const service = new ScreenContextService();
    let hashIndex = 0;

    service.imageHashService = {
        computeHash: async () => `hash-${++hashIndex}`,
        quickHash: async () => `quick-${hashIndex}`,
    };
    service.ocrProviderManager = {
        recognize: async imagePath => ({
            text: `ocr:${path.basename(imagePath)}`,
            lines: [],
            confidence: 0.9,
            provider: 'stub-ocr',
            durationMs: 1,
        }),
        getPrimaryProviderType: () => 'tesseract',
    };

    const first = await service.captureScreenFromPath('/tmp/screen-a.png');
    const second = await service.captureScreenFromPath('/tmp/screen-b.png');

    assert.equal(first.ocrText, 'ocr:screen-a.png');
    assert.equal(second.ocrText, 'ocr:screen-b.png');
    assert.equal(first.provider, 'stub-ocr');
    assert.notEqual(first.hash, second.hash);
    assert.equal(service.getCacheStats().size, 2);
});

test('ScreenContextService uses bounded OCR options for live screenshots', async () => {
    const { ScreenContextService } = await loadScreenModules();
    const service = new ScreenContextService();
    let receivedOptions;

    service.imageHashService = {
        computeHash: async () => 'bounded-hash',
        quickHash: async () => 'bounded-hash',
    };
    service.ocrProviderManager = {
        recognize: async (_imagePath, options) => {
            receivedOptions = options;
            return {
                text: 'bounded ocr',
                lines: [],
                confidence: 0.9,
                provider: 'stub-ocr',
                durationMs: 1,
            };
        },
        getPrimaryProviderType: () => 'tesseract',
    };

    const result = await service.captureScreenFromPath('/tmp/bounded-screen.png');

    assert.equal(result.ocrText, 'bounded ocr');
    assert.deepEqual(receivedOptions, { timeoutMs: 8_000, maxDimension: 1200 });
});

test('ScreenContextService cache hit updates timestamp without reusing unsafe path input', async () => {
    const { ScreenContextService } = await loadScreenModules();
    const service = new ScreenContextService();
    let ocrCalls = 0;

    service.imageHashService = {
        computeHash: async () => 'same-hash',
        quickHash: async () => 'same-hash',
    };
    service.ocrProviderManager = {
        recognize: async imagePath => {
            ocrCalls += 1;
            return {
                text: `ocr:${path.basename(imagePath)}`,
                lines: [],
                confidence: 0.9,
                provider: 'stub-ocr',
                durationMs: 1,
            };
        },
        getPrimaryProviderType: () => 'tesseract',
    };

    const first = await service.captureScreenFromPath('/tmp/original-safe-screen.png');
    const second = await service.captureScreenFromPath('/tmp/../../private/other-screen.png');

    assert.equal(ocrCalls, 1);
    assert.equal(second.ocrText, first.ocrText);
    assert.equal(second.imagePath, first.imagePath);
    assert.notEqual(second.imagePath, '/tmp/../../private/other-screen.png');
    assert.ok(second.timestamp >= first.timestamp);
});