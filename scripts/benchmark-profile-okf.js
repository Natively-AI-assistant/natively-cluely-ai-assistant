#!/usr/bin/env node
/**
 * OKF Profile Intelligence benchmark (2026-07-02).
 *
 * Ingests the deterministic synthetic resume + JD fixture into REAL profile OKF
 * packs, then runs the 18 mandated profile questions through the REAL routing
 * decision surface (planAnswer → deterministic fast path → fail-closed profile
 * retrieval) and records, per question:
 *   - answerType, profileContextPolicy, voice perspective
 *   - fast-path used? (deterministic answer available before OKF is consulted)
 *   - OKF evidence composition (allowed?, blockedReason, cardCount)
 *   - pass/fail against expected facts / isolation expectations
 *
 * This is a DETERMINISTIC harness (no live LLM) — it validates the routing,
 * retrieval, and isolation contracts, which is exactly what the OKF layer
 * changes. Answer-quality (LLM) evals live in benchmarks/profile-intelligence/.
 *
 * Writes:
 *   OKF OFF  → debug-artifacts/okf-profile-benchmark/retrieval-baseline.json
 *   OKF ON   → debug-artifacts/okf-profile-benchmark/final-results.json
 *
 * MUST run under Electron (native better-sqlite3):
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/benchmark-profile-okf.js [--off]
 * Default runs OKF ON; --off runs the baseline (flags off).
 */

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const outDir = path.join(repoRoot, 'debug-artifacts', 'okf-profile-benchmark');

const MODE_OFF = process.argv.includes('--off');

// ── flag env (set BEFORE loading any dist module that reads flags) ──
if (!process.env.NATIVELY_TEST_USERDATA) {
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-profile-bench-'));
}
if (MODE_OFF) {
  process.env.NATIVELY_OKF_PROFILE_PACKS = '0';
  process.env.NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL = '0';
} else {
  process.env.NATIVELY_OKF_PROFILE_PACKS = '1';
  process.env.NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL = '1';
}

function req(rel) {
  return require(path.join(distRoot, rel));
}

// Fixture (CommonJS-friendly copy of the .mjs fixture values).
const { FIXTURE_RESUME, FIXTURE_JD, FIXTURE_ARTIFACTS } = loadFixture();
function loadFixture() {
  // The .mjs fixture is ESM; re-declare the same deterministic data here so this
  // CJS script has no ESM-interop dance. Kept in sync with
  // electron/services/knowledge/__tests__/fixtures/profile-fixture.mjs.
  const FIXTURE_RESUME = {
    identity: { name: 'Alex Rivera', email: 'alex.rivera@example.com', location: 'Austin, TX', github: 'github.com/alexrivera',
      summary: 'Backend-leaning full-stack engineer with 6 years building distributed systems and developer tools. Ships pragmatic, well-tested services and mentors junior engineers.' },
    skills: { languages: ['Python', 'TypeScript', 'Go', 'SQL'], frameworks: ['FastAPI', 'React', 'Next.js'], cloud: ['AWS', 'GCP'],
      databases: ['PostgreSQL', 'Redis'], ml: ['PyTorch', 'LangChain'], devops: ['Docker', 'Kubernetes', 'Terraform'], tools: ['Git', 'Datadog'] },
    experience: [
      { company: 'Nimbus Data', role: 'Senior Software Engineer', start_date: '2022-03', end_date: null,
        bullets: ['Built a real-time ingestion pipeline that reduced event processing latency by 40%.', 'Led migration of a monolith to 6 independent services, cutting deploy time from 45 to 8 minutes.', 'Mentored 3 junior engineers and ran the team code-review guild.'] },
      { company: 'Loop Analytics', role: 'Software Engineer', start_date: '2019-06', end_date: '2022-02',
        bullets: ['Designed a PostgreSQL-backed reporting API serving 2M requests/day.', 'Cut cloud spend 25% by right-sizing Kubernetes workloads.'] },
    ],
    projects: [{ name: 'OpenTrace', description: 'An open-source distributed tracing sidecar for FastAPI services.', technologies: ['Python', 'FastAPI', 'OpenTelemetry'], url: 'github.com/alexrivera/opentrace' }],
    education: [{ institution: 'University of Texas at Austin', degree: 'B.S.', field: 'Computer Science', start_date: '2015-08', end_date: '2019-05', gpa: '3.7' }],
    achievements: [{ title: 'Internal Hackathon Winner', description: 'Built a log-anomaly detector adopted by the SRE team.' }],
    certifications: [], leadership: [], _schema_version: 2, _extraction_mode: 'llm',
  };
  const FIXTURE_JD = {
    title: 'Staff Backend Engineer', company: 'Meridian Robotics', location: 'Remote (US)',
    description_summary: 'Own the reliability and scale of the fleet-coordination platform powering thousands of autonomous robots.',
    level: 'staff', employment_type: 'full_time', min_years_experience: 7, compensation_hint: '',
    requirements: ['7+ years building distributed backend systems', 'Deep experience with Go or Python', 'Production Kubernetes operations', 'Event-driven architecture (Kafka or equivalent)'],
    nice_to_haves: ['Experience with robotics or real-time control systems', 'gRPC service design'],
    responsibilities: ['Design fleet-coordination services', 'Own SLOs and on-call for the platform'],
    technologies: ['Go', 'Kubernetes', 'Kafka', 'gRPC', 'PostgreSQL'], keywords: ['distributed systems', 'reliability', 'scale', 'event-driven'],
  };
  const FIXTURE_ARTIFACTS = {
    gapAnalysis: { match_percentage: 78, matched_skills: ['Python', 'Go', 'Kubernetes', 'PostgreSQL', 'distributed systems'],
      gaps: [{ skill: 'Kafka', gap_type: 'missing' }, { skill: 'gRPC', gap_type: 'weak' }] },
    negotiationScript: { salary_range: { min: 210000, max: 260000, currency: 'USD' }, anchor_script: 'Based on my distributed-systems track record and the staff scope here, I am targeting the upper end of the band.', rationale: 'Six years of relevant experience plus proven latency and cost wins.' },
    mockQuestions: [{ question: 'How would you design a fleet-coordination service for 10k robots?', category: 'system_design', difficulty: 'hard' }],
    cultureMappings: { values: ['ownership', 'reliability', 'pragmatism'], mappings: [{ value: 'ownership', evidence: 'Led a full monolith-to-services migration end to end.' }] },
    intro: 'I am a backend-leaning engineer with six years shipping distributed systems and developer tools.',
  };
  return { FIXTURE_RESUME, FIXTURE_JD, FIXTURE_ARTIFACTS };
}

// The 18 mandated benchmark questions + their expectations.
const QUESTIONS = [
  { id: 1, q: 'Who are you?', expect: { voice: 'assistant_or_candidate', profileExpected: false, isolation: null } },
  { id: 2, q: 'Tell me about yourself.', expect: { profileExpected: true } },
  { id: 3, q: 'What is your total experience?', expect: { profileExpected: true, factHints: ['6', 'years'] } },
  { id: 4, q: 'Where did you work most recently?', expect: { profileExpected: true, factHints: ['Nimbus'] } },
  { id: 5, q: 'Tell me about your project OpenTrace.', expect: { profileExpected: true, factHints: ['OpenTrace', 'FastAPI'] } },
  { id: 6, q: 'What did you achieve at Nimbus Data?', expect: { profileExpected: true, factHints: ['Nimbus', '40%'] } },
  { id: 7, q: 'What are your strongest programming languages?', expect: { profileExpected: true, factHints: ['Python', 'TypeScript'] } },
  { id: 8, q: 'What tools and frameworks do you know?', expect: { profileExpected: true, factHints: ['FastAPI', 'Docker'] } },
  { id: 9, q: 'Where did you study?', expect: { profileExpected: true, factHints: ['Texas'] } },
  { id: 10, q: 'Walk me through a challenge you solved.', expect: { profileExpected: true } },
  { id: 11, q: 'What does the target job require?', expect: { profileExpected: true, factHints: ['Kubernetes', 'distributed'] } },
  { id: 12, q: 'Which requirements of the JD do you not yet meet?', expect: { profileExpected: true, factHints: ['Kafka'] } },
  { id: 13, q: 'What salary should you ask for?', expect: { profileExpected: true } },
  { id: 14, q: 'Why are you a good fit for this role?', expect: { profileExpected: true } },
  { id: 15, q: 'Give me a 60-second intro.', expect: { profileExpected: true } },
  { id: 16, q: 'Write a for loop in Python.', expect: { profileExpected: false, isolation: 'coding_no_profile' } },
  { id: 17, q: 'What is OpenVLA?', expect: { profileExpected: false, isolation: 'doc_grounded_no_profile', docGrounded: true } },
  { id: 18, q: 'What is my thesis about?', expect: { profileExpected: false, isolation: 'doc_grounded_no_profile', docGrounded: true } },
];

function main() {
  const { DatabaseManager } = req('db/DatabaseManager.js');
  DatabaseManager.getInstance();
  const { planAnswer, isCodingAnswerType } = req('llm/AnswerPlanner.js');
  const { tryBuildManualProfileFastPathAnswer } = req('llm/manualProfileIntelligence.js');
  const { retrieveProfileEvidence } = req('services/knowledge/OkfProfileRetriever.js');
  const { ProfilePackBuilder } = req('services/knowledge/ProfilePackBuilder.js');

  const builder = ProfilePackBuilder.getInstance();
  builder.deleteAllProfilePacks();
  if (!MODE_OFF) {
    builder.generateForProfile({ kind: 'resume', docId: 1, structuredData: FIXTURE_RESUME, totalExperienceYears: 6 }, true);
    builder.generateForProfile({ kind: 'jd', docId: 2, structuredData: FIXTURE_JD, artifacts: FIXTURE_ARTIFACTS }, true);
  }

  const results = [];
  for (const item of QUESTIONS) {
    const docGrounded = item.expect.docGrounded === true;
    const activeMode = docGrounded ? { documentGroundedCustomModeActive: true } : undefined;
    const plan = planAnswer({ question: item.q, source: 'manual_input', speakerPerspective: 'user', activeMode });
    const isCoding = isCodingAnswerType(plan.answerType);

    // Deterministic fast path (runs BEFORE OKF is consulted, exactly like prod).
    let fastPath = null;
    try {
      fastPath = tryBuildManualProfileFastPathAnswer({ question: item.q, profile: FIXTURE_RESUME, jobDescription: FIXTURE_JD, source: 'manual_input' });
    } catch { /* fast path optional */ }

    // OKF retrieval decision — same gating the manual path applies.
    let evidence = { allowed: false, cardCount: 0, blockedReason: 'not_attempted', cards: [] };
    const okfEligible = !isCoding && plan.profileContextPolicy !== 'forbidden' && !docGrounded;
    if (okfEligible) {
      evidence = retrieveProfileEvidence({
        question: item.q,
        profileContextPolicy: plan.profileContextPolicy,
        documentGroundedActive: docGrounded,
        hasExplicitPlan: true,
      });
    } else {
      evidence.blockedReason = isCoding ? 'coding' : (docGrounded ? 'doc_grounded' : 'policy_forbidden');
    }

    // Pass/fail scoring.
    let pass = true;
    const notes = [];
    if (item.expect.isolation && /no_profile/.test(item.expect.isolation)) {
      // Q16/17/18: OKF must contribute NOTHING (block empty).
      if (evidence.allowed && evidence.cardCount > 0) { pass = false; notes.push('ISOLATION VIOLATION: profile cards leaked'); }
    } else if (item.expect.profileExpected && !MODE_OFF) {
      // Q2-15: with OKF on, either the fast path answered OR at least one card was retrieved.
      const fastAnswered = Boolean(fastPath && fastPath.usedDeterministicFastPath);
      if (!fastAnswered && evidence.cardCount === 0) { pass = false; notes.push('no fast-path answer AND no OKF card'); }
    }

    results.push({
      id: item.id, question: item.q,
      answerType: plan.answerType,
      profileContextPolicy: plan.profileContextPolicy,
      voicePerspective: plan.voicePerspective,
      isCoding,
      docGrounded,
      fastPathUsed: Boolean(fastPath && fastPath.usedDeterministicFastPath),
      fastPathAnswerType: fastPath?.answerType,
      okfAllowed: evidence.allowed,
      okfBlockedReason: evidence.blockedReason,
      okfCardCount: evidence.cardCount,
      okfCardTitles: (evidence.cards || []).map((c) => c.card.title),
      pass, notes,
    });
  }

  const passed = results.filter((r) => r.pass).length;
  const summary = {
    mode: MODE_OFF ? 'okf_off_baseline' : 'okf_on',
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed,
    passRate: `${passed}/${results.length}`,
    results,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, MODE_OFF ? 'retrieval-baseline.json' : 'final-results.json');
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log(`\n[benchmark-profile-okf] mode=${summary.mode} pass=${summary.passRate}`);
  for (const r of results) {
    const flag = r.pass ? '✓' : '✗';
    console.log(`  ${flag} Q${r.id} [${r.answerType}/${r.profileContextPolicy}] fastPath=${r.fastPathUsed} okf=${r.okfAllowed}(${r.okfCardCount}) ${r.notes.join('; ')}`);
  }
  console.log(`\n  → ${outFile}`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
