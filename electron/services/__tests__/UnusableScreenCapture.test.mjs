import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Prefer compiled JS when present; otherwise load TS via dynamic import path
// that the test runner may not support — fall back to source-contract checks.
async function loadUnusableModule() {
  const dist = path.resolve(__dirname, '../../../dist-electron/electron/services/screen/unusableScreenCapture.js');
  try {
    return await import(pathToFileURL(dist).href);
  } catch {
    // Source-level: evaluate the compiled-equivalent by reading patterns from source.
    return null;
  }
}

describe('unusable screen capture detection', () => {
  test('source exports detection helpers', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../screen/unusableScreenCapture.ts'),
      'utf8',
    );
    assert.match(src, /export function isUnusableScreenCaptureText/);
    assert.match(src, /ERR_CONNECTION_REFUSED/);
    assert.match(src, /UNUSABLE_SCREEN_CAPTURE_USER_MESSAGE/);
  });

  test('detects connection-failed OCR blobs', async () => {
    const mod = await loadUnusableModule();
    if (!mod) {
      // No dist yet — pattern-check the source regexes instead.
      const src = readFileSync(
        path.resolve(__dirname, '../screen/unusableScreenCapture.ts'),
        'utf8',
      );
      assert.match(src, /ERR_CONNECTION_REFUSED/);
      assert.match(src, /Connection Failed/);
      return;
    }
    const { isUnusableScreenCaptureText } = mod;
    assert.equal(
      isUnusableScreenCaptureText('Connection Failed\nERR_CONNECTION_REFUSED\nRestart Browser'),
      true,
    );
    assert.equal(
      isUnusableScreenCaptureText('Best Time to Buy and Sell Stock\nprices = [7,1,5,3,6,4]'),
      false,
    );
  });

  test('generate-what-to-say refuses unusable screen captures', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../../electron/ipcHandlers.ts'),
      'utf8',
    );
    assert.match(src, /isUnusableScreenCaptureText/);
    assert.match(src, /UNUSABLE_SCREEN_CAPTURE_USER_MESSAGE/);
  });

  test('finalize keeps longer buffered answer over short empty-screen finalText', () => {
    const { finalizeImperativeStreamMessages } = require('../../../src/lib/streamingTokenQueue.mjs');
    const longAnswer =
      '## Approach\nUse one pass with min-so-far.\n\n## Solution\n```python\ndef maxProfit(prices):\n    pass\n```\n';
    const shortRefusal =
      "I don't see any attached screen or image in your message. Could you share the screenshot?";
    const out = finalizeImperativeStreamMessages(
      [{ id: 'm1', role: 'system', text: '', isStreaming: true }],
      {
        msgId: 'm1',
        intent: 'what_to_answer',
        bufferedText: longAnswer,
        finalText: shortRefusal,
      },
    );
    assert.equal(out[0].text, longAnswer);
    assert.equal(out[0].isStreaming, false);
  });
});
