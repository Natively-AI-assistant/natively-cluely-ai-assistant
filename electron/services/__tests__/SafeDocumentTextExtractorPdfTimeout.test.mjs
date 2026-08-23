// Resource-leak fix 2026-07-28: on a PDF parse timeout, `withTimeout` must
// (a) actually cancel the underlying pdfjs work via `parser.destroy()`
// rather than merely giving up on it, and (b) never let the original
// `parser.getText()` promise's eventual settlement surface as an unhandled
// rejection once the timeout has already rejected on its behalf.
//
// `getText()` is mocked to reject on a short delay AFTER the configured
// timeout fires, simulating the real scenario (destroy() mid-loop makes the
// next doc.getPage(i) reject asynchronously) without depending on how fast
// a real PDF happens to parse on this machine — a wall-clock race against
// the real parser proved flaky (module warm-up work happens before the
// timed section, so the real parse can finish inside a 1ms window).
//
// PARSE_TIMEOUT_MS is test-overridable via NATIVELY_PARSE_TIMEOUT_MS, read
// once at module load — so it must be set BEFORE the compiled module is
// imported, which is why this lives in its own file/process rather than
// alongside SafeDocumentTextExtractor.test.mjs's default-timeout tests.
//
// Run with: npm run build:electron && node --test electron/services/__tests__/SafeDocumentTextExtractorPdfTimeout.test.mjs

process.env.NATIVELY_PARSE_TIMEOUT_MS = '5';

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/SafeDocumentTextExtractor.js',
)).href;
const { extractSafeDocumentText } = await import(moduleUrl);

const fixturePath = path.resolve(__dirname, '../../../test-fixtures/profiles/p01/resume.pdf');

test('a PDF parse timeout cancels the underlying parse and never emits an unhandled rejection', async () => {
  const { PDFParse } = require('pdf-parse');
  const destroySpy = mock.method(PDFParse.prototype, 'destroy');
  // Simulate destroy() mid-loop making getText()'s internal getPage() call
  // reject *after* our 5ms timeout has already fired and rejected.
  const getTextSpy = mock.method(PDFParse.prototype, 'getText', () => new Promise((_, reject) => {
    setTimeout(() => reject(new Error('simulated: doc.getPage() rejected after destroy()')), 40);
  }));

  let unhandled = null;
  const onUnhandledRejection = (reason) => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    await assert.rejects(
      () => extractSafeDocumentText(fixturePath),
      /PDF parse timed out after 5ms/,
    );

    // Wait past the mocked getText()'s 40ms delayed rejection to prove it
    // gets swallowed instead of surfacing as an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(unhandled, null, `expected no unhandled rejection, got: ${unhandled}`);
    assert.ok(destroySpy.mock.callCount() >= 1, 'expected destroy() to be called to cancel the parse');
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    getTextSpy.mock.restore();
    destroySpy.mock.restore();
  }
});
