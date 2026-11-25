/**
 * OpenCode is REMOTE, and the two boundaries that depend on knowing it must
 * actually know it — the same contract NinerouterPrivacyBoundary2026_09_20 pins.
 *
 * Both boundaries fail OPEN for an unrecognised provider name:
 *
 *   isLocalVisionProvider() returns false for anything it does not know — the
 *   safe answer here, but silently, so nothing would catch the opposite mistake.
 *
 *   assertOutboundScopes() looks the label up in PROVIDER_LABEL_FAMILY and
 *   skips its disabled-provider backstop when the lookup misses. A missing entry
 *   is not an error; it is one fewer check, with nothing to show for it.
 *
 * The OpenCode dispatch suites stub assertOutboundScopes out, so without this
 * file nothing executes the real boundary for this provider.
 *
 * Run: node --test electron/services/__tests__/OpencodePrivacyBoundary2026_11_22.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { isLocalVisionProvider } = require(dist('llm/visionPolicy.js'));
const { LLMHelper } = require(dist('LLMHelper.js'));

function boundaryHelper(isProviderDisabled) {
  const h = Object.create(LLMHelper.prototype);
  h.customProvider = null;
  h.isProviderDisabled = isProviderDisabled;
  h.scopesForPayload = () => [];
  h.getProviderScopePolicy = () => ({});
  return h;
}

describe('OpenCode never counts as on-device', () => {
  test('isLocalVisionProvider says false', () => {
    assert.equal(isLocalVisionProvider('opencode'), false,
      'OpenCode is a hosted gateway: a screenshot sent to it leaves the device');
  });
});

describe('the disabled-provider backstop covers OpenCode', () => {
  test('PROVIDER_LABEL_FAMILY maps the outbound label to the family', () => {
    assert.equal(LLMHelper.PROVIDER_LABEL_FAMILY['opencode'], 'opencode',
      'a missing entry silently removes the last-boundary disabled check');
  });

  test('a disabled OpenCode throws at the outbound boundary, not just at the getter', () => {
    const h = boundaryHelper((family) => family === 'opencode');
    assert.throws(
      () => LLMHelper.prototype.assertOutboundScopes.call(h, 'opencode', 'hello'),
      /disabled/i,
      'the backstop must fire for a path that reaches the provider without going through the client getter',
    );
  });

  test('an enabled OpenCode passes the same boundary', () => {
    const h = boundaryHelper(() => false);
    assert.doesNotThrow(() => LLMHelper.prototype.assertOutboundScopes.call(h, 'opencode', 'hello'));
  });
});
