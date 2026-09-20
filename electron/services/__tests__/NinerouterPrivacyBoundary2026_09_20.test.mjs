/**
 * 9Router is REMOTE, and the two boundaries that depend on knowing it must
 * actually know it.
 *
 * This matters in phase 1, not phase 2. The text branch forwards images when
 * the turn is multimodal — the same contract the LiteLLM rung has — so a
 * screenshot can reach 9Router before the vision seat exists at all.
 *
 * Both boundaries fail OPEN for an unrecognised provider name:
 *
 *   isLocalVisionProvider() returns false for anything it does not know, which
 *   happens to be the SAFE answer here — but silently, so nothing would have
 *   caught the opposite mistake.
 *
 *   assertOutboundScopes() looks the provider label up in PROVIDER_LABEL_FAMILY
 *   and skips its disabled-provider backstop entirely when the lookup misses
 *   (`if (family && ...)`). A missing entry is not an error; it is one fewer
 *   check, with nothing to show for it.
 *
 * "Safe by default and silently uncovered" is what the comment in
 * ScreenUnderstandingModeEnforcement2026_08_01 calls this. These tests make it
 * covered.
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

describe('9Router never counts as on-device', () => {
  test('isLocalVisionProvider says false', () => {
    // 9Router runs ON the user's machine, which is exactly why this is worth
    // pinning: the binary is local, the inference is not. It forwards to
    // Anthropic, OpenAI, Google and 40+ others, so under private_vision a
    // screenshot sent here leaves the device just as surely as one sent to
    // openai — and the localhost address in the base URL argues otherwise to
    // anyone reading quickly.
    assert.equal(isLocalVisionProvider('ninerouter'), false,
      'a localhost ADDRESS is not on-device INFERENCE — 9Router forwards to 40+ cloud providers');
    // The one that really is local, for contrast.
    assert.equal(isLocalVisionProvider('ollama'), true);
  });
});

describe('the disabled-provider backstop covers 9Router', () => {
  test('PROVIDER_LABEL_FAMILY maps the outbound label to the family', () => {
    // assertOutboundScopes' backstop is `if (family && isProviderDisabled(family))`.
    // Without an entry the lookup yields undefined and the check is skipped —
    // no error, no warning, just an absent guard.
    const map = LLMHelper.PROVIDER_LABEL_FAMILY;
    assert.equal(map['ninerouter'], 'ninerouter',
      'a missing entry silently removes the last-boundary disabled check');
  });

  test('a disabled 9Router throws at the outbound boundary, not just at the getter', () => {
    const h = Object.create(LLMHelper.prototype);
    h.customProvider = null;
    h.isProviderDisabled = (family) => family === 'ninerouter';
    h.scopesForPayload = () => [];
    h.getProviderScopePolicy = () => ({});

    assert.throws(
      () => LLMHelper.prototype.assertOutboundScopes.call(h, 'ninerouter', 'hello'),
      /disabled/i,
      'the backstop must fire for a path that reaches the provider without going through the client getter',
    );
  });

  test('an enabled 9Router passes the same boundary', () => {
    const h = Object.create(LLMHelper.prototype);
    h.customProvider = null;
    h.isProviderDisabled = () => false;
    h.scopesForPayload = () => [];
    h.getProviderScopePolicy = () => ({});

    assert.doesNotThrow(() => LLMHelper.prototype.assertOutboundScopes.call(h, 'ninerouter', 'hello'));
  });
});
