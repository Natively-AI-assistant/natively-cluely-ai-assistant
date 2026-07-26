// Context OS Phase 3 — SourceAuthorityKernel.
//
// Every sourceAuthority × the core invariants:
//   • reference_files_only → NO profile capabilities at all
//   • profile modes → NO reference-file capabilities
//   • prior assistant is NEVER evidence by default
//   • custom_mode_prompt is instruction, never evidence
//   • persona is style-only
//   • Hindsight ungranted in reference_files (memoryReadPolicy.allowHindsight=false)
//   • general ambiguous → clarify with instruction-only capabilities
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsSourceAuthorityKernel.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

const kernel = new co.SourceAuthorityKernel();

function build(overrides = {}) {
  return kernel.build({
    surface: 'manual_chat',
    question: 'What are the four main phases of the project?',
    activeModeId: 'mode-1',
    activeModeName: 'Seminar',
    sourceAuthority: 'reference_files_only',
    answerShape: 'list',
    voicePerspective: 'assistant_explanation',
    enforcement: 'observe',
    hasReferenceFiles: true,
    hasProfileFacts: true,
    hasLiveTranscript: true,
    ...overrides,
  });
}

const kindsOf = (contract) => contract.allowedSources.map((c) => c.sourceKind);
const authorityOf = (contract, kind) =>
  contract.allowedSources.find((c) => c.sourceKind === kind)?.authority ?? 'absent';

// ── reference_files_only ────────────────────────────────────────────────────

test('reference_files_only: sourceOwner=reference_files, profile capabilities ABSENT', () => {
  const c = build();
  assert.equal(c.sourceOwner, 'reference_files');
  const kinds = kindsOf(c);
  for (const k of ['profile_resume', 'profile_project', 'profile_jd', 'profile_persona', 'custom_profile_notes', 'okf_profile_card']) {
    assert.ok(!kinds.includes(k), `${k} must be absent`);
    assert.ok(c.forbiddenSources.includes(k), `${k} must be forbidden`);
  }
  assert.ok(kinds.includes('mode_reference_chunk'));
  assert.equal(authorityOf(c, 'mode_reference_chunk'), 'evidence');
});

test('reference_files_only: transcript is referent-only; hindsight + prior claims forbidden', () => {
  const c = build();
  assert.equal(authorityOf(c, 'live_transcript'), 'referent_only');
  assert.ok(c.referentOnlySources.includes('live_transcript'));
  assert.ok(c.forbiddenSources.includes('hindsight_memory'));
  assert.ok(c.forbiddenSources.includes('prior_assistant_claim'));
  assert.equal(c.memoryReadPolicy.allowHindsight, false);
  assert.equal(c.memoryReadPolicy.allowPriorAssistantFacts, false);
  assert.equal(c.conflictPolicy, 'reference_files_win');
});

test('reference_files_plus_transcript: transcript upgraded to evidence, profile still forbidden', () => {
  const c = build({ sourceAuthority: 'reference_files_plus_transcript' });
  assert.equal(c.sourceOwner, 'reference_files');
  assert.equal(authorityOf(c, 'live_transcript'), 'evidence');
  assert.ok(c.forbiddenSources.includes('profile_resume'));
});

test('reference_files_only without reference files → clarify (nothing to own the turn)', () => {
  const c = build({ hasReferenceFiles: false });
  assert.equal(c.sourceOwner, 'clarify');
  // Clarify: instructions only, no factual capabilities.
  const evidenceKinds = c.allowedSources.filter((s) => s.authority === 'evidence');
  assert.equal(evidenceKinds.length, 0);
});

// ── profile modes ───────────────────────────────────────────────────────────

test('profile_only: profile owns; reference files ABSENT; persona is style-only', () => {
  const c = build({ sourceAuthority: 'profile_only', question: 'What is my best project?' });
  assert.equal(c.sourceOwner, 'profile');
  assert.equal(c.requestedProperty, 'candidate_project');
  const kinds = kindsOf(c);
  assert.ok(kinds.includes('profile_resume'));
  assert.ok(!kinds.includes('mode_reference_file'));
  assert.ok(!kinds.includes('mode_reference_chunk'));
  assert.ok(!kinds.includes('okf_document_card'));
  assert.ok(c.forbiddenSources.includes('mode_reference_file'));
  assert.equal(authorityOf(c, 'profile_persona'), 'style');
  assert.equal(c.conflictPolicy, 'profile_wins');
});

test('profile_plus_transcript: mixed ownership — profile is evidence, transcript is peer evidence', () => {
  // Knowledge Source canonical-gate repair (2026-07-16): profile_plus_transcript
  // now resolves to sourceOwner='mixed' (matches legacy resolveSourceOwnership).
  // Both profile and transcript are valid owners; the kernel permits BOTH
  // as evidence. The retrieval layer (orchestrator gate) is what filters
  // out the transcript when the question is purely candidate-directed —
  // the kernel contract permits it, which is the conservative choice.
  const c = build({ sourceAuthority: 'profile_plus_transcript', question: 'What are my strongest skills?' });
  assert.equal(c.sourceOwner, 'mixed');
  assert.equal(authorityOf(c, 'profile_resume'), 'evidence');
  assert.equal(authorityOf(c, 'live_transcript'), 'evidence');
});

test('profile mode without profile facts: never clarifies — retrieval layer handles empty', () => {
  // Knowledge Source canonical-gate repair (2026-07-16): profile_only is
  // never ambiguous — the authority itself names the only possible owner.
  // With no facts loaded the kernel still resolves sourceOwner='profile';
  // the retrieval layer naturally returns empty, surfacing as a no-evidence
  // answer / refusal rather than a source-ownership clarification question
  // (which would have nothing to clarify between).
  const c = build({ sourceAuthority: 'profile_only', hasProfileFacts: false });
  assert.equal(c.sourceOwner, 'profile');
  assert.notEqual(c.sourceOwner, 'clarify');
});

// ── transcript_only ─────────────────────────────────────────────────────────

test('transcript_only: transcript+meeting_rag evidence; profile and reference forbidden', () => {
  const c = build({ sourceAuthority: 'transcript_only', question: 'What did they say about the deadline?' });
  assert.equal(c.sourceOwner, 'transcript');
  assert.equal(authorityOf(c, 'live_transcript'), 'evidence');
  assert.equal(authorityOf(c, 'meeting_rag_chunk'), 'evidence');
  assert.ok(c.forbiddenSources.includes('profile_resume'));
  assert.ok(c.forbiddenSources.includes('mode_reference_file'));
  assert.equal(c.conflictPolicy, 'transcript_wins');
});

test('transcript_only without live transcript → clarify', () => {
  const c = build({ sourceAuthority: 'transcript_only', hasLiveTranscript: false });
  assert.equal(c.sourceOwner, 'clarify');
});

// ── general / ambiguous ─────────────────────────────────────────────────────

test('general_mixed + ambiguous term → clarify with ask_clarification policy', () => {
  const c = build({ sourceAuthority: 'general_mixed', question: 'What are the project phases?' });
  assert.equal(c.sourceOwner, 'clarify');
  assert.equal(c.conflictPolicy, 'ask_clarification');
});

test('ask_if_ambiguous + source-owned noun (>=2 universes) → clarify', () => {
  // Source-owned nouns still clarify when >=2 universes exist.
  for (const q of ['What model is used?', 'What is the current result?', 'What was that system again?']) {
    const c = build({ sourceAuthority: 'ask_if_ambiguous', question: q });
    assert.equal(c.sourceOwner, 'clarify', `expected clarify for "${q}"`);
  }
});

test('H1 fix: bare deictics ("it") no longer force clarify (avoid false-clarify on general knowledge)', () => {
  // "Tell me about it" has no source-owned noun → answer normally, not clarify.
  const c = build({ sourceAuthority: 'ask_if_ambiguous', question: 'Tell me about it' });
  assert.equal(c.sourceOwner, 'unknown', 'bare deictic must not force clarify');
});

test('H1 fix: single-universe general question is answered, not clarified', () => {
  // Only ONE universe (a document) → nothing to disambiguate BETWEEN → answer.
  const c = build({ sourceAuthority: 'general_mixed', question: 'What model is used?', hasReferenceFiles: true, hasProfileFacts: false, hasLiveTranscript: false });
  assert.equal(c.sourceOwner, 'unknown', 'single-universe question must not clarify');
});

test('H1 fix: general-knowledge question with NO universes is answered normally', () => {
  const c = build({ sourceAuthority: 'general_mixed', question: 'What is the latest React version?', hasReferenceFiles: false, hasProfileFacts: false, hasLiveTranscript: false });
  assert.equal(c.sourceOwner, 'unknown');
});

test('general_mixed + unambiguous question → unknown owner with conservative grants', () => {
  const c = build({ sourceAuthority: 'general_mixed', question: 'How do I reverse a linked list in Python?' });
  assert.equal(c.sourceOwner, 'unknown');
  // No hindsight, no prior claims, no screen/browser.
  for (const k of ['hindsight_memory', 'prior_assistant_claim', 'screen_context', 'browser_dom']) {
    assert.ok(c.forbiddenSources.includes(k), `${k} must be forbidden in unknown owner`);
  }
});

// ── Universal invariants (every authority) ──────────────────────────────────

const ALL_AUTHORITIES = [
  'reference_files_only',
  'reference_files_plus_transcript',
  'transcript_only',
  'profile_only',
  'profile_plus_transcript',
  'general_mixed',
  'ask_if_ambiguous',
];

test('INVARIANT: prior assistant is never evidence, in ANY authority', () => {
  for (const sourceAuthority of ALL_AUTHORITIES) {
    const c = build({ sourceAuthority });
    assert.notEqual(authorityOf(c, 'prior_assistant_message'), 'evidence', sourceAuthority);
    assert.notEqual(authorityOf(c, 'prior_assistant_claim'), 'evidence', sourceAuthority);
    assert.equal(c.memoryReadPolicy.allowPriorAssistantFacts, false, sourceAuthority);
  }
});

test('INVARIANT: custom_mode_prompt is instruction (never evidence) in ANY authority', () => {
  for (const sourceAuthority of ALL_AUTHORITIES) {
    const c = build({ sourceAuthority });
    const a = authorityOf(c, 'custom_mode_prompt');
    assert.ok(a === 'instruction' || a === 'absent', `${sourceAuthority}: got ${a}`);
    assert.notEqual(a, 'evidence', sourceAuthority);
  }
});

test('INVARIANT: browser_dom and screen_context are never granted by default', () => {
  for (const sourceAuthority of ALL_AUTHORITIES) {
    const c = build({ sourceAuthority });
    assert.equal(authorityOf(c, 'browser_dom'), 'absent', sourceAuthority);
    assert.equal(authorityOf(c, 'screen_context'), 'absent', sourceAuthority);
  }
});

test('INVARIANT: memoryWritePolicy never allows unverified claims', () => {
  for (const sourceAuthority of ALL_AUTHORITIES) {
    const c = build({ sourceAuthority });
    assert.equal(c.memoryWritePolicy.allowUnverifiedClaims, false, sourceAuthority);
  }
});

test('INVARIANT: allowed/forbidden partition — every kind is exactly one of allowed|forbidden', () => {
  for (const sourceAuthority of ALL_AUTHORITIES) {
    const c = build({ sourceAuthority });
    const allowed = new Set(kindsOf(c));
    for (const k of co.ALL_SOURCE_KINDS) {
      assert.notEqual(allowed.has(k), c.forbiddenSources.includes(k),
        `${sourceAuthority}: ${k} must be in exactly one of allowed/forbidden`);
    }
  }
});

test('INVARIANT: kernel is deterministic (identical decisions for identical input)', () => {
  const a = build();
  const b = build();
  // turnId differs (identity); everything decision-relevant matches.
  assert.equal(a.sourceOwner, b.sourceOwner);
  assert.deepEqual(kindsOf(a), kindsOf(b));
  assert.deepEqual(a.forbiddenSources, b.forbiddenSources);
  assert.equal(a.requestedProperty, b.requestedProperty);
});

// ── Explicit user source override ───────────────────────────────────────────

test('explicit profile ask in a strict reference mode → clarify (never silent grant)', () => {
  const c = build({ userExplicitSource: 'profile' });
  assert.equal(c.sourceOwner, 'clarify');
});

test('explicit profile ask in general mode with facts → profile', () => {
  const c = build({ sourceAuthority: 'general_mixed', userExplicitSource: 'profile', question: 'What is my best project?' });
  assert.equal(c.sourceOwner, 'profile');
});

// ── PII + trust stamping ────────────────────────────────────────────────────

test('profile capabilities carry pii=true; reference capabilities do not', () => {
  const c = build({ sourceAuthority: 'profile_only' });
  const resume = c.allowedSources.find((s) => s.sourceKind === 'profile_resume');
  assert.equal(resume.pii, true);
  const ref = build().allowedSources.find((s) => s.sourceKind === 'mode_reference_chunk');
  assert.equal(ref.pii, false);
  assert.equal(ref.trustLevel, 'user_uploaded');
});

test('scenario A trace shape: doc seminar "four phases" question', () => {
  const c = build();
  assert.equal(c.answerShape, 'list');
  assert.equal(c.requestedProperty, 'phase_or_stage');
  assert.equal(c.sourceOwner, 'reference_files');
  const kinds = kindsOf(c);
  for (const k of ['mode_reference_file', 'mode_reference_chunk', 'okf_document_card']) {
    assert.ok(kinds.includes(k));
  }
  assert.ok(c.referentOnlySources.includes('live_transcript'));
  assert.ok(c.referentOnlySources.includes('prior_assistant_message'));
  for (const k of ['profile_resume', 'profile_project', 'profile_jd', 'profile_persona', 'custom_profile_notes', 'hindsight_memory', 'prior_assistant_claim']) {
    assert.ok(c.forbiddenSources.includes(k), `${k} must be forbidden`);
  }
});

test('buildAmbiguousSourceClarification names the three source universes, no entities', () => {
  const line = co.buildAmbiguousSourceClarification();
  assert.match(line, /uploaded document/i);
  assert.match(line, /resume/i);
  assert.match(line, /meeting/i);
});
