// electron/services/__tests__/VisionProviderRegistryOrder.test.mjs
//
// Guards the Gemini vision cascade ordering in buildVisionProviders():
// flash-lite must be registered BEFORE flash, and flash before pro, so the
// screenshot fallback chain (VisionProviderFallbackChain iterates the array in
// order, first non-empty wins) leads with the cheapest/fastest Gemini model.
//
// We assert against the SOURCE file rather than the compiled module because
// buildVisionProviders transitively imports CredentialsManager, which evaluates
// `app.getPath('userData')` at module load — only available inside the Electron
// runtime, not under plain `node --test`. A source-order check needs neither
// Electron nor a build step and directly pins the registration order decision.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registrySrc = fs.readFileSync(
  path.resolve(__dirname, '../screen/VisionProviderRegistry.ts'),
  'utf8',
);

// Isolate the buildVisionProviders body so we measure REGISTRATION order
// (providers.push(...) calls), not the order the builder functions are defined.
function buildBody(src) {
  const start = src.indexOf('export function buildVisionProviders');
  assert.ok(start >= 0, 'buildVisionProviders not found');
  // Body ends at the closing `}` of the function; the next `// ─── Provider
  // builders` banner is a stable sentinel right after it.
  const end = src.indexOf('Provider builders', start);
  assert.ok(end > start, 'provider-builders sentinel not found after buildVisionProviders');
  return src.slice(start, end);
}

describe('buildVisionProviders Gemini cascade order', () => {
  const body = buildBody(registrySrc);
  const idx = (fn) => body.indexOf(`providers.push(${fn}(`);

  test('flash-lite is registered before flash', () => {
    const lite = idx('geminiFlashLite');
    const flash = idx('geminiFlash');
    assert.ok(lite >= 0, 'geminiFlashLite is not registered in buildVisionProviders');
    assert.ok(flash >= 0, 'geminiFlash is not registered in buildVisionProviders');
    assert.ok(lite < flash, `expected geminiFlashLite (@${lite}) before geminiFlash (@${flash})`);
  });

  test('flash is registered before pro', () => {
    const flash = idx('geminiFlash');
    const pro = idx('geminiPro');
    assert.ok(pro >= 0, 'geminiPro is not registered in buildVisionProviders');
    assert.ok(flash < pro, `expected geminiFlash (@${flash}) before geminiPro (@${pro})`);
  });

  test('the flash-lite builder declares the flash-lite model id', () => {
    assert.match(registrySrc, /id:\s*'gemini_flash_lite'/);
    assert.match(registrySrc, /modelId:\s*'gemini-3\.1-flash-lite'/);
  });
});
