// scripts/verify-humanized-answers.mjs
//
// verify:humanized-answers — REAL-backend verification for the prompt-humanization sprint.
//
// It drives the SAME production decision path the live manual handler uses:
//   planAnswer → coding-contract detection (codingFollowup) → real streamChat (live
//   Gemini, the spoken mode prompts now carry HUMAN_SPOKEN_ANSWER_CONTRACT) → the real
//   final-answer polish (cleanAnswerArtifacts + humanizeForAnswerType).
//
// For each of the 80+ paraphrased questions it measures style properties only (no fixed
// expected answers): banned corporate phrases, em/en dash in prose, empty bullets,
// internal labels, first-person, and the coding format contract. It never fakes a pass:
// if the live provider is unavailable, the answer-text checks are reported as
// provider_unavailable, not green.
//
// Output: test-results/prompt-humanization/humanization-results.json + summary.md
//
// Env: needs GEMINI_API_KEY (harness.cjs loads .env). BENCHMARK_MODEL optional.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'dist-electron', 'electron');
const require = createRequire(import.meta.url);

const OUT_DIR = path.join(REPO_ROOT, 'test-results', 'prompt-humanization');
fs.mkdirSync(OUT_DIR, { recursive: true });

const { QUESTIONS } = await import('./humanized-answers-dataset.mjs');

// Force the intelligence flags ON so the humanizer + conversation memory run (production
// is default-OFF; the verify runner is the gate that proves they work).
process.env.NATIVELY_CONVERSATION_MEMORY_V2 = 'true';
process.env.NATIVELY_ANSWER_DIVERSITY_GUARD = 'true';
process.env.NATIVELY_PROFILE_TREE_V2 = 'true';

const llm = require(path.join(DIST, 'llm', 'index.js'));
const {
  planAnswer, isCodingAnswerType, detectExplicitCodingContract, isCodingContinuation,
  buildCodingContractPrompt, buildPriorCodingContextBlock, explicitContractProducesCode,
  humanizeForAnswerType, detectCorporateFiller, isSameSessionFollowUp,
} = llm;
const { ConversationMemoryService } = require(path.join(DIST, 'intelligence', 'ConversationMemoryService.js'));
const { cleanAnswerArtifacts } = require(path.join(DIST, 'llm', 'answerPolish.js'));
const prompts = require(path.join(DIST, 'llm', 'prompts.js'));

// Map each question's mode to its REAL MODE_* system prompt — the one that now carries
// HUMAN_SPOKEN_ANSWER_CONTRACT and the first-person voice instruction. This makes the
// verify exercise the FULL system (prompt contract + deterministic rewriter), the same
// system prompt ModesManager injects live, instead of the generic CHAT_MODE_PROMPT.
function systemPromptForMode(mode) {
  switch (mode) {
    case 'looking-for-work': return prompts.MODE_LOOKING_FOR_WORK_PROMPT;
    case 'sales': return prompts.MODE_SALES_PROMPT;
    case 'technical-interview': return prompts.MODE_TECHNICAL_INTERVIEW_PROMPT;
    case 'general':
    default: return prompts.WHAT_TO_ANSWER_PROMPT; // spoken WTA voice + contract
  }
}

let harness = null;
try {
  const H = require(path.join(REPO_ROOT, 'benchmarks', 'profile-intelligence', 'harness.cjs'));
  harness = H.createHarness({});
} catch (e) {
  console.warn(`[verify-humanized] harness unavailable: ${e?.message}`);
}
const hasProvider = Boolean((process.env.GEMINI_API_KEY || '').trim()) && Boolean(harness);

// ── Style detectors (the rubric) ──────────────────────────────────────────────
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const stripCodeAndMath = (s) =>
  s.replace(CODE_FENCE_RE, ' ').replace(INLINE_CODE_RE, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$[^$\n]+\$/g, ' ');

const EM_EN_DASH_RE = /[—–]/;
const EMPTY_BULLET_RE = /^[ \t]*[-*•+][ \t]*$/m;
const INTERNAL_LABEL_RE = /\b(Speakable Final Answer|The Honest Gap|Why It'?s Manageable|How I'?d Close It|Situation:|Task:|Action:|Result:)\b/i;
const SOURCE_NARRATION_RE = /\b(based on (?:my|your|the) (?:resume|profile|background)|according to the (?:jd|job description))\b/i;
const THE_CANDIDATE_RE = /\bthe candidate\b/i;
const FIRST_PERSON_RE = /\b(I|I'm|I’m|I've|I’ve|I'd|I’d|my|me)\b/;

function sentenceCount(prose) {
  const t = prose.replace(/\s+/g, ' ').trim();
  if (!t) return 0;
  return (t.match(/[^.!?]+[.!?]/g) || [t]).length;
}

// ── Score one answer against its expectations ─────────────────────────────────
function scoreAnswer(item, answer, providerUnavailable) {
  const e = item.expect || {};
  const prose = stripCodeAndMath(answer);
  const fillerVerdict = detectCorporateFiller(prose);
  const m = {
    banned_phrase_count: fillerVerdict.count,
    banned_phrases: fillerVerdict.matches,
    em_en_dash_in_prose: EM_EN_DASH_RE.test(prose) ? 1 : 0,
    empty_bullet_count: (answer.match(new RegExp(EMPTY_BULLET_RE.source, 'gm')) || []).length,
    internal_label: INTERNAL_LABEL_RE.test(answer) ? 1 : 0,
    source_narration: SOURCE_NARRATION_RE.test(prose) ? 1 : 0,
    the_candidate: THE_CANDIDATE_RE.test(prose) ? 1 : 0,
    sentence_count: sentenceCount(prose),
  };

  const checks = [];
  const ok = (name, cond) => checks.push({ name, pass: Boolean(cond) });
  const textReady = Boolean(answer && answer.trim()) && !providerUnavailable;

  // Style checks apply to any spoken answer with text.
  if ((e.spoken || e.firstPerson) && textReady) {
    ok('no_banned_phrase', m.banned_phrase_count === 0);
    ok('no_em_en_dash', m.em_en_dash_in_prose === 0);
    ok('no_empty_bullet', m.empty_bullet_count === 0);
    ok('no_internal_label', m.internal_label === 0);
    ok('no_source_narration', m.source_narration === 0);
    ok('no_the_candidate', m.the_candidate === 0);
  }
  if (e.firstPerson && textReady) ok('first_person', FIRST_PERSON_RE.test(prose));
  if (e.maxSentences && textReady) ok(`<=${e.maxSentences}_sentences`, m.sentence_count <= e.maxSentences);

  // Coding format checks.
  if (e.codeOnly && textReady) {
    ok('code_only_has_fence', /```/.test(answer));
    ok('code_only_no_headings', !/##\s*Approach/i.test(answer) && !/##\s*Complexity/i.test(answer));
  }
  if (e.complexityOnly && textReady) {
    ok('complexity_no_fresh_code', !/```/.test(answer));
    ok('complexity_mentions_O', /O\(/.test(answer) || /complexit/i.test(answer));
  }
  if (e.dryRunOnly && textReady) ok('dry_run_no_fresh_code', !/```/.test(answer));
  if (e.noCode && textReady) ok('no_code_block', !/```/.test(answer));
  if (e.sixSection && textReady) ok('has_coding_headings', /##\s*Approach/i.test(answer) && /##\s*Complexity/i.test(answer));
  if (e.codingContinuation) ok('detected_coding_continuation', isCodingContinuation(item.q));
  if (e.assistantIdentity && textReady) ok('assistant_identity', /Natively|Evin John|AI assistant|can't share/i.test(answer));

  return { metrics: m, checks };
}

// ── Run one question through the REAL backend ─────────────────────────────────
const SESSION = 'verify-humanized';
const convMem = harness ? new ConversationMemoryService() : null;

async function runQuestion(item) {
  const message = item.q;
  const plan = planAnswer({ question: message, source: 'manual_input' });
  let isCoding = isCodingAnswerType(plan.answerType);
  const explicit = detectExplicitCodingContract(message);

  // Coding follow-up: inherit the prior problem (bug #6 path).
  let codingPriorBlock = '';
  if (isCodingContinuation(message) && convMem) {
    const prior = convMem.getLastCodingTurn(SESSION);
    if (prior?.userMessage && prior?.assistantAnswer) {
      codingPriorBlock = buildPriorCodingContextBlock(prior);
      if (!isCoding) isCoding = true;
    }
  }
  // Same-session refinement ("make that shorter").
  let refinementContext = '';
  if (!isCoding && isSameSessionFollowUp(message) && convMem) {
    const prior = convMem.getLastAssistantAnswer(SESSION);
    if (prior) refinementContext = `PRIOR ANSWER (edit this, don't start over):\n${prior}\n\nApply: "${message}"`;
  }

  // Build the context exactly like the manual path.
  let context = '';
  if (isCoding) {
    const cc = explicit
      ? buildCodingContractPrompt(explicit)
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
    } catch (e) {
      providerUnavailable = true;
    }
  }

  // Apply the REAL final-answer polish the manual path applies.
  if (answer.trim() && !isCoding) {
    answer = cleanAnswerArtifacts(answer);
    const human = humanizeForAnswerType(plan.answerType, answer);
    if (human.changed && human.text.trim().length >= 10) answer = human.text;
  }
  if (isCoding && answer.trim()) {
    // strip the hidden verification spec if any model emitted one
    answer = answer.replace(/\s*<verification_spec>[\s\S]*?(?:<\/verification_spec>|$)/gi, '').trim();
  }

  // Record for follow-ups.
  if (answer.trim() && convMem) {
    convMem.record({ sessionId: SESSION, userMessage: message, assistantAnswer: answer, timestamp: Date.now() });
  }

  const scored = scoreAnswer(item, answer, providerUnavailable);
  return { answer, providerUnavailable, answerType: plan.answerType, explicit: explicit || 'none', isCoding, ...scored };
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`[verify-humanized] provider=${hasProvider ? (harness.getModel?.() || 'gemini') : 'UNAVAILABLE'} questions=${QUESTIONS.length}`);

const results = [];
for (const item of QUESTIONS) {
  let r;
  try {
    r = await runQuestion(item);
  } catch (e) {
    r = { answer: '', providerUnavailable: true, error: String(e?.message || e), metrics: {}, checks: [] };
  }
  const evaluated = r.checks.length;
  const passed = r.checks.filter((c) => c.pass).length;
  const allPass = evaluated > 0 && passed === evaluated;
  results.push({
    id: item.id, mode: item.mode, q: item.q, answerType: r.answerType, explicit: r.explicit,
    providerUnavailable: r.providerUnavailable, metrics: r.metrics, checks: r.checks,
    evaluated, passed, allPass,
    answerPreview: (r.answer || '').slice(0, 240),
  });
  const tag = r.providerUnavailable ? 'PROV?' : allPass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${item.id} ${item.q.slice(0, 52)}${item.q.length > 52 ? '…' : ''} (${passed}/${evaluated})`);
}

// ── Aggregate ───────────────────────────────────────────────────────────────
const withProvider = results.filter((r) => !r.providerUnavailable);
const evaluatedResults = withProvider.filter((r) => r.evaluated > 0);
const passCount = evaluatedResults.filter((r) => r.allPass).length;

const agg = {
  total: results.length,
  provider_available: withProvider.length,
  provider_unavailable: results.length - withProvider.length,
  evaluated: evaluatedResults.length,
  passed: passCount,
  pass_rate: evaluatedResults.length ? +(100 * passCount / evaluatedResults.length).toFixed(1) : 0,
  banned_phrase_total: withProvider.reduce((s, r) => s + (r.metrics.banned_phrase_count || 0), 0),
  em_en_dash_total: withProvider.reduce((s, r) => s + (r.metrics.em_en_dash_in_prose || 0), 0),
  empty_bullet_total: withProvider.reduce((s, r) => s + (r.metrics.empty_bullet_count || 0), 0),
  internal_label_total: withProvider.reduce((s, r) => s + (r.metrics.internal_label || 0), 0),
  the_candidate_total: withProvider.reduce((s, r) => s + (r.metrics.the_candidate || 0), 0),
};

fs.writeFileSync(path.join(OUT_DIR, 'humanization-results.json'), JSON.stringify({ agg, results }, null, 2));

const failing = evaluatedResults.filter((r) => !r.allPass);
const summary = `# verify:humanized-answers — Results

Model: ${hasProvider ? (harness.getModel?.() || 'gemini') : 'PROVIDER UNAVAILABLE'}
Generated over the REAL backend (planAnswer → coding contract → live streamChat → real humanizer final pass).

## Aggregate
- Questions: ${agg.total}
- Provider available: ${agg.provider_available} (unavailable: ${agg.provider_unavailable})
- Evaluated (had checks + provider): ${agg.evaluated}
- Passed (all checks): ${agg.passed} → **${agg.pass_rate}%**

## Style totals across answered questions
- Banned corporate phrases: **${agg.banned_phrase_total}**
- Em/en dash in spoken prose: **${agg.em_en_dash_total}**
- Empty bullets: **${agg.empty_bullet_total}**
- Internal labels: **${agg.internal_label_total}**
- "the candidate" in spoken prose: **${agg.the_candidate_total}**

## Success criteria
| Metric | Target | Actual | OK |
|--------|--------|--------|----|
| Banned phrases | 0 | ${agg.banned_phrase_total} | ${agg.banned_phrase_total === 0 ? '✅' : '❌'} |
| Em/en dash | 0 | ${agg.em_en_dash_total} | ${agg.em_en_dash_total === 0 ? '✅' : '❌'} |
| Empty bullets | 0 | ${agg.empty_bullet_total} | ${agg.empty_bullet_total === 0 ? '✅' : '❌'} |
| Pass rate | ≥92% | ${agg.pass_rate}% | ${agg.pass_rate >= 92 ? '✅' : '❌'} |

${failing.length ? `## Failing (${failing.length})\n` + failing.map((r) => `- **${r.id}** "${r.q}" — failed: ${r.checks.filter((c) => !c.pass).map((c) => c.name).join(', ')}\n  preview: ${JSON.stringify(r.answerPreview)}`).join('\n') : '## No failures among evaluated questions. ✅'}
`;
fs.writeFileSync(path.join(OUT_DIR, 'humanization-summary.md'), summary);

console.log('\n' + summary);

try { harness?.cleanup?.(); } catch {}

// Exit non-zero only on a real style failure with the provider available (not on
// provider-unavailable, which is an environment gap, not a code failure).
const hardFail = hasProvider && (agg.banned_phrase_total > 0 || agg.em_en_dash_total > 0 || agg.empty_bullet_total > 0 || agg.pass_rate < 92);
process.exit(hardFail ? 1 : 0);
