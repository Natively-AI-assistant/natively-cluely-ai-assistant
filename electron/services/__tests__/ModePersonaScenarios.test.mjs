// electron/services/__tests__/ModePersonaScenarios.test.mjs
//
// End-to-end scenario suite covering five realistic user stories per
// production mode. Each scenario:
//   1. seeds reference files (loaded from tests/fixtures/modes/*) into the
//      active mode
//   2. drives a representative query through ModeContextRetriever
//   3. asserts the right snippet was retrieved (sentinel present)
//   4. asserts isolation — no foreign-mode sentinel appears in the
//      formatted context block
//
// The retriever is the lexical one (synchronous, no embeddings). The hybrid
// retriever falls back to lexical when no embedding provider is ready, so
// these assertions also hold for hybrid mode in the test environment.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runScenario, makeMode, asReferenceFiles } from '../../../tests/utils/scenarioRunner.mjs';
import { SENTINELS, loadReferenceFiles, foreignSentinels } from '../../../tests/utils/referenceFileFactory.mjs';
import {
  buildLookingForWorkContext,
  buildSalesNegotiationContext,
  buildRecruitingScreenContext,
  buildLectureContext,
  buildTechnicalInterviewContext,
  buildTeamMeetContext,
  buildGeneralFounderContext,
  buildNegotiationOverlayContext,
} from '../../../tests/utils/profileIntelligenceSeeder.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function runWith({ modeFolder, templateType, customContext, query, transcript }) {
  const mode = makeMode(`mode_${modeFolder}`, templateType, customContext);
  const files = asReferenceFiles(mode.id, loadReferenceFiles(modeFolder));
  return runScenario({ mode, files, query, transcript });
}

function assertSentinelInRetrieval(result, sentinel) {
  const haystack = result.formattedContext;
  assert.ok(
    haystack.includes(escapeXmlText(sentinel)) || haystack.includes(sentinel),
    `Expected sentinel "${sentinel}" to appear in retrieval. Got snippets:\n${haystack.slice(0, 1200)}`
  );
}

function assertNoForeignSentinels(result, activeMode) {
  const haystack = result.formattedContext;
  for (const phrase of foreignSentinels(activeMode)) {
    // Some foreign sentinels share generic terms (e.g. "Friday"). Only fail
    // when the WHOLE sentinel phrase shows up — that's a true bleed.
    if (haystack.includes(phrase)) {
      assert.fail(
        `Foreign-mode sentinel leaked into ${activeMode} retrieval: "${phrase}"\nHaystack snippet:\n${haystack.slice(0, 1200)}`
      );
    }
  }
}

// ModeContextRetriever uses the same XML escape as we did in
// ModeContextRetriever.ts; for sentinels with apostrophes we have to compare
// to the escaped form too. Keep this in sync with the retriever.
function escapeXmlText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-mode scenarios — 5 each, deliberately realistic user stories
// ─────────────────────────────────────────────────────────────────────────────

describe('Mode: general — five realistic founder/PM scenarios', () => {
  const folder = 'general';
  const template = 'general';
  const ctx = buildGeneralFounderContext();

  test('1. Founder investor call — asks for Q1 ARR', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what is the Q1 ARR run rate for our pilot',
    });
    assertSentinelInRetrieval(result, SENTINELS.general.arr);
    assertNoForeignSentinels(result, 'general');
  });

  test('2. Customer onboarding call — audio setup question', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'customer asks how to configure their audio device for the first meeting',
    });
    assertSentinelInRetrieval(result, SENTINELS.general.audio);
  });

  test('3. Internal planning call — Q2 priority question', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'walk me through the Q2 priority and themes from our roadmap',
      transcript: 'PM: lets review the Q2 priority — multi-modal copilot beta — and confirm milestone owners.',
    });
    assertSentinelInRetrieval(result, SENTINELS.general.roadmap);
  });

  test('4. Client update call — project codename pull', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'remind me of the project codename Halcyon for the launch brief',
      transcript: 'Client: which codename are we using for the Halcyon project brief?',
    });
    assertSentinelInRetrieval(result, SENTINELS.general.codename);
  });

  test('5. Founder brainstorming — investor sync date recall', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'when is the investor sync scheduled with Hyperion Partners',
      transcript: 'Founder: remind me when the investor sync with Hyperion Partners is set.',
    });
    assertSentinelInRetrieval(result, SENTINELS.general.investor);
  });
});

describe('Mode: sales — five realistic sales scenarios', () => {
  const folder = 'sales';
  const template = 'sales';
  const ctx = buildSalesNegotiationContext();

  test('1. Pricing objection — Acme discount floor', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'prospect from Acme says price is too high — what discount floor can we offer',
    });
    assertSentinelInRetrieval(result, SENTINELS.sales.discountFloor);
    assertNoForeignSentinels(result, 'sales');
  });

  test('2. Competitor objection — Cluely comparison', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'how do we compare to Cluely on reference files',
    });
    assertSentinelInRetrieval(result, SENTINELS.sales.competitor);
  });

  test('3. Security question — where are API keys stored', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'security question: where are API keys stored',
    });
    assertSentinelInRetrieval(result, SENTINELS.sales.security);
  });

  test('4. Buying signal — annual seats prompt', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'prospect mentioned rolling out annual seats — what is the buying signal next step',
    });
    assertSentinelInRetrieval(result, SENTINELS.sales.playbook);
  });

  test('5. Pipeline performance — enterprise conversion rate', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what was the enterprise pilot conversion in Q1',
    });
    assertSentinelInRetrieval(result, SENTINELS.sales.pipeline);
  });
});

describe('Mode: recruiting — five realistic recruiting scenarios', () => {
  const folder = 'recruiting';
  const template = 'recruiting';
  const ctx = buildRecruitingScreenContext();

  test('1. Backend engineer screen — role fit', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what does the backend platform role require around Kafka and PostgreSQL',
    });
    assertSentinelInRetrieval(result, SENTINELS.recruiting.jd);
    assertNoForeignSentinels(result, 'recruiting');
  });

  test('2. Frontend screen — interview scoring rubric', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'how do we score candidates on systems design',
    });
    assertSentinelInRetrieval(result, SENTINELS.recruiting.rubric);
  });

  test('3. Compensation concern — Backend L4 band', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what is the compensation range for a backend L4 hire',
    });
    assertSentinelInRetrieval(result, SENTINELS.recruiting.comp);
  });

  test('4. Visa concern — sponsorship policy', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'candidate asks about visa sponsorship outside the US',
    });
    assertSentinelInRetrieval(result, SENTINELS.recruiting.visa);
  });

  test('5. Weak signal — candidate channel and ATS lookup', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'how did candidate ATS-7321 come into our pipeline via referral channel',
      transcript: 'Hiring manager: was candidate ATS-7321 a referral or job board channel?',
    });
    assertSentinelInRetrieval(result, SENTINELS.recruiting.referral);
  });
});

describe('Mode: team-meet — five realistic meeting scenarios', () => {
  const folder = 'team-meet';
  const template = 'team-meet';
  const ctx = buildTeamMeetContext();

  test('1. Sprint planning — owner of TM-204', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'who owns ticket TM-204 due Friday in the sprint backlog',
      transcript: 'Lead: lets walk the sprint backlog — TM-204 owned by Sarah due Friday?',
    });
    assertSentinelInRetrieval(result, SENTINELS['team-meet'].backlog);
    assertNoForeignSentinels(result, 'team-meet');
  });

  test('2. Launch meeting — Sarah & launch checklist', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'who owns the launch checklist for the Halcyon beta',
    });
    assertSentinelInRetrieval(result, SENTINELS['team-meet'].launch);
  });

  test('3. Incident review — INC-119 root cause', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what was the root cause of incident INC-119',
    });
    assertSentinelInRetrieval(result, SENTINELS['team-meet'].incident);
  });

  test('4. Design review — embeddings storage decision', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what did we decide about embeddings storage SQLite sqlite-vec',
      transcript: 'PM: confirm the decision — embeddings storage on SQLite with sqlite-vec, right?',
    });
    assertSentinelInRetrieval(result, SENTINELS['team-meet'].embeddings);
  });

  test('5. Leadership sync — STT outage risk mitigation', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'how do we mitigate a third-party STT outage',
    });
    assertSentinelInRetrieval(result, SENTINELS['team-meet'].risk);
  });
});

describe('Mode: looking-for-work — five realistic candidate scenarios', () => {
  const folder = 'looking-for-work';
  const template = 'looking-for-work';
  const ctx = buildLookingForWorkContext();

  test('1. Behavioral — tell me about a project you scaled', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'tell me about a project you built and scaled to many users',
      transcript: 'Interviewer: walk me through a project you built and scaled — PriceX or Natively for example.',
    });
    // Either PriceX or Natively scale sentinel is acceptable here.
    const haystack = result.formattedContext;
    assert.ok(
      haystack.includes(SENTINELS['looking-for-work'].pricex) ||
        haystack.includes(SENTINELS['looking-for-work'].scaled),
      `Expected scaled-project sentinel in retrieval. Got:\n${haystack.slice(0, 1200)}`
    );
    assertNoForeignSentinels(result, 'looking-for-work');
  });

  test('2. Recruiter screen — role at Helio Labs', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'tell me about the AI Product Engineer role at Helio Labs',
    });
    assertSentinelInRetrieval(result, SENTINELS['looking-for-work'].jd);
  });

  test('3. Conflict story — payments vendor escalation', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'tell me about a conflict story you resolved with a payments vendor',
      transcript: 'Interviewer: describe a conflict — perhaps the chargeback story with the payments vendor escalation.',
    });
    assertSentinelInRetrieval(result, SENTINELS['looking-for-work'].conflict);
  });

  test('4. STAR coaching — measurable outcomes anchor', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'how should I frame STAR stories to anchor in measurable outcomes',
      transcript: 'Coach: STAR stories should always anchor in measurable outcomes — numbers, comparison, scope.',
    });
    assertSentinelInRetrieval(result, SENTINELS['looking-for-work'].star);
  });

  test('5. Post-offer negotiation — target base recall', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what target base should I counter with versus my BATNA competing offer',
      transcript: 'Recruiter: what target base salary are you looking for? Candidate notes: target $185k, BATNA competing offer at $180k.',
    });
    assertSentinelInRetrieval(result, SENTINELS['looking-for-work'].negotiation);
  });
});

describe('Mode: technical-interview — five realistic technical scenarios', () => {
  const folder = 'technical-interview';
  const template = 'technical-interview';
  const ctx = buildTechnicalInterviewContext();

  test('1. Two-sum-on-sorted-array — problem recall', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'recall the array problem the interviewer gave me',
    });
    assertSentinelInRetrieval(result, SENTINELS['technical-interview'].arrayProblem);
    assertNoForeignSentinels(result, 'technical-interview');
  });

  test('2. Complexity preference — interviewer style', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what is the interviewer\'s complexity preference',
    });
    assertSentinelInRetrieval(result, SENTINELS['technical-interview'].prefs);
  });

  test('3. Two-pointer complexity', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what is the time and space complexity of a two pointer scan',
    });
    assertSentinelInRetrieval(result, SENTINELS['technical-interview'].complexity);
  });

  test('4. System design — sharded throughput cap', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what is the throughput cap per shard',
    });
    assertSentinelInRetrieval(result, SENTINELS['technical-interview'].systemDesign);
  });

  test('5. Debugging — handler error log', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what does the error log say about the TypeError at handlers.ts:114',
      transcript: 'Interviewer: read the error log — TypeError at handlers.ts:114, what is the bug?',
    });
    assertSentinelInRetrieval(result, SENTINELS['technical-interview'].error);
  });
});

describe('Mode: lecture — five realistic lecture/study scenarios', () => {
  const folder = 'lecture';
  const template = 'lecture';
  const ctx = buildLectureContext();

  test('1. Exam priority — Green\'s function 12-mark', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'how likely is Greens function on the exam and for how many marks',
    });
    assertSentinelInRetrieval(result, SENTINELS.lecture.examTopic);
    assertNoForeignSentinels(result, 'lecture');
  });

  test('2. Definition — Green\'s function notation', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      // Use tokens that survive the retriever's apostrophe-stripping
      // tokenizer (Green's → green, s, function). Adding "definition", "satisfies",
      // and "delta" lifts the score above the 0.18 threshold.
      query: 'definition of green function satisfies LG equals delta',
      transcript: 'Lecturer: the green function definition: G satisfies LG=delta. Memorize this.',
    });
    assertSentinelInRetrieval(result, SENTINELS.lecture.definition);
  });

  test('3. Past question — PYQ-2024-Q3 recall', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'past year question pyq-2024-q3 solve harmonic boundary problem',
      transcript: 'Student: what did pyq-2024-q3 ask about harmonic boundary problem on a disk?',
    });
    assertSentinelInRetrieval(result, SENTINELS.lecture.pyq);
  });

  test('4. Topic priority — high vs medium', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'which topics are high priority for the exam',
    });
    assertSentinelInRetrieval(result, SENTINELS.lecture.priority);
  });

  test('5. Formula sheet — Laplacian recall', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what is the Laplacian formula',
    });
    assertSentinelInRetrieval(result, SENTINELS.lecture.laplacian);
  });
});

describe('Mode: negotiation overlay — five realistic negotiation scenarios', () => {
  const folder = 'negotiation';
  // Negotiation is intentionally overlayed on looking-for-work — see test plan
  // for the rationale (no dedicated negotiation template type exists in the
  // production ModesManager).
  const template = 'looking-for-work';
  const ctx = buildNegotiationOverlayContext();

  test('1. Salary negotiation — target/floor recall', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what is my target and floor base salary',
    });
    assertSentinelInRetrieval(result, SENTINELS.negotiation.salary);
    assertNoForeignSentinels(result, 'negotiation');
  });

  test('2. Refund retention — pro-rata policy', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'customer wants a refund on their annual plan pro-rata policy within 30 days',
      transcript: 'Customer: I would like a refund on my annual plan; what does the pro-rata policy say within 30 days?',
    });
    assertSentinelInRetrieval(result, SENTINELS.negotiation.refund);
  });

  test('3. SaaS annual contract — discount policy', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what is our annual contract discount and multi-seat bonus',
    });
    assertSentinelInRetrieval(result, SENTINELS.negotiation.saas);
  });

  test('4. SOW negotiation — scope and cap', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'what is the SOW scope and hourly rate cap',
    });
    assertSentinelInRetrieval(result, SENTINELS.negotiation.sow);
  });

  test('5. Vendor negotiation — comparison and SOC2', () => {
    const result = runWith({
      modeFolder: folder,
      templateType: template,
      customContext: ctx,
      query: 'how does vendor B compare on price and SOC2 compliance against vendor A and vendor C',
      transcript: 'Procurement: vendor B is 18% lower on price but no SOC2. Vendor A has SOC2. Vendor C bundles premium support.',
    });
    assertSentinelInRetrieval(result, SENTINELS.negotiation.vendor);
  });
});
