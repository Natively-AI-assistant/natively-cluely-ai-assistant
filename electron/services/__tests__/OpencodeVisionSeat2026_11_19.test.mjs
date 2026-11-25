/**
 * OpenCode's screenshot seat.
 *
 * "Try it and see" is the wrong policy here: some models answer HTTP 200
 * without having read the image, so a text-only model produces a confident
 * blind answer instead of an error the chain can fall over from. The catalogue
 * (`modalities.input`) is therefore the only trustworthy answer, and this test
 * pins all three of its states — including that ABSENT data seats the rung
 * rather than refusing it (failing closed on an unfetched catalogue was
 * already a bug once).
 *
 * Run: node --test electron/services/__tests__/OpencodeVisionSeat2026_11_19.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const { gatewaySeatReadsImages, resolveVision, resolveVisionAuto } =
  require(dist('llm/visionResolver.js'));

const MODEL = 'opencode/claude-sonnet-5';

const facts = (over = {}) => ({
  providerReportsVision: () => undefined,
  testedVision: () => undefined,
  overriddenVision: () => undefined,
  ...over,
});

describe('gatewaySeatReadsImages(opencode, …)', () => {
  test('catalogue yes seats the rung', () => {
    assert.equal(gatewaySeatReadsImages('opencode', MODEL, facts({ providerReportsVision: () => true })), true);
  });

  test('catalogue no refuses it', () => {
    assert.equal(gatewaySeatReadsImages('opencode', MODEL, facts({ providerReportsVision: () => false })), false);
  });

  test('no catalogue at all seats it (unknown is not "no")', () => {
    assert.equal(gatewaySeatReadsImages('opencode', MODEL, facts()), true);
  });

  test('a failed one-time image test outranks a catalogue yes', () => {
    assert.equal(gatewaySeatReadsImages('opencode', MODEL, facts({
      providerReportsVision: () => true,
      testedVision: () => false,
    })), false);
  });

  test('the user\'s explicit Off wins over everything', () => {
    assert.equal(gatewaySeatReadsImages('opencode', MODEL, facts({
      providerReportsVision: () => true,
      overriddenVision: () => false,
    })), false);
  });

  test('the persisted catalogue subset refuses a text-only model with no store answer', () => {
    // The failure this guards: the catalogue's "no" lived only in credentials,
    // never reached the vision store, and the name table said UNKNOWN — which
    // seats the rung. A text-only GLM then answered HTTP 200 blind.
    assert.equal(gatewaySeatReadsImages('opencode', 'opencode/glm-5.3', facts({
      opencodeVisionModels: ['claude-sonnet-5', 'gpt-6.1-sol'],
    })), false);
  });

  test('the persisted catalogue subset seats a listed model', () => {
    assert.equal(gatewaySeatReadsImages('opencode', 'opencode/kimi-k3', facts({
      opencodeVisionModels: ['claude-sonnet-5', 'kimi-k3'],
    })), true);
  });
});

describe('resolveVision answers with a source, for Settings', () => {
  test('catalogue yes reports source provider', () => {
    const v = resolveVisionAuto({ provider: 'opencode', model: MODEL }, facts({ providerReportsVision: () => true }));
    assert.deepEqual(v, { reads: 'yes', source: 'provider' });
  });

  test('unknown on a name with no vision signal reports unknown, not no', () => {
    const v = resolveVisionAuto({ provider: 'opencode', model: 'opencode/glm-5.3' }, facts());
    assert.equal(v.reads, 'unknown');
  });

  test('unknown on a known vision family reports yes/names (the name table may prove a yes)', () => {
    // Not a contradiction: absence from the name list is not evidence of "no",
    // but presence in it is evidence of "yes". The catalogue still outranks it.
    const v = resolveVisionAuto({ provider: 'opencode', model: MODEL }, facts());
    assert.deepEqual(v, { reads: 'yes', source: 'names' });
  });
});
