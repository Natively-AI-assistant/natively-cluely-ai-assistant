// Real-app source-switch repair (2026-07-14) — migration-greediness fix.
//
// ROOT CAUSE this pins: a seminar-mode prompt that says BOTH "by default
// answer from the uploaded thesis" AND "if I explicitly ask, use my résumé or
// the JD" was migrated by rev-1 to `reference_files_only` — a hard prison with
// NO allowed switches — because the strict legacy detector only saw the
// default clause and was blind to the override-grant clause. The real Electron
// app then answered explicit résumé/JD questions with a source-honest
// "I only answer from the document" clarification instead of the profile
// answer the prompt itself invited.
//
// THE FIX (rev-2): the strict lock to `reference_files_only` now requires the
// prompt to NOT also grant an explicit override. A strict-default-PLUS-grant
// prompt migrates to `reference_files_primary` (default doc, explicit
// résumé/JD/transcript switches allowed) — genuinely exclusive prompts
// ("answer ONLY from the document, do not use my résumé") still lock to the
// prison. GENERAL shape detection — no document/company/mode name hardcoded.
//
// Requires: npm run build:electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/services/modeSourceContract.js');
const mod = await import(pathToFileURL(modPath).href);

const {
  migrateSourceContractFromPrompt,
  promptGrantsExplicitSourceOverride,
  legacyPromptDetectsStrictDocumentGrounding,
  CURRENT_MIGRATION_REVISION,
} = mod;

function migrate(customContext) {
  return migrateSourceContractFromPrompt({ customContext, hasReferenceFiles: true, hasProfileFacts: false });
}

// ── The exact defect: strict default clause + explicit override grant ───────

test('INCIDENT REGRESSION: "default to the thesis, but use my résumé/JD if I ask" → reference_files_primary, NOT the reference_files_only prison', () => {
  const prompt = 'You are my seminar assistant. By default answer from the uploaded thesis. If I explicitly ask, use my résumé or the JD.';
  // The strict detector still fires on the default clause...
  assert.equal(legacyPromptDetectsStrictDocumentGrounding(prompt), true);
  // ...but the override-grant detector also fires, so we do NOT imprison it.
  assert.equal(promptGrantsExplicitSourceOverride(prompt), true);
  const c = migrate(prompt);
  assert.equal(c.sourceAuthority, 'reference_files_primary',
    'strict-default + explicit-override must migrate to reference_files_primary');
  assert.notDeepEqual(c.allowedExplicitSwitches, [], 'must allow explicit switches, not the empty prison set');
  assert.ok(c.allowedExplicitSwitches.includes('profile'), 'résumé grant → profile switch allowed');
  assert.ok(c.allowedExplicitSwitches.includes('job_description'), 'JD grant → job_description switch allowed');
  assert.equal(c.evidenceRequired, true, 'reference-file authority still requires evidence');
  assert.equal(c.defaultOwner, 'reference_files', 'default owner stays the document');
  assert.equal(c.origin, 'migrated_from_prompt');
  assert.equal(c.migrationRevision, CURRENT_MIGRATION_REVISION);
});

test('accent-insensitive: "you can also use my resume if I ask" (no accent) is detected the same as "résumé"', () => {
  const accented = migrate('Answer only from the uploaded document. You may also use my résumé if I ask.');
  const plain = migrate('Answer only from the uploaded document. You may also use my resume if I ask.');
  assert.equal(accented.sourceAuthority, 'reference_files_primary');
  assert.equal(plain.sourceAuthority, 'reference_files_primary');
  assert.ok(accented.allowedExplicitSwitches.includes('profile'));
  assert.ok(plain.allowedExplicitSwitches.includes('profile'));
});

// ── The strict prison must SURVIVE for genuinely exclusive prompts ──────────

test('genuinely exclusive prompt (no override grant) still locks to reference_files_only', () => {
  const prompt = 'Answer ONLY from the uploaded seminar document I provided. Stick strictly to the material in the reference file. Do not use outside knowledge or my resume.';
  assert.equal(legacyPromptDetectsStrictDocumentGrounding(prompt), true);
  assert.equal(promptGrantsExplicitSourceOverride(prompt), false,
    'an exclusive prompt that mentions "my resume" only to FORBID it is not an override grant');
  const c = migrate(prompt);
  assert.equal(c.sourceAuthority, 'reference_files_only');
  assert.deepEqual(c.allowedExplicitSwitches, []);
});

test('explicit FORBID of the profile ("do not use my résumé or the JD") is never mistaken for a grant', () => {
  const prompt = 'Answer only from the uploaded thesis. Do not use my résumé or the JD under any circumstances.';
  assert.equal(promptGrantsExplicitSourceOverride(prompt), false);
  const c = migrate(prompt);
  assert.equal(c.sourceAuthority, 'reference_files_only');
});

test('mixed forbid + grant: "never use my résumé, but you may use the meeting if I ask" grants ONLY the meeting', () => {
  const prompt = 'Answer only from the uploaded document. Never use my résumé. You may also use the meeting transcript if I ask.';
  assert.equal(promptGrantsExplicitSourceOverride(prompt), true);
  const c = migrate(prompt);
  assert.equal(c.sourceAuthority, 'reference_files_primary');
  assert.ok(c.allowedExplicitSwitches.includes('transcript'), 'meeting grant → transcript switch');
  assert.ok(!c.allowedExplicitSwitches.includes('profile'), 'the forbidden résumé must NOT become an allowed switch');
});

// ── The grant detector must not fire on ordinary strict/neutral prompts ─────

test('override-grant detector: does not false-positive on a plain strict prompt', () => {
  assert.equal(promptGrantsExplicitSourceOverride('Answer only from the uploaded document.'), false);
  assert.equal(promptGrantsExplicitSourceOverride(''), false);
  // "also" alone (no switch target) is not a grant.
  assert.equal(promptGrantsExplicitSourceOverride('Answer from the document. Also be concise and friendly.'), false);
  // a switch target alone (no permission cue) is not a grant.
  assert.equal(promptGrantsExplicitSourceOverride('This mode is about my resume writing course.'), false);
});

// ── LEAK-SAFETY: adversarial forbids (code-review 2026-07-14) ───────────────
//
// These are the shapes an earlier draft of the detector mis-read as grants,
// loosening a genuinely strict document-only mode into reference_files_primary
// — a real résumé→document contamination leak. Each MUST stay
// reference_files_only with no profile switch.

test('LEAK-SAFETY: target-FIRST forbid ("the resume should never be used") stays reference_files_only', () => {
  for (const prompt of [
    'Answer only from the uploaded document. The resume should never be used.',
    'Answer only from the uploaded document. My resume is off-limits and must not be referenced.',
    'Answer only from the uploaded document. Profile data is not to be used.',
    'Answer only from the uploaded document. The JD is off-limits.',
  ]) {
    assert.equal(promptGrantsExplicitSourceOverride(prompt), false, `must NOT grant: ${JSON.stringify(prompt)}`);
    const c = migrate(prompt);
    assert.equal(c.sourceAuthority, 'reference_files_only', `must stay prison: ${JSON.stringify(prompt)}`);
    assert.deepEqual(c.allowedExplicitSwitches, []);
  }
});

test('LEAK-SAFETY: doc-internal nouns (projects/experience/skills/background) describing the document are NOT a profile grant', () => {
  // A bare doc-internal noun with NO first-person possessive is the DOCUMENT's
  // content, not the candidate's profile — the override-grant detector must NOT
  // register a grant off it. (For a STRICT prompt this is what keeps the mode in
  // the reference_files_only prison; a non-strict prompt still reaches
  // reference_files_primary via the pre-existing ambiguous branch, whose full
  // switch set only enables EXPLICIT per-turn asks — the default owner stays the
  // document — so it is not a silent contamination path.)
  for (const prompt of [
    'Only use the uploaded PDF. It also covers work history and career background in chapter 3.',
    'Only use the uploaded PDF. It also covers the candidate\'s projects and experience in chapter 3.',
    'Answer only from the slides. You may cite the projects and results in the deck.',
  ]) {
    assert.equal(promptGrantsExplicitSourceOverride(prompt), false,
      `a bare doc-internal noun (no possessive) must not register a grant: ${JSON.stringify(prompt)}`);
  }
});

test('LEAK-SAFETY: a STRICT doc-only prompt with a bare doc-internal noun stays reference_files_only (the grant path never fires)', () => {
  // The regression that matters: a genuinely strict prompt must not be loosened
  // by a doc-descriptive noun. (These ARE strict — "answer only from … do not
  // use outside knowledge".)
  for (const prompt of [
    'Answer only from the uploaded document. Do not use outside knowledge. The paper covers projects and experience in chapter 3.',
    'Answer only from the uploaded PDF and do not go outside it. It also covers work history and career background.',
  ]) {
    const c = migrate(prompt);
    assert.equal(c.sourceAuthority, 'reference_files_only',
      `strict + bare doc noun must stay prison: ${JSON.stringify(prompt)}`);
    assert.deepEqual(c.allowedExplicitSwitches, []);
  }
});

test('LEAK-SAFETY: a possessive weak noun ("use my experience if I ask") IS a genuine profile grant', () => {
  const c = migrate('Answer from the uploaded document by default. If I ask, use my experience and background.');
  assert.equal(c.sourceAuthority, 'reference_files_primary');
  assert.ok(c.allowedExplicitSwitches.includes('profile'), 'possessive "my experience/background" is the candidate, not the doc');
});

test('LEAK-SAFETY: forbid-résumé + grant-meeting in one run-on sentence grants ONLY the meeting', () => {
  const prompt = 'Answer only from the uploaded document. My résumé must not be used, but you can also use the meeting transcript if I ask.';
  const c = migrate(prompt);
  // Either outcome is leak-safe: the résumé is NEVER an allowed switch.
  assert.ok(!c.allowedExplicitSwitches.includes('profile'), 'forbidden résumé must never become an allowed switch');
  if (c.sourceAuthority === 'reference_files_primary') {
    assert.ok(c.allowedExplicitSwitches.includes('transcript'));
  }
});

// ── LEAK-SAFETY round 2: cross-clause forbid + descriptive prose (review 2) ──
//
// The clause-scoped detector introduced a NEW leak class the second review
// caught: a résumé forbid in ONE clause must dominate a résumé grant in a
// DIFFERENT clause (the whole profile family collapses to a single `profile`
// switch downstream, so granting it re-admits the forbidden artifact). And a
// switch verb used DESCRIPTIVELY by a third-person subject must not be read as
// a user switch instruction. All prompts below are strict-prefixed, so any
// loosening is a genuine regression to a leak.

const STRICT = 'Answer only from the uploaded document. Do not go outside it. ';

test('LEAK-SAFETY: a résumé forbid in one clause dominates a same-family grant in a later clause', () => {
  for (const tail of [
    'My resume must never be used under any circumstances. But if I ask about my experience, use it.',
    'Do not ever reference my resume. When I ask, draw on my background.',
    'The resume is strictly forbidden. Consult my work history if I request it.',
    'Never use my resume. If I ask, use my CV.',
    'My profile is forbidden. Use my portfolio if I ask.',
  ]) {
    const prompt = STRICT + tail;
    assert.equal(promptGrantsExplicitSourceOverride(prompt), false,
      `a prompt-wide résumé forbid must dominate any later grant: ${JSON.stringify(tail)}`);
    const c = migrate(prompt);
    assert.equal(c.sourceAuthority, 'reference_files_only', `must stay prison: ${JSON.stringify(tail)}`);
    assert.ok(!c.allowedExplicitSwitches.includes('profile'), 'forbidden profile family never re-admitted across clauses');
  }
});

test('LEAK-SAFETY: a switch verb used DESCRIPTIVELY (third-person subject) is not a grant', () => {
  for (const tail of [
    'The paper discusses using my experience effectively.',
    'This deck will check my background thoroughly.',
    'The document explains referencing my career history.',
  ]) {
    const prompt = STRICT + tail;
    assert.equal(promptGrantsExplicitSourceOverride(prompt), false,
      `descriptive prose must not grant: ${JSON.stringify(tail)}`);
    assert.equal(migrate(prompt).sourceAuthority, 'reference_files_only');
  }
});

test('LEAK-SAFETY: negated-redirect prose ("refuse and cite only the deck", "direct them … instead") is not a grant', () => {
  for (const tail of [
    'When users check my background, refuse and cite only the deck.',
    'When students check my skills section, direct them to the syllabus instead.',
  ]) {
    const prompt = STRICT + tail;
    assert.equal(promptGrantsExplicitSourceOverride(prompt), false,
      `a redirect-AWAY instruction must not grant the source: ${JSON.stringify(tail)}`);
    assert.equal(migrate(prompt).sourceAuthority, 'reference_files_only');
  }
});

test('LEAK-SAFETY: emphatic/verbose in-clause forbid is not out-distanced by a later grant (unbounded negation)', () => {
  // A long qualifier phrase between negator and target must not let the forbid
  // be missed (the fixed-width-window escape, code-review round 3).
  const prompt = STRICT + 'Under no circumstances should you ever, even if the user seems to want it or demands it repeatedly across the whole session, use my resume. If I ask, use my resume.';
  const c = migrate(prompt);
  assert.equal(c.sourceAuthority, 'reference_files_only');
  assert.deepEqual(c.allowedExplicitSwitches, []);
});

test('LEAK-SAFETY: a self-contradicting RETRACTION ("use my resume … never do that / never appropriate") revokes the grant', () => {
  for (const tail of [
    'If I ask, use my resume, though honestly given how the mode is configured you should really never do that.',
    'Use my resume if I ask, but only after you confirm with three follow-up questions that this is truly never appropriate.',
    'You may use my résumé — actually, no, never do that.',
  ]) {
    const prompt = STRICT + tail;
    assert.equal(promptGrantsExplicitSourceOverride(prompt), false,
      `a retraction must revoke the grant: ${JSON.stringify(tail)}`);
    assert.equal(migrate(prompt).sourceAuthority, 'reference_files_only');
  }
});

test('RETRACTION guard does NOT fire on a legitimate grant whose forbid targets the DOCUMENT exception', () => {
  // "never go outside the document" negates a concrete non-switch noun, not a
  // deictic — the résumé grant must survive.
  const c = migrate('Use my resume if I ask, but never go outside the uploaded document otherwise.');
  assert.equal(c.sourceAuthority, 'reference_files_primary');
  assert.ok(c.allowedExplicitSwitches.includes('profile'), 'grant must survive a document-scoped "never"');
});

test('GRANT-SURVIVAL: genuine per-turn override grants still resolve to reference_files_primary with the right switches', () => {
  const g1 = migrate('By default answer from the uploaded thesis. If I explicitly ask, use my résumé or the JD.');
  assert.equal(g1.sourceAuthority, 'reference_files_primary');
  assert.deepEqual(new Set(g1.allowedExplicitSwitches), new Set(['profile', 'job_description']));

  const g2 = migrate('Answer only from the document. You may also use the meeting transcript if I ask.');
  assert.equal(g2.sourceAuthority, 'reference_files_primary');
  assert.deepEqual(g2.allowedExplicitSwitches, ['transcript']);

  const g3 = migrate('Answer only from the uploaded document. Never use my résumé. You may also use the meeting transcript if I ask.');
  assert.equal(g3.sourceAuthority, 'reference_files_primary');
  assert.deepEqual(g3.allowedExplicitSwitches, ['transcript'], 'forbidden résumé excluded; only the granted meeting survives');
});

// ── Self-heal: a rev-1 over-locked contract is eligible for re-migration ────

test('a rev-1-migrated contract (missing migrationRevision) is treated as stale for re-migration eligibility', () => {
  // Simulate the persisted shape produced by the OLD migrator: a
  // reference_files_only contract with no migrationRevision field. The
  // ModesManager self-heal gate treats (migrationRevision ?? 1) < CURRENT as
  // stale. We assert the numeric invariant the gate relies on here (the gate
  // itself is exercised in the ModesManager suite).
  const legacyPersisted = { origin: 'migrated_from_prompt' }; // no migrationRevision
  const rev = legacyPersisted.migrationRevision ?? 1;
  assert.ok(rev < CURRENT_MIGRATION_REVISION, 'a contract with no migrationRevision must count as pre-rev-2 (stale)');
  // A freshly-migrated contract is NOT stale.
  const fresh = migrate('By default use the uploaded thesis, but use my résumé if I ask.');
  assert.equal((fresh.migrationRevision ?? 1) < CURRENT_MIGRATION_REVISION, false);
});
