// Ticking "Reference files" in an interview-prep mode now actually grounds in
// them.
//
// THE GAP. T8 (2026-08-28) gave technical-interview a reference pool and put
// `reference_files` into its permitted switches, so the "Primary knowledge
// source" control offers it and an attached file became REACHABLE — measured
// second-person reachability went 0/6 to 6/6. But `buildUserSourceContract`
// pinned `defaultOwner: 'profile'` for interview-prep templates regardless of
// what the user ticked, so the saved contract still resolved `profile_only`,
// `documentGroundedFromContract` still returned false, and
// `forceDocumentGrounding` stayed OFF.
//
// Measured before this fix — the identical user selection, two modes:
//
//   technical-interview + reference_files  ->  profile_only            docGrounded=false
//   general             + reference_files  ->  reference_files_primary docGrounded=true
//
// So everything gated on that switch stayed off in the one mode whose users are
// most likely to upload project documents: topK 6 and a 1800-token budget
// instead of 12/3600, no per-file floor, no answerability scoring, no
// section-target or positional restore, no identity block, no query
// normalization. The user could ask for their reference files and be handed a
// materially weaker retrieval than the same files in General.
//
// UPLOAD IS STILL NOT CONSENT. This reads the user's EXPLICIT switch, never the
// presence of a file — the rule T8 was built around is unchanged and is
// asserted below.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

const { ModesManager } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/services/ModesManager.js'));
const msc = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/services/modeSourceContract.js'));

const ENV = 'NATIVELY_RETRIEVAL_INTERVIEW_PREP_HONORS_REFERENCE_SWITCH';
const withFlag = (value, fn) => {
  const original = process.env[ENV];
  process.env[ENV] = value;
  try { return fn(); } finally {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  }
};

/** The real builder, without standing up a database. */
const build = (templateType, switches) =>
  ModesManager.prototype.buildUserSourceContract.call(
    Object.create(ModesManager.prototype),
    { modeId: 'm', templateType, switches });

const INTERVIEW_PREP = ['technical-interview', 'looking-for-work'];

describe('an explicit reference-files switch grounds interview-prep modes', () => {
  for (const template of INTERVIEW_PREP) {
    test(`${template}: ticking reference files enables document grounding`, () => {
      const c = build(template, ['profile', 'job_description', 'reference_files']);
      assert.equal(c.sourceAuthority, 'reference_files_primary');
      assert.equal(msc.documentGroundedFromContract(c, true), true,
        'forceDocumentGrounding must now be reachable for this mode');
    });

    test(`${template}: reference files ALONE also grounds`, () => {
      const c = build(template, ['reference_files']);
      assert.equal(msc.documentGroundedFromContract(c, true), true);
    });
  }

  test('it matches what the same selection already did in General', () => {
    // The asymmetry was the bug: identical user intent, opposite outcome.
    const ti = build('technical-interview', ['reference_files']);
    const general = build('general', ['reference_files']);
    assert.equal(ti.sourceAuthority, general.sourceAuthority);
  });
});

describe('NON-REGRESSION: upload is not consent, and profile-first is still the default', () => {
  for (const template of INTERVIEW_PREP) {
    test(`${template}: WITHOUT the switch it stays profile-first`, () => {
      const c = build(template, ['profile', 'job_description']);
      assert.equal(c.defaultOwner, 'profile');
      assert.equal(c.sourceAuthority, 'profile_only');
      assert.equal(msc.documentGroundedFromContract(c, true), false,
        'a mode the user has not switched must not document-ground');
    });

    test(`${template}: no switches at all stays profile-first`, () => {
      assert.equal(build(template, []).sourceAuthority, 'profile_only');
    });
  }

  test('non-interview templates are completely unaffected', () => {
    for (const t of ['general', 'sales', 'recruiting', 'team-meet', 'lecture']) {
      const on = build(t, ['reference_files']);
      const off = withFlag('0', () => build(t, ['reference_files']));
      assert.deepEqual(on, off, `${t} changed`);
    }
  });

  test('the kill switch restores the pre-fix behaviour exactly', () => {
    withFlag('0', () => {
      for (const template of INTERVIEW_PREP) {
        const c = build(template, ['profile', 'job_description', 'reference_files']);
        assert.equal(c.sourceAuthority, 'profile_only');
        assert.equal(msc.documentGroundedFromContract(c, true), false);
      }
    });
  });
});

describe('the memory-policy consequence is real, and is pinned here on purpose', () => {
  // Switching an interview-prep mode to reference-files ownership ALSO changes
  // its memory policy, because invariant #3 forbids Hindsight for any
  // document-grounded owner. That is a deliberate consequence of the user's own
  // choice, not a side effect to discover later in a bug report:
  //
  //   allowHindsight           true -> FALSE   (cross-meeting recall is off)
  //   allowPriorAssistantFacts true -> FALSE   (the assistant's own prior output
  //                                             stops counting as evidence — a
  //                                             fabrication vector closing, and
  //                                             arguably a gain)
  //   allowPriorAssistantReferents      stays TRUE, so follow-ups still resolve
  //                                             ("what did you monitor after that?")
  test('grounding an interview-prep mode turns Hindsight off', () => {
    const grounded = build('technical-interview', ['reference_files']);
    assert.equal(grounded.memoryPolicy.allowHindsight, false);
    assert.equal(grounded.memoryPolicy.allowPriorAssistantFacts, false);
    assert.equal(grounded.memoryPolicy.allowPriorAssistantReferents, true,
      'follow-up resolution must survive — losing it would break "and what about X?"');
  });

  test('an ungrounded interview-prep mode keeps both', () => {
    const profileFirst = build('technical-interview', ['profile']);
    assert.equal(profileFirst.memoryPolicy.allowHindsight, true);
    assert.equal(profileFirst.memoryPolicy.allowPriorAssistantFacts, true);
  });
});
