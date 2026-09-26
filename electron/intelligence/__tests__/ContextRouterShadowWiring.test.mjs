// node:test — ContextRouter SHADOW WIRING (Phase 5).
//
// The manual chat path (electron/ipcHandlers.ts `gemini-chat-stream`) wires
// `routeContext()` in SHADOW / OBSERVE-ONLY mode behind the default-OFF flag
// `contextRouterV2`. The shadow block (ipcHandlers.ts ~L744-765) computes a
// ContextRouter decision, records it on the observe-only IntelligenceTrace, and
// emits a divergence telemetry marker when `routerDecision.useProfileTree`
// disagrees with the live profile-policy routing. The RETURN VALUE never gates
// `context`, `streamChat`, or any answer behavior.
//
// This suite exercises the REAL compiled `routeContext` from dist-electron using
// the EXACT input shape the shadow wiring passes:
//   { userQuery, source: 'manual_input', mode, profileAvailable, jdAvailable }
// and proves the routing decisions the Phase 5 spec cares about are CORRECT — so
// that the day this router is allowed to DRIVE, it is already right. It also
// proves routeContext is pure/safe to call in shadow (never throws on odd input).
//
// NOTE: ../../intelligence/__tests__/ContextRouter.test.mjs already covers similar
// cases but spreads a `base` of {profileAvailable, jdAvailable, hasLiveTranscript,
// referenceFilesAvailable} = all true. The shadow wiring passes ONLY the four
// fields above (no live transcript, no reference files), so this suite asserts the
// behavior under the shadow's actual, narrower input.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeContext } from '../../../dist-electron/electron/intelligence/ContextRouter.js';

// Mirrors the object literal built at electron/ipcHandlers.ts ~L747-753.
function shadowInput({ userQuery, mode, profileAvailable = true, jdAvailable = false }) {
  return {
    userQuery,
    source: 'manual_input',
    mode,
    profileAvailable,
    jdAvailable,
  };
}

// Mirrors the live `liveWantsProfile` proxy at electron/ipcHandlers.ts ~L755-756.
// We don't have planAnswer's output handy in a pure test, so we reconstruct the
// proxy from the router's pass-through fields (profileContextPolicy) to sanity
// check that the divergence comparison is meaningful for the cases below.
function liveWantsProfileProxy(decision) {
  // The live proxy is: profileContextPolicy === 'required' || requiredLayers ⊇
  // {stable_identity|resume|jd}. requiredLayersFor sets resume/jd exactly when the
  // policy is 'required', so policy==='required' is the dominant signal here.
  return decision.profileContextPolicy === 'required';
}

describe('ContextRouter shadow wiring — exact shadow input shape', () => {
  // (a) "what is my name?" manual → ProfileTree, no hybrid RAG.
  test('(a) identity ask → useProfileTree=true, useHybridRag=false', () => {
    const d = routeContext(shadowInput({ userQuery: 'what is my name?' }));
    assert.equal(d.useProfileTree, true, 'identity ask must use the profile tree');
    assert.equal(d.useHybridRag, false, 'identity must NOT trigger heavy RAG');
    assert.equal(d.answerType, 'identity_answer');
    assert.equal(d.profileContextPolicy, 'required');
  });

  // (b) sales mode "why is your product expensive?" → NO candidate profile.
  test('(b) sales mode → useProfileTree=false (no candidate profile in sales)', () => {
    const d = routeContext(shadowInput({ userQuery: 'why is your product expensive?', mode: 'sales' }));
    assert.equal(d.useProfileTree, false, 'sales must NOT inject the candidate profile');
    assert.equal(d.answerContract, 'sales_reply');
    assert.equal(d.profileContextPolicy, 'forbidden');
  });

  // (c) lecture mode "summarize this lecture" → lecture contract, no profile.
  test('(c) lecture mode → lecture contract + useProfileTree=false', () => {
    const d = routeContext(shadowInput({ userQuery: 'summarize this lecture', mode: 'lecture' }));
    assert.equal(d.useProfileTree, false, 'lecture must NOT inject the candidate profile');
    assert.match(d.answerContract, /lecture/, 'answerContract should relate to lecture');
    assert.equal(d.answerContract, 'lecture_notes');
    assert.equal(d.profileContextPolicy, 'forbidden');
  });

  // (d) "write code for two sum" → coding, no profile.
  test('(d) coding ask → useProfileTree=false', () => {
    const d = routeContext(shadowInput({ userQuery: 'write code for two sum' }));
    assert.equal(d.useProfileTree, false, 'coding must NOT inject the candidate profile');
    assert.equal(d.answerContract, 'coding_answer');
    assert.equal(d.profileContextPolicy, 'forbidden');
  });

  // (e) JD-fit "why am I a fit for this JD?" → profile + evidence RAG.
  //
  // 2026-07-11: AnswerPlanner's JD/Resume JIT pipeline (2026-07-07) added the
  // more specific 'resume_jd_fit_answer' type ("which of MY projects best
  // matches this JD?" — resume+jd mix) alongside the older, more generic
  // 'jd_fit_answer'. This exact phrasing now classifies as the newer type.
  // ContextRouter/ProfileIntelligenceRouter had NOT been updated to route
  // resume_jd_fit_answer (nor its siblings resume_jd_gap_answer /
  // resume_jd_intro_answer / jd_summary_answer / jd_requirements_answer /
  // jd_fact_answer) — they silently fell through to the general_assistant /
  // no-profile default despite AnswerPlanner itself (profileContextPolicyFor,
  // CANDIDATE_VOICE_TYPES) and ProfileOutputValidator (updated 2026-07-07)
  // both already treating resume_jd_fit_answer as a profile-required,
  // candidate-voice answer. Fixed in ContextRouter.ts (answerContractFor +
  // useHybridRag) and ProfileIntelligenceRouter.ts (PROFILE_ANSWER_TYPES).
  test('(e) jd-fit ask → useProfileTree=true + useHybridRag=true', () => {
    const d = routeContext(shadowInput({
      userQuery: 'why am I a fit for this JD?',
      mode: 'looking-for-work',
      jdAvailable: true,
    }));
    assert.equal(d.useProfileTree, true, 'jd-fit grounds in the candidate profile');
    assert.equal(d.useHybridRag, true, 'jd-fit pulls evidence via hybrid RAG');
    assert.equal(d.answerType, 'resume_jd_fit_answer');
    assert.equal(d.profileContextPolicy, 'required');
    assert.equal(d.answerContract, 'interview_detailed', 'resume+JD fit must get the detailed interview contract, not general_assistant');
  });

  // Sibling coverage: the OLDER, more generic jd_fit_answer type (still reachable
  // via other phrasings — see AnswerPlanner's classifier) must route identically.
  test('(e2) legacy jd_fit_answer phrasing still routes to profile + hybrid RAG', () => {
    const d = routeContext(shadowInput({
      userQuery: 'am I a good fit for this role',
      mode: 'looking-for-work',
      jdAvailable: true,
    }));
    assert.equal(d.answerType, 'jd_fit_answer', 'sanity: this phrasing must still hit the legacy type');
    assert.equal(d.useProfileTree, true);
    assert.equal(d.useHybridRag, true);
    assert.equal(d.answerContract, 'interview_detailed');
  });

  // The three resume+JD MIX types added 2026-07-07 must all ground in the
  // candidate profile (AnswerPlanner: profileContextPolicy 'required',
  // CANDIDATE_VOICE_TYPES). The three JD-ONLY types must NOT force the profile
  // (AnswerPlanner: profileContextPolicy 'allowed', excluded from
  // CANDIDATE_VOICE_TYPES) — they describe the target role, not the candidate.
  test('(f) resume_jd_gap_answer grounds in the candidate profile', () => {
    const d = routeContext(shadowInput({
      userQuery: 'how would you explain your lack of experience with Kubernetes for this JD',
      mode: 'looking-for-work',
      jdAvailable: true,
    }));
    assert.equal(d.answerType, 'resume_jd_gap_answer', 'sanity: this phrasing must hit the resume+JD gap type');
    assert.equal(d.useProfileTree, true, 'resume_jd_gap_answer must ground in the candidate profile');
    assert.equal(d.answerContract, 'interview_detailed');
    assert.equal(d.profileContextPolicy, 'required');
  });

  test('(g) resume_jd_intro_answer grounds in the candidate profile', () => {
    const d = routeContext(shadowInput({
      userQuery: 'tell me about yourself for this role',
      mode: 'looking-for-work',
      jdAvailable: true,
    }));
    assert.equal(d.answerType, 'resume_jd_intro_answer', 'sanity: this phrasing must hit the resume+JD intro type');
    assert.equal(d.useProfileTree, true, 'resume_jd_intro_answer must ground in the candidate profile');
    assert.equal(d.answerContract, 'interview_detailed');
    assert.equal(d.profileContextPolicy, 'required');
  });

  test('(h) jd_requirements_answer must NOT force candidate profile grounding', () => {
    const d = routeContext(shadowInput({
      userQuery: 'what are the top requirements in this JD',
      mode: 'looking-for-work',
      jdAvailable: true,
    }));
    assert.equal(d.answerType, 'jd_requirements_answer', 'sanity: this phrasing must hit the JD-only type');
    assert.equal(d.useProfileTree, false, 'JD-only answers must not force the candidate profile in');
    assert.equal(d.profileContextPolicy, 'allowed', 'JD-only answers describe the role, not the candidate');
    assert.equal(d.answerContract, 'interview_detailed', 'still a detailed answer, just not profile-forced');
  });
});

describe('ContextRouter shadow wiring — divergence proxy agrees on the canonical cases', () => {
  // For these unambiguous cases the live proxy (policy === 'required') and the
  // router's useProfileTree should AGREE → no spurious divergence telemetry. This
  // protects the shadow comparison from being pure noise on the common path.
  const agreeCases = [
    { userQuery: 'what is my name?', mode: undefined, jdAvailable: false },
    { userQuery: 'why is your product expensive?', mode: 'sales', jdAvailable: false },
    { userQuery: 'summarize this lecture', mode: 'lecture', jdAvailable: false },
    { userQuery: 'write code for two sum', mode: undefined, jdAvailable: false },
    { userQuery: 'why am I a fit for this JD?', mode: 'looking-for-work', jdAvailable: true },
  ];
  for (const c of agreeCases) {
    test(`no spurious divergence: "${c.userQuery}"${c.mode ? ` [${c.mode}]` : ''}`, () => {
      const d = routeContext(shadowInput(c));
      assert.equal(
        d.useProfileTree,
        liveWantsProfileProxy(d),
        'router useProfileTree must match the live profile-policy proxy on canonical cases (no shadow-divergence noise)',
      );
    });
  }
});

describe('ContextRouter shadow wiring — pure & safe to call in shadow', () => {
  test('never throws on empty / odd / missing-field input', () => {
    assert.doesNotThrow(() => routeContext(shadowInput({ userQuery: '' })));
    assert.doesNotThrow(() => routeContext(shadowInput({ userQuery: '   ' })));
    assert.doesNotThrow(() => routeContext(shadowInput({ userQuery: '???!!!' })));
    assert.doesNotThrow(() => routeContext({ userQuery: 'hi', source: 'manual_input' })); // no profile/jd flags
    assert.doesNotThrow(() => routeContext({ userQuery: 'hi' })); // no source at all
    // Unknown/garbage mode string must be ignored, not crash.
    assert.doesNotThrow(() => routeContext(shadowInput({ userQuery: 'hello', mode: 'Not-A-Real-Mode' })));
  });

  test('returns a complete, well-typed decision object (shape contract)', () => {
    const d = routeContext(shadowInput({ userQuery: 'what is my name?' }));
    for (const key of [
      'useProfileTree', 'useLiveTranscript', 'useHybridRag', 'useHindsightRecall',
      'useMeetingSummary', 'useBrowserDom', 'useReferenceFiles', 'useLectureMemory',
      'useDiagramIntelligence',
    ]) {
      assert.equal(typeof d[key], 'boolean', `${key} must be boolean`);
    }
    assert.equal(typeof d.answerContract, 'string');
    assert.equal(typeof d.maxLatencyMs, 'number');
    assert.equal(typeof d.reason, 'string');
    assert.equal(typeof d.answerType, 'string');
    assert.equal(typeof d.profileContextPolicy, 'string');
  });

  test('deterministic — same shadow input yields the same useProfileTree decision', () => {
    const mk = () => routeContext(shadowInput({ userQuery: 'introduce yourself', mode: 'technical-interview' }));
    const a = mk();
    const b = mk();
    assert.equal(a.useProfileTree, b.useProfileTree);
    assert.equal(a.answerType, b.answerType);
    assert.equal(a.answerContract, b.answerContract);
  });

  test('profileAvailable=false → useProfileTree=false even for an identity ask (honest about data)', () => {
    // Mirrors the shadow input when no resume is loaded. The router must not claim
    // it will use a profile that does not exist — important so the divergence
    // signal is meaningful (live routing also can't ground without a profile).
    const d = routeContext(shadowInput({ userQuery: 'what is my name?', profileAvailable: false }));
    assert.equal(d.useProfileTree, false, 'no profile loaded → cannot use the profile tree');
  });
});
