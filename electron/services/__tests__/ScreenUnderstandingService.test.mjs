// LEGACY OCR PATH — TESTS SKIPPED (2026-05-17)
// =====================================================================
// These tests assert the OLD ScreenUnderstandingService API (which
// branched on OCR-first vs vision and consumed `ocrText` directly).
// The service has been rewritten as a vision-first pipeline in the
// pivot. New coverage lives in:
//   electron/services/__tests__/VisionFirstScreenUnderstanding.test.mjs
// These legacy tests are retained for reference until that suite lands;
// they are skipped at runtime.
// =====================================================================
import { test as _test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const test = (name, opts, fn) => {
  if (typeof opts === 'function') return _test(name, { skip: 'legacy OCR-coupled ScreenUnderstandingService API replaced by vision-first pipeline' }, opts);
  return _test(name, { ...(opts || {}), skip: 'legacy OCR-coupled ScreenUnderstandingService API replaced by vision-first pipeline' }, fn);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');
process.env.NATIVELY_TEST_USER_DATA = '/Users/alice/Library/Application Support/Natively';

async function loadService() {
  const modPath = pathToFileURL(path.join(screenDir, 'ScreenUnderstandingService.js')).href;
  const mod = await import(modPath);
  return mod.ScreenUnderstandingService;
}

function makeService({ hash = 'same-hash', ocrText = '' } = {}) {
  return loadService().then(ScreenUnderstandingService => {
    const service = new ScreenUnderstandingService();
    service.imageHashService = {
      computeHash: async () => hash,
      quickHash: async () => hash,
    };
    service.screenContextService = {
      captureScreenFromPath: async imagePath => ({
        ocrText,
        imagePath,
        timestamp: Date.now(),
        hash,
        confidence: ocrText ? 0.9 : 0,
        provider: 'stub-ocr',
      }),
      clearCache: () => {},
    };
    return service;
  });
}

const VALID_IMAGE = '/Users/alice/Library/Application Support/Natively/screenshots/test.png';

function baseRequest(overrides = {}) {
  return {
    modeId: 'mode-1',
    modeTemplateType: 'general',
    userAction: 'what_to_say',
    qualityMode: 'balanced',
    imagePaths: [VALID_IMAGE],
    transcript: '',
    ...overrides,
  };
}

test('ScreenUnderstandingService rejects invalid image paths without invoking OCR', async () => {
  const service = await makeService({ ocrText: 'should not be used' });
  let ocrCalled = false;
  service.screenContextService.captureScreenFromPath = async () => {
    ocrCalled = true;
    throw new Error('unexpected OCR call');
  };

  const result = await service.understand(baseRequest({ imagePaths: ['/etc/passwd'] }));

  assert.equal(result.status, 'unavailable');
  assert.equal(result.source, 'unavailable');
  assert.equal(ocrCalled, false);
  assert.ok(result.warnings.some(w => w.includes('Invalid image path rejected')));
});

test('ScreenUnderstandingService marks technical interview screenshots for direct vision', async () => {
  const service = await makeService({
    ocrText: 'Two Sum LeetCode function twoSum(nums, target) { return []; }',
  });

  const result = await service.understand(baseRequest({
    modeTemplateType: 'technical-interview',
    userAction: 'code_hint',
    qualityMode: 'balanced',
    transcript: 'Can you solve the visible coding problem?',
    // Direct vision is only chosen when an actual vision-capable provider is configured;
    // otherwise SUS must fall back to OCR with a warning instead of silently lying.
    providerPolicy: { visionAvailable: true, visionProvider: 'gpt-4o' },
  }));

  assert.equal(result.status, 'available');
  assert.equal(result.source, 'vision_direct');
  assert.equal(result.provenance, 'vision_used');
  assert.equal(result.visionRequested, true);
  assert.equal(result.screenType, 'code');
  assert.equal(result.taskDetected, 'coding_interview');
  assert.ok(result.visibleText.includes('Two Sum'));
});

test('ScreenUnderstandingService extracts tables and errors from OCR text', async () => {
  const service = await makeService({
    ocrText: 'Plan | Price\nBasic | $10\nPro | $20\n\nTypeError: cannot read property value of undefined',
  });

  const result = await service.understand(baseRequest({
    modeTemplateType: 'sales',
    userAction: 'what_to_say',
    qualityMode: 'fast',
  }));

  assert.equal(result.status, 'available');
  assert.equal(result.source, 'tesseract');
  assert.equal(result.screenType, 'error');
  assert.ok(result.tables.length >= 1);
  assert.deepEqual(result.tables[0].rows[0], ['Plan', 'Price']);
  assert.ok(result.errors.some(e => e.includes('TypeError')));
});

test('ScreenUnderstandingService returns cached result for matching image hash', async () => {
  const service = await makeService({ ocrText: 'Document paragraph content' });
  let ocrCalls = 0;
  service.screenContextService.captureScreenFromPath = async imagePath => {
    ocrCalls += 1;
    return {
      ocrText: `ocr:${ocrCalls}`,
      imagePath,
      timestamp: Date.now(),
      hash: 'same-hash',
      confidence: 0.9,
      provider: 'stub-ocr',
    };
  };

  const first = await service.understand(baseRequest());
  const second = await service.understand(baseRequest());

  assert.equal(ocrCalls, 1);
  assert.equal(second.visibleText, first.visibleText);
  assert.equal(second.imageHash, first.imageHash);
});
