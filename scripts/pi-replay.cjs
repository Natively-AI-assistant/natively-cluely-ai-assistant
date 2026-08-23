/**
 * scripts/pi-replay.cjs — Phase 0 deterministic replay harness for the
 * Profile Intelligence production-fix autopilot task.
 *
 * Drives the SAME manual-chat sequence ipcHandlers.ts's `gemini-chat-stream`
 * handler runs (planAnswer -> fast-path preflight -> coding/contract context
 * assembly -> streamChat -> post-stream validators) against the real compiled
 * backend (dist-electron), using the real natively.db profile (copied, never
 * mutated) via benchmarks/profile-intelligence/harness.cjs.
 *
 * Usage:
 *   node scripts/pi-replay.cjs test-fixtures/pi-benchmark/evin-39.json [outfile]
 *
 * Env:
 *   PI_TRACE_VERBOSE=1   verbose per-question structured trace (routing seams)
 *   BENCHMARK_MODEL=...  forces an exact model id (passed through to harness)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const H = require(path.join(REPO_ROOT, 'benchmarks/profile-intelligence/harness.cjs'));

const TIMEOUT_MS = 30000;
const CONTRACT_ENFORCED_TYPES = new Set([
  'ethical_usage_answer', 'project_link_answer',
  'source_code_evidence_answer', 'project_about_answer',
]);
const CANDIDATE_CONTRACT_TYPES = new Set([
  'identity_answer', 'profile_fact_answer', 'experience_answer', 'project_answer',
  'project_followup_answer', 'skills_answer', 'skill_experience_answer',
  'jd_fit_answer', 'gap_analysis_answer', 'behavioral_interview_answer', 'negotiation_answer',
  'sales_answer', 'product_candidate_mix_answer', 'lecture_answer',
]);

function qhash(q) { return crypto.createHash('sha256').update(q).digest('hex').slice(0, 12); }

/**
 * Faithfully replays the gemini-chat-stream IPC sequence for ONE manual
 * question, without any conversation-memory/rolling-context state (mirrors a
 * true single-shot manual send — the harness has no per-session Maps since
 * each replay call is independent, same as the real handler's cold path).
 */
async function runOne(h, question, verbose) {
  const trace = { question, questionHash: qhash(question) };
  const rec = new (require(path.join(REPO_ROOT, 'benchmarks/profile-intelligence/harness.cjs')).LatencyRecorder)();

  const answerPlan = h.planAnswer({ question, source: 'manual_input', speakerPerspective: 'user' });
  trace.answerType = answerPlan.answerType;
  trace.profileContextPolicy = answerPlan.profileContextPolicy;
  trace.requiredContextLayers = answerPlan.requiredContextLayers;
  trace.forbiddenContextLayers = answerPlan.forbiddenContextLayers;

  let isCodingChat = h.isCodingAnswerType(answerPlan.answerType);
  trace.isCodingChat = isCodingChat;

  // --- fast-path preflight (mirrors ipcHandlers.ts:1195-1257) ---
  const isStealthChat = h.isStealthEvasionQuestion ? h.isStealthEvasionQuestion(question) : false;
  const fastPathEligible = !isCodingChat
    && !h.isAssistantIdentityQuestion(question)
    && !isStealthChat
    && answerPlan.answerType !== 'ethical_usage_answer'
    && answerPlan.answerType !== 'project_link_answer'
    && answerPlan.answerType !== 'source_code_evidence_answer'
    && answerPlan.answerType !== 'project_about_answer'
    && answerPlan.answerType !== 'lecture_answer';
  trace.fastPathEligible = fastPathEligible;

  let answer = '';
  let via = 'llm';
  let usedDeterministicFastPath = false;
  let promptContainsProfileContext = false;
  let firstUsefulMs = null;

  if (fastPathEligible) {
    try {
      const { route, routeLog } = h.buildManualProfileBackendAnswer({
        question, orchestrator: h.orchestrator, source: 'manual_input',
      });
      trace.routeLogFirstPass = routeLog;
      if (route) {
        answer = route.answer;
        via = 'fast_path';
        usedDeterministicFastPath = true;
        promptContainsProfileContext = true;
        firstUsefulMs = rec.ms();
      }
    } catch (e) { trace.fastPathError = e.message; }
  }

  if (!answer) {
    // --- context assembly (mirrors ipcHandlers.ts:1289-1403) ---
    let context;
    const isContractEnforced = CONTRACT_ENFORCED_TYPES.has(answerPlan.answerType);
    if (isCodingChat) {
      const explicitCodingContract = h.detectExplicitCodingContract ? h.detectExplicitCodingContract(question) : null;
      trace.explicitCodingContract = explicitCodingContract || 'none';
      if (explicitCodingContract) {
        context = h.buildCodingContractPrompt(explicitCodingContract, {});
      } else {
        context = h.formatAnswerPlanForPrompt(answerPlan, false);
      }
    } else if (isContractEnforced) {
      context = h.formatAnswerPlanForPrompt(answerPlan, false);
    }
    const wantsCandidateContract = CANDIDATE_CONTRACT_TYPES.has(answerPlan.answerType)
      || (answerPlan.answerStyle && answerPlan.answerStyle !== 'default');
    if (wantsCandidateContract && !isContractEnforced && !isCodingChat) {
      const candidateContract = h.formatAnswerPlanForPrompt(answerPlan, false);
      context = context ? `${candidateContract}\n\n${context}` : candidateContract;
      promptContainsProfileContext = answerPlan.profileContextPolicy !== 'forbidden';
    }
    trace.contextLength = context ? context.length : 0;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const cap = H.captureConsole();
    try {
      const isSafetyAnswer = answerPlan.answerType === 'ethical_usage_answer';
      const ignoreKnowledge = isCodingChat || isSafetyAnswer;
      const stream = h.llmHelper.streamChat(
        question, undefined, context, h.CHAT_MODE_PROMPT,
        ignoreKnowledge, isCodingChat || isSafetyAnswer, [], ac.signal,
        h.llmHelper.thinkingBudgetForAnswerType(isCodingChat),
        { answerType: answerPlan.answerType, forbiddenContextLayers: answerPlan.forbiddenContextLayers },
      );
      await h.raceStreamWithDeadline({
        stream,
        firstUsefulDeadlineMs: h.firstUsefulDeadlineMs(answerPlan.answerType, false),
        isUsefulYet: () => firstUsefulMs !== null,
        shouldAbort: () => ac.signal.aborted,
        onToken: (tok) => {
          answer += String(tok || '');
          if (firstUsefulMs === null && H.isUseful(answer)) firstUsefulMs = rec.ms();
        },
      });
    } catch (e) {
      trace.streamError = e.message;
    } finally {
      clearTimeout(timer);
      cap.restore();
      trace.consoleLines = cap.lines;
    }

    if (!isCodingChat) {
      // post-stream profile evidence validation (mirrors ipcHandlers.ts:1822-1848)
      try {
        const activeResume = h.orchestrator.activeResume && h.orchestrator.activeResume.structured_data;
        const activeJD = h.orchestrator.activeJD && h.orchestrator.activeJD.structured_data;
        const profileAvailable = h.profileFactsReady(activeResume);
        const evidence = `${JSON.stringify(activeResume || {})}\n${JSON.stringify(activeJD || {})}`;
        const profileValidation = h.validateProfileEvidence({
          answer, plan: answerPlan, evidence, profileAvailable, candidateDirected: profileAvailable,
        });
        trace.evidenceViolations = profileValidation.violations.map((v) => v.code);
      } catch (e) { trace.evidenceValidationError = e.message; }
    }
  }

  trace.answer = answer;
  trace.via = via;
  trace.usedDeterministicFastPath = usedDeterministicFastPath;
  trace.promptContainsProfileContext = promptContainsProfileContext;
  trace.firstUsefulMs = firstUsefulMs;
  if (!verbose) delete trace.consoleLines;
  return trace;
}

async function main() {
  const fixturePath = process.argv[2];
  const outPath = process.argv[3] || path.join(REPO_ROOT, 'debug-artifacts', 'pi-benchmark', 'replay-results.json');
  if (!fixturePath) {
    console.error('Usage: node scripts/pi-replay.cjs <fixture.json> [outfile.json]');
    process.exit(1);
  }
  const verbose = process.env.PI_TRACE_VERBOSE === '1';
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const cases = fixture.cases || fixture;

  const h = H.createHarness({});
  // The harness copies the LIVE natively.db, which may have an active custom
  // mode (e.g. a document-grounded "Seminar mode" left active by an unrelated
  // concurrent session on this machine) — deactivate it on the SAFE COPY only
  // so this replay tests plain manual-chat routing, matching every earlier
  // round of this benchmark. Never touches the live DB (h.db is the copy).
  // PI_REPLAY_KEEP_MODE=1 keeps the live DB's active mode (round-2 RC1/RC2
  // validation needs the "Looking for work" mode ACTIVE — that's the failing
  // condition). Default: deactivate for a mode-neutral replay.
  if (process.env.PI_REPLAY_KEEP_MODE !== '1') {
    try { h.db.exec('UPDATE modes SET is_active = 0'); } catch { /* best effort */ }
  }
  console.log(`[pi-replay] ${cases.length} questions · profile=${h.profileMeta.candidateRoleLabel} · model=${h.getModel()}`);

  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const question = typeof c === 'string' ? c : c.question;
    process.stdout.write(`[${i + 1}/${cases.length}] ${question.slice(0, 60)}... `);
    const t0 = Date.now();
    const r = await runOne(h, question, verbose);
    const dt = Date.now() - t0;
    console.log(`(${dt}ms) -> ${r.answerType} via=${r.via}`);
    results.push({ id: c.id, expect: c, ...r });
  }
  h.cleanup();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ meta: { total: results.length, model: h.getModel() }, results }, null, 2));
  console.log(`\n[pi-replay] wrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
