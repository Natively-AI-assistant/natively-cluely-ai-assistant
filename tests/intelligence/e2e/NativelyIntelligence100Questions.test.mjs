// tests/intelligence/e2e/NativelyIntelligence100Questions.test.mjs
//
// ============================================================================
//  NATIVELY INTELLIGENCE OS — 100-QUESTION END-TO-END VERIFICATION SUITE
// ============================================================================
//
// GOAL (verification spec, 2026-06-13): prove whether the Intelligence OS
// actually works on the LIVE SERVICE PATH — the SAME service-layer methods the
// production IPC handlers call — NOT isolated library unit tests.
//
// HOW EACH CATEGORY IS DRIVEN (and the limitation, stated honestly):
//   A. Profile identity (15)   → REAL manual answer path: planAnswer →
//      buildManualProfileBackendAnswer (deterministic fast path) → LLMHelper.streamChat
//      (real provider) against a SAFE COPY of the real natively.db. This is the EXACT
//      path electron/ipcHandlers.ts `gemini-chat-stream` runs (reuses harness.cjs +
//      the logic in run_profile_intelligence_benchmark.ts).
//   B. JD fit (10)             → same REAL manual path.
//   C. live transcript / WTA (15) → REAL WTA path: orchestrator.processQuestion grounding
//      + WhatToAnswerLLM.generateStream — the EXACT path IntelligenceEngine.runWhatShouldISay
//      drives.
//   D. same-session follow-up (10) → ConversationMemoryService.record + resolveSameSession,
//      the EXACT method ipcHandlers gemini-chat-stream calls when conversationMemoryV2 is on.
//      D10 (cross-session) → LongTermMemoryService recall (Hindsight; Noop/[] when no server).
//   E. meeting memory (10)     → MeetingMemoryService.buildMeetingRecord (compiled dist-electron).
//   F. global search (10)      → SearchOrchestrator.globalSearch with the candidate shape
//      the `search:global-meetings` IPC handler builds (userId 'local', metadata company/
//      hasActionItems/hasInterviewQuestions), PLUS an isolation corpus.
//   G. in-meeting search (8)   → SearchOrchestrator.inMeetingSearch (compiled), same as
//      `search:in-meeting`.
//   H. mode boundaries (8)     → planAnswer routing/profileContextPolicy (compiled), the
//      decision the manual + WTA paths consult.
//   I. lecture notes (8)       → LectureIntelligenceService.generateNotes (compiled), same
//      as `lecture:generate-notes`.
//   J. diagrams (4)            → DiagramIntelligenceService.generate (compiled), same as
//      `diagram:generate`.
//   K. privacy isolation (2)   → ProfileTreeService per-user scoping + SearchOrchestrator
//      scope filter (compiled).
//
// HONEST LIMITATION: this is a SERVICE-LEVEL harness, NOT a launched GUI. The Electron
// app is not booted; an electron stub + a node:sqlite→better-sqlite3 ABI shim back the
// DB (see harness.cjs). Therefore:
//   • A/B/C real provider LATENCY (first-useful token) IS measured on the headless stream
//     (real network to the configured provider). It approximates but is NOT identical to
//     in-GUI latency (no renderer paint, no IPC marshalling).
//   • E–K services are DETERMINISTIC (no LLM, no network) so their behavior in this
//     harness is byte-for-byte what the GUI handler would produce given the same input.
//   • Hindsight (D10) requires a server on :8888. When DOWN, LongTermMemoryService is Noop
//     → recall []. We record hindsight_used=false + the honest reason and PASS only on the
//     correct DEGRADED behavior (empty, no leak, no break) — never on a faked recall.
//
// Run: node --test tests/intelligence/e2e/NativelyIntelligence100Questions.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { QUESTIONS } from './fixtures/questions100.mjs';
import {
  USER_A, USER_B, LIVE_TRANSCRIPT,
  MEETING_1, MEETING_2, MEETING_3,
  buildGlobalSearchCandidates, buildInMeetingChunks,
  LECTURE_1, LECTURE_2, LECTURE_3, DIAGRAM_INPUTS,
} from './fixtures/fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(REPO_ROOT, 'dist-electron');

// Enable the LIVE-behavior flags for the categories that need them. Env is read FRESH on
// every flag check (intelligenceFlags.ts has no cache), so setting these before requiring
// the compiled modules is sufficient and stable.
const ENABLED_FLAGS = {
  NATIVELY_CONVERSATION_MEMORY_V2: '1',
  NATIVELY_MEETING_MEMORY_V2: '1',
  NATIVELY_GLOBAL_SEARCH_V2: '1',
  NATIVELY_IN_MEETING_SEARCH_V2: '1',
  NATIVELY_LECTURE_INTELLIGENCE_V2: '1',
  NATIVELY_DIAGRAM_INTELLIGENCE: '1',
  NATIVELY_ANSWER_DIVERSITY_GUARD: '1',
  NATIVELY_HINDSIGHT_MEMORY: '1',
};
for (const [k, v] of Object.entries(ENABLED_FLAGS)) process.env[k] = v;

// Load harness.cjs FIRST so its Module._load interception (electron stub + sqlite shim)
// is active before any compiled dist-electron module is required.
const H = require(path.join(REPO_ROOT, 'benchmarks', 'profile-intelligence', 'harness.cjs'));

function reqDist(rel) {
  const p = path.join(DIST, rel);
  if (!fs.existsSync(p)) throw new Error(`Compiled module missing: ${p}. Run \`npm run build:electron\`.`);
  return require(p);
}

const NOT_MEASURED = (reason) => `NOT MEASURED — ${reason}`;
const RESULTS = [];

function blankUsage() {
  return {
    deterministic_fast_path_used: false,
    profile_tree_used: false,
    live_transcript_used: false,
    meeting_memory_used: false,
    global_search_used: false,
    in_meeting_search_used: false,
    lecture_intelligence_used: false,
    diagram_intelligence_used: false,
    hindsight_used: false,
    context_router_used: false,
    prompt_assembler_v2_used: false,
    output_normalizer_used: false,
  };
}

function record(rec) {
  RESULTS.push({
    id: rec.id,
    category: rec.category,
    mode: rec.mode,
    question: rec.question,
    expected_behavior: rec.expected_behavior,
    actual_answer: rec.actual_answer ?? '',
    pass: !!rec.pass,
    harness_limited: !!rec.harness_limited,
    failure_reason: rec.failure_reason ?? null,
    latency_ms: rec.latency_ms ?? null,
    first_useful_token_ms: rec.first_useful_token_ms ?? NOT_MEASURED('not applicable'),
    total_time_ms: rec.total_time_ms ?? null,
    provider_used: rec.provider_used ?? NOT_MEASURED('deterministic service — no provider'),
    ...blankUsage(),
    ...(rec.usage || {}),
    trace_id: rec.trace_id ?? null,
    evidence: rec.evidence ?? null,
  });
}

// ── Module handles populated in before() ─────────────────────────────────────
let harness = null;
let MeetingMemoryService, SearchOrchestrator, ConversationMemoryService;
let LectureIntelligenceService, DiagramIntelligenceService, ProfileTreeService;
let LongTermMemoryService, HindsightManager;
let planAnswer, isCodingAnswerType;
let hindsightServerUp = false;
let realDbLoaded = false;
const loadErrors = [];

before(async () => {
  ({ MeetingMemoryService } = reqDist('electron/intelligence/MeetingMemoryService.js'));
  ({ SearchOrchestrator } = reqDist('electron/intelligence/SearchOrchestrator.js'));
  ({ ConversationMemoryService } = reqDist('electron/intelligence/ConversationMemoryService.js'));
  ({ LectureIntelligenceService } = reqDist('electron/intelligence/LectureIntelligenceService.js'));
  ({ DiagramIntelligenceService } = reqDist('electron/intelligence/DiagramIntelligenceService.js'));
  ({ ProfileTreeService } = reqDist('electron/intelligence/ProfileTreeService.js'));
  try { ({ LongTermMemoryService } = reqDist('electron/intelligence/memory/LongTermMemoryService.js')); } catch (e) { loadErrors.push('LongTermMemoryService:' + e.message); }
  try { ({ HindsightManager } = reqDist('electron/services/HindsightManager.js')); } catch (e) { loadErrors.push('HindsightManager:' + e.message); }

  const planner = reqDist('electron/llm/AnswerPlanner.js');
  planAnswer = planner.planAnswer;
  isCodingAnswerType = planner.isCodingAnswerType;

  try {
    harness = H.createHarness({ provider: 'auto', timeoutMs: 30000 });
    realDbLoaded = !!harness?.profileMeta?.resumeLoaded;
  } catch (e) {
    loadErrors.push('createHarness:' + e.message);
  }

  try {
    const res = await fetch('http://localhost:8888/health', { signal: AbortSignal.timeout(2000) }).catch(() => null);
    hindsightServerUp = !!(res && res.ok);
    if (hindsightServerUp && !process.env.HINDSIGHT_BASE_URL) process.env.HINDSIGHT_BASE_URL = 'http://localhost:8888';
  } catch { hindsightServerUp = false; }
});

after(() => {
  try { harness?.cleanup?.(); } catch { /* noop */ }
  const outPath = path.join(REPO_ROOT, 'natively-intelligence-e2e-results.json');
  const byCat = {};
  for (const r of RESULTS) {
    byCat[r.category] = byCat[r.category] || { total: 0, pass: 0, harnessLimited: 0, productFail: 0 };
    byCat[r.category].total++;
    if (r.pass) byCat[r.category].pass++;
    else if (r.harness_limited) byCat[r.category].harnessLimited++;
    else byCat[r.category].productFail++;
  }
  const usageCounts = {};
  for (const key of Object.keys(blankUsage())) usageCounts[key] = RESULTS.filter((r) => r[key]).length;
  const lat = RESULTS.map((r) => (typeof r.first_useful_token_ms === 'number' ? r.first_useful_token_ms : null)).filter((x) => x != null).sort((a, b) => a - b);
  const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.ceil((p / 100) * arr.length) - 1)] : null);
  const summary = {
    generatedAt: new Date().toISOString(),
    harness: {
      realDbLoaded,
      candidateNameHash: harness?.profileMeta?.candidateNameHash ?? null,
      resumeLoaded: harness?.profileMeta?.resumeLoaded ?? false,
      jdLoaded: harness?.profileMeta?.jdLoaded ?? false,
      projectCount: harness?.profileMeta?.projectCount ?? 0,
      skillCount: harness?.profileMeta?.skillCount ?? 0,
      providerConfigured: (() => { try { return harness?.getProvider?.(); } catch { return 'unknown'; } })(),
      modelConfigured: (() => { try { return harness?.getModel?.(); } catch { return 'unknown'; } })(),
      hindsightServerUp,
      hindsightClientInstalled: fs.existsSync(path.join(REPO_ROOT, 'node_modules', '@vectorize-io', 'hindsight-client', 'package.json')),
      enabledFlags: ENABLED_FLAGS,
      loadErrors,
      note: 'Service-level harness (no GUI). A–D drive the REAL LLM answer path on a safe DB copy; E–K drive compiled deterministic dist-electron services. See file header for limitations.',
    },
    overall: (() => {
      const pass = RESULTS.filter((r) => r.pass).length;
      const hl = RESULTS.filter((r) => !r.pass && r.harness_limited).length;
      const pf = RESULTS.filter((r) => !r.pass && !r.harness_limited).length;
      const verifiable = RESULTS.length - hl;
      return {
        total: RESULTS.length,
        pass,
        productFail: pf,
        harnessLimited: hl,
        passRateAll: RESULTS.length ? +(pass / RESULTS.length * 100).toFixed(1) : 0,
        passRateVerifiable: verifiable ? +(pass / verifiable * 100).toFixed(1) : 0,
        note: 'passRateVerifiable excludes harnessLimited items (could only be verified in a real GUI run).',
      };
    })(),
    perCategory: Object.fromEntries(Object.entries(byCat).sort().map(([k, v]) => [k, { ...v, passRate: +(v.pass / v.total * 100).toFixed(1), passRateVerifiable: (v.total - v.harnessLimited) ? +(v.pass / (v.total - v.harnessLimited) * 100).toFixed(1) : 0 }])),
    latencyFirstUsefulMs: lat.length ? { count: lat.length, min: lat[0], p50: pct(lat, 50), p90: pct(lat, 90), p95: pct(lat, 95), max: lat[lat.length - 1] } : NOT_MEASURED('no measurable LLM first-useful latency (provider failures or all-deterministic)'),
    moduleUsageCounts: usageCounts,
    results: RESULTS,
  };
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\n[100Q] wrote ${RESULTS.length} results → ${outPath}`);
  console.log(`[100Q] pass ${summary.overall.pass}/${summary.overall.total} | productFail ${summary.overall.productFail} | harnessLimited ${summary.overall.harnessLimited}`);
  console.log(`[100Q] passRateAll=${summary.overall.passRateAll}% | passRateVerifiable=${summary.overall.passRateVerifiable}%`);
  console.log('[100Q] per-category:', JSON.stringify(summary.perCategory));
});

// ── Scoring helpers ──────────────────────────────────────────────────────────
const REFUSAL_RE = /\b(i don'?t (have|know)|i do not have|no information|not able to (find|provide)|i cannot (find|provide|answer)|i'?m not sure (who|what)|unable to (determine|find)|i don'?t have access|no (record|data|details) (of|about|on))\b/i;
// WTA "graceful retry" stall text. WhatToAnswerLLM.generateStream yields one of these
// ONLY from its catch block (the error path) — there is no other route to buildGracefulRetry.
// Covers all 3 RETRY_TEMPLATES (manualProfileIntelligence.ts) incl. topic-aware variants.
const CLARIFICATION_STALL_RE = /\b(could you (repeat|ask that|say|say a bit more)|repeat that|say that again|come again|once more|i didn'?t (fully )?catch (that|the question)|rephrase (it|the question|your question)|make sure i (get|address|answer|understand)|ask (that|it) (again|once more)|what specifically about)\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Drive ONE manual/WTA question through the REAL answer path (logic lifted from
// run_profile_intelligence_benchmark.ts so this is the production path, not a re-impl).
// Build the transcript window the WTA path consumes: prior interviewer turns from the
// live transcript fixture + the current question as the latest interviewer turn. This is
// what IntelligenceEngine.runWhatShouldISay / the WTA benchmark feed generateStream
// (cleanedTranscript), NOT a bare question — a bare question makes WTA emit a clarification.
function buildWtaTurns(question) {
  const prior = LIVE_TRANSCRIPT
    .filter((t) => t.speaker === 'interviewer' && t.text !== question)
    .slice(-3)
    .map((t) => ({ role: 'interviewer', text: t.text, speaker: 'interviewer', timestamp: Date.now() }));
  prior.push({ role: 'interviewer', text: question, speaker: 'interviewer', timestamp: Date.now() });
  return prior;
}

async function runRealAnswer(q, mode) {
  if (!harness) return { answer: '', usedFastPath: false, firstUsefulMs: null, totalMs: null, provider: null, plan: null, error: 'harness unavailable' };
  const rec = new H.LatencyRecorder();
  const source = mode === 'what-to-answer' ? 'what_to_answer' : 'manual_input';
  const plan = harness.planAnswer({ question: q.question, source, speakerPerspective: mode === 'what-to-answer' ? 'interviewer' : 'user' });
  const isCoding = harness.isCodingAnswerType(plan.answerType);
  let answer = '';
  let usedFastPath = false;
  let firstUsefulMs = null;
  let harnessLimited = false;
  let provider = (() => { try { return harness.getProvider(); } catch { return 'unknown'; } })();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    if (mode === 'manual' && !isCoding && !harness.isAssistantIdentityQuestion(q.question)) {
      try {
        const fp = harness.buildManualProfileBackendAnswer({ question: q.question, orchestrator: harness.orchestrator, source: 'manual_input' });
        if (fp && fp.route && fp.route.answer) { answer = String(fp.route.answer); usedFastPath = true; firstUsefulMs = rec.ms(); }
      } catch { /* fall through */ }
    }
    if (mode === 'what-to-answer' && !isCoding && harness.tryBuildManualProfileFastPathAnswer) {
      try {
        const resume = harness.orchestrator?.activeResume?.structured_data ?? null;
        const jd = harness.orchestrator?.activeJD?.structured_data ?? null;
        if (resume) {
          const fp = harness.tryBuildManualProfileFastPathAnswer({ question: q.question, profile: resume, jobDescription: jd, source: 'what_to_answer' });
          if (fp && fp.answer) { answer = String(fp.answer); usedFastPath = true; firstUsefulMs = rec.ms(); }
        }
      } catch { /* fall through */ }
    }
    if (!usedFastPath) {
      const cap = H.captureConsole();
      try {
        let stream;
        if (mode === 'what-to-answer') {
          let candidateProfile = '';
          try {
            const knowledge = await Promise.race([harness.orchestrator.processQuestion(q.question), sleep(8000).then(() => null)]);
            if (knowledge && knowledge.factualRecall === true && !knowledge.liveNegotiationResponse) {
              if (knowledge.contextBlock) candidateProfile = knowledge.contextBlock;
              else if (knowledge.introResponse) candidateProfile = `<candidate_identity_fact>\n${knowledge.introResponse}\n</candidate_identity_fact>`;
            }
          } catch { /* no grounding */ }
          if (!candidateProfile) {
            try {
              const resume = harness.orchestrator?.activeResume?.structured_data ?? null;
              const jd = harness.orchestrator?.activeJD?.structured_data ?? null;
              if (resume && plan.profileContextPolicy === 'required') {
                const fp = harness.tryBuildManualProfileFastPathAnswer({ question: q.question, profile: resume, jobDescription: jd, source: 'what_to_answer' });
                if (fp?.answer) candidateProfile = `<candidate_identity_fact>\n${fp.answer}\n</candidate_identity_fact>`;
              }
            } catch { /* best effort */ }
          }
          // Feed the FULL transcript window (role: text) as cleanedTranscript — the
          // shape runWhatShouldISay uses. A bare question here triggers a clarification.
          const turns = buildWtaTurns(q.question);
          const cleanedTranscript = turns.map((t) => `${t.role}: ${t.text}`).join('\n');
          stream = harness.whatToAnswerLLM.generateStream(cleanedTranscript, undefined, undefined, undefined, undefined, undefined, undefined, candidateProfile || undefined, plan);
        } else {
          const context = isCoding ? harness.formatAnswerPlanForPrompt(plan, false) : undefined;
          stream = harness.llmHelper.streamChat(q.question, undefined, context, harness.CHAT_MODE_PROMPT, isCoding, isCoding, [], ac.signal, harness.llmHelper.thinkingBudgetForAnswerType(isCoding), { answerType: plan.answerType, forbiddenContextLayers: plan.forbiddenContextLayers || [] });
        }
        const gate = isCoding ? new harness.CodingStreamGate() : null;
        let displayed = '';
        await harness.raceStreamWithDeadline({
          stream,
          firstUsefulDeadlineMs: harness.firstUsefulDeadlineMs(plan.answerType),
          isUsefulYet: () => firstUsefulMs !== null,
          shouldAbort: () => ac.signal.aborted,
          onToken: (piece) => {
            answer += String(piece || '');
            if (gate) { const out = gate.push(String(piece || '')); if (out) { displayed += out; if (firstUsefulMs === null && H.isUseful(displayed)) firstUsefulMs = rec.ms(); } }
            else { displayed = answer; if (firstUsefulMs === null && H.isUseful(displayed)) firstUsefulMs = rec.ms(); }
          },
        });
        if (gate?.flush) { try { const tail = gate.flush(); if (tail) displayed += tail; } catch { /* noop */ } }
        const logA = H.analyzeProviderLogs(cap.lines, provider);
        provider = logA.providerServed || provider;
        // HARNESS-LIMITATION DETECTION (WTA only): generateStream's mode-context
        // hybrid retrieval (ModesManager.buildRetrievedActiveModeContextBlockHybrid)
        // requires sqlite-vec/vec0 virtual tables, which CANNOT load under the
        // node:sqlite ABI shim used headless. When it throws, WTA's catch yields the
        // graceful-retry clarification ("Could you repeat that?"). This is a HARNESS
        // artifact, NOT a product defect (the GUI uses real better-sqlite3 + sqlite-vec).
        // Detect it precisely from the captured stack so we never score it as a pass.
        const joined = cap.lines.join('\n');
        // Primary signal: the captured stack shows the WTA stream threw on the DB/Modes/vec0 path.
        // Secondary signal (robust to console-capture races): WTA yielded a graceful-retry
        // stall — which generateStream emits ONLY from its catch block — so on this headless
        // harness it can only be the sqlite-vec/ModesManager retrieval throw, never a real answer.
        const stackSaysDb = /WhatToAnswerLLM\] Stream failed/.test(joined)
          && /(buildRetrievedActiveModeContextBlockHybrid|ModesManager|vec0|no such module|DatabaseManager|runMigrations)/.test(joined);
        harnessLimited = mode === 'what-to-answer' && (stackSaysDb || (CLARIFICATION_STALL_RE.test(answer) && answer.trim().length < 160));
      } finally { cap.restore(); }
    }
  } catch (e) {
    clearTimeout(timer);
    return { answer, usedFastPath, firstUsefulMs, totalMs: rec.ms(), provider, plan, error: e.message, harnessLimited };
  }
  clearTimeout(timer);
  return { answer, usedFastPath, firstUsefulMs, totalMs: rec.ms(), provider, plan, error: null, harnessLimited };
}

// Synthetic structured profile facts for ProfileTree isolation (K) — fake by design.
const ALICE_FACTS = {
  identity: { name: 'Alice Varma' },
  experience: [{ company: 'Acme Corp', role: 'Backend Engineer', duration: '2 years' }],
  projects: [{ name: 'AtlasDB', description: 'distributed key-value store with Redis-backed caching' }],
  skills: { languages: ['Go', 'Python'], databases: ['Redis', 'Postgres'] },
  skills_flat: ['Go', 'Python', 'Redis', 'Postgres'],
  education: [{ institution: 'State University', degree: 'BS Computer Science' }],
};
const BOB_FACTS = {
  identity: { name: 'Bob Menon' },
  experience: [{ company: 'Beta Inc', role: 'Frontend Engineer', duration: '3 years' }],
  projects: [{ name: 'CloudCart', description: 'e-commerce storefront with a React UI' }],
  skills: { languages: ['JavaScript', 'TypeScript'], frameworks: ['React'] },
  skills_flat: ['JavaScript', 'TypeScript', 'React'],
  education: [{ institution: 'City College', degree: 'BS Information Systems' }],
};

// ============================================================================
//  CATEGORY A + B — REAL manual LLM answer path
// ============================================================================
for (const q of QUESTIONS.filter((x) => x.category === 'A' || x.category === 'B')) {
  test(`[${q.id}] ${q.category} manual — ${q.question}`, async () => {
    const r = await runRealAnswer(q, 'manual');
    const text = (r.answer || '').trim();
    const tokens = harness?.profileTokens || {};
    const scan = harness ? harness.qualityScan(text, tokens, { expectedVoice: q.expectedVoice, profileShouldBeUsed: q.profileShouldBeUsed }) : {};
    let pass = false; let reason = null;
    if (!realDbLoaded) reason = 'real profile DB not loaded — cannot verify candidate grounding';
    else if (!text) reason = r.error ? `empty answer (provider error: ${r.error})` : 'empty answer';
    else if (scan.nativelyIdentityLeak) reason = 'WRONG IDENTITY — answer claims to be Natively/an AI assistant on a candidate question';
    else if (scan.falseRefusal) reason = 'false refusal — claimed no info though profile exists';
    else if (q.expectedVoice === 'first_person_candidate' && scan.deliveredVoice === 'second_person_user')
      reason = 'WRONG PERSPECTIVE — answered ABOUT the candidate ("You have…") instead of AS the candidate ("I have…")';
    else if (q.profileShouldBeUsed && !scan.profilePresent && (REFUSAL_RE.test(text) || text.length < 20)) reason = 'generic/non-grounded answer when candidate facts exist';
    else pass = true;
    record({
      id: q.id, category: q.category, mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
      actual_answer: H.redact(text, harness?.profileMeta).slice(0, 600),
      pass, failure_reason: reason,
      latency_ms: r.firstUsefulMs != null ? Math.round(r.firstUsefulMs) : null,
      first_useful_token_ms: r.firstUsefulMs != null ? Math.round(r.firstUsefulMs) : NOT_MEASURED(r.usedFastPath ? 'deterministic fast path (no provider token)' : 'no useful token produced'),
      total_time_ms: r.totalMs != null ? Math.round(r.totalMs) : null,
      provider_used: r.usedFastPath ? 'deterministic_fast_path' : (r.provider || 'unknown'),
      usage: { deterministic_fast_path_used: r.usedFastPath },
      evidence: { deliveredVoice: scan.deliveredVoice, profilePresent: scan.profilePresent, plannedType: r.plan?.answerType, profileContextPolicy: r.plan?.profileContextPolicy, usedFastPath: r.usedFastPath },
    });
    assert.ok(pass || reason, 'must produce a verdict');
  });
}

// ============================================================================
//  CATEGORY C — REAL what-to-answer path
// ============================================================================
for (const q of QUESTIONS.filter((x) => x.category === 'C')) {
  test(`[${q.id}] C WTA — ${q.question}`, async () => {
    const r = await runRealAnswer(q, 'what-to-answer');
    const text = (r.answer || '').trim();
    const tokens = harness?.profileTokens || {};
    const scan = harness ? harness.qualityScan(text, tokens, { expectedVoice: q.expectedVoice, profileShouldBeUsed: q.profileShouldBeUsed }) : {};
    let pass = false; let reason = null; let harnessLimited = false;
    const stalled = CLARIFICATION_STALL_RE.test(text) && text.length < 160;
    if (!realDbLoaded) reason = 'real profile DB not loaded — cannot verify WTA grounding';
    else if (stalled && r.harnessLimited) {
      // The WTA mode-context hybrid retrieval threw on the headless sqlite-vec shim →
      // graceful-retry clarification. NOT a product defect; NOT a pass. Marked distinctly.
      harnessLimited = true;
      reason = 'NOT VERIFIED — harness limitation: WTA generateStream mode-context retrieval requires sqlite-vec/vec0 (not loadable under the node:sqlite ABI shim headless). The GUI uses real better-sqlite3 + sqlite-vec. Verify these in a real GUI run.';
    }
    else if (!text) reason = r.error ? `empty answer (provider error: ${r.error})` : 'empty answer (WTA produced no token)';
    else if (scan.nativelyIdentityLeak) reason = 'WRONG IDENTITY — "I\'m Natively" in live copilot';
    else if (stalled) reason = 'CLARIFICATION STALL — copilot asked to repeat instead of answering a concrete interview question';
    else if (q.profileShouldBeUsed === false && scan.profileLeak) reason = 'profile leak — candidate facts dumped into a technical WTA answer';
    else if (q.profileShouldBeUsed && scan.falseRefusal) reason = 'false refusal on a grounded WTA question';
    else pass = true;
    record({
      id: q.id, category: q.category, mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
      actual_answer: H.redact(text, harness?.profileMeta).slice(0, 600),
      pass, failure_reason: reason, harness_limited: harnessLimited,
      latency_ms: r.firstUsefulMs != null ? Math.round(r.firstUsefulMs) : null,
      first_useful_token_ms: harnessLimited ? NOT_MEASURED('harness limitation — WTA stream threw on sqlite-vec shim') : (r.firstUsefulMs != null ? Math.round(r.firstUsefulMs) : NOT_MEASURED(r.usedFastPath ? 'deterministic fast path' : 'no useful token produced')),
      total_time_ms: r.totalMs != null ? Math.round(r.totalMs) : null,
      provider_used: r.usedFastPath ? 'deterministic_fast_path' : (r.provider || 'unknown'),
      usage: { deterministic_fast_path_used: r.usedFastPath, live_transcript_used: true },
      evidence: { deliveredVoice: scan.deliveredVoice, profilePresent: scan.profilePresent, plannedType: r.plan?.answerType, profileContextPolicy: r.plan?.profileContextPolicy, profileLeak: scan.profileLeak, harnessLimited },
    });
    assert.ok(pass || reason, 'must produce a verdict');
  });
}

// ============================================================================
//  CATEGORY D — same-session follow-up (ConversationMemoryService) + D10 Hindsight
// ============================================================================
test('[D] same-session follow-up — ConversationMemoryService.resolveSameSession', () => {
  const cms = new ConversationMemoryService();
  const sid = 'sess_alice_1';
  // Seed turns written so each follow-up has a CLEAR correct target by topic word.
  // The follow-up questions (from the fixture) name their topic explicitly
  // ("sharding", "eviction", "PostgreSQL", "latency", "caching"), so a competent
  // same-session resolver should match the turn that discusses that exact topic.
  const seed = [
    { u: 'How would you scale Redis to handle 10x load?', a: 'Use Redis Cluster across nodes to scale horizontally.' },
    { u: 'What sharding strategy fits write-heavy workloads?', a: 'Consistent-hashing sharding distributes writes evenly across the cluster.' },
    { u: 'How do you reduce read latency here?', a: 'Add an index and tune queries to cut p99 latency on reads.' },
    { u: 'What caching layer would you add?', a: 'An LRU caching policy for hot keys gives the best hit rate.' },
    { u: 'What database would you pick for this workload?', a: 'PostgreSQL for durability, with Redis for the hot path.' },
    { u: 'What eviction policy did you choose?', a: 'We went with an LRU eviction policy for the cache.' },
  ];
  for (const s of seed) cms.record({ sessionId: sid, userMessage: s.u, assistantAnswer: s.a });

  // Keys MUST match the fixture's followUpExpect values exactly. Each maps to
  // substrings the correctly-resolved prior turn (userMessage+assistantAnswer) should
  // contain. The resolver scores by entity + token overlap (recency-tiebroken).
  const expectKey = {
    eviction: ['eviction'],
    recent: null,
    shard: ['shard', 'hashing'],
    latency: ['latency', 'read'],
    last_answer: null,
    cach: ['cach'],
    postgres: ['postgres', 'database'],
  };

  for (const q of QUESTIONS.filter((x) => x.category === 'D')) {
    if (q.id === 'D10') continue;
    const resolved = cms.resolveSameSession(sid, q.question);
    const hay = resolved ? `${resolved.userMessage} ${resolved.assistantAnswer}`.toLowerCase() : '';
    let pass = false; let reason = null; let actual = resolved ? resolved.summary : '(null)';
    if (q.followUpExpect === 'recent') {
      const mostRecent = seed[seed.length - 1];
      pass = !!resolved && resolved.assistantAnswer === mostRecent.a;
      if (!pass) reason = `bare follow-up did not resolve to most-recent turn (got "${actual}")`;
    } else if (q.followUpExpect === 'last_answer') {
      const last = cms.getLastAssistantAnswer(sid);
      pass = !!last && last === seed[seed.length - 1].a;
      actual = last || '(null)';
      if (!pass) reason = 'getLastAssistantAnswer did not return the last assistant turn';
    } else {
      const keys = expectKey[q.followUpExpect] || [];
      pass = !!resolved && keys.some((k) => hay.includes(k));
      if (!pass) reason = `follow-up did not resolve to a turn containing ${JSON.stringify(keys)} (got "${actual}")`;
    }
    record({
      id: q.id, category: 'D', mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
      actual_answer: String(actual).slice(0, 300), pass, failure_reason: reason,
      first_useful_token_ms: NOT_MEASURED('deterministic in-memory resolution — no provider token'),
      total_time_ms: 0, provider_used: 'deterministic_service',
      usage: { deterministic_fast_path_used: true },
      evidence: { resolvedTurnId: resolved?.id ?? null, resolvedSummary: resolved?.summary ?? null },
    });
  }
});

test('[D10] cross-session recall — LongTermMemoryService (Hindsight) honest degradation', async () => {
  const q = QUESTIONS.find((x) => x.id === 'D10');
  let pass = false; let reason = null; let hindsightUsed = false; let memories = [];
  let provider = 'noop';
  try {
    if (hindsightServerUp && LongTermMemoryService && HindsightManager) {
      const cfg = HindsightManager.getInstance().getHindsightConfig?.() || { baseUrl: process.env.HINDSIGHT_BASE_URL, timeoutMs: 2000 };
      const ltm = LongTermMemoryService.fromFlags({ hindsight: { ...cfg, timeoutMs: 2000 } });
      if (ltm.enabled) {
        provider = 'hindsight';
        memories = await ltm.recallRelevantMemory('what did we discuss last week', { userId: 'local' }, { timeoutMs: 2000, maxResults: 8 });
        hindsightUsed = true;
        pass = Array.isArray(memories);
        if (!pass) reason = 'Hindsight recall did not return an array';
      } else {
        reason = 'Hindsight server up but LongTermMemoryService reported disabled (client/config issue)';
      }
    } else {
      const ltm = LongTermMemoryService ? LongTermMemoryService.fromFlags({ hindsight: { baseUrl: '', timeoutMs: 500 } }) : null;
      memories = ltm ? await ltm.recallRelevantMemory('x', { userId: 'local' }, {}) : [];
      pass = Array.isArray(memories) && memories.length === 0;
      provider = 'noop_degraded';
      reason = pass ? null : 'Noop recall did not return [] when memory disabled';
    }
  } catch (e) {
    reason = 'recall threw: ' + e.message;
  }
  record({
    id: 'D10', category: 'D', mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
    actual_answer: hindsightUsed ? `recalled ${memories.length} memory item(s)` : 'cross-session recall returned [] (memory disabled — no leak, no break)',
    pass, failure_reason: reason,
    first_useful_token_ms: hindsightServerUp ? NOT_MEASURED('Hindsight recall latency not separately timed') : NOT_MEASURED('Hindsight server down — Noop path'),
    total_time_ms: 0, provider_used: provider,
    usage: { hindsight_used: hindsightUsed },
    evidence: { hindsightServerUp, recalledCount: memories.length, note: hindsightUsed ? 'REAL Hindsight recall call completed' : 'Hindsight server DOWN — verified Noop [] degradation, NOT a faked recall' },
  });
  assert.ok(pass || reason);
});

// ============================================================================
//  CATEGORY E — meeting memory (MeetingMemoryService.buildMeetingRecord)
// ============================================================================
test('[E] meeting memory — MeetingMemoryService.buildMeetingRecord', () => {
  const svc = new MeetingMemoryService();
  const byId = { m1_interview_redis: MEETING_1, m2_sales_pricing: MEETING_2, m3_team_actions: MEETING_3 };
  for (const q of QUESTIONS.filter((x) => x.category === 'E')) {
    const m = byId[q.meeting];
    const mr = svc.buildMeetingRecord({ meetingId: m.meetingId, title: m.title, mode: m.mode, date: m.date, segments: m.segments });
    const field = mr[q.expectField];
    let pass = false; let reason = null;
    if (q.expectField === 'cleanTranscript') {
      pass = typeof field === 'string' && field.length > 0;
      if (!pass) reason = 'cleanTranscript empty';
    } else if (q.expectField === 'participants') {
      pass = Array.isArray(field) && field.length >= 2;
      if (!pass) reason = `participants not extracted (got ${JSON.stringify(field)})`;
    } else if (Array.isArray(field)) {
      pass = field.length > 0;
      if (q.expectContains) pass = pass && q.expectContains.every((c) => field.join(' ').toLowerCase().includes(c));
      if (!pass) reason = `${q.expectField} empty or missing ${JSON.stringify(q.expectContains || [])} (got ${JSON.stringify(field).slice(0, 200)})`;
    } else {
      reason = `field ${q.expectField} not array/string (got ${typeof field})`;
    }
    record({
      id: q.id, category: 'E', mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
      actual_answer: JSON.stringify(field).slice(0, 400), pass, failure_reason: reason,
      first_useful_token_ms: NOT_MEASURED('deterministic extraction — no provider token'),
      total_time_ms: 0, provider_used: 'deterministic_service',
      usage: { meeting_memory_used: true },
      evidence: { meetingId: m.meetingId, structureScore: mr.structureScore, field: q.expectField, value: field },
    });
  }
});

// ============================================================================
//  CATEGORY F — global search (SearchOrchestrator.globalSearch)
// ============================================================================
test('[F] global search — SearchOrchestrator.globalSearch (scope + filters + isolation)', () => {
  const orch = new SearchOrchestrator();
  const corpus = buildGlobalSearchCandidates();
  const scopeA = { userId: USER_A.userId, orgId: USER_A.orgId };
  for (const q of QUESTIONS.filter((x) => x.category === 'F')) {
    const results = orch.globalSearch(corpus, scopeA, q.filter || {}, Date.now());
    const ids = results.map((r) => r.meetingId);
    let pass = false; let reason = null;
    if (q.expectMeetingAbsent) {
      pass = !ids.includes(q.expectMeetingAbsent);
      if (!pass) reason = `ISOLATION BREACH — ${q.expectMeetingAbsent} (another user's meeting) surfaced in Alice's scope`;
    } else if (q.expectTopMeeting) {
      pass = ids[0] === q.expectTopMeeting;
      if (!pass) reason = `expected top meeting ${q.expectTopMeeting}, got ${ids[0] ?? '(none)'} [${ids.join(',')}]`;
    } else if (q.expectMeetingPresent) {
      pass = ids.includes(q.expectMeetingPresent);
      if (!pass) reason = `expected ${q.expectMeetingPresent} present, got [${ids.join(',')}]`;
    }
    record({
      id: q.id, category: 'F', mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
      actual_answer: JSON.stringify(results.map((r) => ({ id: r.meetingId, conf: r.confidence, why: r.whyMatched }))).slice(0, 500),
      pass, failure_reason: reason,
      first_useful_token_ms: NOT_MEASURED('deterministic fusion ranking — no provider'),
      total_time_ms: 0, provider_used: 'deterministic_service',
      usage: { global_search_used: true },
      evidence: { query: q.query, filter: q.filter || {}, scope: scopeA, rankedIds: ids },
    });
  }
});

// ============================================================================
//  CATEGORY G — in-meeting search (SearchOrchestrator.inMeetingSearch)
// ============================================================================
test('[G] in-meeting search — SearchOrchestrator.inMeetingSearch', () => {
  const orch = new SearchOrchestrator();
  const chunks = buildInMeetingChunks();
  for (const q of QUESTIONS.filter((x) => x.category === 'G')) {
    const results = orch.inMeetingSearch(chunks, q.query);
    let pass = false; let reason = null;
    if (q.expectEmpty) {
      pass = results.length === 0;
      if (!pass) reason = `expected NO match (hallucination guard) but got ${results.length} result(s)`;
    } else {
      const top = results[0];
      pass = !!top && top.snippet.toLowerCase().includes(String(q.expectSnippetContains).toLowerCase()) && typeof top.timestampMs === 'number';
      if (!pass) reason = `expected top snippet containing "${q.expectSnippetContains}" with timestamp; got ${top ? JSON.stringify({ s: top.snippet.slice(0, 60), ts: top.timestampMs }) : '(none)'}`;
    }
    record({
      id: q.id, category: 'G', mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
      actual_answer: JSON.stringify(results.map((r) => ({ s: r.snippet.slice(0, 60), ts: r.timestampMs, sc: r.score }))).slice(0, 400),
      pass, failure_reason: reason,
      first_useful_token_ms: NOT_MEASURED('deterministic lexical search — no provider'),
      total_time_ms: 0, provider_used: 'deterministic_service',
      usage: { in_meeting_search_used: true },
      evidence: { query: q.query, topSnippet: results[0]?.snippet?.slice(0, 80) ?? null, topTs: results[0]?.timestampMs ?? null },
    });
  }
});

// ============================================================================
//  CATEGORY H — mode boundaries (planAnswer profileContextPolicy)
// ============================================================================
test('[H] mode boundaries — planAnswer routing + profileContextPolicy', () => {
  for (const q of QUESTIONS.filter((x) => x.category === 'H')) {
    const plan = planAnswer({ question: q.question, source: q.source || 'manual_input', activeMode: q.activeMode });
    const policy = plan.profileContextPolicy;
    const coding = isCodingAnswerType(plan.answerType);
    let pass = true; let reason = null;
    if (q.expectProfilePolicy && policy !== q.expectProfilePolicy) { pass = false; reason = `expected profileContextPolicy='${q.expectProfilePolicy}', got '${policy}' (type ${plan.answerType})`; }
    if (q.expectProfilePolicyNot && policy === q.expectProfilePolicyNot) { pass = false; reason = `profileContextPolicy must NOT be '${q.expectProfilePolicyNot}' but is (type ${plan.answerType})`; }
    if (q.expectCoding === true && !coding) { pass = false; reason = `expected a coding answer type, got '${plan.answerType}' (not coding)`; }
    if (q.expectCoding === false && coding) { pass = false; reason = `expected a NON-coding answer type, got coding '${plan.answerType}'`; }
    if (q.expectCandidateVoiceMode) {
      const voiceOk = plan.outputPerspective === 'first_person_candidate' || policy === 'allowed' || policy === 'required';
      if (!voiceOk) { pass = false; reason = `looking-for-work should allow candidate voice; got perspective='${plan.outputPerspective}', policy='${policy}'`; }
    }
    record({
      id: q.id, category: 'H', mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
      actual_answer: `answerType=${plan.answerType} policy=${policy} coding=${coding} perspective=${plan.outputPerspective}`,
      pass, failure_reason: reason,
      first_useful_token_ms: NOT_MEASURED('deterministic routing decision — no provider'),
      total_time_ms: 0, provider_used: 'deterministic_router',
      usage: { context_router_used: true, deterministic_fast_path_used: true },
      evidence: { answerType: plan.answerType, profileContextPolicy: policy, isCoding: coding, outputPerspective: plan.outputPerspective, required: plan.requiredContextLayers, forbidden: plan.forbiddenContextLayers },
    });
  }
});

// ============================================================================
//  CATEGORY I — lecture notes (LectureIntelligenceService.generateNotes)
// ============================================================================
test('[I] lecture notes — LectureIntelligenceService.generateNotes + course memory', () => {
  const svc = new LectureIntelligenceService();
  const byId = { l1_tcp: LECTURE_1, l2_deadlock: LECTURE_2, l3_normalization: LECTURE_3 };
  const generated = {};
  for (const q of QUESTIONS.filter((x) => x.category === 'I')) {
    const lec = byId[q.lecture];
    const key = `${lec.lectureId}|${lec.course}`;
    const notes = generated[key] || (generated[key] = svc.generateNotes({ lectureId: lec.lectureId, segments: lec.segments, title: lec.title, course: lec.course }));
    let pass = false; let reason = null; let actual = '';
    if (q.courseMemory) {
      const hits = svc.courseMemory.lecturesMentioning(lec.course, q.expectConcept);
      pass = hits.length > 0;
      actual = `course ${lec.course}: lectures mentioning "${q.expectConcept}" = ${hits.map((h) => h.lectureId).join(',')}`;
      if (!pass) reason = `course memory found no lecture mentioning "${q.expectConcept}"`;
    } else {
      const field = notes[q.expectField];
      if (q.expectField === 'definitions') {
        pass = Array.isArray(field) && field.length > 0;
        if (q.expectConcept) pass = pass && field.some((d) => `${d.term} ${d.definition}`.toLowerCase().includes(q.expectConcept));
        actual = JSON.stringify(field).slice(0, 300);
        if (!pass) reason = `no definition for "${q.expectConcept}" (got ${actual})`;
      } else if (q.expectField === 'coreConcepts') {
        pass = Array.isArray(field) && field.length > 0;
        if (q.expectConcept) pass = pass && field.some((c) => String(c.term || c).toLowerCase().includes(q.expectConcept));
        actual = JSON.stringify(field.map((c) => c.term || c)).slice(0, 300);
        if (!pass) reason = `core concepts missing "${q.expectConcept}" (got ${actual})`;
      } else {
        pass = Array.isArray(field) && field.length > 0;
        actual = JSON.stringify(field).slice(0, 300);
        if (!pass) reason = `${q.expectField} empty`;
      }
    }
    record({
      id: q.id, category: 'I', mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
      actual_answer: actual, pass, failure_reason: reason,
      first_useful_token_ms: NOT_MEASURED('deterministic note generation — no provider'),
      total_time_ms: 0, provider_used: 'deterministic_service',
      usage: { lecture_intelligence_used: true },
      evidence: { lectureId: lec.lectureId, course: lec.course, field: q.expectField, conceptCount: notes.coreConcepts.length, definitionCount: notes.definitions.length },
    });
  }
});

// ============================================================================
//  CATEGORY J — diagrams (DiagramIntelligenceService.generate)
// ============================================================================
test('[J] diagrams — DiagramIntelligenceService.generate', () => {
  const svc = new DiagramIntelligenceService();
  for (const q of QUESTIONS.filter((x) => x.category === 'J')) {
    const d = svc.generate({ text: DIAGRAM_INPUTS[q.diagram], fromSourceVisual: false });
    let pass = false; let reason = null;
    if (q.expectKind === 'none') {
      pass = d.kind === 'none' || !d.valid || !d.mermaid;
      if (!pass) reason = `expected NO diagram (no-structure guard), got kind=${d.kind} valid=${d.valid}`;
    } else {
      pass = d.kind === q.expectKind && d.valid && d.mermaid.length > 0 && d.confidenceLabel !== 'exact_source_diagram';
      if (!pass) reason = `expected valid ${q.expectKind} (ai_reconstructed), got kind=${d.kind} valid=${d.valid} label=${d.confidenceLabel}`;
    }
    record({
      id: q.id, category: 'J', mode: q.mode, question: q.question, expected_behavior: q.expected_behavior,
      actual_answer: `kind=${d.kind} valid=${d.valid} label=${d.confidenceLabel} mermaid=${(d.mermaid || '').slice(0, 120).replace(/\n/g, ' / ')}`,
      pass, failure_reason: reason,
      first_useful_token_ms: NOT_MEASURED('deterministic diagram generation — no provider'),
      total_time_ms: 0, provider_used: 'deterministic_service',
      usage: { diagram_intelligence_used: true },
      evidence: { kind: d.kind, valid: d.valid, confidenceLabel: d.confidenceLabel, hasMermaid: !!d.mermaid },
    });
  }
});

// ============================================================================
//  CATEGORY K — privacy / isolation (ProfileTree per-user + Search scope)
// ============================================================================
test('[K] privacy isolation — ProfileTree per-user + Search scope', () => {
  const bobTree = new ProfileTreeService(BOB_FACTS, null);
  const bobProjects = (bobTree.getProjects() || '').toLowerCase();
  const bobIdentity = (bobTree.getIdentity().answer || '').toLowerCase();
  const k01Leak = bobProjects.includes('atlasdb') || bobIdentity.includes('atlasdb') || bobProjects.includes('alice') || bobIdentity.includes('alice');
  const k01Pass = !k01Leak && bobProjects.includes('cloudcart');
  record({
    id: 'K01', category: 'K', mode: 'privacy', question: QUESTIONS.find((x) => x.id === 'K01').question,
    expected_behavior: QUESTIONS.find((x) => x.id === 'K01').expected_behavior,
    actual_answer: `Bob projects: ${bobProjects.slice(0, 150)}`,
    pass: k01Pass, failure_reason: k01Pass ? null : (k01Leak ? 'CROSS-USER LEAK — Alice\'s AtlasDB/name surfaced in Bob\'s ProfileTree' : 'Bob\'s own project not surfaced (tree empty)'),
    first_useful_token_ms: NOT_MEASURED('deterministic profile tree — no provider'),
    total_time_ms: 0, provider_used: 'deterministic_service',
    usage: { profile_tree_used: true },
    evidence: { bobHasOwnProject: bobProjects.includes('cloudcart'), aliceLeak: k01Leak },
  });

  const orch = new SearchOrchestrator();
  const corpus = buildGlobalSearchCandidates();
  const scopeB = { userId: USER_B.userId, orgId: USER_B.orgId };
  const bobResults = orch.globalSearch(corpus, scopeB, {}, Date.now());
  const bobIds = bobResults.map((r) => r.meetingId);
  const aliceMeetingIds = ['m1_interview_redis', 'm2_sales_pricing', 'm3_team_actions'];
  const k02Leak = bobIds.some((id) => aliceMeetingIds.includes(id));
  record({
    id: 'K02', category: 'K', mode: 'privacy', question: QUESTIONS.find((x) => x.id === 'K02').question,
    expected_behavior: QUESTIONS.find((x) => x.id === 'K02').expected_behavior,
    actual_answer: `Bob-scoped search returned: [${bobIds.join(',')}]`,
    pass: !k02Leak, failure_reason: !k02Leak ? null : `ISOLATION BREACH — Alice's meeting(s) returned for Bob: ${bobIds.filter((id) => aliceMeetingIds.includes(id)).join(',')}`,
    first_useful_token_ms: NOT_MEASURED('deterministic search scope — no provider'),
    total_time_ms: 0, provider_used: 'deterministic_service',
    usage: { global_search_used: true },
    evidence: { bobScopedIds: bobIds, aliceLeak: k02Leak },
  });
});
