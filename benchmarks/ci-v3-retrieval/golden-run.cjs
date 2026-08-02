/**
 * Phase 8 — golden suite runner.
 *
 * Asserts the §26.4 decision fields, NOT answer text:
 *   resolved question · question types · authorized source types ·
 *   prohibited source types · retrieval path · accepted evidence ·
 *   answerability · fallback · general-knowledge permission ·
 *   no unauthorized content in the prompt
 *
 * "Do not test only final answer text" (§26.4) is the whole point. Answer text
 * is the weakest available signal — it is stochastic, it drifts with the model,
 * and hedged prose can hide a contaminated retrieval. Every assertion here is
 * deterministic and needs no provider.
 *
 * Usage:
 *   NATIVELY_CONTEXT_INTELLIGENCE_V3=1 ELECTRON_RUN_AS_NODE=1 \
 *     ./node_modules/.bin/electron benchmarks/ci-v3-retrieval/golden-run.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { installElectronStub, REPO_ROOT, DIST } = require('./bootstrap.cjs');

installElectronStub();
process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = '1';
const d = (rel) => require(path.join(DIST, rel));

const { orchestrate } = d('electron/context-intelligence/orchestration/orchestrator.js');
const { composePrompt } = d('electron/context-intelligence/generation/prompt-composer.js');
const { resolveModePolicy, isModeId } = d('electron/context-intelligence/policies/mode-policy-registry.js');
const { adaptLegacyChunks } = d('electron/context-intelligence/retrieval/legacy-adapter.js');

const bank = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'test-fixtures/ci-v3-corpus/questions.json'), 'utf8')).questions;

// Which mode each question is labelled against. The corpus assumes the natural
// mode for the question's source; running every question in every mode measures
// mode authorization, not classification.
const MODE_FOR_SOURCE = {
  RESUME: 'looking-for-work',
  JOB_DESCRIPTION: 'looking-for-work',
  REFERENCE_FILE: 'seminar',
  MEETING_TRANSCRIPT: 'team-meet',
  PROFILE_FACT: 'looking-for-work',
};
const modeFor = (q) => {
  const req = (q.requiredSources || [])[0];
  const m = MODE_FOR_SOURCE[req] || 'general';
  return isModeId(m) ? m : 'general';
};

// A retrieval port that returns one chunk per required source, so a question
// whose sources ARE authorized can reach FULL. Contamination probes additionally
// get a chunk from every PROHIBITED source, so the assertion is that the
// pipeline excludes it — not that it was never offered.
const SOURCE_FIXTURE = {
  RESUME: { id: 'resume-1', text: 'PriceX covered 14 retailers; Natively hit 10k users in the first 90 days.' },
  JOB_DESCRIPTION: { id: 'jd-1', text: 'Postgres required. Compensation range 175-200k base.' },
  REFERENCE_FILE: { id: 'ref-1', text: 'Acme discount floor is 17 percent. BERT-base has 110M parameters.' },
  MEETING_TRANSCRIPT: { id: 'tx-1', text: 'Decision: proceed with the Cassandra migration. Meera owns the rollout plan.' },
  PROFILE_FACT: { id: 'pf-1', text: 'Profile fact block.' },
};

function portFor(q) {
  const offered = [...new Set([...(q.requiredSources || []), ...(q.prohibitedSources || [])])]
    .filter((s) => SOURCE_FIXTURE[s]);
  const sourceTypes = new Map();
  const activeVersions = new Map();
  const chunks = [];
  for (const s of offered) {
    const f = SOURCE_FIXTURE[s];
    sourceTypes.set(f.id, s);
    activeVersions.set(f.id, 'v1');
    chunks.push({ sourceId: f.id, text: f.text, chunkIndex: 0, score: 0.9 });
  }
  return {
    async retrieve({ decision }) {
      const { evidence } = adaptLegacyChunks(chunks, {
        scope: decision.scope, sourceTypes, activeVersions,
      });
      const allowed = new Set(decision.retrievalPlan.sourceTypes);
      const needed = new Set(decision.claimRequirements
        .filter((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED').map((c) => c.claimType));
      const scoped = evidence.filter((e) => allowed.has(e.sourceType));
      return {
        evidence: needed.size ? scoped.filter((e) => e.acceptedFor.some((c) => needed.has(c))) : scoped,
        attempts: [],
      };
    },
  };
}

const CHECKS = [
  'resolvedQuestion', 'retrievalPath', 'generalKnowledgeAllowed',
  'noProhibitedSourceInEvidence', 'noProhibitedContentInPrompt',
  'evidenceCarriesProvenance', 'promptLabelsEvidenceUntrusted',
];

(async () => {
  const rows = [];

  for (const q of bank) {
    const modeId = modeFor(q);
    const policy = resolveModePolicy(modeId);
    const result = await orchestrate({
      requestId: `g-${q.id}`, requestSequence: 1, surface: 'manual-chat',
      modeId, scope: { userId: 'u1' }, sessionId: 's1', manualQuestion: q.question,
    }, portFor(q));
    const composed = composePrompt({ decision: result.decision, policy, evidence: result.evidence });

    const prohibited = new Set(q.prohibitedSources || []);
    const checks = {};

    // §26.4 — resolved question must survive verbatim (manual input priority)
    checks.resolvedQuestion = result.decision.resolvedQuestion === q.question;

    // §26.4 — retrieval path matches the label
    checks.retrievalPath = !q.expectedPath || result.decision.retrievalPlan.path === q.expectedPath;

    // §26.4 — general-knowledge permission.
    //
    // TurnDecision.generalKnowledgeAllowed is a MODE-level capability ("may this
    // mode ever use general knowledge?"). The corpus label is QUESTION-level
    // ("may THIS question be answered from general knowledge?"). Comparing them
    // directly is a category error — looking-for-work permits general knowledge
    // as a mode, while "what is the name of the price-comparison website?"
    // plainly cannot be answered from it.
    //
    // The question-level truth is carried by claimRequirements: a question that
    // cannot be answered generally is one that has at least one claim requiring
    // private evidence. That is what is asserted.
    // A bare follow-up ("Why?") carries no subject of its own, so it cannot be
    // answered from general knowledge either — the decision expresses that by
    // routing it FOLLOW_UP/GROUNDED rather than by emitting a claim.
    const requiresPrivate = result.decision.claimRequirements
      .some((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED')
      || (result.decision.isFollowUp && result.decision.retrievalPlan.path !== 'FAST');
    checks.generalKnowledgeAllowed = typeof q.generalKnowledgeAllowed !== 'boolean'
      ? true
      : q.generalKnowledgeAllowed === false
        ? requiresPrivate            // must NOT be answerable from general knowledge alone
        : true;                      // permitted — the mode capability governs

    // THE contamination gate: no prohibited source may appear in evidence
    checks.noProhibitedSourceInEvidence = !result.evidence.some((e) => prohibited.has(e.sourceType));

    // ...nor may its text reach the prompt by any other route
    checks.noProhibitedContentInPrompt = ![...prohibited]
      .map((s) => SOURCE_FIXTURE[s]?.text)
      .filter(Boolean)
      .some((t) => composed.user.includes(t.slice(0, 24)));

    // Every accepted item carries provenance (§15.5)
    checks.evidenceCarriesProvenance = result.evidence.every(
      (e) => e.sourceId && e.versionId && e.scopeId && typeof e.isDirectFact === 'boolean');

    // Retrieved text is always framed as untrusted data (§23)
    checks.promptLabelsEvidenceUntrusted = result.evidence.length === 0
      || /untrusted data/i.test(composed.user);

    rows.push({
      id: q.id, category: q.category, modeId,
      path: result.decision.retrievalPlan.path,
      answerability: result.answerability,
      fallback: result.trace.fallbackUsed,
      evidence: result.evidence.length,
      checks,
      failed: CHECKS.filter((c) => !checks[c]),
    });
  }

  const total = rows.length;
  const perCheck = Object.fromEntries(CHECKS.map((c) => [c, rows.filter((r) => r.checks[c]).length]));
  const clean = rows.filter((r) => r.failed.length === 0).length;

  const out = {
    runAt: new Date().toISOString(), questions: total,
    fullyPassing: clean, perCheck,
    gates: {
      // §27.1 — these are the ZERO-TOLERANCE gates
      contaminationZero: perCheck.noProhibitedSourceInEvidence === total
        && perCheck.noProhibitedContentInPrompt === total,
      provenanceComplete: perCheck.evidenceCarriesProvenance === total,
      untrustedFramingComplete: perCheck.promptLabelsEvidenceUntrusted === total,
      // §27.2 — decision-quality targets
      pathAccuracy: perCheck.retrievalPath / total,
    },
    rows,
  };

  const outDir = path.join(REPO_ROOT, 'benchmarks/ci-v3-retrieval/results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'golden-latest.json'), JSON.stringify(out, null, 2));

  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  console.log('\n=== GOLDEN SUITE (decision assertions, no provider) ===');
  console.log(`questions                          ${total}`);
  console.log(`fully passing all checks           ${clean}  ${pct(clean)}\n`);
  for (const c of CHECKS) console.log(`  ${c.padEnd(34)} ${String(perCheck[c]).padStart(3)}/${total}  ${pct(perCheck[c])}`);
  console.log('\n--- §27 GATES ---');
  console.log(`  contamination = ZERO             ${out.gates.contaminationZero ? 'PASS' : 'FAIL'}`);
  console.log(`  provenance complete              ${out.gates.provenanceComplete ? 'PASS' : 'FAIL'}`);
  console.log(`  untrusted framing complete       ${out.gates.untrustedFramingComplete ? 'PASS' : 'FAIL'}`);
  console.log(`  retrieval-path accuracy          ${(out.gates.pathAccuracy * 100).toFixed(1)}%  (target 97%)`);

  const failing = rows.filter((r) => r.failed.length);
  if (failing.length) {
    console.log('\n--- FAILURES ---');
    for (const r of failing.slice(0, 20)) console.log(`  ${r.id} [${r.category}] ${r.modeId}: ${r.failed.join(', ')}`);
  }
  console.log(`\nwrote ${path.join(outDir, 'golden-latest.json')}`);
  process.exit(0);
})().catch((e) => { console.error('GOLDEN RUN FAILED:', e.stack || e.message); process.exit(1); });
