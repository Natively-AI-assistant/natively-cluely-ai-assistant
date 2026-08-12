// Live report 2026-08-11: WTA (Cmd+1 / Cmd+Enter) with a screenshot in a
// looking-for-work mode answered, three times:
//
//     "This is not directly mentioned in the uploaded material."
//
// The user's own [CONTEXT-OS] trace showed the whole chain:
//   sourceAuthority=profile_only, sourceOwner=profile, questionPreview="",
//   forbiddenSources includes screen_context, selectedEvidenceCount=0,
//   finalAction="answer"  ← the KERNEL wanted to answer
//
// The evidence layer then overrode that into a refusal: with zero candidates,
// the coordinator/profile-service pack comes back
// `refuse_insufficient_evidence`, the govern sites set `govern: true`
// UNCONDITIONALLY, and WhatToAnswerLLM yields the canned string without ever
// calling the model. Meanwhile the identical screenshot pasted into
// manual-chat answered fine (868 chars, Gemini vision) — that path's V3
// fallback was GENERAL_KNOWLEDGE.
//
// The honest line (independent review, 2026-08-11): a refusal is only truthful
// when the mode's authority promises a BOUNDED UNIVERSE — the four strict
// authorities where "answer only from X" is the product contract. Those are
// exactly the ones modeSourceContract marks `evidenceRequired: true`. For
// profile_only / general_mixed / ask_if_ambiguous / profile_plus_transcript,
// failing to find evidence means FALL BACK TO THE MODEL, not refuse: the mode
// never promised source-exclusivity, so "not in the uploaded material" is a
// false statement about a universe that was never bounded (and in the
// reported case, never even populated — zero files).
//
// packGovernsGeneration is that line as a predicate. It gates `govern:` at the
// two coordinator sites; govern:false reverts the turn to the legacy path,
// which every consumer already respects (`_cog?.govern` guards in
// WhatToAnswerLLM/LLMHelper).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const { packGovernsGeneration, sourceAuthorityPermitsRefusal, clarificationIsActionable, buildInsufficientPropertyAnswer } =
  await import(pathToFileURL(path.join(base, 'intelligence/context-os/index.js')).href);

const STRICT = ['reference_files_only', 'reference_files_primary', 'reference_files_plus_transcript', 'transcript_only'];
const OPEN = ['profile_only', 'profile_plus_transcript', 'general_mixed', 'ask_if_ambiguous'];

describe('the reported turn — profile_only + empty evidence must NOT govern into a refusal', () => {
  test('the exact live case: profile_only + refuse_insufficient_evidence → legacy path', () => {
    assert.equal(packGovernsGeneration({
      answerPolicy: 'refuse_insufficient_evidence',
      sourceAuthority: 'profile_only',
    }), false, 'the model must get the turn (screenshot and all), not the canned string');
  });

  for (const sourceAuthority of OPEN) {
    test(`${sourceAuthority}: refusal does not govern`, () => {
      assert.equal(packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority }), false);
    });
  }
});

describe('honest refusals are preserved — the fabrication boundary must not move', () => {
  // A funding_source question against a real uploaded paper that only mentions
  // collaborations SHOULD refuse. Killing that reintroduces the fabrication
  // class this subsystem exists to prevent.
  for (const sourceAuthority of STRICT) {
    test(`${sourceAuthority}: refusal still governs (universe populated)`, () => {
      assert.equal(packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority, hasReferenceFiles: true }), true);
    });
  }

  // Review finding F2 (2026-08-12): the module's own docblock states the line
  // as "the bounded universe actually EXISTS", and clarificationIsActionable
  // already takes hasReferenceFiles — but packGovernsGeneration did not. The
  // reporting user's mode IS reference_files_primary with ZERO files; it was
  // saved only by a coordinator scope rule unrelated to this fix. The two
  // halves of one principle must be implemented symmetrically.
  for (const sourceAuthority of ['reference_files_only', 'reference_files_primary', 'reference_files_plus_transcript']) {
    test(`${sourceAuthority} + ZERO files: refusal does NOT govern`, () => {
      assert.equal(packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority, hasReferenceFiles: false }), false);
    });
  }

  test('transcript_only never has files — authority alone still governs', () => {
    assert.equal(packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority: 'transcript_only', hasReferenceFiles: false }), true);
  });

  test('omitting hasReferenceFiles keeps the old behaviour for non-file authorities only', () => {
    // Legacy callers that never pass files: transcript_only unaffected;
    // the reference trio FAILS TOWARD ANSWERING when files are unknown,
    // because refusing on an unverified universe is the whole bug class.
    assert.equal(packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority: 'transcript_only' }), true);
    assert.equal(packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority: 'reference_files_primary' }), false);
  });

  test('an answering pack always governs, any authority', () => {
    for (const sourceAuthority of [...STRICT, ...OPEN]) {
      assert.equal(packGovernsGeneration({ answerPolicy: 'answer', sourceAuthority }), true, sourceAuthority);
      assert.equal(packGovernsGeneration({ answerPolicy: 'answer_with_uncertainty', sourceAuthority }), true, sourceAuthority);
    }
  });

  test('ask_clarification is untouched by this change', () => {
    for (const sourceAuthority of [...STRICT, ...OPEN]) {
      assert.equal(packGovernsGeneration({ answerPolicy: 'ask_clarification', sourceAuthority }), true, sourceAuthority);
    }
  });

  test('an unknown/legacy authority fails toward answering, not refusing', () => {
    // 'legacy' and undefined reach the govern sites via `?? 'ask_if_ambiguous'`
    // fallbacks, but the predicate itself must also fail open: refusing on an
    // authority we cannot classify would recreate the reported bug for any
    // future authority value.
    assert.equal(packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority: 'legacy' }), false);
    assert.equal(packGovernsGeneration({ answerPolicy: 'refuse_insufficient_evidence', sourceAuthority: undefined }), false);
  });
});

describe('DRIFT GUARD: the strict set IS modeSourceContract.evidenceRequired', () => {
  // The predicate hand-mirrors EVIDENCE_REQUIRED_FOR_AUTHORITY rather than
  // importing it (services → context-os would be a layering inversion). This
  // test is the enforcement that the mirror cannot drift: it asserts the
  // predicate agrees with the real mapping for every authority the contract
  // module defines.
  test('predicate agrees with evidenceRequired for every authority', async () => {
    const { defaultSourceContractForNewMode } =
      await import(pathToFileURL(path.join(base, 'services/modeSourceContract.js')).href);
    // Derive the mapping from the public surface: every template's default
    // contract carries both fields.
    const seen = new Map();
    for (const t of ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'technical-interview', 'lecture', 'seminar']) {
      const c = defaultSourceContractForNewMode(t);
      seen.set(c.sourceAuthority, c.evidenceRequired);
    }
    assert.ok(seen.size >= 2, 'expected multiple distinct authorities across the templates');
    for (const [authority, evidenceRequired] of seen) {
      assert.equal(sourceAuthorityPermitsRefusal(authority), evidenceRequired,
        `${authority}: predicate says ${sourceAuthorityPermitsRefusal(authority)}, contract says evidenceRequired=${evidenceRequired}`);
    }
  });
});

describe('a clarify short-circuit must be ACTIONABLE (live report #2, 2026-08-11)', () => {
  // Second live report, same day, after the refuse-path fix: WTA screenshot in
  // a blank GENERAL-template mode answered
  //
  //   "This mode only answers from your uploaded material, so I'm not pulling
  //    from your résumé here. Switch to a mode that enables that source..."
  //
  // The general template's SEEDED contract claims reference_files_primary; the
  // mode had ZERO files; the kernel demoted sourceOwner to 'clarify'; and the
  // clarification short-circuit fired before the provider call. The contract
  // simultaneously FORBADE every profile source — so the message told the user
  // to switch modes to reach a resume it would not have used, about material
  // that was never uploaded, for a question that was never typed.
  //
  // The same honest line applies: a clarification between source universes is
  // only actionable when the mode's own bounded universe actually EXISTS. A
  // reference-bound authority with no files has nothing to disambiguate into —
  // the honest move is answering.
  for (const sourceAuthority of ['reference_files_only', 'reference_files_primary', 'reference_files_plus_transcript']) {
    test(`${sourceAuthority} + NO files: clarify is not actionable`, () => {
      assert.equal(clarificationIsActionable({ sourceAuthority, hasReferenceFiles: false }), false);
    });
    test(`${sourceAuthority} + files present: clarify stays actionable`, () => {
      assert.equal(clarificationIsActionable({ sourceAuthority, hasReferenceFiles: true }), true);
    });
  }

  test('non-reference authorities keep their clarifications regardless of files', () => {
    // ask_if_ambiguous / general_mixed clarifications disambiguate between
    // REAL universes (profile vs transcript vs docs) and must survive;
    // transcript_only never has files, so a files check must not gag it.
    for (const sourceAuthority of ['ask_if_ambiguous', 'general_mixed', 'profile_only', 'transcript_only']) {
      assert.equal(clarificationIsActionable({ sourceAuthority, hasReferenceFiles: false }), true, sourceAuthority);
    }
  });

  test('unknown authority fails toward answering the user, not gagging them', () => {
    // R8 (2026-08-12): this test's TITLE always stated the right invariant but
    // its assertion baked the inversion in — `true` here means the clarify
    // short-circuit MAY fire, i.e. the user IS gagged on an authority nobody
    // can classify. Unknown/legacy/future values must answer instead.
    assert.equal(clarificationIsActionable({ sourceAuthority: 'legacy', hasReferenceFiles: false }), false);
    assert.equal(clarificationIsActionable({ sourceAuthority: 'some_future_authority', hasReferenceFiles: true }), false);
    // null/undefined stay permissive: a missing field is "no contract at all",
    // which predates the authority system and keeps legacy flows untouched.
    assert.equal(clarificationIsActionable({ sourceAuthority: null, hasReferenceFiles: false }), true);
  });

  test('R8 drift guard: every ModeSourceAuthority the contract module can produce is classified', () => {
    // Mirrors the ModeSourceAuthority union (modeSourceContract.ts). If a new
    // authority is added there, clarificationIsActionable must learn it —
    // otherwise every mode carrying it is silently barred from clarifying.
    const allAuthorities = [
      'reference_files_only', 'reference_files_primary', 'reference_files_plus_transcript',
      'profile_only', 'profile_plus_transcript', 'transcript_only', 'general_mixed', 'ask_if_ambiguous',
    ];
    for (const sourceAuthority of allAuthorities) {
      const verdictWithFiles = clarificationIsActionable({ sourceAuthority, hasReferenceFiles: true });
      assert.equal(verdictWithFiles, true, `${sourceAuthority} with files must remain clarifiable`);
    }
  });
});

describe('the refusal string no longer lies about its source', () => {
  test('reference_files wording is byte-identical to before', () => {
    assert.equal(
      buildInsufficientPropertyAnswer({ property: 'unknown', sourceOwner: 'reference_files' }),
      'This is not directly mentioned in the uploaded material.');
    // and the legacy no-owner call keeps the old string, so existing callers
    // and the REFUSAL_SNIFF_RE repair path are unaffected
    assert.equal(
      buildInsufficientPropertyAnswer({ property: 'unknown' }),
      'This is not directly mentioned in the uploaded material.');
  });

  test('a profile-owned refusal names the profile, not phantom uploads', () => {
    const s = buildInsufficientPropertyAnswer({ property: 'unknown', sourceOwner: 'profile' });
    assert.ok(!/uploaded material/i.test(s), `must not claim uploaded material: ${s}`);
    assert.match(s, /profile/i);
    // keep the "not directly mentioned" stem — downstream refusal sniffers
    // (ipcHandlers REFUSAL_SNIFF_RE) key on it
    assert.match(s, /not directly mentioned/i);
  });

  test('the funding_source near-miss note survives on both owners', () => {
    for (const sourceOwner of ['reference_files', 'profile']) {
      const s = buildInsufficientPropertyAnswer({ property: 'funding_source', sourceOwner });
      assert.match(s, /collaboration is not the same as funding/);
    }
  });
});

describe('a developer diagnostic is never user-visible prose (live report #3, 2026-08-11)', () => {
  // The user was shown, verbatim:
  //     "sourceAuthority=reference_files_primary; requestedProperty=unknown"
  // — contract.reason, yielded as the ask_clarification answer. Reasons are
  // telemetry; users get the human question. Source-level tripwire, same style
  // as ContextOsStaticImport: if anyone reintroduces a reason yield, this
  // fails with the incident attached.
  test('no surface yields contract.reason', async () => {
    const fs = await import('node:fs');
    for (const f of ['electron/llm/WhatToAnswerLLM.ts', 'electron/LLMHelper.ts']) {
      const src = fs.readFileSync(path.resolve(process.cwd(), f), 'utf8');
      assert.ok(!/yield\s+_?cog\??\.?contract\.reason|yield\s+contract\.reason/.test(src),
        `${f}: contract.reason must never be yielded to the user`);
    }
  });

  test('the WTA doc-grounded govern site requires actual files', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/IntelligenceEngine.ts'), 'utf8');
    // documentGroundedCustomModeActive was proven TRUE with zero files —
    // the govern gate must pair it with a hasReferenceFiles check.
    // 2026-08-12: the gate keys on docGroundedEnforcementActive (R1: explicit
    // strict contract OR broad-with-files — restores parity with manual chat
    // for seeded modes the user actually uploaded documents into) AND keeps
    // the explicit files requirement as belt-and-braces (reference_files_only
    // can be strict with zero files).
    const gate = /docGroundedEnforcementActive\s*\n[^]{0,700}?hasReferenceFiles[^]{0,200}?contextOsEvidencePackEnabled/;
    assert.ok(gate.test(src), 'site-2 govern must key on strictDocumentGroundedActive AND require hasReferenceFiles');
  });
});
