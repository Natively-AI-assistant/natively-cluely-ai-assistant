// scripts/__tests__/sd-requirements-gate-smoke.test.mjs
//
// Unit tests for Requirements-gate real-API smoke helpers (skip gate,
// structural asserts, URL-shortener scenario). No Electron / network.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Smoke = require('../lib/sd-requirements-gate-smoke.js');
const H = require('../lib/sd-grounding-harness.js');

describe('sd-requirements-gate-smoke skip gate', () => {
  test('shouldRunRequirementsGateSmoke is false without opt-in', () => {
    assert.equal(Smoke.shouldRunRequirementsGateSmoke({ GEMINI_API_KEY: 'g' }), false);
  });

  test('shouldRunRequirementsGateSmoke accepts RUN_SD_REQUIREMENTS_GATE_E2E + GEMINI', () => {
    assert.equal(
      Smoke.shouldRunRequirementsGateSmoke({
        RUN_SD_REQUIREMENTS_GATE_E2E: '1',
        GEMINI_API_KEY: 'g-test',
      }),
      true,
    );
  });

  test('shouldRunRequirementsGateSmoke accepts RUN_SD_GROUNDING_E2E + GEMINI', () => {
    assert.equal(
      Smoke.shouldRunRequirementsGateSmoke({
        RUN_SD_GROUNDING_E2E: '1',
        GEMINI_API_KEY: 'g-test',
      }),
      true,
    );
  });

  test('shouldRunRealApi honors RUN_SD_REQUIREMENTS_GATE_E2E', () => {
    assert.equal(H.shouldRunRealApi({ RUN_SD_REQUIREMENTS_GATE_E2E: '1', GEMINI_API_KEY: 'g' }), true);
    assert.equal(H.shouldRunRealApi({ RUN_SD_REQUIREMENTS_GATE_E2E: '1' }), false);
  });
});

describe('sd-requirements-gate-smoke scenario + asserts', () => {
  test('URL shortener fills + advance reach post_requirements', () => {
    let a = Smoke.createEmptyArtifact('url-shortener');
    assert.equal(Smoke.deriveSdPhase(a), 'requirements');
    a = Smoke.applyInterviewerFills(a);
    assert.equal(Smoke.isChecklistComplete(a), true);
    a = Smoke.acceptAdvance(a);
    assert.equal(Smoke.deriveSdPhase(a), 'post_requirements');
  });

  test('assertGatedSpoken soft-truncates later headings', () => {
    const raw = [
      '## Requirements',
      'Create + redirect.',
      '## High-Level Design',
      'CDN + Redis',
    ].join('\n');
    const r = Smoke.assertGatedSpoken(raw);
    assert.equal(r.ok, true, r.misses.join(';'));
    assert.equal(Smoke.hasLaterFrameworkHeadings(r.spoken), false);
  });

  test('assertPostAdvanceSpoken accepts HLD + tech', () => {
    const good = [
      '## High-Level Design',
      'API tier in front of Redis cache.',
      '## Deep Dives',
      'Base62 short codes.',
    ].join('\n');
    const r = Smoke.assertPostAdvanceSpoken(good);
    assert.equal(r.ok, true, r.misses.join(';'));
  });

  test('assertPostAdvanceSpoken fails empty', () => {
    const r = Smoke.assertPostAdvanceSpoken('');
    assert.equal(r.ok, false);
  });

  test('skipMessage mentions weekly/dispatch and not PR', () => {
    const msg = Smoke.skipMessage();
    assert.match(msg, /RUN_SD_REQUIREMENTS_GATE_E2E/);
    assert.match(msg, /Not for PR/i);
  });
});
