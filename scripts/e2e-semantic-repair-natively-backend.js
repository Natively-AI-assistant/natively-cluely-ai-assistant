// Semantic-retrieval repair — REAL NATIVELY BACKEND flag matrix (ON vs OFF).
//
// Drives the PRODUCTION path a paying user hits: model='natively' →
// POST https://api.natively.software/v1/chat → server-chosen model
// (flashModelPicker), through this session's shipped defaults and their kill
// switches:
//
//   M1  sanity: one prod call streams (records serverModel)
//   M2  doc-grounded custom mode, 4 critical questions × {defaults ON, kill
//       switches OFF} — the semantic gate must NOT affect mode-file retrieval
//       (it lives on the premium profile path), so BOTH states must answer
//       grounded; this pins the absence of unintended coupling on the real
//       backend.
//   M3  jd_fit × {ON: retrieval skipped, grounding-only / OFF: retrieval
//       runs} — both contexts answered by the real backend; both must produce
//       a grounded fit answer; the embed-skip must differ exactly with the
//       flag.
//
// BOUNDED BY DESIGN: ~13 prod calls total. Every /v1/chat call authenticates
// against production Supabase and WRITES A USAGE ROW on the key's account
// (see no-load-testing-production) — this is an explicit owner-requested
// acceptance run, never a sweep. Key values are never logged.
//
// Run:
//   npm run build:electron
//   ./node_modules/.bin/electron scripts/e2e-semantic-repair-natively-backend.js

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const distPremium = path.join(repoRoot, 'dist-electron', 'premium', 'electron', 'knowledge');

for (const line of fs.readFileSync(path.join(repoRoot, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const NATIVELY_KEY = process.env.NATIVELY_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
if (!NATIVELY_KEY) { console.error('[e2e-nat] FATAL: NATIVELY_API_KEY missing from .env'); process.exit(1); }
console.log(`[e2e-nat] keys: natively=present gemini=${GEMINI_KEY ? 'present' : 'absent'}`);

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-e2e-natbackend-'));
app.setPath('userData', tmpUserData);

const KILL_ALL = () => {
  process.env.NATIVELY_SEMANTIC_ADMISSION_GATE = 'off';
  process.env.PROFILE_GROUNDING_V2_JDFIT_COVERAGE = 'off';
};
const DEFAULTS_ON = () => {
  delete process.env.NATIVELY_SEMANTIC_ADMISSION_GATE;
  delete process.env.PROFILE_GROUNDING_V2_JDFIT_COVERAGE;
};

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
// 4 questions — bounded prod usage; picked to span fact-recall, entity, list,
// and the fail-closed shape.
const CRITICAL = [
  { q: 'How many degrees of freedom does Mercury X1 have?', must: [/19/] },
  { q: 'What is the role of ROS# in the project?', must: [/ros#/i] },
  { q: 'What evaluation metrics were used?', must: [/success rate/i] },
  { q: 'What exact GPU was used for training?', must: [], mustNot: [/\b(?:A100|H100|V100|P100|T4|L4|RTX\s?\d{3,4}|GTX\s?\d{3,4}|4090|3090|A6000)\b/i] },
];
const GREETING_RE = /what would you like help with|how can i help|what can i (?:help|do)/i;

const results = { sections: {}, failures: [] };
function record(section, name, ok, detail) {
  results.sections[section] = results.sections[section] || { pass: 0, fail: 0 };
  results.sections[section][ok ? 'pass' : 'fail']++;
  console.log(`[e2e-nat][${section}] ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) results.failures.push({ section, name, detail });
}
async function collectStream(gen) { let out = ''; for await (const tok of gen) out += tok; return out; }

function judge(section, label, answer, must, mustNot = []) {
  const trimmed = (answer || '').trim();
  const problems = [];
  if (GREETING_RE.test(trimmed)) problems.push('GREETING');
  if (trimmed.length < 8) problems.push('EMPTY/TINY');
  const miss = must.filter((re) => !re.test(trimmed));
  if (miss.length) problems.push(`MISSING:${miss.map(String).join(',')}`);
  const hit = mustNot.filter((re) => re.test(trimmed));
  if (hit.length) problems.push(`FORBIDDEN:${hit.map(String).join(',')}`);
  record(section, label, problems.length === 0, problems.join(';') || `${trimmed.length} chars`);
  console.log(`      A: ${trimmed.slice(0, 180).replace(/\n/g, ' / ')}${trimmed.length > 180 ? ' …' : ''}`);
}

async function main() {
  await app.whenReady();
  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const llmMod = require(path.join(distRoot, 'LLMHelper.js'));
  const LLMHelper = llmMod.LLMHelper || llmMod.default;
  const { CHAT_MODE_PROMPT } = require(path.join(distRoot, 'llm/prompts.js'));
  const { buildUserSelectedSourceContract } = require(path.join(distRoot, 'services/modeSourceContract.js'));

  const llmHelper = new LLMHelper(GEMINI_KEY || undefined);
  llmHelper.setNativelyKey(NATIVELY_KEY);
  llmHelper.setModel('natively');
  const serverModels = new Set();
  const noteModel = () => { const m = llmHelper.getLastProviderModel && llmHelper.getLastProviderModel(); if (m) serverModels.add(m); };

  // ── M1: prod sanity ───────────────────────────────────────────────────────
  {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 45000);
    let a = '';
    try { a = await collectStream(llmHelper.streamChat('Reply with exactly: OK', undefined, undefined, undefined, false, false, [], c.signal)); }
    catch (e) { console.error('[e2e-nat][M1] error:', e && e.message); }
    clearTimeout(t); noteModel();
    record('M1-prod-sanity', 'real backend streams', /ok/i.test(a), `"${a.trim().slice(0, 30)}" serverModel=${[...serverModels].join(',') || '?'}`);
  }

  // ── M2: doc-grounded × flag states ────────────────────────────────────────
  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) { if (/seminar/i.test(m.name)) { try { mm.deleteMode(m.id); } catch (_) {} } }
  const mode = mm.createMode({ name: 'Seminar Presentation Assistant (E2E-nat)', templateType: 'general' });
  mm.updateMode(mode.id, {
    customContext: CUSTOM_PROMPT,
    sourceContract: buildUserSelectedSourceContract({ defaultOwner: 'reference_files' }),
  });
  for (const f of FIXTURE_FILES) {
    mm.addReferenceFile({ modeId: mode.id, fileName: f, content: fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8') });
  }
  mm.setActiveMode(mode.id);

  for (const [stateLabel, setState] of [['defaults-ON', DEFAULTS_ON], ['kill-switch-OFF', KILL_ALL]]) {
    setState();
    for (const c of CRITICAL) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
      let answer = '';
      try {
        answer = await collectStream(llmHelper.streamChat(c.q, undefined, undefined, CHAT_MODE_PROMPT, false, false, [], ctrl.signal, undefined, { answerType: 'lecture_answer' }));
      } catch (e) { console.error(`[e2e-nat][M2] error "${c.q}":`, e && e.message); }
      clearTimeout(t); noteModel();
      judge(`M2-docgrounded-${stateLabel}`, c.q, answer, c.must, c.mustNot || []);
    }
  }
  DEFAULTS_ON();

  // ── M3: jd_fit ON vs OFF, answered by the real backend ───────────────────
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
  const NODES = [{
    id: 'n1', source_type: 'resume', category: 'experience', title: 'Senior Backend Engineer',
    organization: 'Drift Systems', text_content: '[Senior Backend Engineer @ Drift Systems] Built a billing pipeline processing 40k events/sec in Go and Kafka',
    tags: ['billing'], duration_months: 24, start_date: '2021-03', end_date: null, embedding: [1, 0], embedding_space: null,
  }];
  const makeOrch = () => {
    const db = {
      initializeSchema() {}, getDocumentByType(t) { return t === 'resume' ? RESUME : t === 'job_description' ? JD : null; },
      getAllNodes() { return NODES; }, getNodeCount() { return 1; }, getIntro() { return null; },
      getGapAnalysis() { return null; }, getNegotiationScript() { return null; }, getMockQuestions() { return null; },
      getCultureMappings() { return null; }, updateDocumentStructuredData() {}, getNodesNeedingReembed() { return []; },
      updateNodeEmbedding() {},
    };
    const o = new KnowledgeOrchestrator(db);
    o.setKnowledgeMode(true);
    return o;
  };
  const FIT_Q = 'am I qualified for this position?';
  for (const [stateLabel, setState, expectSkip] of [['ON', DEFAULTS_ON, true], ['OFF', KILL_ALL, false]]) {
    setState();
    const orch = makeOrch();
    let embedCalls = 0;
    orch.setEmbedFn(async () => { embedCalls += 1; return [1, 0]; });
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => { logs.push(a.join(' ')); origLog(...a); };
    let r = null;
    try { r = await orch.processQuestion(FIT_Q); } finally { console.log = origLog; }
    const skipped = logs.some((l) => l.includes('skipping redundant vector retrieval embed'));
    record(`M3-jdfit-${stateLabel}`, `retrieval ${expectSkip ? 'skipped' : 'runs'} as the flag dictates`,
      skipped === expectSkip && (expectSkip ? embedCalls === 0 : embedCalls >= 1),
      `skipped=${skipped} embedCalls=${embedCalls}`);
    const ctx = r ? `${r.systemPromptInjection || ''}\n${r.contextBlock || ''}` : '';
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
    let a = '';
    try {
      a = await collectStream(llmHelper.streamChat(
        FIT_Q, undefined, ctx, 'You are helping the candidate answer questions about their own fit for a job, grounded ONLY in the provided profile context.', false, false, [], ctrl.signal));
    } catch (e) { console.error(`[e2e-nat][M3-${stateLabel}] error:`, e && e.message); }
    clearTimeout(t); noteModel();
    judge(`M3-jdfit-${stateLabel}`, FIT_Q, a,
      [/yes|qualified|fit|match|strong/i],
      [/don.t have (?:access|enough information|your (?:resume|profile))|cannot (?:answer|assess|evaluate)|no (?:resume|profile|information) (?:available|found|provided)/i]);
  }
  DEFAULTS_ON();

  console.log('\n[e2e-nat] ===== SUMMARY =====');
  console.log(`[e2e-nat] serverModels observed: ${[...serverModels].join(', ') || '(none reported)'}`);
  let totalFail = 0;
  for (const [sec, { pass, fail }] of Object.entries(results.sections)) {
    console.log(`[e2e-nat] ${sec}: ${pass}/${pass + fail}`);
    totalFail += fail;
  }
  for (const f of results.failures) console.log(`  - [${f.section}] ${f.name} ${f.detail || ''}`);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e-nat] FATAL:', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  process.exit(2);
});
