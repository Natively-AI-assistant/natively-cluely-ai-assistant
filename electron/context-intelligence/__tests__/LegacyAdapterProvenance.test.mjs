// The EvidenceProvenance union and the adapter's runtime allowlist must agree.
//
// They drifted once already: SCREEN_CAPTURE was added to the union in
// contracts/types.ts, stamped by screen-retrieval-port, and left out of
// KNOWN_PROVENANCE in legacy-adapter. The adapter does not REJECT an unknown
// provenance — it strips the field — so screen evidence reached the model with
// no `provenance=` attribute, and the distinction the union's docblock exists
// to make (an OBSERVATION, not a model-generated claim) silently did not exist.
//
// A stripped field cannot fail loudly on its own. This test is the only thing
// that makes the drift visible.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const TYPES = read('electron/context-intelligence/contracts/types.ts');
const ADAPTER = read('electron/context-intelligence/retrieval/legacy-adapter.ts');

/** Members of `export type EvidenceProvenance = 'A' | 'B' | …` */
function unionMembers() {
  const m = TYPES.match(/export type EvidenceProvenance\s*=([\s\S]*?);/);
  assert.ok(m, 'EvidenceProvenance union not found — did it move or get renamed?');
  return new Set([...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]));
}

/** Entries of the adapter's KNOWN_PROVENANCE set. */
function allowlist() {
  const m = ADAPTER.match(/const KNOWN_PROVENANCE = new Set<string>\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'KNOWN_PROVENANCE not found — did it move or get renamed?');
  return new Set([...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]));
}

describe('evidence provenance allowlist', () => {
  test('every union member is allowlisted, or it is silently stripped', () => {
    const missing = [...unionMembers()].filter((p) => !allowlist().has(p)).sort();
    assert.deepEqual(missing, [],
      'These EvidenceProvenance members are not in legacy-adapter KNOWN_PROVENANCE, ' +
      'so the adapter drops the field and the packer never emits provenance= for ' +
      'them:\n  ' + missing.join('\n  '));
  });

  test('the allowlist invents nothing the union does not declare', () => {
    const extra = [...allowlist()].filter((p) => !unionMembers().has(p)).sort();
    assert.deepEqual(extra, [],
      'allowlisted but not a declared EvidenceProvenance member — a typo here ' +
      'admits a value the type system rejects:\n  ' + extra.join('\n  '));
  });

  test('SCREEN_CAPTURE specifically survives, since that is the regression', () => {
    assert.ok(unionMembers().has('SCREEN_CAPTURE'));
    assert.ok(allowlist().has('SCREEN_CAPTURE'));
  });
});
