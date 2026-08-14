/**
 * verify-current-routing-decisions.mjs — Phase 3/4 DETERMINISTIC (no-LLM) reproduction.
 *
 * The MiniMax key is currently 401; the audit prompt allows fixture/mock mode for
 * prompt/validator tests. Hypotheses H1-H8 are about the DECISION + SHAPING layer
 * (routing, speakability target, output-shape normalization, identity/lazy guards),
 * which is deterministic and testable without a provider. This drives the CURRENT
 * built dist-electron's planAnswer + LiveMomentRouter + speakability + OutputShape
 * + the guards on the exact Phase-4 probe questions and reports the decisions, so we
 * can CONFIRM/REJECT each hypothesis against current code.
 *
 *   node scripts/verify-current-routing-decisions.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'test-results', 'mixed-7000-audit');
const DIST = path.join(REPO, 'dist-electron');

// load current built modules
function tryReq(...names) { for (const n of names) { try { return require(path.join(DIST, n)); } catch {} } return {}; }
const planner = tryReq('llm/AnswerPlanner.js', 'AnswerPlanner.js');
const liveMoment = tryReq('intelligence/LiveMomentRouter.js');
const speak = tryReq('llm/speakability.js');
const shape = tryReq('intelligence/OutputShapeNormalizer.js');
const validator = tryReq('llm/ProfileOutputValidator.js');

const planAnswer = planner.planAnswer;
fs.mkdirSync(OUT, { recursive: true });

const out = { generatedAt: 'audit-deterministic', modules: { LiveMomentRouter: !!liveMoment.routeLiveMoment, speakability: Object.keys(speak), OutputShapeNormalizer: Object.keys(shape), ProfileOutputValidator: Object.keys(validator) }, probes: {} };

function plan(q, surface) {
  const source = surface === 'wta' ? 'what_to_answer' : 'manual_input';
  const speakerPerspective = surface === 'wta' ? 'interviewer' : 'user';
  try { return planAnswer({ question: q, source, speakerPerspective }); } catch (e) { return { error: String(e.message) }; }
}

// derive speakability target for an answerType using whatever the current API exposes
function speakTarget(answerType, q) {
  // LiveMomentRouter.targetForAnswerType / speakabilityForAnswerType / classify
  for (const fn of ['speakabilityTargetForAnswerType', 'targetForAnswerType', 'classifySpeakability', 'speakabilityFor']) {
    if (typeof speak[fn] === 'function') { try { return speak[fn](answerType, q); } catch {} }
    if (typeof liveMoment[fn] === 'function') { try { return liveMoment[fn](answerType, q); } catch {} }
  }
  if (typeof liveMoment.routeLiveMoment === 'function') { try { const d = liveMoment.routeLiveMoment({ answerType, question: q }); return d?.target || d?.speakabilityTarget || JSON.stringify(d); } catch {} }
  return '(no speakability API found)';
}

const SETS = {
  H1_H2_tech: { surface: 'manual', qs: ['What is Redis?', 'What is JWT?', 'What is CORS?', 'Explain REST API in simple terms.', 'Explain database indexing.', 'Explain caching strategies.', 'Explain the JavaScript event loop.', 'Explain rate limiting.', 'What is CAP theorem?', 'What is Kafka?'] },
  H3_sales: { surface: 'manual', qs: ['What is Natively?', 'What does your product do?', 'Who is this for?', 'What problem do you solve?', 'Give me the elevator pitch.', 'What is Natively built with?', 'What platforms does it support?', 'Why should I pay when ChatGPT exists?', 'How is Natively different from Cluely?', 'Your product is expensive.'] },
  H4_teammeet: { surface: 'wta', qs: ['What are the action items?', 'What was decided?', 'Who is the owner?', 'What is the deadline?', 'Summarize the meeting.', 'What are the next steps?', 'Recap this meeting.'] },
  H5_lecture: { surface: 'wta', qs: ['Summarize this lecture.', 'What are the key concepts?', 'Explain this slide.', 'What is the main idea?', 'Define the key terms.', 'What should I remember from this?'] },
  H6_profile: { surface: 'manual', qs: ['Introduce yourself.', 'Tell me about yourself.', 'What is your current role?', 'How many years of experience do you have?', 'What companies have you worked at?', 'What is your strongest match for this role?', 'What gap do I have?', 'Why should we hire you?'] },
  H8_coding: { surface: 'manual', qs: ['Solve Two Sum in Python.', 'Now optimize it.', 'Give time and space complexity.', 'Dry run this with [2,7,11,15], target 9.', 'What was the original problem I asked?', 'Write code only for Valid Parentheses in Python.'] },
};

for (const [hyp, spec] of Object.entries(SETS)) {
  console.log(`\n=== ${hyp} (surface=${spec.surface}) ===`);
  const rows = [];
  for (const q of spec.qs) {
    const p = plan(q, spec.surface);
    const tgt = p.answerType ? speakTarget(p.answerType, q) : '(no plan)';
    rows.push({ q, answerType: p.answerType, outputPerspective: p.outputPerspective, profileContextPolicy: p.profileContextPolicy, requiredContextLayers: p.requiredContextLayers, speakabilityTarget: tgt });
    console.log(`  "${q.slice(0, 42).padEnd(42)}" -> ${String(p.answerType).padEnd(26)} | speak=${tgt} | profilePolicy=${p.profileContextPolicy || '?'}`);
  }
  out.probes[hyp] = rows;
}

fs.writeFileSync(path.join(OUT, 'routing-decisions.json'), JSON.stringify(out, null, 2));
console.log('\nwrote routing-decisions.json — speakability/LiveMomentRouter API:', JSON.stringify(out.modules));
