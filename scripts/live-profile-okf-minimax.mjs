// scripts/live-profile-okf-minimax.mjs
//
// LIVE end-to-end test of the OKF Profile Intelligence layer against a REAL LLM
// (MiniMax-M3), using the MINIMAX_API_KEY from .env. It:
//   1. ingests the deterministic fixture resume + JD into a real DatabaseManager,
//   2. generates the OKF profile packs (real ProfilePackBuilder),
//   3. for each of the 18 mandated questions: runs planAnswer → deterministic
//      fast path → fail-closed OkfProfileRetriever, assembles the SAME prompt the
//      manual chat path would, and sends it to MiniMax-M3,
//   4. scores the live answer against expected profile facts + isolation rules.
//
// Isolation is the headline: Q16 (coding) and Q17/18 (doc-grounded) must contain
// ZERO profile/candidate content in BOTH the assembled prompt AND the model output.
//
// Run (MUST be the Electron runner for native better-sqlite3):
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/live-profile-okf-minimax.mjs
//
// Env: MINIMAX_API_KEY (from .env, auto-loaded). Flags forced ON for the run.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const outDir = path.join(repoRoot, 'debug-artifacts', 'okf-profile-benchmark');

// ── load .env (both .env.local and .env, matching the app) ──
function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile(path.join(repoRoot, '.env.local'));
loadEnvFile(path.join(repoRoot, '.env'));

if (!process.env.MINIMAX_API_KEY) {
  console.error('FATAL: MINIMAX_API_KEY not found in .env');
  process.exit(2);
}
if (!process.env.NATIVELY_TEST_USERDATA) {
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-live-'));
}
// Force the OKF profile layer ON for this live run.
process.env.NATIVELY_OKF_PROFILE_PACKS = '1';
process.env.NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL = '1';

async function load(rel) {
  return import(pathToFileURL(path.join(distRoot, rel)).href);
}

// ── MiniMax-M3 caller (reuses the app's own provider module) ──
const minimax = await import(pathToFileURL(path.join(repoRoot, 'natively-api/lib/minimaxProvider.js')).href);

async function callMiniMax(systemPrompt, userContent) {
  const body = minimax.buildMiniMaxBody(
    minimax.MINIMAX_M3_MODEL,
    [{ role: 'user', content: userContent }],
    systemPrompt,
    null,
    { stream: false },
  );
  const res = await fetch(minimax.MINIMAX_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(minimax.MINIMAX_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`MiniMax HTTP ${res.status}: ${t.slice(0, 160)}`);
  }
  const data = await res.json();
  const parsed = minimax.parseMiniMaxResponse(data);
  if (!parsed.ok) throw new Error(`MiniMax soft error: ${parsed.reason}`);
  return minimax.stripLeadingThink(parsed.text).trim();
}

// ── fixtures (kept in sync with the .mjs test fixture) ──
const { FIXTURE_RESUME, FIXTURE_JD, FIXTURE_ARTIFACTS } = await import(
  pathToFileURL(path.join(repoRoot, 'electron/services/knowledge/__tests__/fixtures/profile-fixture.mjs')).href
);

const QUESTIONS = [
  { id: 1, q: 'Who are you?', factHints: [], isolation: null, note: 'identity probe — assistant OR candidate voice, not a leak test' },
  { id: 2, q: 'Tell me about yourself.', factHints: ['engineer'], isolation: null },
  { id: 3, q: 'What is your total experience?', factHints: ['six', '6'], isolation: null, anyHint: true },
  { id: 4, q: 'Where did you work most recently?', factHints: ['Nimbus'], isolation: null },
  { id: 5, q: 'Tell me about your project OpenTrace.', factHints: ['OpenTrace'], isolation: null },
  { id: 6, q: 'What did you achieve at Nimbus Data?', factHints: ['Nimbus'], isolation: null },
  { id: 7, q: 'What are your strongest programming languages?', factHints: ['Python'], isolation: null },
  { id: 8, q: 'What tools and frameworks do you know?', factHints: ['Docker', 'FastAPI', 'React'], isolation: null, anyHint: true },
  { id: 9, q: 'Where did you study?', factHints: ['Texas'], isolation: null },
  { id: 10, q: 'Walk me through a challenge you solved.', factHints: [], isolation: null },
  { id: 11, q: 'What does the target job require?', factHints: ['Kubernetes', 'distributed', 'Go'], isolation: null, anyHint: true },
  { id: 12, q: 'Which requirements of the JD do you not yet meet?', factHints: ['Kafka'], isolation: null },
  { id: 13, q: 'What salary should you ask for?', factHints: [], isolation: null },
  { id: 14, q: 'Why are you a good fit for this role?', factHints: [], isolation: null },
  { id: 15, q: 'Give me a 60-second intro.', factHints: ['engineer'], isolation: null },
  { id: 16, q: 'Write a for loop in Python.', factHints: [], isolation: 'coding_no_profile' },
  { id: 17, q: 'What is OpenVLA?', factHints: [], isolation: 'doc_grounded_no_profile', docGrounded: true },
  { id: 18, q: 'What is my thesis about?', factHints: [], isolation: 'doc_grounded_no_profile', docGrounded: true },
];

// Profile PII tokens that must NEVER appear in an isolated (coding/doc-grounded) answer.
const PROFILE_PII_TOKENS = ['Alex Rivera', 'Nimbus Data', 'Loop Analytics', 'OpenTrace', 'Meridian Robotics', 'Austin'];

function containsAny(text, tokens) {
  const lc = text.toLowerCase();
  return tokens.filter((t) => lc.includes(t.toLowerCase()));
}

async function main() {
  const { DatabaseManager } = await load('db/DatabaseManager.js');
  DatabaseManager.getInstance();
  const { planAnswer, isCodingAnswerType, formatAnswerPlanForPrompt } = await load('llm/AnswerPlanner.js');
  const { tryBuildManualProfileFastPathAnswer } = await load('llm/manualProfileIntelligence.js');
  const { retrieveProfileEvidence } = await load('services/knowledge/OkfProfileRetriever.js');
  const { ProfilePackBuilder } = await load('services/knowledge/ProfilePackBuilder.js');
  const { CHAT_MODE_PROMPT } = await load('llm/prompts.js');

  const builder = ProfilePackBuilder.getInstance();
  builder.deleteAllProfilePacks();
  const r1 = builder.generateForProfile({ kind: 'resume', docId: 1, structuredData: FIXTURE_RESUME, totalExperienceYears: 6 }, true);
  const r2 = builder.generateForProfile({ kind: 'jd', docId: 2, structuredData: FIXTURE_JD, artifacts: FIXTURE_ARTIFACTS }, true);
  console.log(`[live] profile packs: resume=${r1.status}(${r1.pack?.cards.length ?? 0} cards) jd=${r2.status}(${r2.pack?.cards.length ?? 0} cards)`);
  console.log(`[live] model=${minimax.MINIMAX_M3_MODEL} endpoint=${minimax.MINIMAX_CHAT_URL}\n`);

  const results = [];
  for (const item of QUESTIONS) {
    const docGrounded = item.docGrounded === true;
    const activeMode = docGrounded ? { documentGroundedCustomModeActive: true } : undefined;
    const plan = planAnswer({ question: item.q, source: 'manual_input', speakerPerspective: 'user', activeMode });
    const isCoding = isCodingAnswerType(plan.answerType);

    // OKF retrieval — the same fail-closed gate the manual path applies.
    let evidence = { allowed: false, cardCount: 0, block: '', blockedReason: 'not_attempted' };
    const okfEligible = !isCoding && plan.profileContextPolicy !== 'forbidden' && !docGrounded;
    if (okfEligible) {
      evidence = retrieveProfileEvidence({
        question: item.q, profileContextPolicy: plan.profileContextPolicy,
        documentGroundedActive: docGrounded, hasExplicitPlan: true,
      });
    }

    // Assemble the prompt exactly like the manual path: answer-plan directive +
    // OKF card block (if allowed) prepended to the question, under CHAT_MODE_PROMPT.
    let planDirective = '';
    try { planDirective = formatAnswerPlanForPrompt ? formatAnswerPlanForPrompt(plan) : ''; } catch { /* optional */ }
    const contextBlock = (evidence.allowed && evidence.block) ? `${evidence.block}\n\n` : '';
    const userContent = `${planDirective ? planDirective + '\n\n' : ''}${contextBlock}Question: ${item.q}`;

    // Live call.
    let answer = '';
    let callErr = null;
    try {
      answer = await callMiniMax(CHAT_MODE_PROMPT, userContent);
    } catch (e) {
      callErr = e.message;
    }

    // Scoring.
    let pass = true;
    const notes = [];
    const promptLeak = containsAny(userContent, PROFILE_PII_TOKENS);
    const answerLeak = containsAny(answer, PROFILE_PII_TOKENS);

    if (item.isolation && /no_profile/.test(item.isolation)) {
      if (evidence.allowed && evidence.cardCount > 0) { pass = false; notes.push('ISOLATION: OKF cards were retrieved'); }
      if (promptLeak.length > 0) { pass = false; notes.push(`ISOLATION: profile token in PROMPT: ${promptLeak.join(',')}`); }
      if (answerLeak.length > 0) { pass = false; notes.push(`ISOLATION: profile token in ANSWER: ${answerLeak.join(',')}`); }
    } else {
      if (callErr) { pass = false; notes.push(`call error: ${callErr}`); }
      else if (!answer) { pass = false; notes.push('empty answer'); }
      else if (item.factHints.length > 0) {
        const hit = containsAny(answer, item.factHints);
        const need = item.anyHint ? 1 : item.factHints.length;
        if (hit.length < need) { pass = false; notes.push(`missing facts: expected ${item.anyHint ? 'any of' : 'all'} [${item.factHints.join(',')}], got [${hit.join(',')}]`); }
      }
    }

    results.push({
      id: item.id, question: item.q, answerType: plan.answerType, profileContextPolicy: plan.profileContextPolicy,
      isCoding, docGrounded, okfAllowed: evidence.allowed, okfCardCount: evidence.cardCount,
      okfBlockedReason: evidence.blockedReason, fastPathUsed: (() => {
        try { return Boolean(tryBuildManualProfileFastPathAnswer({ question: item.q, profile: FIXTURE_RESUME, jobDescription: FIXTURE_JD, source: 'manual_input' })?.usedDeterministicFastPath); } catch { return false; }
      })(),
      answerPreview: answer.slice(0, 180).replace(/\n/g, ' '), callErr, pass, notes,
    });

    const flag = pass ? '✓' : '✗';
    console.log(`${flag} Q${item.id} [${plan.answerType}/${plan.profileContextPolicy}] okf=${evidence.allowed}(${evidence.cardCount})`);
    console.log(`    Q: ${item.q}`);
    console.log(`    A: ${answer.slice(0, 160).replace(/\n/g, ' ')}${answer.length > 160 ? '…' : ''}`);
    if (notes.length) console.log(`    ⚠ ${notes.join('; ')}`);
    console.log('');
  }

  const passed = results.filter((r) => r.pass).length;
  const summary = { mode: 'live_minimax_m3', model: minimax.MINIMAX_M3_MODEL, generatedAt: new Date().toISOString(), total: results.length, passed, passRate: `${passed}/${results.length}`, results };
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'live-minimax-results.json');
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\n[live] pass=${summary.passRate} → ${outFile}`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
