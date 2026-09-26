import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const flags = require('../../../dist-electron/electron/intelligence/intelligenceFlags.js');
const { getSourceOwnerEnforcementStage, isSourceOwnerEnforcementBlocking } = flags;

// The staged source-owner enforcement accessor is the rollout knob promised by
// plan §6. It resolves from NATIVELY_SOURCE_OWNER_ENFORCEMENT_STAGE first, then
// falls back to the legacy customModeSourceEnforcement flag, then defaults to
// `observe`. The gate sites (manual chat + WTA) treat `off` as a legacy bypass
// and every other stage as "honor the resolver", so the default posture is
// leak-safe. These tests pin that contract so the knob cannot silently rot back
// into dead code.

const STAGE_ENV = 'NATIVELY_SOURCE_OWNER_ENFORCEMENT_STAGE';
const FLAG_ENV = 'NATIVELY_CUSTOM_MODE_SOURCE_ENFORCEMENT';

describe('SourceOwnerEnforcement staged accessor', () => {
  let priorStage;
  let priorFlag;

  beforeEach(() => {
    priorStage = process.env[STAGE_ENV];
    priorFlag = process.env[FLAG_ENV];
    delete process.env[STAGE_ENV];
    delete process.env[FLAG_ENV];
  });

  afterEach(() => {
    if (priorStage === undefined) delete process.env[STAGE_ENV];
    else process.env[STAGE_ENV] = priorStage;
    if (priorFlag === undefined) delete process.env[FLAG_ENV];
    else process.env[FLAG_ENV] = priorFlag;
  });

  test('defaults to observe (non-blocking) when nothing is set', () => {
    assert.equal(getSourceOwnerEnforcementStage(), 'observe');
    assert.equal(isSourceOwnerEnforcementBlocking(), false);
  });

  test('explicit stage env wins over everything', () => {
    for (const stage of ['off', 'observe', 'soft_block', 'enforce']) {
      process.env[STAGE_ENV] = stage;
      assert.equal(getSourceOwnerEnforcementStage(), stage);
    }
  });

  test('stage env is case-insensitive and trimmed', () => {
    process.env[STAGE_ENV] = '  ENFORCE  ';
    assert.equal(getSourceOwnerEnforcementStage(), 'enforce');
  });

  test('an unrecognized stage value does not throw and falls through to default', () => {
    process.env[STAGE_ENV] = 'banana';
    assert.equal(getSourceOwnerEnforcementStage(), 'observe');
  });

  test('legacy customModeSourceEnforcement flag maps to enforce when stage env is absent', () => {
    process.env[FLAG_ENV] = '1';
    assert.equal(getSourceOwnerEnforcementStage(), 'enforce');
    assert.equal(isSourceOwnerEnforcementBlocking(), true);
  });

  test('explicit stage env overrides the legacy flag', () => {
    process.env[FLAG_ENV] = '1';
    process.env[STAGE_ENV] = 'off';
    assert.equal(getSourceOwnerEnforcementStage(), 'off');
    assert.equal(isSourceOwnerEnforcementBlocking(), false);
  });

  test('soft_block and enforce are blocking; off and observe are not', () => {
    process.env[STAGE_ENV] = 'soft_block';
    assert.equal(isSourceOwnerEnforcementBlocking(), true);
    process.env[STAGE_ENV] = 'enforce';
    assert.equal(isSourceOwnerEnforcementBlocking(), true);
    process.env[STAGE_ENV] = 'observe';
    assert.equal(isSourceOwnerEnforcementBlocking(), false);
    process.env[STAGE_ENV] = 'off';
    assert.equal(isSourceOwnerEnforcementBlocking(), false);
  });
});
