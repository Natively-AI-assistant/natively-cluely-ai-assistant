// Document-grounded custom mode — REAL PRODUCTION PATH end-to-end runner.
//
// This is the acceptance gate for the 2026-06-27 real-path fix. It drives the
// SAME path a manual Ask-AI question takes in the live app:
//
//   real ModesManager + ModeContextRetriever (real chunking/retrieval)
//   → real LLMHelper.streamChat with CHAT_MODE_PROMPT
//   → model = natively  →  POST https://api.natively.software/v1/chat
//   → server-chosen serverModel = gemini-3.1-flash-lite
//   → real SSE stream parse
//
// Unlike a `node --test` file, this boots a real Electron `app` (so
// `app.getPath('userData')` and the better-sqlite3 native binding resolve)
// against a TEMP userData dir, then runs the assertions and exits with code
// 0 (all pass) or 1 (any fail).
//
// Run:
//   npm run build:electron
//   RUN_NATIVELY_API_E2E=1 NATIVELY_API_KEY=<key> \
//     ./node_modules/.bin/electron scripts/e2e-document-grounded-real-path.js
//
// The key value is never logged.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

const KEY = process.env.NATIVELY_API_KEY || '';
if (process.env.RUN_NATIVELY_API_E2E !== '1' || !KEY) {
  console.log('[e2e] SKIP — set RUN_NATIVELY_API_E2E=1 + NATIVELY_API_KEY to run the real-backend E2E');
  process.exit(0);
}

// Point userData at a throwaway dir BEFORE app is ready so the real DB is
// created in isolation (never touches the user's live natively.db).
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-e2e-'));
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
  'seminar_vla_overview.txt',
  'seminar_hardware_specs.txt',
  'seminar_simulation_stack.md',
  'seminar_evaluation_results.csv',
  'seminar_dataset_training.txt',
  'seminar_custom_prompt_rules.txt',
];

const CRITICAL = [
  { q: 'What is OpenVLA-OFT?', must: [/openvla-oft/i], should: [/parallel decoding|action chunk|43x|fine-?tun/i] },
  { q: 'How many degrees of freedom does Mercury X1 have?', must: [/19/], should: [/degrees of freedom|dof/i] },
  { q: 'What sensors does Mercury X1 use?', must: [/lidar/i], should: [/ultrasonic|2d vision|vision/i] },
  { q: 'What is the role of ROS# in the project?', must: [/ros#/i], should: [/unity|ros nodes|topics|services|messages|\.net/i] },
  { q: 'What is the role of Unity in the project?', must: [/unity/i], should: [/teleoperation|vr|c#|ros#/i] },
  { q: 'What are the four main phases of the project?', must: [/teleoperation/i, /data collection/i, /training/i, /agentic ai/i], should: [] },
  { q: 'How was OpenVLA-OFT finetuned?', must: [/lora|fine-?tun|adapter/i], should: [] },
  { q: 'What evaluation metrics were used?', must: [/success rate/i], should: [/mse/i] },
  { q: 'What does MSE measure?', must: [/mse|mean squared|error|trajectory|deviation/i], should: [] },
  { q: 'What exact GPU was used for training?', must: [/not (?:directly )?(?:mentioned|in)|does not (?:specify|mention)|no .*gpu|isn.t (?:mentioned|specified)/i], should: [], failClosed: true },
];

const FORBIDDEN_DRIFT = [
  'TalentScope', 'real-time technical interview platform', 'Convex',
  'Stream SDK', 'Clerk', 'Next.js', 'Tailwind', 'RBAC', 'synchronized code execution',
];
const GREETING_RE = /what would you like help with|how can i help|what can i (?:help|do)/i;

async function collectStream(gen) {
  let out = '';
  for await (const tok of gen) out += tok;
  return out;
}

async function main() {
  await app.whenReady();

  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const llmMod = require(path.join(distRoot, 'LLMHelper.js'));
  const LLMHelper = llmMod.LLMHelper || llmMod.default;
  const { CHAT_MODE_PROMPT } = require(path.join(distRoot, 'llm/prompts.js'));

  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) {
    if (/seminar/i.test(m.name)) { try { mm.deleteMode(m.id); } catch (_) { /* ignore */ } }
  }
  const mode = mm.createMode({ name: 'Seminar Presentation Assistant (E2E)', templateType: 'general' });
  const modeId = mode.id;
  mm.updateMode(modeId, { customContext: CUSTOM_PROMPT });
  for (const fileName of FIXTURE_FILES) {
    const content = fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8');
    mm.addReferenceFile({ modeId, fileName, content });
  }
  mm.setActiveMode(modeId);

  const grounding = mm.getActiveModeDocumentGroundingInfo();
  if (grounding.documentGroundedCustomModeActive !== true) {
    console.error('[e2e] FATAL: documentGroundedCustomModeActive is not true — fix mode setup');
    process.exit(1);
  }
  console.log('[e2e] documentGroundedCustomModeActive = true ✓');

  const llmHelper = new LLMHelper();
  llmHelper.setNativelyKey(KEY);
  llmHelper.setModel('natively');

  let pass = 0, fail = 0;
  const serverModels = new Set();
  const failures = [];
  const latencies = [];

  for (const c of CRITICAL) {
    const block = mm.buildRetrievedActiveModeContextBlock(
      c.q, undefined, 1800, 'lecture_answer', true, modeId, { forceDocumentGrounding: true },
    ) || '';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const start = Date.now();
    let answer = '';
    try {
      answer = await collectStream(llmHelper.streamChat(
        c.q, undefined, block, CHAT_MODE_PROMPT, false, false, [], controller.signal,
      ));
    } catch (err) {
      answer = '';
      console.error(`[e2e] stream error for "${c.q}":`, err && err.message);
    } finally {
      clearTimeout(timeout);
    }
    const latency = Date.now() - start;
    latencies.push(latency);

    const trimmed = answer.trim();
    const reported = llmHelper.getLastProviderModel && llmHelper.getLastProviderModel();
    if (reported) serverModels.add(reported);

    const problems = [];
    if (GREETING_RE.test(trimmed)) problems.push('GREETING');
    if (trimmed.length < 8) problems.push('EMPTY/TINY');
    for (const drift of FORBIDDEN_DRIFT) {
      if (trimmed.toLowerCase().includes(drift.toLowerCase())) problems.push(`DRIFT:${drift}`);
    }
    const missMust = c.must.filter((re) => !re.test(trimmed));
    if (missMust.length) problems.push(`MISSING:${missMust.map(String).join(',')}`);

    const ok = problems.length === 0;
    console.log(`\n[e2e] ${ok ? 'PASS' : 'FAIL'} — ${c.q}`);
    console.log(`      serverModel=${reported || '?'} latency=${latency}ms`);
    console.log(`      A (${trimmed.length}): ${trimmed.slice(0, 220).replace(/\n/g, ' / ')}${trimmed.length > 220 ? ' …' : ''}`);
    if (!ok) { fail++; failures.push({ q: c.q, problems, answer: trimmed }); console.log(`      problems: ${problems.join(' ; ')}`); }
    else pass++;
  }

  latencies.sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || latencies[latencies.length - 1];

  console.log(`\n[e2e] ===== RESULT =====`);
  console.log(`[e2e] ${pass}/${pass + fail} critical questions passed`);
  console.log(`[e2e] serverModels observed: ${Array.from(serverModels).join(', ') || '(none reported)'}`);
  console.log(`[e2e] latency median=${median}ms p95=${p95}ms (n=${latencies.length})`);
  const modelOk = serverModels.size === 0 || Array.from(serverModels).some((m) => /gemini-3\.1-flash-lite/i.test(m));
  if (!modelOk) console.log(`[e2e] WARNING: expected gemini-3.1-flash-lite among serverModels`);

  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) { /* best effort */ }

  process.exit(fail === 0 && modelOk ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] FATAL:', err);
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) { /* noop */ }
  process.exit(2);
});
