// Regression test for the ROS-version source-boundary fix (root-cause fix,
// 2026-07-23): the "entity present, requested PROPERTY absent" check
// (textCanProveProperty / buildInsufficientPropertyAnswer, gated on
// contextOsPropertyValidation) previously ONLY ran when that flag was
// explicitly enabled (default OFF in production, isInternalDevTestContext).
// A document that generically mentions "ROS" and "Mercury X1" but never
// states the EXACT ROS distribution/version could pass an unsupported
// property claim straight through in production, because the one check
// designed to catch it (property vocabulary vs entity/topic overlap) never
// ran. The fix additionally enables this specific check whenever the active
// mode is a doc-grounded custom mode — the exact surface this symptom came
// from — without flipping the flag's broader global default (which also
// gates the clarify short-circuit, a larger, less-targeted surface).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const ipcHandlersSrc = fs.readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

test('ipcHandlers: property-unsupported check is enabled for doc-grounded custom modes independent of contextOsPropertyValidation flag', () => {
  assert.match(
    ipcHandlersSrc,
    /isIntelligenceFlagEnabled\('contextOsPropertyValidation'\)\s*\n\s*\|\|\s*manualActiveMode\?\.documentGroundedCustomModeActive === true/,
    'the property-unsupported gate must OR in documentGroundedCustomModeActive so it runs by default on doc-grounded modes even when the global flag is off',
  );
});

test('ipcHandlers: the gate still requires turnContract + reference_files ownership + a known requestedProperty', () => {
  assert.match(
    ipcHandlersSrc,
    /turnContract\s*\n\s*&&\s*turnContract\.sourceOwner === 'reference_files'\s*\n\s*&&\s*turnContract\.requestedProperty !== 'unknown'/,
    'the property check must still require a real turn contract scoped to reference_files with a known requested property — it must not fire unconditionally',
  );
});

test('ipcHandlers: property-unsupported can only downgrade to a refusal, never fabricate (still gated on !answerIsRefusal before checking)', () => {
  assert.match(
    ipcHandlersSrc,
    /const answerIsRefusal = isAssistantRefusal\(trimmed\)[\s\S]{0,120}if \(!answerIsRefusal\)/,
    'an already-honest refusal must never be re-flagged as property_unsupported',
  );
});

// ---------------------------------------------------------------------------
// Named-entity claim-to-evidence check wiring (root-cause fix, 2026-07-23)
// ---------------------------------------------------------------------------

test('ipcHandlers: the manual-chat gate checks the ORIGINAL streamed answer for unsupported named-entity claims', () => {
  assert.match(
    ipcHandlersSrc,
    /detectUnsupportedDocumentAnswer[\s\S]{0,120}_detectUnsupported\(\{\s*answer:\s*trimmed,\s*retrievedBlock:\s*docContextBlock\s*\}\)/,
    'the entity check must run against `trimmed` (the streamed answer), not only the regen output',
  );
});

test('ipcHandlers: unsupported_named_entity is wired into the reason cascade and triggers a regen', () => {
  assert.match(
    ipcHandlersSrc,
    /entityUnsupported \? 'unsupported_named_entity'/,
    'unsupported_named_entity must be a recognized reason in the validation cascade',
  );
  assert.match(
    ipcHandlersSrc,
    /reason === 'unsupported_named_entity'/,
    'the regen prompt builder must have a dedicated branch for unsupported_named_entity',
  );
});

test('ipcHandlers: the entity check is skipped when the answer is already a refusal or property-unsupported (no false claim to check)', () => {
  assert.match(
    ipcHandlersSrc,
    /!propertyUnsupported && !isFalseRefusal && docContextBlock && trimmed\.length >= 8/,
    'the entity-claim check must not run on an answer that already makes no factual claim',
  );
});
