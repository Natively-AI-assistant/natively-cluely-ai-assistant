// LEGACY OCR PATH — TESTS SKIPPED (2026-05-17)
// =====================================================================
// These routing tests assert the OLD screenUnderstandingMode enum
// ('auto' | 'vision_only' | 'ocr_only' | 'private') and the OCR-first
// behavior that has been removed from Natively's runtime in the
// vision-first pivot. They are kept on disk so the legacy behavior can
// be revived if a future opt-in OCR mode is reintroduced; until then
// they should not run.
//
// The new vision-mode coverage lives in:
//   electron/services/__tests__/VisionFirstScreenUnderstanding.test.mjs
// =====================================================================

import { test as _test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Force every test in this file to be skipped without touching each call site.
const test = (name, opts, fn) => {
  if (typeof opts === 'function') return _test(name, { skip: 'legacy OCR path disabled — see file header' }, opts);
  return _test(name, { ...(opts || {}), skip: 'legacy OCR path disabled — see file header' }, fn);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');
process.env.NATIVELY_TEST_USER_DATA = '/Users/alice/Library/Application Support/Natively';

const VALID_IMAGE = '/Users/alice/Library/Application Support/Natively/screenshots/test.png';

async function loadService() {
  const mod = await import(pathToFileURL(path.join(screenDir, 'ScreenUnderstandingService.js')).href);
  return mod.ScreenUnderstandingService;
}

// Builds a service with a stubbed OCR and image hash so we can assert call counts
// without touching disk. Default: OCR is called and returns the supplied text.
async function makeService({
  hash = 'h1',
  ocrText = '',
  confidence = 0.9,
  provider = 'tesseract',
  throwOnOcr = false,
} = {}) {
  const ScreenUnderstandingService = await loadService();
  const service = new ScreenUnderstandingService();
  service._ocrCalls = 0;
  service.imageHashService = {
    computeHash: async () => hash,
    quickHash: async () => hash,
  };
  service.screenContextService = {
    captureScreenFromPath: async imagePath => {
      service._ocrCalls += 1;
      if (throwOnOcr) throw new Error('boom');
      return { ocrText, imagePath, timestamp: Date.now(), hash, confidence, provider };
    },
    clearCache: () => {},
  };
  return service;
}

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

// ---- vision_only ----

test('vision_only never invokes OCR when a vision provider is available', async () => {
  const service = await makeService({ ocrText: 'should never be read' });
  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'vision_only',
    providerPolicy: { visionAvailable: true, visionProvider: 'gpt-4o' },
  }));

  assert.equal(service._ocrCalls, 0);
  assert.equal(result.source, 'vision_direct');
  assert.equal(result.provenance, 'vision_only');
  assert.equal(result.ocrRan, false);
  assert.equal(result.visionRequested, true);
  assert.equal(result.providerUsed, 'gpt-4o');
});

test('vision_only returns a clear unavailable result when no vision provider exists', async () => {
  const service = await makeService();
  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'vision_only',
    providerPolicy: { visionAvailable: false },
  }));

  assert.equal(service._ocrCalls, 0);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.provenance, 'screenshot_ignored_no_vision');
  assert.match(result.unavailableReason || '', /vision/i);
});

// ---- ocr_only ----

test('ocr_only invokes OCR and never marks vision as requested', async () => {
  const service = await makeService({ ocrText: 'Welcome to the lecture on linear algebra' });
  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'ocr_only',
    providerPolicy: { visionAvailable: true, visionProvider: 'gpt-4o' },
  }));

  assert.equal(service._ocrCalls, 1);
  assert.equal(result.ocrRan, true);
  assert.equal(result.visionRequested, false);
  assert.equal(result.provenance, 'ocr_only');
  assert.match(result.visibleText, /linear algebra/);
});

test('ocr_only with empty OCR returns failed status without falling back to vision', async () => {
  const service = await makeService({ ocrText: '', confidence: 0 });
  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'ocr_only',
    providerPolicy: { visionAvailable: true },
  }));

  assert.equal(service._ocrCalls, 1);
  assert.equal(result.visionRequested, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.provenance, 'ocr_only');
});

// ---- private ----

test('private never escalates to cloud vision even when OCR is weak', async () => {
  const service = await makeService({ ocrText: 'ok', confidence: 0.1 }); // intentionally weak
  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'private',
    providerPolicy: { visionAvailable: true, localVisionAvailable: false, visionProvider: 'gpt-4o' },
  }));

  assert.equal(service._ocrCalls, 1);
  assert.equal(result.visionRequested, false);
  assert.equal(result.provenance, 'screenshot_blocked_private');
});

test('private may use a local vision provider when OCR is weak and one is configured', async () => {
  const service = await makeService({ ocrText: 'x', confidence: 0.1 });
  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'private',
    providerPolicy: { localVisionAvailable: true, visionProvider: 'ollama/llava' },
  }));

  assert.equal(result.visionRequested, true);
  assert.equal(result.provenance, 'private_local_vision');
  assert.equal(result.providerUsed, 'ollama/llava');
});

// ---- auto ----

test('auto + technical interview + vision provider → vision_direct', async () => {
  const service = await makeService({ ocrText: 'function twoSum(nums, target) { return []; }' });
  const result = await service.understand(baseRequest({
    modeTemplateType: 'technical-interview',
    userAction: 'code_hint',
    qualityMode: 'balanced',
    screenUnderstandingMode: 'auto',
    technicalInterviewDirectVision: true,
    providerPolicy: { visionAvailable: true, visionProvider: 'gpt-4o' },
  }));

  assert.equal(result.source, 'vision_direct');
  assert.equal(result.provenance, 'vision_used');
  assert.equal(result.visionRequested, true);
});

test('auto + technical interview + no vision provider → OCR fallback with a warning', async () => {
  const service = await makeService({ ocrText: 'function twoSum(nums, target) { return []; }' });
  const result = await service.understand(baseRequest({
    modeTemplateType: 'technical-interview',
    userAction: 'code_hint',
    qualityMode: 'balanced',
    screenUnderstandingMode: 'auto',
    providerPolicy: { visionAvailable: false },
  }));

  assert.equal(result.visionRequested, false);
  assert.equal(result.provenance, 'screenshot_ignored_no_vision');
  assert.ok(result.warnings.some(w => /no vision-capable provider/i.test(w)));
});

test('auto + general mode + strong OCR → OCR-only path', async () => {
  const service = await makeService({
    ocrText: 'Quarterly revenue grew by 18 percent compared with prior year results.',
  });
  const result = await service.understand(baseRequest({
    modeTemplateType: 'general',
    userAction: 'what_to_say',
    qualityMode: 'balanced',
    screenUnderstandingMode: 'auto',
    providerPolicy: { visionAvailable: true, visionProvider: 'gpt-4o' },
  }));

  assert.equal(result.visionRequested, false);
  assert.equal(result.provenance, 'ocr_used');
});

test('auto + general mode + weak OCR + vision provider → vision fallback', async () => {
  const service = await makeService({ ocrText: 'x', confidence: 0.1 });
  const result = await service.understand(baseRequest({
    modeTemplateType: 'general',
    userAction: 'what_to_say',
    qualityMode: 'balanced',
    screenUnderstandingMode: 'auto',
    providerPolicy: { visionAvailable: true, visionProvider: 'gpt-4o' },
  }));

  assert.equal(result.visionRequested, true);
  assert.equal(result.provenance, 'vision_fallback_after_weak_ocr');
});

// ---- provider scope (custom provider with screenshots disabled) ----

test('custom provider with screenshots scope disabled → no capture, no OCR, no vision', async () => {
  const service = await makeService({ ocrText: 'should never be read' });
  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'auto',
    providerPolicy: { visionAvailable: true, allowScreenshots: false },
  }));

  assert.equal(service._ocrCalls, 0);
  assert.equal(result.visionRequested, false);
  assert.equal(result.provenance, 'screenshot_blocked_scope');
  assert.match(result.unavailableReason || '', /scope/i);
});

// ---- invalid path ----

test('invalid image path is rejected without invoking OCR regardless of mode', async () => {
  const service = await makeService({ ocrText: 'should not be used' });

  for (const mode of ['auto', 'vision_only', 'ocr_only', 'private']) {
    service._ocrCalls = 0;
    const result = await service.understand(baseRequest({
      imagePaths: ['/etc/passwd'],
      screenUnderstandingMode: mode,
      providerPolicy: { visionAvailable: true },
    }));

    assert.equal(service._ocrCalls, 0, `mode ${mode} called OCR`);
    assert.equal(result.status, 'unavailable', `mode ${mode} status mismatch`);
    assert.ok(result.warnings.some(w => /Invalid image path/.test(w)));
  }
});

// ---- result shape (provenance is always populated) ----

test('every result includes a provenance value', async () => {
  const service = await makeService({ ocrText: 'hello world this is text' });
  const cases = [
    { mode: 'auto', policy: { visionAvailable: false } },
    { mode: 'auto', policy: { visionAvailable: true } },
    { mode: 'ocr_only', policy: { visionAvailable: true } },
    { mode: 'vision_only', policy: { visionAvailable: true, visionProvider: 'gpt-4o' } },
    { mode: 'vision_only', policy: { visionAvailable: false } },
    { mode: 'private', policy: {} },
    { mode: 'private', policy: { localVisionAvailable: true } },
  ];
  for (const c of cases) {
    const r = await service.understand(baseRequest({
      screenUnderstandingMode: c.mode,
      providerPolicy: c.policy,
    }));
    assert.ok(r.provenance, `mode ${c.mode} did not set provenance`);
  }
});
