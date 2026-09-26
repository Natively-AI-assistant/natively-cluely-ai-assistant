// electron/intelligence/__tests__/EvidencePackMandatoryPackId2026_07_25.test.mjs
//
// Phase 6 Slice 4 (context-rebuild) item 5: EvidencePack.packId is now
// mandatory (was optional) and EvidencePack gains zeroEvidenceReason (RC9).
// Source-pinned (a TS interface's optionality has no runtime
// representation) plus a behavioral check that real construction sites
// still produce a real packId.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const src = readFileSync(path.resolve(__dirname, '../context-os/evidencePack.ts'), 'utf8');
const { emptyEvidencePack } = require(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/evidencePack.js'));

describe('EvidencePack.packId is mandatory; zeroEvidenceReason exists (RC9)', () => {
  test('packId has no `?` optional marker in the interface declaration', () => {
    const ifaceStart = src.indexOf('export interface EvidencePack {');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const iface = src.slice(ifaceStart, ifaceEnd);
    assert.match(iface, /\n\s*packId: string;/, 'packId must be declared as required (no `?`)');
    assert.doesNotMatch(iface, /packId\?:/);
  });

  test('zeroEvidenceReason exists as an OPTIONAL field (only meaningful when items is empty)', () => {
    const ifaceStart = src.indexOf('export interface EvidencePack {');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const iface = src.slice(ifaceStart, ifaceEnd);
    assert.match(iface, /zeroEvidenceReason\?: ZeroEvidenceReason;/);
  });

  test('ZeroEvidenceReason has all 4 target-arch values', () => {
    assert.match(src, /export type ZeroEvidenceReason =/);
    for (const value of ['no_match', 'embedding_provider_down', 'not_permitted_by_policy', 'no_sources_configured']) {
      assert.match(src, new RegExp(`'${value}'`));
    }
  });

  test('emptyEvidencePack() (a real construction site) always produces a real packId', () => {
    const pack = emptyEvidencePack({
      turnId: 't1',
      sourceOwner: 'candidate',
      requestedProperty: 'unknown',
      answerPolicy: 'refuse_insufficient_evidence',
    });
    assert.equal(typeof pack.packId, 'string');
    assert.ok(pack.packId.length > 0);
  });
});
