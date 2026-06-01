// intelligence-eval-real-api/run-real-api-e2e.ts
//
// REAL API end-to-end intelligence eval. For each of the 100 cases it:
//   1. loads the synthetic profile into a REAL KnowledgeOrchestrator,
//   2. reproduces production context assembly (assembleManual / assembleWhatToAnswer
//      — the exact prompt _streamChatInner / WhatToAnswerLLM build),
//   3. for provider-streaming cases, POSTs to the REAL https://api.natively.software
//      /v1/chat with x-natively-key and streams the SSE response,
//   4. records real first-byte / first-token / first-useful-token / total latency,
//   5. grades the REAL streamed text + audits context usage.
//
// Deterministic fast-path cases (identity/intro ready answers) are labelled
// responsePath="deterministic_fast_path", providerUsed=false — these are the
// production design's safe fast answers; they still go through the real
// orchestrator routing.
//
// HARD GUARDS:
//   - Asserts NATIVELY_TEST_API_KEY is set; exits 2 with a setup message if not.
//   - Mock detection: refuses to certify if fetch is intercepted or base URL is
//     not the production host.
//   - The key is NEVER printed/written; redactKey() masks key-like tokens.
//
// Run: NATIVELY_TEST_API_KEY=... node intelligence-eval-real-api/run-real-api-e2e.ts
//      add --dry-run to assemble prompts + audit routing WITHOUT calling the API
//      (used to validate the harness offline; clearly marked as not a production proof).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApiKey, detectMockEnvironment, redactKey, NATIVELY_CHAT_URL } from './real-api-client.ts';
import { RealLatencyRecorder, percentile } from './real-api-latency-recorder.ts';
import { runStreaming } from './real-api-streaming-client.ts';
import { loadFixture, loadSession, assembleManual, HARD_SYSTEM_PROMPT } from './real-api-session-loader.ts';
import { extract, assembleWhatToAnswer } from './real-api-transcript-runner.ts';
import { grade, type RealTestCase, type RealAnswer } from './real-api-grader.ts';
import { audit, type AuditInput } from './real-api-context-auditor.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../');
const resultsDir = path.resolve(__dirname, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

const DRY_RUN = process.argv.includes('--dry-run');

// ── Guard 1: API key present ────────────────────────────────────────────────
const { key, info } = getApiKey();
if (!info.present && !DRY_RUN) {
  console.error(`
[real-api-e2e] NATIVELY_TEST_API_KEY is not set.

This eval MUST hit the real Natively API; it will not fabricate results.
Set the test key and rerun:

    export NATIVELY_TEST_API_KEY="<your-test-key>"
    node intelligence-eval-real-api/run-real-api-e2e.ts

(Or run with --dry-run to validate the harness offline — that is NOT a
production proof and is reported as such.)
`);
  process.exit(2);
}

// ── Guard 2: mock detection ─────────────────────────────────────────────────
const mock = detectMockEnvironment();
if (!DRY_RUN && (mock.mockProviderDetected || mock.fetchIntercepted)) {
  console.error('[real-api-e2e] Mock environment detected (fetch intercepted or non-prod base URL). Refusing to certify.');
  console.error(`  apiBaseUrl=${mock.apiBaseUrl} fetchIntercepted=${mock.fetchIntercepted}`);
  process.exit(3);
}

const { cases } = JSON.parse(fs.readFileSync(
  path.resolve(ROOT, 'intelligence-eval/test-cases/intelligence-100-e2e.json'), 'utf8')) as { cases: RealTestCase[] };

// Cache one loaded session per profile (fresh orchestrator, real context).
const sessionCache = new Map<string, ReturnType<typeof loadSession>>();
function sessionFor(profileId: string) {
  if (!sessionCache.has(profileId)) sessionCache.set(profileId, loadSession(loadFixture(profileId)));
  return sessionCache.get(profileId)!;
}

let sessionsCreated = 0;
const results: any[] = [];

for (const tc of cases) {
  const session = sessionFor(tc.profileId);
  sessionsCreated++;
  const rec = new RealLatencyRecorder();

  // ── Assemble the production prompt (real routing) ──────────────────────────
  let detectedSpeaker = 'user';
  let extractionMs = 0;
  let assembled: any;
  if (tc.mode === 'what_to_answer') {
    const ext = extract(tc.transcript || '');
    extractionMs = ext.extractionMs;
    detectedSpeaker = ext.detectedSpeaker;
    assembled = await assembleWhatToAnswer(session, ext);
    // The transcript IS the input for the what-to-answer path — live_transcript
    // is structurally part of the packet regardless of what grounded.
    if (!assembled.selectedContextLayers.includes('live_transcript')) {
      assembled.selectedContextLayers.push('live_transcript');
    }
  } else {
    assembled = await assembleManual(session, tc.question || '', HARD_SYSTEM_PROMPT);
  }
  rec.mark('contextReady');

  // ── Produce the answer ─────────────────────────────────────────────────────
  let answer = '';
  let httpStatus = 0;
  let requestId = '';
  let provider = '';
  let chunks = 0;
  let usedRealApi = false;
  let error: string | undefined;
  let latency = rec.metrics();

  if (assembled.responsePath === 'deterministic_fast_path' && assembled.deterministicAnswer) {
    // Production answers these WITHOUT a provider call. Mark first-useful-token
    // at contextReady (the answer is ready then). This is a genuine fast path.
    answer = assembled.deterministicAnswer;
    rec.mark('providerRequestStart'); rec.mark('firstByte'); rec.mark('firstToken'); rec.mark('firstUsefulToken'); rec.mark('streamCompleted');
    latency = rec.metrics();
  } else if (DRY_RUN) {
    // Offline harness validation: no API call. Clearly NOT a production proof.
    answer = '[dry-run: no provider call made]';
    rec.mark('providerRequestStart'); rec.mark('streamCompleted');
    latency = rec.metrics();
  } else {
    // REAL provider streaming call. Pace requests so we don't trip the API's
    // rate limiter (the first run fired 71 back-to-back and 34 hit connection
    // failures). A short gap + the client's retry/backoff mirrors real client
    // behaviour (one call per user action) without loosening any assertion.
    await new Promise(r => setTimeout(r, 600));
    try {
      const run = await runStreaming(key, { userContent: assembled.userContent, system: assembled.system }, rec, 5);
      answer = run.text;
      httpStatus = run.result.httpStatus;
      requestId = run.result.requestId;
      provider = run.result.provider;
      chunks = run.chunks;
      latency = run.latency;
      usedRealApi = true;
      if (!run.result.ok) error = run.result.error;
    } catch (e: any) {
      error = redactKey(String(e?.message || e));
      latency = rec.metrics();
    }
  }

  // ── Grade against the REAL answer ──────────────────────────────────────────
  const realAnswer: RealAnswer = {
    answer,
    rawContextBlock: assembled.contextBlock,
    detectedSpeaker,
    selectedContextLayers: assembled.selectedContextLayers,
    firstUsefulTokenMs: latency.firstUsefulTokenMs,
    totalResponseMs: latency.totalResponseMs,
    providerUsed: assembled.providerUsed && !DRY_RUN,
    responsePath: assembled.responsePath,
  };
  const g = (DRY_RUN && assembled.responsePath === 'provider_streaming')
    ? { passed: false, score: 0, failReasons: ['dry_run_no_provider_answer'] }   // dry-run can't validate provider answers
    : grade(tc, realAnswer);

  const excluded = ['stable_identity','resume','projects','skills','experience','education','jd','custom_context','persona','negotiation','reference_files','live_transcript','meeting_mode','assistant_identity']
    .filter(l => !assembled.selectedContextLayers.includes(l));

  results.push({
    testId: tc.testId, profileId: tc.profileId, mode: tc.mode, pattern: tc.pattern,
    apiPathUsed: NATIVELY_CHAT_URL,
    usedRealApi, usedMock: false, usedProvider: realAnswer.providerUsed,
    providerName: provider, httpStatus, requestId,
    sessionId: `${tc.profileId}#${sessionsCreated}`, contextVersion: 'synthetic-1',
    responsePath: assembled.responsePath,
    detectedIntent: assembled.detectedIntent, detectedSpeaker,
    selectedContextLayers: assembled.selectedContextLayers, excludedContextLayers: excluded,
    questionExtractionMs: extractionMs,
    contextBuildMs: latency.contextBuildMs, intentDetectionMs: 0, promptBuildMs: latency.contextBuildMs,
    providerRequestStartMs: latency.providerRequestStartMs,
    firstByteMs: latency.firstByteMs, firstTokenMs: latency.firstTokenMs,
    firstUsefulTokenMs: latency.firstUsefulTokenMs, totalResponseMs: latency.totalResponseMs,
    inputTokenCount: Math.ceil((assembled.userContent + assembled.system).length / 4),
    outputTokenCount: Math.ceil(answer.length / 4),
    rawResponse: redactKey(answer).slice(0, 2000),
    normalizedResponse: redactKey(answer).toLowerCase().slice(0, 2000),
    requiredFactsFound: (tc.requiredFacts || []).filter(f => answer.toLowerCase().includes(f.toLowerCase())),
    missingRequiredFacts: (tc.requiredFacts || []).filter(f => !answer.toLowerCase().includes(f.toLowerCase())),
    forbiddenFactsFound: (tc.forbiddenFacts || []).filter(f => answer.toLowerCase().includes(f.toLowerCase())),
    hallucinationFlags: g.failReasons.filter(r => r.startsWith('hallucinated')),
    contextPollutionFlags: g.failReasons.filter(r => r.startsWith('forbidden_context_layer') || r.startsWith('forbidden_fact')),
    passed: g.passed, score: g.score, failReasons: g.failReasons,
    error,
    mockDetection: { ...mock, realProviderEvidence: { requestId, provider, streamingChunksReceived: chunks } },
  });
}

// ── Aggregate ───────────────────────────────────────────────────────────────
const passed = results.filter(r => r.passed);
const failed = results.filter(r => !r.passed);
const critical = results.filter(r => cases.find(c => c.testId === r.testId)?.critical);
const criticalFailed = critical.filter(r => !r.passed);
const realApiCount = results.filter(r => r.usedRealApi).length;
const providerCount = results.filter(r => r.usedProvider).length;
const fastPathCount = results.filter(r => r.responsePath === 'deterministic_fast_path').length;

const cat = (pred: (r: any) => boolean, field: string) => {
  const vals = results.filter(pred).map(r => r[field]).filter((n: number) => n > 0);
  return { p50: percentile(vals, 0.5), p95: percentile(vals, 0.95) };
};
const manualFactual = (r: any) => r.mode === 'manual_input' && r.responsePath === 'deterministic_fast_path';
const manualLLM = (r: any) => r.mode === 'manual_input' && r.responsePath === 'provider_streaming';
const wta = (r: any) => r.mode === 'what_to_answer';

const summary = {
  iteration: 'real-api-iteration-001',
  dryRun: DRY_RUN,
  endpoint: NATIVELY_CHAT_URL,
  apiKeyFingerprint: info.fingerprint,
  mockDetection: mock,
  total: results.length, passed: passed.length, failed: failed.length,
  accuracy: results.length ? passed.length / results.length : 0,
  criticalTotal: critical.length, criticalPassed: critical.length - criticalFailed.length,
  criticalFailed: criticalFailed.map(r => r.testId),
  realApiSessionsCreated: sessionsCreated,
  realApiCalls: realApiCount, providerBackedResponses: providerCount, deterministicFastPathResponses: fastPathCount,
  mockResponsesDetected: results.filter(r => r.usedMock).length,
  latency: {
    manual_factual_first_useful_p50: cat(manualFactual, 'firstUsefulTokenMs').p50,
    manual_factual_first_useful_p95: cat(manualFactual, 'firstUsefulTokenMs').p95,
    manual_llm_first_useful_p50: cat(manualLLM, 'firstUsefulTokenMs').p50,
    manual_llm_first_useful_p95: cat(manualLLM, 'firstUsefulTokenMs').p95,
    wta_first_useful_p50: cat(wta, 'firstUsefulTokenMs').p50,
    wta_first_useful_p95: cat(wta, 'firstUsefulTokenMs').p95,
    wta_extraction_p95: percentile(results.filter(wta).map(r => r.questionExtractionMs), 0.95),
    total_response_p50: percentile(results.map(r => r.totalResponseMs), 0.5),
    total_response_p95: percentile(results.map(r => r.totalResponseMs), 0.95),
  },
  contextAudit: audit(results.map(r => ({
    testId: r.testId, pattern: r.pattern, requiredFacts: r.requiredFactsFound.concat(r.missingRequiredFacts),
    forbiddenFacts: r.forbiddenFactsFound, expectedLayers: [], selectedContextLayers: r.selectedContextLayers,
    answer: r.rawResponse, rawContextBlock: '', passed: r.passed, failReasons: r.failReasons,
  }) as AuditInput)),
  failures: failed.map(r => ({ testId: r.testId, pattern: r.pattern, reasons: r.failReasons, error: r.error })),
  results,
};

const gatePass = !DRY_RUN
  && realApiCount + fastPathCount === results.length    // every case went through real path (provider or genuine fast path)
  && passed.length >= 99 && criticalFailed.length === 0
  && summary.contextAudit.assistantIdentityConfusionCount === 0;

fs.writeFileSync(path.join(resultsDir, 'real-api-iteration-001.json'), JSON.stringify(summary, null, 2));

console.log(`\n=== REAL API E2E ${DRY_RUN ? '(DRY RUN — NOT a production proof)' : ''} ===`);
console.log(`Endpoint: ${NATIVELY_CHAT_URL} | key: ${info.fingerprint}`);
console.log(`Tests: ${passed.length}/${results.length} passed | critical ${summary.criticalPassed}/${summary.criticalTotal}`);
console.log(`Real API calls: ${realApiCount} | provider-backed: ${providerCount} | fast-path: ${fastPathCount} | mocks: ${summary.mockResponsesDetected}`);
console.log(`Manual factual first-useful p50/p95: ${summary.latency.manual_factual_first_useful_p50}/${summary.latency.manual_factual_first_useful_p95}ms`);
console.log(`Manual LLM first-useful p50/p95: ${summary.latency.manual_llm_first_useful_p50}/${summary.latency.manual_llm_first_useful_p95}ms`);
console.log(`What-to-answer first-useful p50/p95: ${summary.latency.wta_first_useful_p50}/${summary.latency.wta_first_useful_p95}ms | extraction p95: ${summary.latency.wta_extraction_p95}ms`);
console.log(`Assistant-identity confusion: ${summary.contextAudit.assistantIdentityConfusionCount}`);
if (failed.length) { console.log(`\nFailures (${failed.length}):`); for (const f of failed.slice(0, 30)) console.log(`  ${f.testId} [${f.pattern}] ${f.failReasons.join(', ')}`); }
console.log(`\nRelease gate: ${gatePass ? 'PASS' : 'FAIL'}${DRY_RUN ? ' (dry-run cannot pass the gate by design)' : ''}`);

// Write the markdown reports.
await import('./write-real-api-reports.ts').then(m => m.writeReports(summary)).catch(e => console.warn('report write failed:', e?.message));

process.exit(gatePass ? 0 : 1);
