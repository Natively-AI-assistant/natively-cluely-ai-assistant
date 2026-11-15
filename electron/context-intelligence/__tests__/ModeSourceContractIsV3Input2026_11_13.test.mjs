// F-ACC-05 (live-pipeline forensics, 2026-11-13): the mode's source contract
// ("answer from my reference files first") was not a V3 input, and Technical
// Interview's policy ranks the résumé first and reference files fifth, so a
// user who chose reference files first still got résumé-owned answers.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const { decide } = require(path.join(root, 'dist-electron/electron/context-intelligence/orchestration/orchestrator.js'));
const { applyModeSourceContract, resolveModePolicy } = require(path.join(root, 'dist-electron/electron/context-intelligence/policies/mode-policy-registry.js'));

const base = {
  requestId: 'r', requestSequence: 0, surface: 'what_to_answer', modeId: 'technical-interview',
  scope: { userId: 'local' }, sessionId: 's', manualQuestion: 'How many engineers are in pod 3?',
  hasAttachedDocuments: true, attachedSourceCount: 1, inLiveMeeting: true,
};
const USER_REF_FIRST = { sourceAuthority: 'reference_files_primary', origin: 'user_selected' };

describe('decide() reads the mode source contract (F-ACC-05)', () => {
  test('TI + a user-selected reference-files-first contract: the reference files own the turn', () => {
    const d = decide({ ...base, modeSourceContract: USER_REF_FIRST });
    assert.deepEqual(d.inferredClaimTypes, ['DOCUMENT_FACT'], 'résumé still inferred as the owner');
    assert.equal(d.requiredSourceTypes[0], 'REFERENCE_FILE');
  });
  test('TI with no contract or the template seed: unchanged (résumé first)', () => {
    for (const c of [undefined, null, { sourceAuthority: 'reference_files_primary', origin: 'default_new_mode' }]) {
      const d = decide({ ...base, modeSourceContract: c });
      assert.deepEqual(d.inferredClaimTypes, ['USER_PROJECT']);
      assert.equal(d.requiredSourceTypes[0], 'RESUME');
    }
  });
  test('a profile-first contract changes nothing', () => {
    const d = decide({ ...base, modeSourceContract: { sourceAuthority: 'profile_only', origin: 'user_selected' } });
    assert.deepEqual(d.inferredClaimTypes, ['USER_PROJECT']);
  });
});

describe('applyModeSourceContract', () => {
  test('a mode that already ranks reference files first is returned as is', () => {
    const p = resolveModePolicy('seminar');
    assert.equal(applyModeSourceContract(p, USER_REF_FIRST), p);
  });
  test('TI is promoted: reference files rank strictly first and are primary material', () => {
    const p = applyModeSourceContract(resolveModePolicy('technical-interview'), USER_REF_FIRST);
    const min = Math.min(...Object.values(p.sourcePriorities));
    assert.equal(p.sourcePriorities.REFERENCE_FILE, min);
    assert.equal(Object.values(p.sourcePriorities).filter((n) => n === min).length, 1);
    assert.equal(p.attachedMaterialIsPrimary, true);
  });
  test('the shared registry entry is not mutated', () => {
    applyModeSourceContract(resolveModePolicy('technical-interview'), USER_REF_FIRST);
    assert.equal(resolveModePolicy('technical-interview').sourcePriorities.REFERENCE_FILE, 5);
  });
});

test('the V3 bridge passes the mode contract to the request (source pin)', () => {
  const src = fs.readFileSync(path.join(root, 'electron/context-intelligence/orchestration/engine-bridge.ts'), 'utf8');
  assert.match(src, /getModes\(\)\.find\(\(m: \{ id: string \}\) => m\.id === input\.modeUniqueId\)/);
  assert.match(src, /extraAllowedSourceTypes: input\.extraAllowedSourceTypes,\s*modeSourceContract,/);
});
