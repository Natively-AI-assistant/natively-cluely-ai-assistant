// Context OS H3 — verified-claim persistence (REAL sqlite + real buildAssistantClaims).
//
// Proves: a claim SUPPORTED by the captured evidence is persisted 'verified'
// with evidence IDs; an unsupported claim stays 'unverified'; and the DAO
// refuses to store a 'verified' claim with no evidence IDs (downgrades it).
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/db/__tests__/ContextOsClaimVerification.verif.test.mjs

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const DB_MODULE = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');
const CO = path.join(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js');

let DatabaseManager, co;

describe('Context OS H3 — verified claim persistence (REAL)', () => {
  before(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxos-claims-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    DatabaseManager = require(DB_MODULE).DatabaseManager;
    co = require(CO);
  });

  test('supported claim → verified WITH evidence IDs; unsupported → unverified', () => {
    const dbm = DatabaseManager.getInstance();
    const turnId = 'turn-h3-1';
    // Evidence: the document says Jetson. Answer makes two claims: one supported
    // (Jetson), one NOT supported (ESP32 — never in evidence).
    const pack = {
      packId: `${turnId}:vp:1`, version: 1, turnId, sourceOwner: 'reference_files',
      requestedProperty: 'processor_or_controller',
      items: [{
        evidenceId: 'ev0', sourceKind: 'mode_reference_chunk', sourceId: 'm1',
        sourceOwner: 'reference_files', authority: 'evidence', trustLevel: 'user_uploaded',
        text: 'The system uses an NVIDIA Jetson Orin Nano as its onboard compute controller for perception and planning.',
        supports: { property: 'processor_or_controller' }, score: { final: 0.6 }, reasonIncluded: 't',
      }],
      rejected: [], coverage: { hasDirectEvidence: true, propertySatisfied: true, entityMatched: true, sourceOwnerSatisfied: true, confidence: 0.6 },
      conflicts: [], answerPolicy: 'answer',
    };
    const answer = 'The system uses an NVIDIA Jetson Orin Nano as its onboard compute controller. It also uses an ESP32 microcontroller for low-level actuation timing.';
    const claims = co.buildAssistantClaims({ answer, contract: { turnId, sourceOwner: 'reference_files', requestedProperty: 'processor_or_controller' }, evidencePack: pack });
    for (const c of claims) {
      const status = (c.validationStatus === 'verified' && c.evidenceIds.length === 0) ? 'unverified' : c.validationStatus;
      dbm.saveAssistantClaim({ claimId: c.claimId, turnId: c.turnId, claimText: c.claimText, sourceOwner: c.sourceOwner, requestedProperty: c.requestedProperty, validationStatus: status, evidenceIds: c.evidenceIds });
    }

    const rows = dbm.db.prepare("SELECT claim_text, validation_status, evidence_ids_json FROM assistant_claims WHERE turn_id='turn-h3-1'").all();
    const jetson = rows.find((r) => /jetson/i.test(r.claim_text));
    const esp32 = rows.find((r) => /esp32/i.test(r.claim_text));
    assert.ok(jetson, 'jetson claim persisted');
    assert.equal(jetson.validation_status, 'verified', 'supported claim must be verified');
    assert.ok(JSON.parse(jetson.evidence_ids_json).length > 0, 'verified claim must carry evidence IDs');
    assert.ok(esp32, 'esp32 claim persisted');
    assert.equal(esp32.validation_status, 'unverified', 'unsupported ESP32 claim must be unverified');
    assert.deepEqual(JSON.parse(esp32.evidence_ids_json), [], 'unverified claim has no evidence IDs');

    // The verified claim IS in the reusable set; the unverified one is NOT.
    const verified = dbm.getVerifiedAssistantClaims(50).map((r) => r.claim_text);
    assert.ok(verified.some((t) => /jetson/i.test(t)));
    assert.ok(!verified.some((t) => /esp32/i.test(t)));
  });

  test('DAO fail-closed: a verified claim with NO evidence IDs is downgraded to unverified', () => {
    const dbm = DatabaseManager.getInstance();
    dbm.saveAssistantClaim({ claimId: 'bogus-verified', turnId: 'turn-h3-2', claimText: 'unprovable but marked verified', sourceOwner: 'reference_files', validationStatus: 'verified', evidenceIds: [] });
    const row = dbm.db.prepare("SELECT validation_status FROM assistant_claims WHERE claim_id='bogus-verified'").get();
    assert.equal(row.validation_status, 'unverified', 'DAO must refuse to store verified-without-evidence');
    assert.ok(!dbm.getVerifiedAssistantClaims(50).some((r) => r.claim_id === 'bogus-verified'));
  });
});
