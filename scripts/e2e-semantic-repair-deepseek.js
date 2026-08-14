// Semantic-retrieval repair (Phases 0.5-3) — LIVE end-to-end validation.
//
// Boots a REAL Electron main process (temp userData) and validates this
// session's changes against REAL APIs:
//   S1  DeepSeek provider sanity (deepseek-v4-flash, DIRECT api.deepseek.com —
//       never through natively-api/server.js, which writes billing rows).
//   S2  Doc-grounded custom mode through streamChat's INTERNAL retrieval —
//       the unified Phase 2 site-2 path (shouldUseHybridRetrieval +
//       runHybridModeRetrieval) — 10 critical seminar questions.
//   S3  Same mode through chatWithGemini — the Phase 2 site-1 path whose
//       doc-grounded hybrid branch fires for the first time.
//   S4  semanticAdmissionGate on REAL embeddings: embed resume-like nodes +
//       queries with the live embedding provider, compare the kill-switch
//       (legacy) run against the DEFAULT-ON run with the calibrated 0.69
//       gemini floor, capturing [SemanticAdmission] telemetry.
//   S5  jd_fit coverage flag live: retrieval skipped under the flag, then the
//       grounding-block-only context is answered by DeepSeek — proving the
//       grounding block alone carries the facts the skip removes.
//
// Keys come from .env (DEEPSEEK_API_KEY required; GEMINI_API_KEY optional —
// without it S4/S5 use the bundled local MiniLM embedder with an env floor
// override for its space). Key VALUES are never logged.
//
// Run:
//   npm run build:electron
//   ./node_modules/.bin/electron scripts/e2e-semantic-repair-deepseek.js

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const distPremium = path.join(repoRoot, 'dist-electron', 'premium', 'electron', 'knowledge');

// ── .env loading (values are secrets — never log them) ─────────────────────
for (const line of fs.readFileSync(path.join(repoRoot, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
if (!DEEPSEEK_KEY) { console.error('[e2e] FATAL: DEEPSEEK_API_KEY missing from .env'); process.exit(1); }
console.log(`[e2e] keys: deepseek=present gemini=${GEMINI_KEY ? 'present' : 'ABSENT (local embedder fallback)'}`);

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-e2e-semrepair-'));
app.setPath('userData', tmpUserData);

const CUSTOM_PROMPT = [
  'Act as my real-time seminar presentation assistant.',
  'I have uploaded a seminar/thesis file.',
  'Answer from the uploaded seminar content first.',
  'Do not invent facts, numbers, methods, results, or claims.',
  'If something is not in the file, say it is not directly mentioned in my seminar material.',
  'Keep answers natural, confident, student-friendly, and speakable.',
].join(' ');

const FIXTURE_DIR = path.join(repoRoot, 'tests/fixtures/modes/custom/seminar-presentation');
const FIXTURE_FILES = [
  'seminar_vla_overview.txt', 'seminar_hardware_specs.txt', 'seminar_simulation_stack.md',
  'seminar_evaluation_results.csv', 'seminar_dataset_training.txt', 'seminar_custom_prompt_rules.txt',
];

const CRITICAL = [
  { q: 'What is OpenVLA-OFT?', must: [/openvla-oft/i] },
  { q: 'How many degrees of freedom does Mercury X1 have?', must: [/19/] },
  { q: 'What sensors does Mercury X1 use?', must: [/lidar/i] },
  { q: 'What is the role of ROS# in the project?', must: [/ros#/i] },
  { q: 'What is the role of Unity in the project?', must: [/unity/i] },
  { q: 'What are the four main phases of the project?', must: [/teleoperation/i, /data collection/i, /training/i, /agentic ai/i] },
  { q: 'How was OpenVLA-OFT finetuned?', must: [/lora|fine-?tun|adapter/i] },
  { q: 'What evaluation metrics were used?', must: [/success rate/i] },
  { q: 'What does MSE measure?', must: [/mse|mean squared|error|trajectory|deviation/i] },
  // Fail-closed probe (KNOWN-ABSENCE): the fixtures state GPU memory sizes but
  // never a model name — so the DECIDABLE property is "no GPU model invented".
  // Refusal PHRASING varies run to run and must not be asserted.
  { q: 'What exact GPU was used for training?', must: [], mustNot: [/\b(?:A100|H100|V100|P100|T4|L4|RTX\s?\d{3,4}|GTX\s?\d{3,4}|4090|3090|A6000)\b/i], failClosed: true },
];
const FORBIDDEN_DRIFT = ['TalentScope', 'Convex', 'Stream SDK', 'Clerk', 'Next.js', 'Tailwind', 'RBAC'];
const GREETING_RE = /what would you like help with|how can i help|what can i (?:help|do)/i;

const results = { sections: {}, failures: [] };
function record(section, name, ok, detail) {
  results.sections[section] = results.sections[section] || { pass: 0, fail: 0 };
  results.sections[section][ok ? 'pass' : 'fail']++;
  console.log(`[e2e][${section}] ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) results.failures.push({ section, name, detail });
}

async function collectStream(gen) { let out = ''; for await (const tok of gen) out += tok; return out; }

function checkAnswer(section, q, answer, must, mustNot = []) {
  const trimmed = (answer || '').trim();
  const problems = [];
  if (GREETING_RE.test(trimmed)) problems.push('GREETING');
  if (trimmed.length < 8) problems.push('EMPTY/TINY');
  for (const d of FORBIDDEN_DRIFT) if (trimmed.toLowerCase().includes(d.toLowerCase())) problems.push(`DRIFT:${d}`);
  const miss = must.filter((re) => !re.test(trimmed));
  if (miss.length) problems.push(`MISSING:${miss.map(String).join(',')}`);
  const hit = mustNot.filter((re) => re.test(trimmed));
  if (hit.length) problems.push(`FORBIDDEN:${hit.map(String).join(',')}`);
  record(section, q, problems.length === 0, problems.join(';') || `${trimmed.length} chars`);
  console.log(`      A: ${trimmed.slice(0, 200).replace(/\n/g, ' / ')}${trimmed.length > 200 ? ' …' : ''}`);
  return problems.length === 0;
}

async function main() {
  await app.whenReady();

  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const llmMod = require(path.join(distRoot, 'LLMHelper.js'));
  const LLMHelper = llmMod.LLMHelper || llmMod.default;
  const { CHAT_MODE_PROMPT } = require(path.join(distRoot, 'llm/prompts.js'));

  // ── S1: DeepSeek sanity ───────────────────────────────────────────────────
  const llmHelper = new LLMHelper(GEMINI_KEY || undefined, false, undefined, undefined, undefined, undefined, undefined, DEEPSEEK_KEY);
  llmHelper.setModel('deepseek-v4-flash');
  {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30000);
    let a = '';
    try { a = await collectStream(llmHelper.streamChat('Reply with exactly: OK', undefined, undefined, undefined, false, false, [], controller.signal)); }
    catch (e) { console.error('[e2e][S1] stream error:', e && e.message); }
    clearTimeout(t);
    record('S1-deepseek-sanity', 'provider streams a reply', /ok/i.test(a), `"${a.trim().slice(0, 40)}"`);
  }

  // ── S2: doc-grounded via streamChat INTERNAL retrieval (Phase 2 site 2) ──
  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) { if (/seminar/i.test(m.name)) { try { mm.deleteMode(m.id); } catch (_) {} } }
  const mode = mm.createMode({ name: 'Seminar Presentation Assistant (E2E)', templateType: 'general' });
  // Mirror a REAL user-configured doc-grounded mode: the template seed stamps
  // origin 'default_new_mode', and strictDocumentGroundedFromContract requires
  // a NON-default origin (Defect C, 2026-08-01) — without this, streamChat's
  // forceDocumentGrounding (keyed on strictDocumentGroundedActive) stays false
  // and site 2 runs the weaker non-strict retrieval, which is what a stock
  // unconfigured mode gets. The live app sets this via the "Primary knowledge
  // source" UI → buildUserSelectedSourceContract (origin 'user_selected').
  const { buildUserSelectedSourceContract } = require(path.join(distRoot, 'services/modeSourceContract.js'));
  mm.updateMode(mode.id, {
    customContext: CUSTOM_PROMPT,
    sourceContract: buildUserSelectedSourceContract({ defaultOwner: 'reference_files' }),
  });
  for (const f of FIXTURE_FILES) {
    mm.addReferenceFile({ modeId: mode.id, fileName: f, content: fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8') });
  }
  mm.setActiveMode(mode.id);
  const grounding = mm.getActiveModeDocumentGroundingInfo();
  record('S2-doc-grounded', 'documentGroundedCustomModeActive', grounding.documentGroundedCustomModeActive === true);

  const latencies = [];
  for (const c of CRITICAL) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 45000);
    const start = Date.now();
    let answer = '';
    try {
      // context=undefined → streamChat assembles the mode block itself,
      // exercising the unified shouldUseHybridRetrieval/runHybridModeRetrieval.
      // routeOptions mirrors the REAL gemini-chat-stream caller (answerType
      // lecture_answer) — without it, doc-grounded routing/strictness differs
      // from production and the model is told nothing about the doc turn.
      answer = await collectStream(llmHelper.streamChat(c.q, undefined, undefined, CHAT_MODE_PROMPT, false, false, [], controller.signal, undefined, { answerType: 'lecture_answer' }));
    } catch (e) { console.error(`[e2e][S2] stream error for "${c.q}":`, e && e.message); }
    clearTimeout(t);
    latencies.push(Date.now() - start);
    checkAnswer('S2-doc-grounded', c.q, answer, c.must, c.mustNot || []);
  }
  latencies.sort((a, b) => a - b);
  console.log(`[e2e][S2] latency median=${latencies[Math.floor(latencies.length / 2)]}ms max=${latencies[latencies.length - 1]}ms`);

  // ── S3: same mode via chatWithGemini (Phase 2 site 1) ────────────────────
  for (const c of [CRITICAL[1], CRITICAL[3]]) {
    let answer = '';
    try { answer = await llmHelper.chatWithGemini(c.q, undefined, undefined, false); }
    catch (e) { console.error(`[e2e][S3] error for "${c.q}":`, e && e.message); }
    checkAnswer('S3-site1-chat', c.q, answer, c.must);
  }

  // ── S4: semanticAdmissionGate on REAL embeddings ─────────────────────────
  const { getRelevantNodes } = require(path.join(distPremium, 'HybridSearchEngine.js'));
  let provider = null, spaceKey = null;
  if (GEMINI_KEY) {
    try {
      const { GeminiEmbeddingProvider } = require(path.join(distRoot, 'rag/providers/GeminiEmbeddingProvider.js'));
      provider = new GeminiEmbeddingProvider([GEMINI_KEY]);
      spaceKey = provider.space;
      await provider.embed('probe'); // fail fast if the key is dead
    } catch (e) {
      console.warn('[e2e][S4] gemini embedder unusable → local fallback:', e && e.message && e.message.slice(0, 120));
      provider = null;
    }
  }
  if (!provider) {
    const { LocalEmbeddingProvider } = require(path.join(distRoot, 'rag/providers/LocalEmbeddingProvider.js'));
    provider = new LocalEmbeddingProvider();
    spaceKey = provider.space;
    // local-384 deliberately has NO floor (calibration 2026-08-14 measured
    // overlapping distributions) — the default-ON gate must behave legacy here.
    console.log('[e2e][S4] using local MiniLM embedder (no floor by design)');
  }
  console.log(`[e2e][S4] embedding space: ${spaceKey}`);

  const NODE_TEXTS = {
    relevantProject: 'Built a distributed billing reconciliation pipeline in Go and Kafka processing 40k events per second with exactly-once semantics',
    relevantSkill: 'Deep PostgreSQL schema design and query optimization experience across multi-tenant SaaS databases',
    oldRelevant: 'Designed the event-sourced ledger service handling multi-currency transaction reconciliation across regions',
    recentIrrelevant: 'Organized the annual company holiday party and managed catering vendor relationships for office events',
  };
  const nodeEmbeds = {};
  for (const [k, txt] of Object.entries(NODE_TEXTS)) nodeEmbeds[k] = await provider.embed(txt);
  const mkNode = (id, text, emb, extra = {}) => ({
    id, source_type: 'resume', category: 'experience', title: 'Role Entry', organization: 'Acme',
    text_content: text, tags: [], duration_months: null, end_date: '2019-01', embedding: emb, ...extra,
  });
  const NODES = [
    mkNode('relevant-project', NODE_TEXTS.relevantProject, nodeEmbeds.relevantProject),
    mkNode('relevant-skill', NODE_TEXTS.relevantSkill, nodeEmbeds.relevantSkill),
    mkNode('old-relevant', NODE_TEXTS.oldRelevant, nodeEmbeds.oldRelevant),
    // The P0 shape: query-independent boosts only (recent + long tenure).
    mkNode('recent-irrelevant', NODE_TEXTS.recentIrrelevant, nodeEmbeds.recentIrrelevant, { duration_months: 30, end_date: null }),
  ];
  const QUERY = 'tell me about my event streaming and database work';
  const qEmb = await provider.embedQuery(QUERY);
  const embedFn = async () => qEmb;

  const telemetry = [];
  const origLog = console.log;
  console.log = (...args) => { const s = args.join(' '); if (s.startsWith('[SemanticAdmission] ')) telemetry.push(JSON.parse(s.slice('[SemanticAdmission] '.length))); origLog(...args); };
  let legacyOut, defaultOut;
  try {
    // Kill switch — the ONLY way to observe legacy admission now that the
    // gate defaults ON (2026-08-14).
    process.env.NATIVELY_SEMANTIC_ADMISSION_GATE = 'off';
    legacyOut = await getRelevantNodes(QUERY, NODES, embedFn, { embeddingSpaceKey: spaceKey });
    // DEFAULT posture: env unset → gate ON with the calibrated floor
    // (gemini-768: 0.69; local-384: no floor → this run behaves legacy).
    delete process.env.NATIVELY_SEMANTIC_ADMISSION_GATE;
    defaultOut = await getRelevantNodes(QUERY, NODES, embedFn, { embeddingSpaceKey: spaceKey });
  } finally {
    console.log = origLog;
    delete process.env.NATIVELY_SEMANTIC_ADMISSION_GATE;
  }
  record('S4-admission-gate', 'telemetry emitted for both runs', telemetry.length === 2, `${telemetry.length} lines`);
  const [obs, enf] = telemetry;
  if (obs && enf) {
    record('S4-admission-gate', 'kill-switch run not enforced / default run enforced',
      obs.enforced === false && enf.enforced === (spaceKey.startsWith('gemini') ? true : false));
    console.log('[e2e][S4] real cosine distribution:', enf.candidates.map((c, i) => `${NODES[i].id}=${c.cosine}`).join(' '));
    // THE P0, LIVE: under the legacy blended threshold the ONLY retrieved node
    // should be the boost-carrying irrelevant one (its +0.2 query-independent
    // boosts clear 0.55 while the relevant nodes' 0.6·cosine does not).
    record('S4-admission-gate', 'LIVE P0 confirmation: legacy admits ONLY the boost-carrying irrelevant node',
      legacyOut.length === 1 && legacyOut[0].node.id === 'recent-irrelevant',
      `legacy=[${legacyOut.map((s) => s.node.id).join(',')}]`);
    if (spaceKey.startsWith('gemini')) {
      record('S4-admission-gate', 'DEFAULT posture (calibrated 0.69): P0 node excluded, relevant nodes kept',
        !defaultOut.some((s) => s.node.id === 'recent-irrelevant')
          && defaultOut.some((s) => s.node.id === 'relevant-project'),
        `default=[${defaultOut.map((s) => s.node.id).join(',')}]`);
    } else {
      record('S4-admission-gate', 'DEFAULT posture (local space, no calibrated floor): legacy admission preserved',
        JSON.stringify(defaultOut.map((s) => s.node.id)) === JSON.stringify(legacyOut.map((s) => s.node.id)),
        `default=[${defaultOut.map((s) => s.node.id).join(',')}]`);
    }
  }

  // ── S5: jd_fit coverage flag live (skip retrieval → DeepSeek answers from grounding) ──
  const { KnowledgeOrchestrator } = require(path.join(distPremium, 'KnowledgeOrchestrator.js'));
  const RESUME = {
    id: 1, type: 'resume',
    structured_data: {
      identity: { name: 'Jordan Rivera', email: '', location: 'Austin, TX', phone: '', links: [] },
      summary: 'Backend engineer focused on distributed systems.',
      skills: ['Go', 'Kafka', 'PostgreSQL', 'Kubernetes'],
      experience: [{ company: 'Drift Systems', role: 'Senior Backend Engineer', start_date: '2021-03', end_date: null, bullets: ['Built a billing pipeline processing 40k events/sec in Go and Kafka'] }],
      projects: [{ name: 'LedgerFlow', description: 'Event-sourced multi-currency ledger', technologies: ['Go', 'Kafka'] }],
      education: [{ institution: 'State University', degree: 'BS', field: 'CS', start_date: '2014', end_date: '2018' }],
      achievements: [], certifications: [], leadership: [],
    },
  };
  const JD = {
    id: 2, type: 'job_description',
    structured_data: {
      title: 'Senior Backend Engineer', company: 'Acme', location: 'Remote', description_summary: '',
      level: 'senior', employment_type: 'full_time', min_years_experience: 5, compensation_hint: '',
      requirements: ['Expert Go', 'Kafka event streaming', 'PostgreSQL'], nice_to_haves: [], responsibilities: [],
      technologies: ['Go', 'Kafka', 'PostgreSQL'], keywords: [],
    },
  };
  const db = {
    initializeSchema() {}, getDocumentByType(t) { return t === 'resume' ? RESUME : t === 'job_description' ? JD : null; },
    getAllNodes() { return NODES; }, getNodeCount() { return NODES.length; }, getIntro() { return null; },
    getGapAnalysis() { return null; }, getNegotiationScript() { return null; }, getMockQuestions() { return null; },
    getCultureMappings() { return null; }, updateDocumentStructuredData() {}, getNodesNeedingReembed() { return []; },
    updateNodeEmbedding() {},
  };
  const orchestrator = new KnowledgeOrchestrator(db);
  orchestrator.setKnowledgeMode(true);
  let embedCalls = 0;
  orchestrator.setEmbedFn(async (text) => { embedCalls += 1; return provider.embedQuery(text); });

  const FIT_Q = 'am I qualified for this position?';
  process.env.PROFILE_GROUNDING_V2_JDFIT_COVERAGE = 'on';
  let fitResult = null;
  try { fitResult = await orchestrator.processQuestion(FIT_Q); } finally { delete process.env.PROFILE_GROUNDING_V2_JDFIT_COVERAGE; }
  record('S5-jdfit-live', 'flag ON skips the retrieval embed', embedCalls === 0, `${embedCalls} embed calls`);
  const groundingBlock = fitResult ? `${fitResult.systemPromptInjection || ''}\n${fitResult.contextBlock || ''}` : '';
  record('S5-jdfit-live', 'grounding context assembled without retrieval', groundingBlock.includes('Jordan Rivera') || groundingBlock.includes('Drift Systems'), `${groundingBlock.length} chars`);
  {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 45000);
    let a = '';
    try {
      a = await collectStream(llmHelper.streamChat(
        FIT_Q, undefined, groundingBlock, 'You are helping the candidate answer questions about their own fit for a job, grounded ONLY in the provided profile context.', false, false, [], controller.signal));
    } catch (e) { console.error('[e2e][S5] stream error:', e && e.message); }
    clearTimeout(t);
    // Decidable properties, not vocabulary: a fit answer must (a) take a
    // stance and (b) never claim the profile is missing — the grounding block
    // is provably in context (asserted above). Which facts the model chooses
    // to cite varies run to run and is not asserted.
    checkAnswer('S5-jdfit-live', FIT_Q, a,
      [/yes|qualified|fit|match|strong/i],
      [/don.t have (?:access|enough information|your (?:resume|profile))|cannot (?:answer|assess|evaluate)|no (?:resume|profile|information) (?:available|found|provided)/i]);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n[e2e] ===== SUMMARY =====');
  let totalFail = 0;
  for (const [sec, { pass, fail }] of Object.entries(results.sections)) {
    console.log(`[e2e] ${sec}: ${pass}/${pass + fail}`);
    totalFail += fail;
  }
  if (results.failures.length) {
    console.log('[e2e] failures:');
    for (const f of results.failures) console.log(`  - [${f.section}] ${f.name} ${f.detail || ''}`);
  }
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] FATAL:', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  process.exit(2);
});
