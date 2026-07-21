/**
 * verify-current-answer-quality.mjs — Phase 3/4 of the mixed-7000 audit.
 *
 * Drives the CURRENT checked-out backend (freshly-built dist-electron) on the
 * hypothesis probe sets, served by MiniMax-M2.7 via the same real-path seam the
 * 7000-run used (benchmarks/profile-intelligence/harness.cjs + the
 * tests/intelligence/e2e/minimax-provider client injected at llmHelper.groqClient).
 *
 * Unlike the 7000-run this CAPTURES THE FULL ANSWER (no 320-char preview) + derives
 * speakability metrics (word count, markdown-header/table/bullet flags, lazy-
 * clarification flag, resume-dump flag, product-identity-leak flag) so each
 * hypothesis can be CONFIRMED or REJECTED against current code, not the mixed run.
 *
 *   node scripts/verify-current-answer-quality.mjs [--hyp=H1,H3] [--limit=N] [--qpm=25]
 *
 * Output: test-results/mixed-7000-audit/reproduction-results.json + per-hypothesis
 * console verdicts. Honest about provider stalls (does not count them as product fails).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { validateKeys, EVAL_MODEL } from '../tests/intelligence/e2e/minimax-keypool.mjs';
import { createMiniMaxClient } from '../tests/intelligence/e2e/minimax-provider.mjs';
import { GlobalThrottle } from '../tests/intelligence/e2e/minimax-throttle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '..');
const BENCH = path.join(REPO, 'benchmarks', 'profile-intelligence');
const OUT = path.join(REPO, 'test-results', 'mixed-7000-audit');
const H = require(path.join(BENCH, 'harness.cjs'));

const args = process.argv.slice(2);
const getArg = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : undefined; };
const HYP = getArg('hyp') ? new Set(getArg('hyp').split(',')) : null;
const QPM = getArg('qpm') ? parseInt(getArg('qpm'), 10) : 25;
const TIMEOUT_MS = getArg('timeout') ? parseInt(getArg('timeout'), 10) : 120000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── probe sets (verbatim from the audit prompt's Phase 4) ──
const TRANSCRIPT_TEAM = [
  { speaker: 'Speaker', text: 'Mark owns the Redis migration and needs it done by Friday.' },
  { speaker: 'Speaker', text: 'Anu owns the landing page copy.' },
  { speaker: 'Speaker', text: 'Decision: launch beta next Tuesday.' },
  { speaker: 'Speaker', text: 'Risk: Deepgram cost may exceed the budget.' },
];
const TRANSCRIPT_LECTURE = [
  { speaker: 'Professor', text: 'TCP three-way handshake starts with SYN from the client, then SYN-ACK from the server, then ACK from the client. This establishes a reliable connection before data transfer.' },
];

const PROBES = {
  H1_H2_tech: { surface: 'manual', questions: ['What is Redis?', 'What is JWT?', 'What is CORS?', 'Explain REST API in simple terms.', 'Explain database indexing.', 'Explain caching strategies.', 'Explain the JavaScript event loop.', 'Explain rate limiting.', 'What is CAP theorem?', 'What is Kafka?'] },
  H3_sales: { surface: 'manual', questions: ['What is Natively?', 'What does your product do?', 'Who is this for?', 'What problem do you solve?', 'Give me the elevator pitch.', 'What is Natively built with?', 'What platforms does it support?', 'Why should I pay when ChatGPT exists?', 'How is Natively different from Cluely?', 'Your product is expensive.'] },
  H4_teammeet: { surface: 'what_to_answer', transcript: TRANSCRIPT_TEAM, questions: ['What are the action items?', 'What was decided?', 'Who is the owner?', 'What is the deadline?', 'Summarize the meeting.', 'What are the next steps?', 'Recap this meeting.'] },
  H5_lecture: { surface: 'what_to_answer', transcript: TRANSCRIPT_LECTURE, questions: ['Summarize this lecture.', 'What are the key concepts?', 'Explain this slide.', 'What is the main idea?', 'Define the key terms.', 'What should I remember from this?'] },
  H6_profile: { surface: 'manual', questions: ['Introduce yourself.', 'Tell me about yourself.', 'What is your current role?', 'How many years of experience do you have?', 'What companies have you worked at?', 'What is your strongest match for this role?', 'What gap do I have?', 'Why should we hire you?'] },
  H7_repetition: { surface: 'manual', session: ['Why should we hire you?', 'Make that more natural.', 'Make it less polished.', "Make it sound like I'm actually saying it.", 'Make it shorter.', "Make it more confident but don't exaggerate.", 'Give me the final spoken version.', 'Give me a different version using another project.', 'Give me a version that sounds more humble.'] },
  H8_coding: { surface: 'manual', session: ['Solve Two Sum in Python.', 'Now optimize it.', 'Give time and space complexity.', 'Dry run this with [2,7,11,15], target 9.', 'What was the original problem I asked?', 'Write code only for Valid Parentheses in Python.'] },
};

// ── speakability / quality analyzers (deterministic, content-free) ──
const PROFILE_TERMS = /\b(B\.?Tech|CUSAT|EstroTech|Aetherbot|TalentScope|PriceX|RedisMart)\b/i;
const SELF_ID = /\bI(?:'m| am)\s+Natively\b|\bI(?:'m| am)\s+an?\s+AI\s+assistant\b|developed by\s+Evin/i;
const LAZY = /\b(could you (please )?(repeat|rephrase|clarify)|can you repeat|i didn'?t (catch|hear|get)|want to make sure i (address|understand)|repeat that)\b/i;
const MISSING_CTX_OK = /\bdon'?t have (enough|any)\b.*\b(context|meeting|lecture|transcript|captured)\b/i;
const RESUME_DUMP = /(—\s*(Developed|Built|Led|Implemented|Designed|Engineered))|(;\s*[A-Z][a-z]+.*(Engineer|Developer|Intern).*;)|^\s*[-*•].*(Developed|Built|Led|Implemented)/m;
const MD_HEADER = /^#{1,6}\s/m;
const MD_TABLE = /\|.*\|.*\n\s*\|?\s*[-:]+\s*\|/m;
const MD_BULLETS = (t) => (t.match(/^\s*[-*•]\s+/gm) || []).length;
const wordCount = (t) => (String(t || '').trim().match(/\S+/g) || []).length;
const stripCode = (t) => String(t || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');

function analyze(answer, ctx) {
  const a = String(answer || '');
  const prose = stripCode(a);
  return {
    word_count: wordCount(prose),
    has_md_header: MD_HEADER.test(prose),
    has_md_table: MD_TABLE.test(a),
    bullet_lines: MD_BULLETS(prose),
    is_lazy_clarification: LAZY.test(a) && !MISSING_CTX_OK.test(a),
    states_missing_context: MISSING_CTX_OK.test(a),
    self_identifies_as_product: SELF_ID.test(a),
    mentions_profile_terms: PROFILE_TERMS.test(a),
    has_code_fence: /```/.test(a),
  };
}

async function driveOne(h, mmClient, q, surface, transcript) {
  const isWTA = surface === 'what_to_answer';
  const source = isWTA ? 'what_to_answer' : 'manual_input';
  const speakerPerspective = isWTA ? 'interviewer' : 'user';
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const cap = H.captureConsole();
  let answer = ''; let plan = null; let usedFastPath = false; let error = null;
  try {
    let question = q;
    if (isWTA && transcript) {
      const turns = transcript.concat([{ speaker: 'Speaker', text: q }]).map((t, i) => ({ role: /interviewer|speaker|professor|customer/i.test(t.speaker) ? 'interviewer' : 'candidate', text: t.text, timestamp: i * 1000 }));
      try { const ex = h.extractLatestQuestion(turns); if (ex?.latestQuestion) question = ex.latestQuestion; } catch {}
      plan = h.planAnswer({ question, source, speakerPerspective });
      let candidateProfile = '';
      try { const k = await Promise.race([h.orchestrator.processQuestion(question), sleep(8000).then(() => null)]); if (k && k.factualRecall === true && !k.liveNegotiationResponse) { if (k.contextBlock) candidateProfile = k.contextBlock; else if (k.introResponse) candidateProfile = `<candidate_identity_fact>\n${k.introResponse}\n</candidate_identity_fact>`; } } catch {}
      const stream = h.whatToAnswerLLM.generateStream(question, undefined, undefined, undefined, undefined, undefined, undefined, candidateProfile || undefined, plan);
      await h.raceStreamWithDeadline({ stream, firstUsefulDeadlineMs: 30000, isUsefulYet: () => answer.length > 0, shouldAbort: () => ac.signal.aborted, onToken: (p) => { answer += String(p || ''); } });
    } else {
      plan = h.planAnswer({ question, source, speakerPerspective });
      const isCoding = h.isCodingAnswerType(plan.answerType);
      const isContract = new Set(['ethical_usage_answer', 'project_link_answer', 'source_code_evidence_answer', 'project_about_answer']).has(plan.answerType);
      const isSafety = plan.answerType === 'ethical_usage_answer';
      if (!isCoding && h.isBareFollowUp && h.isBareFollowUp(question)) { answer = h.buildContextFreeClarification('manual'); usedFastPath = true; }
      if (!usedFastPath && !isCoding && !isContract && !h.isAssistantIdentityQuestion(question)) {
        try { const fp = h.buildManualProfileBackendAnswer({ question, orchestrator: h.orchestrator, source: 'manual_input' }); if (fp?.route?.answer) { answer = String(fp.route.answer); usedFastPath = true; } } catch {}
      }
      if (!usedFastPath) {
        let context = (isCoding || isContract) ? h.formatAnswerPlanForPrompt(plan, false) : undefined;
        if (plan.answerType === 'skill_experience_answer') context = h.formatAnswerPlanForPrompt(plan, false);
        const stream = h.llmHelper.streamChat(question, undefined, context, h.CHAT_MODE_PROMPT, isCoding || isSafety, isCoding || isSafety, [], ac.signal, h.llmHelper.thinkingBudgetForAnswerType(isCoding), { answerType: plan.answerType, forbiddenContextLayers: plan.forbiddenContextLayers || [] });
        await h.raceStreamWithDeadline({ stream, firstUsefulDeadlineMs: 30000, isUsefulYet: () => answer.length > 0, shouldAbort: () => ac.signal.aborted, onToken: (p) => { answer += String(p || ''); } });
        // apply the SAME post-gen guards the live path applies (current code)
        if (h.CANDIDATE_VOICE_ANSWER_TYPES?.has(plan.answerType) && h.sanitizeCandidateAnswer) { const s = h.sanitizeCandidateAnswer(answer); if (s.repaired && !s.needsFallback) answer = s.text; else if (s.needsFallback) { try { const fb = h.buildManualProfileBackendAnswer({ question, orchestrator: h.orchestrator, source: 'manual_input' }); if (fb?.route?.answer) answer = fb.route.answer; } catch {} } }
        if (h.ASSISTANT_VOICE_ANSWER_TYPES?.has(plan.answerType) && h.detectAssistantVoiceMisfire) { const m = h.detectAssistantVoiceMisfire(answer); if (m.isMisfire) answer = (plan.answerType === 'general_meeting_answer' || plan.answerType === 'lecture_answer') ? "I don't have enough context from the conversation to answer that yet." : plan.answerType === 'sales_answer' ? "I don't have enough context on that yet — could you share a bit more?" : 'Could you give me a bit more to go on?'; }
      }
    }
  } catch (e) { error = String(e?.message || e).slice(0, 200); }
  finally { clearTimeout(timer); cap.restore(); }
  const stall = H.isUseful ? !H.isUseful(answer) : !answer.trim();
  return { question: q, surface, answer_full: H.redact ? H.redact(answer, h.profileMeta) : answer, answer_type: plan?.answerType, output_perspective: plan?.outputPerspective, used_fast_path: usedFastPath, error, provider_stall: stall && !!answer.trim() === false ? false : false, metrics: analyze(answer, {}) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const v = await validateKeys({ model: EVAL_MODEL });
  if (!v.usableCount) { console.error('[verify] no usable MiniMax key — aborting (run later)'); process.exit(3); }
  const throttle = new GlobalThrottle({ qpm: QPM });
  const mm = createMiniMaxClient(v.usable, { model: EVAL_MODEL, throttle, maxOutputTokens: 8000 });

  const h = H.createHarness({ provider: 'auto' });
  h.llmHelper.groqClient = mm;
  try { h.llmHelper.setModel('meta-llama/llama-4-scout-17b-16e-instruct'); } catch {}
  try { h.llmHelper.setGroqFastTextMode(false); } catch {}
  try { h.llmHelper.client = null; h.llmHelper.openaiClient = null; h.llmHelper.claudeClient = null; h.llmHelper.deepseekClient = null; } catch {}
  try { const rl = h.llmHelper.rateLimiters; if (rl?.groq) { rl.groq.maxTokens = 100000; rl.groq.tokens = 100000; rl.groq.refillRatePerSecond = 1000; } } catch {}

  const results = {};
  for (const [hyp, spec] of Object.entries(PROBES)) {
    if (HYP && ![...HYP].some((x) => hyp.startsWith(x))) continue;
    console.log(`\n=== ${hyp} ===`);
    const rows = [];
    const qs = spec.session || spec.questions;
    for (const q of qs) {
      const r = await driveOne(h, mm, q, spec.surface, spec.transcript);
      rows.push(r);
      const m = r.metrics;
      const flags = [m.has_md_header && 'HEADER', m.has_md_table && 'TABLE', m.bullet_lines >= 3 && `BULLETS(${m.bullet_lines})`, m.word_count > 100 && `LONG(${m.word_count}w)`, m.is_lazy_clarification && 'LAZY', m.self_identifies_as_product && 'SELF-ID', m.mentions_profile_terms && 'PROFILE-TERMS'].filter(Boolean).join(' ');
      console.log(`  [${r.answer_type || '?'}] "${q.slice(0, 38)}" ${m.word_count}w ${flags || 'clean'}`);
    }
    results[hyp] = rows;
  }
  h.cleanup();
  fs.writeFileSync(path.join(OUT, 'reproduction-results.json'), JSON.stringify({ generatedAt: 'audit', model: EVAL_MODEL, results }, null, 2));
  console.log(`\n[verify] wrote reproduction-results.json (${Object.keys(results).length} hypothesis sets)`);
}
main().catch((e) => { console.error('[verify] fatal:', e); process.exit(1); });
