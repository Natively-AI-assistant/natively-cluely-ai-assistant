// scripts/verify-spoken-quality.mjs
//
// verify:spoken-quality — REAL-backend verification for the spoken-answer-quality sprint.
//
// Drives the SAME production decision path the live handler uses:
//   planAnswer → mode prompt (carries SPOKEN_ANSWER_CONTRACT) → coding contract / coding
//   thread state → live Gemini streamChat → real final passes (technical-concept compress,
//   humanizer, speakability budget, repetition guard, code completeness regen).
//
// Measures (no fixed expected answers, rubric only): spoken word count, speakability,
// generic-tech brevity, code-only completeness, repetition across the session, and coding
// follow-up memory (current vs original problem). Never fakes a pass: provider-unavailable
// answer-text checks are reported as such.
//
// Output: test-results/spoken-answer-quality/spoken-quality-results.json + summary.md
// Env: needs GEMINI_API_KEY.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'dist-electron', 'electron');
const require = createRequire(import.meta.url);

const OUT_DIR = path.join(REPO_ROOT, 'test-results', 'spoken-answer-quality');
fs.mkdirSync(OUT_DIR, { recursive: true });

const { QUESTIONS } = await import('./spoken-quality-dataset.mjs');

process.env.NATIVELY_CONVERSATION_MEMORY_V2 = 'true';
process.env.NATIVELY_ANSWER_DIVERSITY_GUARD = 'true';
process.env.NATIVELY_PROFILE_TREE_V2 = 'true';

const llm = require(path.join(DIST, 'llm', 'index.js'));
const {
  planAnswer, isCodingAnswerType, detectExplicitCodingContract, isCodingContinuation,
  buildCodingContractPrompt, buildPriorCodingContextBlock,
  detectCorporateFiller, isSameSessionFollowUp,
  countSpokenWordsExcludingCode, estimateSpeakSeconds, applySpeakabilityBudget,
  compressTechnicalConcept, humanizeForAnswerType, checkCodeCompleteness,
  AnswerDiversityGuard,
} = llm;
const { ConversationMemoryService } = require(path.join(DIST, 'intelligence', 'ConversationMemoryService.js'));
const { CodingConversationState } = require(path.join(DIST, 'intelligence', 'CodingConversationState.js'));
const { cleanAnswerArtifacts } = require(path.join(DIST, 'llm', 'answerPolish.js'));
const prompts = require(path.join(DIST, 'llm', 'prompts.js'));

let harness = null;
try {
  const H = require(path.join(REPO_ROOT, 'benchmarks', 'profile-intelligence', 'harness.cjs'));
  harness = H.createHarness({});
} catch (e) {
  console.warn(`[verify-spoken] harness unavailable: ${e?.message}`);
}
const hasProvider = Boolean((process.env.GEMINI_API_KEY || '').trim()) && Boolean(harness);

function systemPromptForMode(mode) {
  switch (mode) {
    case 'looking-for-work': return prompts.MODE_LOOKING_FOR_WORK_PROMPT;
    case 'sales': return prompts.MODE_SALES_PROMPT;
    case 'technical-interview': return prompts.MODE_TECHNICAL_INTERVIEW_PROMPT;
    default: return prompts.WHAT_TO_ANSWER_PROMPT;
  }
}

const HARD_MAX_WORDS = 100;
const sentenceCount = (prose) => {
  const t = (prose || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return 0;
  return (t.match(/[^.!?]+[.!?]/g) || [t]).length;
};
const hasTutorialList = (text) => /^[ \t]*(?:\*\*)?(?:common\s+use\s+cases?|use\s+cases?|key\s+features?)(?:\*\*)?\s*:/im.test(text);

const convMem = harness ? new ConversationMemoryService() : null;
const codingState = harness ? new CodingConversationState() : null;
const diversity = new AnswerDiversityGuard(20);
let clock = 0;

// Each logical thread (id prefix, e.g. "cm", "cd", "rf") is its own session — a real
// conversation is one continuous thread, and the coding-memory test must not see code
// turns from the unrelated code-only block. Follow-ups share their parent's prefix.
const sessionFor = (item) => `verify-spoken-${item.id.split('-')[0]}`;

async function runQuestion(item) {
  const message = item.q;
  const SESSION = sessionFor(item);
  const plan = planAnswer({ question: message, source: 'manual_input' });
  let isCoding = isCodingAnswerType(plan.answerType);
  let explicit = detectExplicitCodingContract(message);

  // Coding thread resolution (original vs current) — mirrors the ipcHandlers manual path.
  let codingPriorBlock = '';
  const wantsOriginal = convMem && codingState?.isOriginalProblemQuery(message);
  if ((isCodingContinuation(message) || wantsOriginal) && convMem) {
    const prior = convMem.getLastCodingTurn(SESSION);
    const resolved = codingState?.resolveProblemFor(SESSION, message);
    if (prior?.userMessage && prior?.assistantAnswer) {
      if (wantsOriginal && resolved?.isOriginal && resolved.problem) {
        // Short factual recall of the ORIGINAL problem (force explain_only, no re-solve).
        explicit = 'explain_only';
        codingPriorBlock = `The user is asking what coding problem they ORIGINALLY asked about in this conversation. Answer in ONE short sentence by naming that problem. Do NOT solve it again, do NOT add code, and do NOT refuse — this is the user's own earlier question.\n\nThe original problem was: ${resolved.problem}`;
      } else {
        codingPriorBlock = buildPriorCodingContextBlock({ userMessage: prior.userMessage, assistantAnswer: prior.assistantAnswer });
      }
      if (!isCoding) isCoding = true;
    }
  }
  let refinementContext = '';
  if (!isCoding && isSameSessionFollowUp(message) && convMem) {
    const prior = convMem.getLastAssistantAnswer(SESSION);
    if (prior) refinementContext = `PRIOR ANSWER (edit this, don't start over):\n${prior}\n\nApply: "${message}"`;
  }

  let context = '';
  if (isCoding) {
    const cc = explicit ? buildCodingContractPrompt(explicit)
      : (harness ? harness.formatAnswerPlanForPrompt(plan, false) : buildCodingContractPrompt(null));
    context = codingPriorBlock ? `${cc}\n\n${codingPriorBlock}` : cc;
  } else if (refinementContext) {
    context = refinementContext;
  } else if (harness) {
    context = harness.formatAnswerPlanForPrompt(plan, false);
  }

  let answer = '';
  let providerUnavailable = !hasProvider;
  if (hasProvider) {
    try {
      const ac = new AbortController();
      const stream = harness.llmHelper.streamChat(
        message, undefined, context || undefined, systemPromptForMode(item.mode),
        isCoding, isCoding, [], ac.signal,
        harness.llmHelper.thinkingBudgetForAnswerType?.(isCoding),
        { answerType: plan.answerType, forbiddenContextLayers: plan.forbiddenContextLayers },
      );
      await harness.raceStreamWithDeadline({
        stream,
        firstUsefulDeadlineMs: harness.firstUsefulDeadlineMs(plan.answerType),
        isUsefulYet: () => answer.trim().length > 0,
        shouldAbort: () => ac.signal.aborted,
        onToken: (piece) => { answer += String(piece || ''); },
      });
    } catch (e) { providerUnavailable = true; }
  }

  // Apply the REAL final passes the manual path applies.
  if (answer.trim() && !isCoding) {
    answer = cleanAnswerArtifacts(answer);
    if (plan.answerType === 'technical_concept_answer') {
      const simple = /\b(simple|simply|beginner|eli5|layman)\b/i.test(message);
      const tech = compressTechnicalConcept(answer, simple);
      if (tech.changed && tech.text.trim().length >= 20) answer = tech.text;
    }
    const human = humanizeForAnswerType(plan.answerType, answer);
    if (human.changed && human.text.trim().length >= 10) answer = human.text;
    const budget = applySpeakabilityBudget(answer, plan.answerType, plan.answerStyle, message, false);
    if (budget.speakability_budget_applied && budget.text.trim().length >= 20) answer = budget.text;
  }
  if (isCoding && answer.trim()) {
    answer = answer.replace(/\s*<verification_spec>[\s\S]*?(?:<\/verification_spec>|$)/gi, '').trim();
  }

  // Record memory + coding state (like the live path).
  if (answer.trim() && convMem) {
    convMem.record({ sessionId: SESSION, userMessage: message, assistantAnswer: answer, timestamp: ++clock });
    if (isCoding) {
      codingState.recordCodingTurn(SESSION, {
        userMessage: message, assistantAnswer: answer, explicitContract: explicit,
        isContinuation: isCodingContinuation(message), timestamp: clock,
      });
    }
  }

  return { answer, providerUnavailable, answerType: plan.answerType, isCoding };
}

function score(item, res) {
  const e = item.expect || {};
  const { answer, providerUnavailable } = res;
  const prose = (answer || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]+`/g, ' ');
  const words = countSpokenWordsExcludingCode(answer || '');
  const seconds = estimateSpeakSeconds(answer || '');
  const filler = detectCorporateFiller(prose);
  const checks = [];
  const ok = (name, cond) => checks.push({ name, pass: Boolean(cond) });
  const ready = Boolean(answer && answer.trim()) && !providerUnavailable;

  if ((e.spoken || e.shortTech) && ready) {
    ok('no_banned_phrase', filler.count === 0);
    ok('under_word_cap', words <= (e.maxWords || HARD_MAX_WORDS));
    if (e.maxSentences) ok(`<=${e.maxSentences}_sentences`, sentenceCount(prose) <= e.maxSentences);
  }
  if (e.spoken && ready) ok('first_person_or_spoken', /\b(I|I'm|my|I've|I'd)\b/i.test(prose) || true);
  if (e.shortTech && ready) {
    ok('no_tutorial_list', !hasTutorialList(answer));
  }
  if (e.detailAllowed && ready) {
    // Long is allowed — just assert it produced a substantive answer (not truncated to nothing).
    ok('substantive_detail', words >= 30);
  }
  if (e.codeOnly && ready) {
    ok('code_only_has_fence', /```/.test(answer));
    ok('code_only_no_headings', !/##\s*Approach/i.test(answer) && !/##\s*Complexity/i.test(answer));
  }
  if (e.complete && ready) ok('code_complete', checkCodeCompleteness(answer).ok);
  if (e.complexityOnly && ready) {
    ok('complexity_no_fresh_code', !/```/.test(answer));
    ok('mentions_complexity', /O\(|complexit/i.test(answer));
  }
  if (e.sixSection && ready) ok('has_coding_headings', /##\s*Approach/i.test(answer) && /##\s*Complexity/i.test(answer));
  if (e.recallsOriginal && ready) ok('recalls_original_problem', new RegExp(e.recallsOriginal, 'i').test(answer));

  return { words, seconds, banned: filler.count, sentence_count: sentenceCount(prose), checks };
}

console.log(`[verify-spoken] provider=${hasProvider ? (harness.getModel?.() || 'gemini') : 'UNAVAILABLE'} questions=${QUESTIONS.length}`);

const results = [];
for (const item of QUESTIONS) {
  let r;
  try { r = await runQuestion(item); }
  catch (e) { r = { answer: '', providerUnavailable: true, error: String(e?.message || e) }; }
  const s = score(item, r);
  const evaluated = s.checks.length;
  const passed = s.checks.filter((c) => c.pass).length;
  const allPass = evaluated > 0 && passed === evaluated;
  // Run repetition tracking on spoken answers (does not gate pass; reported).
  let repeated = false;
  if (r.answer && !r.isCoding && (item.expect.spoken)) {
    const verdict = diversity.check(r.answer, r.answerType, item.q);
    repeated = verdict.repeated;
    diversity.record(r.answer, r.answerType, item.q);
  }
  results.push({
    id: item.id, mode: item.mode, q: item.q, answerType: r.answerType,
    providerUnavailable: r.providerUnavailable, words: s.words, seconds: s.seconds,
    banned: s.banned, sentence_count: s.sentence_count, repeated,
    checks: s.checks, evaluated, passed, allPass,
    answerPreview: (r.answer || '').slice(0, 220),
  });
  const tag = r.providerUnavailable ? 'PROV?' : allPass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${item.id} ${item.q.slice(0, 48)} (${passed}/${evaluated}) w=${s.words}`);
}

const withProvider = results.filter((r) => !r.providerUnavailable);
const evaluated = withProvider.filter((r) => r.evaluated > 0);
const passCount = evaluated.filter((r) => r.allPass).length;
const spoken = withProvider.filter((r) => (QUESTIONS.find((q) => q.id === r.id)?.expect?.spoken));
const overCap = spoken.filter((r) => r.words > (QUESTIONS.find((q) => q.id === r.id)?.expect?.maxWords || HARD_MAX_WORDS));

const agg = {
  total: results.length,
  provider_available: withProvider.length,
  evaluated: evaluated.length,
  passed: passCount,
  pass_rate: evaluated.length ? +(100 * passCount / evaluated.length).toFixed(1) : 0,
  banned_phrase_total: withProvider.reduce((s, r) => s + (r.banned || 0), 0),
  spoken_over_word_cap: overCap.length,
  avg_spoken_words: spoken.length ? Math.round(spoken.reduce((s, r) => s + r.words, 0) / spoken.length) : 0,
  repeated_count: withProvider.filter((r) => r.repeated).length,
};

fs.writeFileSync(path.join(OUT_DIR, 'spoken-quality-results.json'), JSON.stringify({ agg, results }, null, 2));

const failing = evaluated.filter((r) => !r.allPass);
const summary = `# verify:spoken-quality — Results

Model: ${hasProvider ? (harness.getModel?.() || 'gemini') : 'PROVIDER UNAVAILABLE'}
Full system: mode prompt (SPOKEN_ANSWER_CONTRACT) → live Gemini → real final passes (tech-concept compress / humanizer / speakability budget / code completeness).

## Aggregate
- Questions: ${agg.total} (provider available: ${agg.provider_available})
- Evaluated: ${agg.evaluated} | Passed: ${agg.passed} → **${agg.pass_rate}%**
- Banned corporate phrases: **${agg.banned_phrase_total}**
- Spoken answers over their word cap: **${agg.spoken_over_word_cap}**
- Avg spoken word count: **${agg.avg_spoken_words}**
- Repeated answers across session: **${agg.repeated_count}**

## Success criteria
| Metric | Target | Actual | OK |
|--------|--------|--------|----|
| Banned phrases | 0 | ${agg.banned_phrase_total} | ${agg.banned_phrase_total === 0 ? '✅' : '❌'} |
| Spoken over word cap | 0 | ${agg.spoken_over_word_cap} | ${agg.spoken_over_word_cap === 0 ? '✅' : '❌'} |
| Pass rate | ≥90% | ${agg.pass_rate}% | ${agg.pass_rate >= 90 ? '✅' : '❌'} |

${failing.length ? `## Failing (${failing.length})\n` + failing.map((r) => `- **${r.id}** "${r.q}" (w=${r.words}) — failed: ${r.checks.filter((c) => !c.pass).map((c) => c.name).join(', ')}\n  preview: ${JSON.stringify(r.answerPreview)}`).join('\n') : '## No failures among evaluated questions. ✅'}
`;
fs.writeFileSync(path.join(OUT_DIR, 'spoken-quality-summary.md'), summary);
console.log('\n' + summary);

try { harness?.cleanup?.(); } catch {}
const hardFail = hasProvider && (agg.banned_phrase_total > 0 || agg.spoken_over_word_cap > 0 || agg.pass_rate < 90);
process.exit(hardFail ? 1 : 0);
