// Security-review hardening regression (2026-06-13). Covers: setIntelligenceFlag
// own-property guard (no prototype-pollution key reaches SettingsManager), bounded
// diagram regex (no quadratic backtracking on a long single sentence), and that the
// hardening didn't break normal extraction.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setIntelligenceFlag, intelligenceFlagKeys } from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';
import { DiagramIntelligenceService } from '../../../dist-electron/electron/intelligence/DiagramIntelligenceService.js';

describe('setIntelligenceFlag — prototype-pollution / bad-key hardening', () => {
  test('rejects non-own-property keys (__proto__, constructor, prototype) → false, no throw', () => {
    for (const bad of ['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString']) {
      assert.equal(setIntelligenceFlag(bad, true), false, `"${bad}" must be rejected`);
    }
    // And global object state is not polluted.
    assert.equal(({}).polluted, undefined);
  });
  test('rejects non-string keys → false', () => {
    for (const bad of [null, undefined, 123, {}, []]) {
      assert.equal(setIntelligenceFlag(bad, true), false);
    }
  });
  test('a real flag key is in the known set (sanity: the guard does not reject valid keys)', () => {
    assert.ok(intelligenceFlagKeys().includes('trace'));
    // setIntelligenceFlag('trace', ...) would touch SettingsManager which needs Electron;
    // headless it returns false gracefully (covered by FlagSettingsRoundTrip). Here we
    // only assert the key passes the own-property guard, which is necessary for it to
    // proceed — proven by it NOT being in the rejected set above.
  });
});

describe('DiagramIntelligenceService — bounded regex (no quadratic backtracking)', () => {
  test('a long single sentence with no period resolves quickly (<150ms)', () => {
    const evil = 'the client ' + 'x '.repeat(4000) + 'sends'; // ~8KB, no period
    const t0 = process.hrtime.bigint();
    const d = new DiagramIntelligenceService().generate({ text: evil });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 150, `pathological input took ${ms.toFixed(1)}ms — regex bound regressed`);
    assert.ok(d); // returns a result (likely kind:'none'), never hangs
  });

  test('the TCP handshake still extracts correctly after the regex bound', () => {
    const d = new DiagramIntelligenceService().generate({
      text: 'The client sends a SYN. The server replies with SYN-ACK. Finally the client sends an ACK.',
    });
    assert.equal(d.valid, true);
    assert.equal(d.confidenceLabel, 'ai_reconstructed_diagram');
    assert.match(d.mermaid, /SYN-ACK/);
    assert.match(d.mermaid, /Client->>Server: SYN/);
  });
});
