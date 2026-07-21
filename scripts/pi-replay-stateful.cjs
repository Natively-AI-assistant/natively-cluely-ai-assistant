/**
 * scripts/pi-replay-stateful.cjs — Phase 0 STATEFUL replay harness.
 *
 * Unlike pi-replay.cjs (stateless, one question in isolation), this drives
 * the questions SEQUENTIALLY through a single shared IntelligenceManager/
 * SessionTracker instance — exactly like a real manual-chat session, where
 * every submitted question AND every delivered answer is appended to the
 * same rolling 100s transcript window (ipcHandlers.ts:862-873,
 * SessionTracker.addTranscript/addAssistantMessage). This is required to
 * reproduce Defect Class B (question/answer desync via stale rolling
 * context) — the stateless replay cannot see it because each question runs
 * with zero prior state.
 *
 * Usage:
 *   node scripts/pi-replay-stateful.cjs <fixture.json> [outfile.json] [--gap-ms=15000]
 *
 * --gap-ms controls the simulated wall-clock gap between one answer landing
 * and the next question being "typed" (default 15000ms — a plausible human
 * reading+typing pace). Since getFormattedContext(100) is a 100-SECOND
 * window, gaps below ~100s keep prior turns in-window; realistic interview
 * pacing (10-20s per turn) means several prior turns are typically in-window
 * at once, matching the live session's `[ASSISTANT (PREVIOUS SUGGESTION)]`
 * bleed.
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

async function runOne(h, im, question, simClockMs, verbose) {
  const trace = { question, questionHash: qhash(question) };
  const { LatencyRecorder } = H;
  const rec = new LatencyRecorder();

  // ── mirrors ipcHandlers.ts:862-884: capture rolling context BEFORE adding
  //    the new user message, then add the user message. ──
  let autoContextSnapshot;
  try {
    const snap = im.getFormattedContext(100);
    if (snap && snap.trim().length > 0) autoContextSnapshot = snap;
  } catch { /* ignore */ }
  trace.autoContextSnapshotLength = autoContextSnapshot ? autoContextSnapshot.length : 0;
  trace.autoContextSnapshotPreview = autoContextSnapshot ? autoContextSnapshot.slice(-300) : '';

  im.addTranscript({ text: question, speaker: 'user', timestamp: simClockMs, final: true }, true);

  const answerPlan = h.planAnswer({ question, source: 'manual_input', speakerPerspective: 'user' });
  trace.answerType = answerPlan.answerType;
  trace.profileContextPolicy = answerPlan.profileContextPolicy;

  let isCodingChat = h.isCodingAnswerType(answerPlan.answerType);
  trace.isCodingChat = isCodingChat;

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
    let context;
    const isContractEnforced = CONTRACT_ENFORCED_TYPES.has(answerPlan.answerType);
    if (isCodingChat) {
      const explicitCodingContract = h.detectExplicitCodingContract ? h.detectExplicitCodingContract(question) : null;
      trace.explicitCodingContract = explicitCodingContract || 'none';
      context = explicitCodingContract
        ? h.buildCodingContractPrompt(explicitCodingContract, {})
        : h.formatAnswerPlanForPrompt(answerPlan, false);
      console.log('[IPC] Coding contract enforced; rolling context excluded', {
        answerType: answerPlan.answerType, explicitContract: explicitCodingContract || 'none',
      });
    } else if (isContractEnforced) {
      context = h.formatAnswerPlanForPrompt(answerPlan, false);
    } else if (autoContextSnapshot) {
      // mirrors ipcHandlers.ts:1337-1358 — non-doc-grounded manual chat keeps
      // the FULL rolling snapshot (prior assistant turns included).
      context = autoContextSnapshot;
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
  }

  // ── mirrors ipcHandlers.ts: addAssistantMessage on the SAME session, so the
  //    NEXT question's autoContextSnapshot sees this answer as
  //    [ASSISTANT (PREVIOUS SUGGESTION)]. ──
  try { im.addAssistantMessage(answer); } catch { /* ignore */ }

  trace.answer = answer;
  trace.via = via;
  trace.usedDeterministicFastPath = usedDeterministicFastPath;
  trace.promptContainsProfileContext = promptContainsProfileContext;
  trace.firstUsefulMs = firstUsefulMs;
  if (!verbose) delete trace.consoleLines;
  return trace;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const gapArg = process.argv.find((a) => a.startsWith('--gap-ms='));
  const gapMs = gapArg ? Number(gapArg.split('=')[1]) : 15000;
  const fixturePath = args[0];
  const outPath = args[1] || path.join(REPO_ROOT, 'debug-artifacts', 'pi-benchmark', 'replay-stateful-results.json');
  if (!fixturePath) {
    console.error('Usage: node scripts/pi-replay-stateful.cjs <fixture.json> [outfile.json] [--gap-ms=15000]');
    process.exit(1);
  }
  const verbose = process.env.PI_TRACE_VERBOSE === '1';
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const cases = fixture.cases || fixture;

  const h = H.createHarness({});
  const { IntelligenceManager } = require(path.join(REPO_ROOT, 'dist-electron/electron/IntelligenceManager.js'));
  const im = new IntelligenceManager(h.llmHelper);
  console.log(`[pi-replay-stateful] ${cases.length} questions · gap=${gapMs}ms · profile=${h.profileMeta.candidateRoleLabel} · model=${h.getModel()}`);

  let simClockMs = Date.now();
  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const question = typeof c === 'string' ? c : c.question;
    process.stdout.write(`[${i + 1}/${cases.length}] ${question.slice(0, 60)}... `);
    const t0 = Date.now();
    const r = await runOne(h, im, question, simClockMs, verbose);
    const dt = Date.now() - t0;
    console.log(`(${dt}ms) -> ${r.answerType} via=${r.via} ctx=${r.autoContextSnapshotLength}c`);
    results.push({ id: c.id, expect: c, ...r });
    simClockMs += gapMs;
  }
  h.cleanup();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ meta: { total: results.length, model: h.getModel(), gapMs }, results }, null, 2));
  console.log(`\n[pi-replay-stateful] wrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
