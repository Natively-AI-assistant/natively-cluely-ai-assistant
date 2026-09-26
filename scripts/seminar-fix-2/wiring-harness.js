// scripts/seminar-fix-2/wiring-harness.js
//
// PHASE 1 WIRING-PROOF + regression scoring harness for the document-grounded
// "Seminar mode" retrieval fix — ATTEMPT 2 ("PROVE IT LANDS").
//
// Mission rule #1: a fix does not exist until proven in the LIVE APP PATH with
// fresh logs showing the new code executing. This harness makes "did it land" a
// mechanical check by driving the REAL product pipeline (unchanged) on a COPY of
// the live DB and asserting the HYBRID `[FIX2-TRACE]` tags fire.
//
// WHAT IT DOES
//   1. DB isolation: copies the live natively userData DB (natively.db + -wal +
//      -shm + credentials.*) into a throwaway temp dir under os.tmpdir(), points
//      NATIVELY_TEST_USERDATA at the COPY, and asserts we're on the copy. The
//      user's real DB is byte-untouched (mtime+sha compared at exit).
//   2. Wiring proof: drives the REAL main-path call
//      mm.buildRetrievedActiveModeContextBlockHybrid(...) for one probe question,
//      captures every [FIX2-TRACE] / [ModeHybridRetriever] / [ModeContextRetriever]
//      stdout line by intercepting console.log/warn in-process, and asserts
//      PATH=HYBRID (the ModesManager hybrid-first branch fired with tookHybrid:true
//      AND the HYBRID doc-grounded selected trace fired). Emits PHASE1_WIRING_PROOF.md.
//   3. Index freshness: re-chunks file.content via the SAME chunker the retriever
//      uses (ModeHybridRetriever.chunkText, exercised through getModeFileChunks by
//      a real retrieval) and compares chunk-count / section-tagged-count against the
//      persisted mode_reference_chunks rows. Logs INDEX_FRESH: ok/mismatch. (A real
//      chunker_version marker is a Phase-2 product change — its absence is noted.)
//   4. Regression scoring: drives each question through the REAL streamChat path
//      (the identical call gemini-chat-stream makes) so retrieval + prompt assembly
//      + the real doc-grounded prompt shaping all run through product code. Scoring
//      rules are COPIED VERBATIM from the attempt-1 harness
//      (scripts/seminar-hardening/regression-harness.js) — they are ground truth.
//      The ipcHandlers post-answer completeness validator (reason:'incomplete' /
//      false_refusal) lives in the IPC HANDLER, not in streamChat, so it is
//      REPLICATED here using the SAME exported pure functions the handler uses
//      (detectIncompleteNumericAnswer / completenessRegenFabricates) and LABELLED
//      as a replica in the output.
//   5. Retrieval fingerprint: for each question, records the sections present in the
//      retrieved HYBRID block + per-chunk fts/vec/combined scores (captured from the
//      [FIX2-TRACE] HYBRID doc-grounded selected trace) so the fix's effect on the
//      six traps is visible (a winning chunk emerging; a section's siblings surviving
//      dedup).
//
// EMBEDDER: tries a Gemini key (CredentialsManager → env → .env), else local Ollama
// (nomic-embed-text @ localhost:11434). Either exercises the HYBRID path. If NO
// embedder resolves, the run is labelled PATH=LEXICAL and flagged as NOT the primary
// target. Because we run on a COPY, any re-embedding is harmless.
//
// GENERATION: Gemini DIRECT (llm.setApiKey + setModel('gemini-3.1-flash-lite')).
// Keys rotate on 429/empty; a quota outage records ERROR (not FAIL). Presence-only.
//
// RUN:
//   ./node_modules/.bin/electron scripts/seminar-fix-2/wiring-harness.js
//
// KNOBS:
//   HARNESS_ONLY=A1,C2       run a subset (comma ids; E1/E2 select whole chains)
//   HARNESS_MS=<ms>          watchdog (default 1500000 = 25min)
//   RUN_TAG=<name>           output dir run-<RUN_TAG> (default run-<counter>)
//   NATIVELY_LIVE_EMBED=1    force wiring the embedder (default: try it)
//   WIRING_ONLY=1            do ONLY the wiring proof + fingerprint + index-fresh,
//                            skip generation/scoring (no gen key needed)
//   OLLAMA_URL=<url>         embedder (default http://localhost:11434)
//
// macOS has no `timeout`: an in-script setTimeout(()=>process.exit(3), MS) guards.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..', '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const OUT_ROOT = path.join(repoRoot, 'test-results', 'seminar-fix-2');

// ── Hard watchdog — macOS has no `timeout`. ──────────────────────────────
const WATCHDOG_MS = Number(process.env.HARNESS_MS) || 1500000;
const watchdog = setTimeout(() => {
  console.error('[harness] WATCHDOG timeout — exiting 3');
  process.exit(3);
}, WATCHDOG_MS);

const ONLY = (process.env.HARNESS_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const WIRING_ONLY = process.env.WIRING_ONLY === '1';
const PER_Q_TIMEOUT_MS = 35000;

// The live mode + good reference file (Phase 0 forensics, verified by reviewer).
const MODE_ID = 'mode_dd5765eb-f83b-487f-930a-0ffdd3eb6e04';
const GOOD_FILE = 'ref_9b5fe304-e51a-4e94-bced-d50bd291a10e';
const PROBE_Q = 'What are the four main phases of the project?';

// ============================================================================
// TRACE CAPTURE — intercept console.log/warn/error IN-PROCESS so we can grep the
// product's [FIX2-TRACE] / [ModeHybridRetriever] / [ModeContextRetriever] lines
// WITHOUT re-spawning. Everything still passes through to the real stdout.
// ============================================================================
const capturedTrace = [];
let capturing = false;
// [FIX2-TRACE] was converted to the permanent, default-OFF
// `[retrievalDiagnostics]` debug flag (electron/llm/documentGroundedPrompt.ts,
// env NATIVELY_RETRIEVAL_DIAGNOSTICS=1) — match both prefixes for continuity
// with earlier captures, and enable the flag below so the harness can still see
// the wiring-proof trace.
const TRACE_RE = /\[FIX2-TRACE\]|\[retrievalDiagnostics\]|\[ModeHybridRetriever\]|\[ModeContextRetriever\]|\[ModesManager\]|\[LLMHelper\] manual hybrid retrieval exceeded|doc_grounded_hybrid_timeout/;
const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origErr = console.error.bind(console);
function fmtArgs(args) {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}
function installTraceHook() {
  console.log = (...args) => { if (capturing) { const s = fmtArgs(args); if (TRACE_RE.test(s)) capturedTrace.push(s); } origLog(...args); };
  console.warn = (...args) => { if (capturing) { const s = fmtArgs(args); if (TRACE_RE.test(s)) capturedTrace.push('[WARN] ' + s); } origWarn(...args); };
  console.error = (...args) => { if (capturing) { const s = fmtArgs(args); if (TRACE_RE.test(s)) capturedTrace.push('[ERROR] ' + s); } origErr(...args); };
}
// Grab and clear the trace buffer, returning the lines captured since last drain.
function drainTrace() { const out = capturedTrace.splice(0, capturedTrace.length); return out; }

// ============================================================================
// KEY RESOLUTION — never print the value; presence booleans only.
// ============================================================================
function parseDotEnvKeys() {
  const out = {};
  try {
    const envPath = path.join(repoRoot, '.env');
    if (!fs.existsSync(envPath)) return out;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(GEMINI_API_KEY(?:_[0-9]+)?)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v.length > 0) out[m[1]] = v;
    }
  } catch { /* ignore */ }
  return out;
}
function resolveGeminiKeys() {
  const names = ['GEMINI_API_KEY'];
  for (let i = 1; i <= 6; i++) names.push(`GEMINI_API_KEY_${i}`);
  const dotenv = parseDotEnvKeys();
  const seen = new Set();
  const keys = [];
  const push = (name, value) => { if (value && value.length > 0 && !seen.has(value)) { seen.add(value); keys.push({ name, value }); } };
  for (const n of names) push(n, process.env[n]);
  for (const n of names) push(n, dotenv[n]);
  for (const [n, v] of Object.entries(dotenv)) push(n, v);
  return keys;
}

// ============================================================================
// REGRESSION SET — ground truth from the thesis. COPIED VERBATIM from
// scripts/seminar-hardening/regression-harness.js (the attempt-1 harness). These
// scoring rules ARE the production bar and MUST NOT be loosened.
// ============================================================================
const REFUSAL_RE = /not (directly )?(mentioned|specified|stated|provided|included|in (my|the))|do(es)? not (say|specify|mention|provide|state|indicate|include)|is not (specified|mentioned|stated|provided|given|indicated)|isn'?t (mentioned|specified|stated|provided|included)|no (information|mention|figure|specific|data|details?) (about|on|regarding|for|is|was)?|couldn'?t find|could not find|i (don'?t|do not) (have|see)|not available in|not part of/i;

const SECTION_A = [
  { id: 'A1', q: 'What are the two research questions?', must: [[/RQ1|research question 1|agentic ai framework/i, /AGI/i], [/RQ2|research question 2|perception|decision/i]], mustNot: [/^\s*the agenticvla system integrates a pretrained and finetuned[\s\S]*$/i] },
  { id: 'A2', q: 'What is a Vision-Language-Action model?', must: [[/multimodal/i, /(image|visual|vision)[\s\S]{0,40}(language|linguistic|instruction)|(language|linguistic|instruction)[\s\S]{0,40}(image|visual|vision)/i], [/action|robot action|control/i], [/(visual|vision).*(language)|language.*(visual|vision)/i]], mustNot: [/agenticvla (system|wrapper|integrates)/i] },
  { id: 'A3', q: 'What are the four main phases of the project?', must: [[/teleoperation/i], [/data ?collection|dataset collection|data ?gathering|data ?acquisition|dataset (design|creation|structure)|collect(ing|ion of)?\s+(the\s+)?(data|dataset|demonstrations|trajector)/i], [/training|finetun|fine-tun|openvla-oft/i], [/agentic|autogen|integration/i]], mustNot: [/^\s*the agenticvla system integrates a pretrained and finetuned[\s\S]*$/i] },
  { id: 'A4', q: 'What objects were used in the robotic tasks?', must: [[/banana/i], [/grape/i]], mustNot: [/^\s*(joystick|haptic)[\s\S]*$/i] },
  { id: 'A5', q: 'What models were compared in the experiments?', must: [[/openvla/i], [/oft|finetuned/i], [/agenticvla/i]] },
  { id: 'A6', q: 'What hardware was used for teleoperation?', must: [[/quest\s*3|meta quest/i], [/orbbec/i, /logitech|c920/i], [/unity|ros#/i]], mustNot: [REFUSAL_RE] },
  { id: 'A7', q: 'What is the conclusion of the thesis?', must: [[/agentic/i], [/instruction|interpretation|decision/i], [/(not|rather than).*(low-level|manipulation)|manipulation/i]], minMustGroups: 2 },
  { id: 'A8', q: 'What is the main contribution of this thesis?', must: [[/modular|pipeline|wrapper|tool/i], [/decid|what.*(act|when)|orchestrat|(decompos|filter|delegat|plan|verif)[\s\S]{0,60}(task|input|action|condition|execut|before)|before\s+(action\s+)?execut/i]] },
  { id: 'A9', q: 'What are the advantages of the AgenticVLA approach?', must: [[/success rate|SR|ambiguous|complex/i], [/decompos|filter|feasibilit|verif/i], [/without retrain|no retrain|wrapper/i]], minMustGroups: 2 },
];

const SECTION_B = [
  { id: 'B1', shared: 'four-phase methodology',
    a: { id: 'B1a', q: 'Explain the research methodology.', must: [[/teleoperation/i], [/data ?collection|dataset collection|data ?gathering|data ?acquisition|dataset (design|creation|structure)|collect(ing|ion of)?\s+(the\s+)?(data|dataset|demonstrations|trajector)/i], [/training|finetun|fine-tun|openvla-oft/i], [/agentic|autogen|integration/i]] },
    b: { id: 'B1b', q: 'What are the four main phases of the project?', must: [[/teleoperation/i], [/data ?collection|dataset collection|data ?gathering|data ?acquisition|dataset (design|creation|structure)|collect(ing|ion of)?\s+(the\s+)?(data|dataset|demonstrations|trajector)/i], [/training|finetun|fine-tun|openvla-oft/i], [/agentic|autogen|integration/i]] },
    agreeRe: [/teleoperation/i, /data ?collection|dataset collection|data ?gathering|data ?acquisition|dataset (design|creation|structure)|collect(ing|ion of)?\s+(the\s+)?(data|dataset|demonstrations|trajector)/i] },
  { id: 'B2', shared: 'objects picked',
    a: { id: 'B2a', q: 'What did the robot pick up during the experiments?', must: [[/banana/i], [/grape/i]] },
    b: { id: 'B2b', q: 'What objects were used in the robotic tasks?', must: [[/banana/i], [/grape/i]] },
    agreeRe: [/banana/i, /grape/i] },
  { id: 'B3', shared: 'research questions',
    a: { id: 'B3a', q: 'State RQ1 and RQ2.', must: [[/RQ1|research question 1|agentic ai framework/i, /AGI/i], [/RQ2|research question 2|perception|decision/i]] },
    b: { id: 'B3b', q: 'What are the two research questions?', must: [[/RQ1|research question 1|agentic ai framework/i, /AGI/i], [/RQ2|research question 2|perception|decision/i]] },
    agreeRe: [/AGI/i] },
  { id: 'B4', shared: 'VLA general concept (not the wrapper)',
    a: { id: 'B4a', q: 'What does a VLA model do?', must: [[/action|control|manipul|task/i]], mustNot: [/agenticvla (system|wrapper)/i] },
    b: { id: 'B4b', q: 'Why are VLA models important for robotics?', must: [[/robot|generaliz|task|control|manipul/i]], mustNot: [/agenticvla (system|wrapper)/i] },
    agreeRe: [/vla|vision-language-action|action|robot/i] },
];

const SECTION_C = [
  { id: 'C1', q: 'What are the specifications of the Mercury X1 robot?', minMustGroups: 6, must: [[/1\.18\s*m/i], [/55\s*kg/i], [/19\s*(dof|degrees)/i], [/24\s*v/i], [/8\s*h(our)?/i], [/1\s*kg/i], [/0\.05\s*mm/i], [/1\.2\s*m\/s/i], [/15°|15 deg/i], [/jetson/i]] },
  { id: 'C2', q: 'What were the finetuning hyperparameters?', minMustGroups: 5, must: [[/batch\s*(size)?[\s:]*(of\s*)?4\b/i], [/2e-4|0\.0002|2\s*(?:\\cdot|·|×|x|\*)?\s*10\s*\^?\s*-?\s*4/i], [/75,?000/i], [/150,?005/i], [/lora|rank[\s:]*32/i], [/dropout[\s\w:]{0,14}0(?:\.0)?\b/i]] },
  { id: 'C3', q: 'What GPU was used for training?', must: [[/96\s*gb/i], [/(62|16)\s*gb/i]], mustNot: [/teleoperation[\s\S]*data collection[\s\S]*training[\s\S]*integration/i] },
  { id: 'C4', q: 'How many episodes are in the dataset, and at what sampling rate?', must: [[/480/], [/50\s*hz/i], [/25\s*hz/i]], refusalIsFail: true },
  { id: 'C5', q: 'What were the success rates in the self-awareness benchmark?', must: [[/0\s*%|zero|fail(s|ed|ure)?|no (successful|meaningful)|did not (succeed|complete)|static pose|unable to/i], [/43\s*%/i], [/85\s*%/i]] },
];

const SECTION_D = [
  { id: 'D1', q: 'What was the total cost of the teleoperation system?', dRefusal: true, fabricationRe: [/\$\s*[\d,]+|\b[\d,]+\s*(usd|dollars|eur|euros|€|£|gbp)\b/i] },
  { id: 'D2', q: 'Which cloud provider or GPU vendor was used?', dRefusal: true, fabricationRe: [/aws|amazon|google cloud|gcp|azure|nvidia (a100|h100|dgx)|lambda labs|coreweave/i] },
  { id: 'D3', q: 'How many human participants collected the dataset?', dRefusal: true, fabricationRe: [/\b\d+\s*(participants|humans|operators|people|annotators)/i], hedgeAlsoRe: [/an operator|a single operator|one operator|the operator/i] },
  { id: 'D4', q: 'What accuracy did it achieve on a public leaderboard?', dRefusal: true, fabricationRe: [/\b\d+(\.\d+)?\s*%\s*(on|accuracy)|leaderboard.{0,30}\d|ranked\s*#?\d|top-?\d/i] },
  { id: 'D5', q: 'Was the system tested outdoors or in a lab?', dLabCheck: true, must: [[/lab|controlled|indoor/i]], mustNot: [/(tested|evaluated|deployed).*(outdoor|outside|in the wild)/i] },
];

const SECTION_E = [
  { id: 'E1', turns: [{ q: 'What is OpenVLA-OFT?' }, { q: 'How is it different from the base model?' }, { q: 'What throughput improvement does that give?', must: [[/43\s*x|43 times|43-fold/i]] }], passOnTurn: 2 },
  { id: 'E2', turns: [{ q: 'What robot was used in this work?', must: [[/mercury\s*x1/i]] }, { q: 'How many degrees of freedom does it have?', must: [[/19/]] }, { q: 'What processor controls it?', must: [[/jetson/i]], mustNot: [/virtual reality|vr (framework|headset|teleoperation)/i] }], passAllTurns: true },
];

const SECTION_F = [
  { id: 'F1', q: 'Why is an agentic framework better than simply using a larger VLA model?', fConcepts: [/decision/i, /control/i, /modular/i, /compos/i, /specialized/i], fMinConcepts: 2 },
  { id: 'F2', q: "I'm stuck, give me one line I can say right now about why VLAs need finetuning for a new robot.", must: [[/single-arm|new robot|(specific|new|this|particular|different|your)\s+robot|own (data|trajector)|dataset|trajector|robot('?s)?\s+(setup|embodiment|configuration|hardware|specific)|embodiment/i]], fOneLine: true },
  { id: 'F3', q: 'What do you think of the latest ChatGPT release?', fRedirect: true },
];

// ============================================================================
// SCORING — COPIED VERBATIM from the attempt-1 harness.
// ============================================================================
function wordCount(t) { return t.trim().split(/\s+/).filter(Boolean).length; }
function sentenceCount(t) { return (t.match(/[.!?](\s|$)/g) || []).length || (t.trim() ? 1 : 0); }
function normalizeForFactMatch(raw) {
  let t = String(raw);
  t = t.replace(/[*_`]+/g, ' ');
  t = t.replace(/\$+/g, ' ');
  t = t.replace(/(\d(?:\.\d+)?)\s*(?:\\cdot|·|×|x|\*)\s*10\s*\^?\s*\{?\s*-\s*(\d+)\s*\}?/gi, (_m, mant, exp) => `${mant}e-${exp} ${_m}`);
  // Canonicalize WORD-FORM units to abbreviations so "96 gigabytes" matches
  // /96\s*gb/, "50 hertz" matches /50\s*hz/, etc. The FACT (the value) is present;
  // only the surface unit differs. Append the abbreviated form alongside the
  // original so both spellings match.
  t = t.replace(/(\d[\d,]*(?:\.\d+)?)\s*(gigabytes?|megabytes?|hertz|kilohertz|kilograms?|millimet(?:er|re)s?|volts?|watts?)/gi, (m, num, unit) => {
    const map = { gigabyte: 'GB', gigabytes: 'GB', megabyte: 'MB', megabytes: 'MB', hertz: 'Hz', kilohertz: 'kHz', kilogram: 'kg', kilograms: 'kg', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm', volt: 'V', volts: 'V', watt: 'W', watts: 'W' };
    const abbr = map[unit.toLowerCase()] || unit;
    return `${m} ${num}${abbr}`;
  });
  t = t.replace(/\s+/g, ' ');
  return t;
}
function matchGroups(text, mustGroups) {
  const norm = normalizeForFactMatch(text);
  const matched = []; const missed = [];
  mustGroups.forEach((group, i) => { const hit = group.some((re) => re.test(text) || re.test(norm)); if (hit) matched.push(i); else missed.push(i); });
  return { matched, missed };
}
function scoreStandard(rule, text) {
  const notes = [];
  if (rule.refusalIsFail && REFUSAL_RE.test(text)) return { verdict: 'FAIL', matched: [], missed: rule.must ? rule.must.map((_, i) => i) : [], notes: ['refusal-but-fact-exists'] };
  let matched = [], missed = [];
  if (rule.must) { const r = matchGroups(text, rule.must); matched = r.matched; missed = r.missed; }
  const need = rule.minMustGroups || (rule.must ? rule.must.length : 0);
  let ok = matched.length >= need;
  const mustNotHit = [];
  if (rule.mustNot) for (const re of rule.mustNot) if (re.test(text)) mustNotHit.push(String(re));
  if (mustNotHit.length) { ok = false; notes.push('mustNot:' + mustNotHit.join(',')); }
  return { verdict: ok ? 'PASS' : 'FAIL', matched, missed, notes: notes.concat(missed.length ? [`missed ${missed.length}/${rule.must.length} (need ${need})`] : []) };
}
function scoreD(rule, text) {
  const notes = [];
  if (rule.dLabCheck) {
    const labNamed = rule.must[0].some((re) => re.test(text));
    const outdoorClaim = rule.mustNot.some((re) => re.test(text));
    if (outdoorClaim) return { verdict: 'FAIL', notes: ['claims-outdoor-testing'] };
    if (!labNamed) return { verdict: 'FAIL', notes: ['does-not-name-lab/controlled'] };
    return { verdict: 'PASS', notes: ['lab-named,no-outdoor-claim'] };
  }
  const fabricated = [];
  for (const re of (rule.fabricationRe || [])) if (re.test(text)) fabricated.push(String(re));
  if (fabricated.length) return { verdict: 'FAIL', notes: ['FABRICATED:' + fabricated.join(',')] };
  const hedged = REFUSAL_RE.test(text) || (rule.hedgeAlsoRe && rule.hedgeAlsoRe.some((re) => re.test(text)));
  if (!hedged) { notes.push('no-explicit-hedge'); return { verdict: 'FAIL', notes }; }
  return { verdict: 'PASS', notes: ['hedged,no-fabrication'] };
}
function scoreF(rule, text) {
  if (rule.fConcepts) {
    const hits = rule.fConcepts.filter((re) => re.test(text));
    const ok = hits.length >= (rule.fMinConcepts || 2);
    const structureBonus = /(first|second|third|1\.|2\.|3\.|•|\n-)/i.test(text);
    return { verdict: ok ? 'PASS' : 'FAIL', notes: [`concepts=${hits.length}/${rule.fMinConcepts}`, structureBonus ? 'structure+' : 'structure-'] };
  }
  if (rule.fOneLine) {
    const mustR = matchGroups(text, rule.must);
    if (mustR.missed.length) return { verdict: 'FAIL', notes: ['missed-content'] };
    const wc = wordCount(text), sc = sentenceCount(text);
    if (wc > 60 || sc > 2) return { verdict: 'FAIL', notes: [`paragraph wc=${wc} sc=${sc}`] };
    return { verdict: 'PASS', notes: [`one-line wc=${wc} sc=${sc}`] };
  }
  if (rule.fRedirect) {
    const chatgptInvented = /chatgpt.{0,40}(released|features?|gpt-?[45]|improv|better|faster|new model)/i.test(text) && /\b(gpt-?[45]|o[13]|multimodal|context window|\d+[kmb])\b/i.test(text);
    const redirect = /(seminar|thesis|uploaded|reference|my material|my (file|document)|presentation)/i.test(text) && /(help|assist|answer|ask|focus|happy to|can (i|we))/i.test(text);
    const bareRefusal = REFUSAL_RE.test(text);
    if (chatgptInvented) return { verdict: 'FAIL', notes: ['answers-chatgpt-invented'] };
    if (redirect) return { verdict: 'PASS', notes: ['polite-redirect'] };
    if (bareRefusal) return { verdict: 'WEAK', notes: ['bare-doc-refusal'] };
    return { verdict: 'FAIL', notes: ['no-redirect-no-refusal'] };
  }
  return { verdict: 'FAIL', notes: ['no-F-rule'] };
}

// Local copy of the production stripPriorAssistantTurns (ipcHandlers.ts:147).
function stripPriorAssistantTurnsLocal(snapshot) {
  const lines = snapshot.split('\n');
  const kept = []; let skipping = false;
  for (const line of lines) {
    if (/^\[ASSISTANT \(PREVIOUS SUGGESTION\)\]:/.test(line)) { skipping = true; continue; }
    if (/^\[(ME|INTERVIEWER)\]:/.test(line)) { skipping = false; kept.push(line); continue; }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').trim();
}

// ============================================================================
// DB ISOLATION — copy the live natively DB (+ credentials) to a throwaway temp
// dir, point NATIVELY_TEST_USERDATA at the COPY, assert we're on the copy.
// ============================================================================
const LIVE_USERDATA = path.join(os.homedir(), 'Library', 'Application Support', 'natively');
const LIVE_DB = path.join(LIVE_USERDATA, 'natively.db');
function sha256File(p) { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } }
function mtimeOf(p) { try { return fs.statSync(p).mtimeMs; } catch { return null; } }

function setupDbCopy(log) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-seminar-fix2-'));
  // Copy the DB triplet + any credential/config files small enough to matter.
  const copyList = ['natively.db', 'natively.db-wal', 'natively.db-shm', 'credentials.enc', 'credentials.fallback.enc', 'credentials.salt'];
  const copied = [];
  for (const name of copyList) {
    const src = path.join(LIVE_USERDATA, name);
    if (fs.existsSync(src)) {
      const dst = path.join(tmpDir, name);
      fs.copyFileSync(src, dst);
      copied.push(name);
    }
  }
  process.env.NATIVELY_TEST_USERDATA = tmpDir;
  // Enable the permanent (default-OFF) retrieval-diagnostics flag so the
  // wiring-proof trace fires — [FIX2-TRACE] was converted to this flag.
  process.env.NATIVELY_RETRIEVAL_DIAGNOSTICS = '1';
  // ASSERT: we are on the copy, and the copy is under os.tmpdir().
  const underTmp = tmpDir.startsWith(os.tmpdir());
  if (!underTmp) { throw new Error(`FATAL: copy dir ${tmpDir} is NOT under os.tmpdir() (${os.tmpdir()}) — refusing to run`); }
  log(`[harness] DB ISOLATION: copied [${copied.join(', ')}] → ${tmpDir}`);
  log(`[harness] DB ISOLATION: NATIVELY_TEST_USERDATA=${process.env.NATIVELY_TEST_USERDATA}`);
  log(`[harness] DB ISOLATION: assert copyUnderTmp=${underTmp} (os.tmpdir=${os.tmpdir()})`);
  return { tmpDir, copied };
}

async function collect(gen) { let o = ''; for await (const t of gen) o += t; return o; }
function nextOutDir() {
  const tag = process.env.RUN_TAG;
  if (tag) return path.join(OUT_ROOT, `run-${tag}`);
  let max = -1;
  try { for (const d of fs.readdirSync(OUT_ROOT)) { const m = d.match(/^run-(\d+)(?:-.*)?$/); if (m) max = Math.max(max, Number(m[1])); } } catch { /* ignore */ }
  return path.join(OUT_ROOT, `run-${max + 1}`);
}

// [FIX2-TRACE] was converted to the permanent [retrievalDiagnostics] flag —
// match either prefix so parsing works against both historical and current logs.
const DIAG_PREFIX = '(?:\\[FIX2-TRACE\\]|\\[retrievalDiagnostics\\])';

// Parse the HYBRID doc-grounded selected trace line to extract the per-chunk
// fingerprint (section / fts / vec / combined / file / first80).
function parseHybridSelectedTrace(traceLines) {
  // The trace is logged as: '<prefix> HYBRID doc-grounded selected' + JSON obj.
  // Because we JSON.stringify each arg separately, the object is a JSON token in
  // the joined string. Find the line, then parse the trailing JSON.
  const re = new RegExp(`${DIAG_PREFIX} HYBRID doc-grounded selected`);
  for (const line of traceLines) {
    if (!re.test(line)) continue;
    const jsonStart = line.indexOf('{');
    if (jsonStart < 0) continue;
    try {
      const obj = JSON.parse(line.slice(jsonStart));
      return obj;
    } catch { /* fall through */ }
  }
  return null;
}
// Sections present in a retrieved block, in order.
function sectionsInBlock(block) { return [...block.matchAll(/\[Section\s+([\d.]+)/g)].map((m) => m[1]); }
function snippetCount(block) { return (block.match(/<snippet>/g) || []).length; }

// Analyze the drained trace: did the hybrid path fire?
function analyzePath(traceLines) {
  const hybridBranch = traceLines.find((l) => new RegExp(`${DIAG_PREFIX} ModesManager hybrid-first branch`).test(l));
  const hybridEntry = traceLines.find((l) => new RegExp(`${DIAG_PREFIX} HYBRID retrieve\\(\\) entry`).test(l));
  const hybridSelected = traceLines.find((l) => new RegExp(`${DIAG_PREFIX} HYBRID doc-grounded selected`).test(l));
  const lexicalEntry = traceLines.find((l) => new RegExp(`${DIAG_PREFIX} LEXICAL retrieve\\(\\) entry`).test(l));
  // tookHybrid parsed from the hybrid-first branch trace object.
  let tookHybrid = false;
  if (hybridBranch) {
    const j = hybridBranch.indexOf('{');
    if (j >= 0) { try { tookHybrid = JSON.parse(hybridBranch.slice(j)).tookHybrid === true; } catch { /* ignore */ } }
  }
  const path = (hybridSelected && tookHybrid) ? 'hybrid'
    : (hybridEntry && !tookHybrid) ? 'hybrid-fellback-lexical'
      : lexicalEntry ? 'lexical' : 'unknown';
  return {
    path,
    tookHybrid,
    hybridBranchFired: !!hybridBranch,
    hybridEntryFired: !!hybridEntry,
    hybridSelectedFired: !!hybridSelected,
    lexicalEntryFired: !!lexicalEntry,
    traceFired: !!(hybridBranch || hybridEntry || hybridSelected || lexicalEntry),
  };
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  await app.whenReady();
  installTraceHook();

  const outDir = nextOutDir();
  fs.mkdirSync(outDir, { recursive: true });
  const log = [];
  const say = (s) => { origLog(s); log.push(s); };

  say(`[harness] ===== Phase-1 wiring-harness (attempt 2) =====`);
  say(`[harness] outDir=${outDir}  ONLY=[${ONLY.join(',') || 'all'}]  WIRING_ONLY=${WIRING_ONLY}  watchdogMs=${WATCHDOG_MS}`);

  // ── 1. DB isolation (record live DB fingerprint BEFORE anything touches it) ──
  const liveShaBefore = sha256File(LIVE_DB);
  const liveMtimeBefore = mtimeOf(LIVE_DB);
  say(`[harness] LIVE DB before: sha256=${liveShaBefore ? liveShaBefore.slice(0, 16) + '…' : 'MISSING'} mtimeMs=${liveMtimeBefore}`);
  const { tmpDir } = setupDbCopy(say);

  // ── Load product modules (after NATIVELY_TEST_USERDATA is set) ──────────
  const { DatabaseManager } = require(path.join(distRoot, 'db/DatabaseManager.js'));
  const dbm = DatabaseManager.getInstance();
  const db = dbm.getDb();
  const dbPath = dbm.getDbPath();
  say(`[harness] DB open=${!!db} dbPath=${dbPath}`);
  // HARD ASSERT: the DB we opened is the COPY, not the live file.
  if (!dbPath.startsWith(tmpDir)) { say(`[harness] FATAL: opened DB ${dbPath} is NOT under the copy dir ${tmpDir}`); return finish(2, tmpDir, liveShaBefore, liveMtimeBefore, say, log, outDir); }
  say(`[harness] DB ISOLATION assert: opened DB is under copy dir = ${dbPath.startsWith(tmpDir)}`);

  // Confirm the live mode + good file are present in the copy.
  const files = db.prepare('SELECT id, file_name, LENGTH(content) len FROM mode_reference_files WHERE mode_id=?').all(MODE_ID);
  say(`[harness] mode ${MODE_ID.slice(0, 20)} reference files: ${JSON.stringify(files.map((f) => ({ id: f.id.slice(0, 16), name: f.file_name, len: f.len })))}`);
  const idxRows = db.prepare('SELECT file_id, chunk_count, status, embedding_space FROM mode_reference_index_state').all();
  say(`[harness] index_state: ${JSON.stringify(idxRows.map((r) => ({ id: r.file_id.slice(0, 16), chunks: r.chunk_count, status: r.status, space: r.embedding_space })))}`);

  // ── Resolve + wire the embedder for the HYBRID path ─────────────────────
  const cm = (() => { try { const C = require(path.join(distRoot, 'services/CredentialsManager.js')).CredentialsManager.getInstance(); C.init(); return C; } catch (e) { say(`[harness] cred init err: ${e && e.message}`); return null; } })();
  let geminiFromCred = false;
  try { const k = cm && cm.getGeminiApiKey && cm.getGeminiApiKey(); geminiFromCred = !!k && k.length > 0; } catch { /* ignore */ }
  const geminiKeys = resolveGeminiKeys();
  say(`[harness] key presence: geminiFromCredentials=${geminiFromCred} geminiKeyCount(env/.env)=${geminiKeys.length}`);

  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const ollamaUp = await (async () => {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 2000);
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: ctl.signal }); clearTimeout(to);
      if (!res.ok) return false;
      const j = await res.json();
      return Array.isArray(j.models) && j.models.some((m) => /nomic-embed-text/.test(m.name || m.model || ''));
    } catch { return false; }
  })();
  // The good file's PERSISTED embedding space. To get a PURE index lookup on the
  // hybrid path (persistedHits=all, missingCount=0, no re-embed), the wired
  // embedder's active space MUST MATCH this. If we wire a different provider, the
  // retriever ephemeral-embeds all 200 chunks — and on this machine a Gemini
  // 429-cooldown burst makes that batch time out and fall back to the local ONNX
  // MiniLM worker, which SIGTRAPs. So we MATCH the persisted space.
  const persistedSpace = (() => { try { const r = db.prepare('SELECT embedding_space FROM mode_reference_index_state WHERE file_id=? AND status=?').get(GOOD_FILE, 'ready'); return r && r.embedding_space || null; } catch { return null; } })();
  const persistedIsOllama = /^ollama:/.test(persistedSpace || '');
  say(`[harness] embedder options: gemini(cred=${geminiFromCred},env=${geminiKeys.length > 0}) ollamaNomic=${ollamaUp}  persistedSpace=${persistedSpace}`);

  // Wire an EmbeddingPipeline whose active space MATCHES the persisted index so the
  // hybrid path does a pure index lookup. Preference order:
  //   1. If persisted space is ollama:* and ollama is up → wire Ollama (WITHHOLD
  //      the gemini key so the resolver picks ollama). Matches → 0 re-embeds.
  //   2. Else if a gemini key resolves → wire gemini (matches gemini-embedding-2).
  //   3. Else if ollama is up → wire ollama.
  // Any mismatch still exercises the HYBRID path (it just ephemeral-embeds on the
  // COPY, harmless) — but matching avoids the Gemini-429→local-worker SIGTRAP.
  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const mm = ModesManager.getInstance();
  const wantEmbed = process.env.NATIVELY_LIVE_EMBED !== '0';
  let embedWired = false;
  let embedProvider = 'none';
  let embedSpace = null;
  let sharedEp = null; // hoisted so we can re-assert it on ModesManager before scoring
  if (wantEmbed) {
    try {
      const { VectorStore } = require(path.join(distRoot, 'rag/VectorStore.js'));
      const { EmbeddingPipeline } = require(path.join(distRoot, 'rag/EmbeddingPipeline.js'));
      const vs = new VectorStore(db, dbPath, dbm.getExtPath ? dbm.getExtPath() : '');
      const ep = new EmbeddingPipeline(db, vs);
      const useOllama = (persistedIsOllama && ollamaUp) || (!geminiFromCred && geminiKeys.length === 0 && ollamaUp);
      const geminiKey = useOllama ? '' : ((geminiFromCred && cm.getGeminiApiKey()) || (geminiKeys.length ? geminiKeys[0].value : (process.env.GOOGLE_API_KEY || '')));
      say(`[harness] embedder decision: ${useOllama ? 'Ollama (gemini key withheld to match persisted space / avoid 429→SIGTRAP)' : 'Gemini'}`);
      await ep.initialize({ openaiKey: undefined, geminiKey: geminiKey || undefined, geminiKeys: geminiKey ? [geminiKey] : [], ollamaUrl });
      try { await ep.waitForReady(10000); } catch (e) { say(`[harness] embed waitForReady: ${e && e.message}`); }
      embedProvider = (ep.getActiveProviderName && ep.getActiveProviderName()) || 'unknown';
      embedSpace = (ep.getActiveSpaceKey && ep.getActiveSpaceKey()) || null;
      if (ep.isReady()) { mm.setSharedEmbeddingPipeline(ep); sharedEp = ep; embedWired = true; }
      const spaceMatch = embedSpace && persistedSpace && embedSpace === persistedSpace;
      say(`[harness] embedder wired=${embedWired} ready=${ep.isReady()} provider=${embedProvider} space=${embedSpace} spaceMatchesPersisted=${spaceMatch}`);
      if (!spaceMatch) say(`[harness] WARN: active space (${embedSpace}) != persisted (${persistedSpace}) — hybrid will ephemeral-embed on the COPY (harmless, but slower / risk of embed-provider fallback).`);
    } catch (e) { say(`[harness] embed wiring failed: ${e && e.message}`); }
  } else {
    say(`[harness] NATIVELY_LIVE_EMBED=0 — embedder NOT wired (lexical-only run).`);
  }

  // ── Activate the live Seminar mode (mirror setActiveMode) ───────────────
  mm.setActiveMode(MODE_ID);
  const grounding = mm.getActiveModeDocumentGroundingInfo();
  say(`[harness] active mode grounding: ${JSON.stringify(grounding)}`);
  if (grounding.documentGroundedCustomModeActive !== true) {
    say(`[harness] FATAL: documentGroundedCustomModeActive !== true — the live Seminar mode is not doc-grounded in the copy. Cannot proceed.`);
    return finish(2, tmpDir, liveShaBefore, liveMtimeBefore, say, log, outDir);
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. WIRING PROOF — one probe question through the REAL main-path call.
  // ══════════════════════════════════════════════════════════════════════
  say(`\n[harness] ===== WIRING PROOF (probe question) =====`);
  say(`[harness] probe q: "${PROBE_Q}"`);
  drainTrace(); // clear any startup noise
  capturing = true;
  let probeBlock = '';
  let probeErr = null;
  try {
    // EXACT live main-path call shape (LLMHelper.ts:4310 → ModesManager:1016).
    probeBlock = await mm.buildRetrievedActiveModeContextBlockHybrid(
      PROBE_Q, undefined, undefined, 'lecture_answer', true, undefined, /*allowRerank*/ true,
      { forceDocumentGrounding: true },
    );
  } catch (e) { probeErr = e; }
  const probeTrace = drainTrace();
  capturing = false;

  const probePathInfo = analyzePath(probeTrace);
  const probeFingerprint = parseHybridSelectedTrace(probeTrace);
  const probeSections = sectionsInBlock(probeBlock || '');
  say(`[harness] probe: entry point = mm.buildRetrievedActiveModeContextBlockHybrid('${PROBE_Q}', undefined, undefined, 'lecture_answer', true, undefined, true, {forceDocumentGrounding:true})`);
  say(`[harness] probe: PATH=${probePathInfo.path} tookHybrid=${probePathInfo.tookHybrid} traceFired=${probePathInfo.traceFired}`);
  say(`[harness] probe: block snippetCount=${snippetCount(probeBlock || '')} blockLen=${(probeBlock || '').length} sectionsInBlock=${JSON.stringify(probeSections)}`);
  if (probeErr) say(`[harness] probe THREW: ${probeErr && probeErr.stack || probeErr}`);
  say(`[harness] probe: captured ${probeTrace.length} trace line(s):`);
  for (const l of probeTrace) say(`    ${l}`);

  // ── 3. INDEX FRESHNESS — re-chunk file.content via the retriever's chunker
  //      and compare to persisted mode_reference_chunks. ────────────────────
  say(`\n[harness] ===== INDEX FRESHNESS =====`);
  let indexFresh = { verdict: 'unknown', persistedTotal: null, persistedTagged: null, freshTotal: null, freshTagged: null };
  try {
    const goodFileRow = db.prepare('SELECT id, file_name, content FROM mode_reference_files WHERE id=?').get(GOOD_FILE)
      || db.prepare('SELECT id, file_name, content FROM mode_reference_files WHERE mode_id=? LIMIT 1').get(MODE_ID);
    const persistedTotal = db.prepare('SELECT COUNT(*) c FROM mode_reference_chunks WHERE file_id=?').get(goodFileRow.id).c;
    const persistedTagged = db.prepare("SELECT COUNT(*) c FROM mode_reference_chunks WHERE file_id=? AND text LIKE '[Section %'").get(goodFileRow.id).c;
    // Re-chunk via the SAME code the hybrid retriever uses: DocumentMap chunker.
    const { buildDocumentMap, sectionAwareChunksFromMap, tabularChunks } = require(path.join(distRoot, 'services/modes/DocumentMap.js'));
    const CHUNK_WORDS = 140, CHUNK_OVERLAP = 30;
    const content = String(goodFileRow.content || '').trim();
    let freshChunks = tabularChunks(content);
    if (!freshChunks) { const dm = buildDocumentMap(content); freshChunks = sectionAwareChunksFromMap(dm, CHUNK_WORDS, CHUNK_OVERLAP); }
    const freshTotal = freshChunks ? freshChunks.length : 0;
    const freshTagged = freshChunks ? freshChunks.filter((c) => /^\[Section\s/.test(c)).length : 0;
    const ok = freshTotal === persistedTotal && freshTagged === persistedTagged;
    indexFresh = { verdict: ok ? 'ok' : 'mismatch', persistedTotal, persistedTagged, freshTotal, freshTagged, file: goodFileRow.id.slice(0, 20) };
    say(`[harness] INDEX_FRESH: ${indexFresh.verdict}  persisted(total=${persistedTotal},tagged=${persistedTagged})  re-chunk(total=${freshTotal},tagged=${freshTagged})`);
    say(`[harness] NOTE: no chunker_version marker exists yet (Phase-2 product change) — freshness is approximated by re-chunk count parity.`);
  } catch (e) { say(`[harness] INDEX_FRESH: error — ${e && e.message}`); }

  // Persist the wiring proof doc + the baseline trace log.
  fs.writeFileSync(path.join(outDir, 'raw-trace.log'), probeTrace.join('\n') + '\n');
  writeWiringProof(outDir, { probePathInfo, probeFingerprint, probeSections, probeBlock, probeTrace, embedWired, embedProvider, embedSpace, indexFresh });

  // ── WIRING-ONLY early exit ──────────────────────────────────────────────
  if (WIRING_ONLY) {
    say(`\n[harness] WIRING_ONLY=1 — skipping generation/scoring.`);
    const summaryLine = `WIRING-ONLY, PATH=${probePathInfo.path}, TRACE=${probePathInfo.traceFired ? 'fired' : 'absent'}, INDEX_FRESH=${indexFresh.verdict}`;
    say(`[harness] ${summaryLine}`);
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ mode: 'wiring-only', probePathInfo, probeFingerprint, probeSections, indexFresh, embed: { wired: embedWired, provider: embedProvider, space: embedSpace }, summaryLine }, null, 2));
    fs.writeFileSync(path.join(outDir, 'harness-log.txt'), log.join('\n'));
    return finish(probePathInfo.traceFired ? 0 : 1, tmpDir, liveShaBefore, liveMtimeBefore, say, log, outDir);
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. REGRESSION SCORING — REAL streamChat path (identical to gemini-chat-stream).
  // ══════════════════════════════════════════════════════════════════════
  if (geminiKeys.length === 0) {
    say(`\n[harness] BLOCKER: no GEMINI_API_KEY for generation. Run WIRING_ONLY=1 for the wiring baseline, or supply a key.`);
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ status: 'SKIPPED_NO_GEN_KEY', probePathInfo, indexFresh }, null, 2));
    fs.writeFileSync(path.join(outDir, 'harness-log.txt'), log.join('\n'));
    return finish(0, tmpDir, liveShaBefore, liveMtimeBefore, say, log, outDir);
  }

  const llmMod = require(path.join(distRoot, 'LLMHelper.js'));
  const LLMHelper = llmMod.LLMHelper || llmMod.default;
  const { CHAT_MODE_PROMPT, HARD_SYSTEM_PROMPT } = require(path.join(distRoot, 'llm/prompts.js'));
  // Validator REPLICA pure functions (the ipcHandlers completeness re-ask uses these).
  const { detectIncompleteNumericAnswer, completenessRegenFabricates, extractNumericUnitTokens } = require(path.join(distRoot, 'llm/documentGroundedPrompt.js'));
  const extractNumericFromText = (t) => extractNumericUnitTokens(t || '');
  // The REAL product prompt-assembly functions (identical to what streamChat uses
  // at LLMHelper.ts:4431 + :4560). We call them DIRECTLY, fed with the PROVEN-HYBRID
  // retrieval block from our embedder-wired ModesManager, then dispatch generation
  // via streamChat with skipModeInjection=true. See CRITICAL note below.
  const { shapeDocumentGroundedSystemPrompt, buildDocumentGroundedUserContent } = require(path.join(distRoot, 'llm/documentGroundedPrompt.js'));

  const llm = new LLMHelper();
  let keyIdx = 0;
  llm.setApiKey(geminiKeys[keyIdx].value);
  llm.setModel('gemini-3.1-flash-lite');
  // RE-ASSERT the shared embedding pipeline on the ModesManager singleton. The
  // probe above proved the injection works, but constructing LLMHelper (or its
  // lazy submodule loads) can leave the ModeContextRetriever with a fresh,
  // unready EmbeddingPipeline by the time streamChat's internal retrieval fires
  // (observed: embReady:false / activeSpace:null on the scored path while the
  // probe had embReady:true). Re-injecting here guarantees streamChat's REAL
  // internal retrieval runs on the HYBRID path with the warm embedder. This is
  // harness plumbing only — the real app keeps its pipeline wired for the app's
  // lifetime, so this restores app-faithful behavior rather than altering it.
  if (embedWired && sharedEp) {
    try {
      mm.setSharedEmbeddingPipeline(sharedEp);
      // Warm the hybrid retriever + prove readiness with a throwaway retrieval.
      drainTrace(); capturing = true;
      await mm.buildRetrievedActiveModeContextBlockHybrid('warm up the hybrid retriever', undefined, undefined, 'lecture_answer', true, undefined, true, { forceDocumentGrounding: true });
      const warmTrace = drainTrace(); capturing = false;
      const warmPath = analyzePath(warmTrace);
      say(`[harness] re-asserted shared embedding pipeline before scoring; warm-retrieval PATH=${warmPath.path} tookHybrid=${warmPath.tookHybrid} (ready=${sharedEp.isReady && sharedEp.isReady()})`);
    } catch (e) { capturing = false; say(`[harness] re-assert/warm failed: ${e && e.message}`); }
  }
  say(`[harness] generation backend: Gemini DIRECT model=gemini-3.1-flash-lite keySlot=${geminiKeys[keyIdx].name} (${geminiKeys.length} key(s))`);
  // ══════════════════════════════════════════════════════════════════════
  // CRITICAL ARCHITECTURAL FINDING (harness design decision, documented):
  // dist-electron bundles EACH entry .ts into a SELF-CONTAINED CJS file with
  // esbuild `bundle:true` + per-file outbase. That INLINES a private copy of
  // ModesManager (+ its singleton) into LLMHelper.js — SEPARATE from the copy in
  // services/ModesManager.js. In PRODUCTION only main.js runs, and main.js inlines
  // BOTH LLMHelper and ModesManager into ONE bundle → ONE shared singleton (this
  // is why Phase 0 saw the HYBRID path fire on the live app). But a harness that
  // `require()`s the two dist files gets TWO ModesManager singletons: the one I
  // wire the embedder into (services/ModesManager.js) is NOT the one LLMHelper's
  // internal retrieval reads. So calling streamChat and trusting ITS retrieval
  // scores the LEXICAL fallback (embReady:false, activeSpace:null) while the
  // embedder sits on the other singleton — the exact "score lexical, call it
  // hybrid" trap the mission forbids.
  //
  // FAITHFUL FIX: drive the answer through the SAME product functions the real
  // streamChat path uses — shapeDocumentGroundedSystemPrompt (LLMHelper.ts:4431)
  // + buildDocumentGroundedUserContent (:4560) — fed with the PROVEN-HYBRID
  // retrieval block from OUR embedder-wired ModesManager (services/ModesManager.js,
  // the [FIX2-TRACE] HYBRID path that the wiring proof captured), then dispatch
  // generation via streamChat with skipModeInjection=true so LLMHelper's
  // embedder-less MM copy does NOT re-retrieve and override the block. This
  // exercises: REAL hybrid retrieval + REAL doc-grounded prompt assembly + REAL
  // generation + REAL (replicated) validator — the retrieval ranking (the fix's
  // subject) runs on the genuine HYBRID path. What it does NOT exercise: the exact
  // in-streamChat OKF-card augmentation and the LLMHelper 2000ms hybrid-race
  // fallback logic (irrelevant here — we feed the hybrid block directly).
  say(`[harness] SCORING PATH: real hybrid retrieval (embedder-wired MM) → REAL shapeDocumentGroundedSystemPrompt + buildDocumentGroundedUserContent → streamChat(skipModeInjection=true) → REAL generation. See wiring-harness.js CRITICAL note (2-singleton bundling).`);
  say(`[harness] validator NOTE: the ipcHandlers post-answer completeness/false-refusal re-ask is REPLICATED here (via exported detectIncompleteNumericAnswer/completenessRegenFabricates) — labelled REPLICA.`);

  // Each ask captures its OWN retrieval fingerprint by draining the trace around
  // the streamChat call (streamChat runs the same hybrid retrieval internally).
  async function askOnce(q, priorContext, referentHint) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), PER_Q_TIMEOUT_MS);
    const start = Date.now();
    let ans = ''; let threw = null;
    let retrTrace = [];
    let hybridBlock = '';
    try {
      // STEP 1 — REAL HYBRID RETRIEVAL on our embedder-wired ModesManager. This is
      // the exact main-path call (LLMHelper.ts:4310) and fires the [FIX2-TRACE]
      // HYBRID tags we capture as the fingerprint.
      drainTrace(); capturing = true;
      hybridBlock = await mm.buildRetrievedActiveModeContextBlockHybrid(
        q, priorContext, undefined, 'lecture_answer', true, undefined, /*allowRerank*/ true,
        { forceDocumentGrounding: true, followUpReferentHint: (referentHint || '').trim() || undefined },
      );
      retrTrace = drainTrace(); capturing = false;
      if (process.env.HARNESS_DUMP_TRACE === '1') { origLog(`\n[harness][dump] hybrid-retrieval trace for "${q.slice(0, 40)}":`); for (const l of retrTrace) origLog('    ' + l.slice(0, 200)); }

      // STEP 2 — REAL doc-grounded PROMPT ASSEMBLY (identical to streamChat's own
      // path). shapeDocumentGroundedSystemPrompt(HARD_SYSTEM_PROMPT, true) +
      // buildDocumentGroundedUserContent({question, retrievedBlock: hybridBlock, ...}).
      const sysPrompt = shapeDocumentGroundedSystemPrompt(HARD_SYSTEM_PROMPT, true);
      const userContent = buildDocumentGroundedUserContent({ question: q, retrievedBlock: hybridBlock, priorContext, active: true }) || q;

      // STEP 3 — REAL generation. skipModeInjection=true so LLMHelper's (embedder-
      // less) MM copy does NOT re-retrieve/override our hybrid block. ignoreKnowledge
      // =true to bypass the knowledge intercept (the doc-grounded path disables it
      // anyway). We pass the fully-shaped userContent as the message and the shaped
      // system prompt as the override — mirroring what _streamChatInner produces
      // just before provider dispatch (LLMHelper.ts:4635).
      ans = await collect(llm.streamChat(userContent, undefined, undefined, sysPrompt, true, true, [], ctl.signal));
      ans = (ans || '').trim();

      // ── REPLICA of the ipcHandlers doc-grounded COMPLETENESS re-ask ──────
      // (reason:'incomplete' branch). Uses the SAME exported pure functions as the
      // handler; re-retrieves via the lexical builder EXACTLY as the handler does
      // at ipcHandlers.ts:2252 (the handler's validator re-retrieval is lexical).
      try {
        const refusalLike = ans.length < 120 && /^(?:\s*I could not find|.*\bnot (?:directly )?(?:mentioned|found|present)\b)/i.test(ans) && !/\d[\d,]*(?:\.\d+)?\s?(?:gb|mb|hz|kg|mm|%|dof|steps?|episodes?)/i.test(ans);
        const vBlock = mm.buildRetrievedActiveModeContextBlock(q, undefined, 3600, 'lecture_answer', true, undefined, { forceDocumentGrounding: true }) || '';
        const detect = detectIncompleteNumericAnswer({ question: q, answer: ans, retrievedBlock: vBlock, answerIsRefusal: refusalLike });
        if (detect.incomplete && vBlock) {
          const reaskPrompt = ['You gave a partial answer. The document excerpts below contain ADDITIONAL relevant values you left out.', 'Re-answer the question COMPLETELY, including EVERY value that appears in the excerpts for this question.', `Values present in the excerpts that your previous answer omitted: ${detect.missing.slice(0, 8).join(', ')}.`, 'Include those ONLY if they are genuinely part of the answer — never invent a value not in the excerpts below.', 'Answer in natural sentences (or a short list). Do not restate the question.', '', '## DOCUMENT EXCERPTS', vBlock, '', `QUESTION: ${q}`, '', 'COMPLETE ANSWER (include all applicable values from the excerpts):'].join('\n');
          const ctl2 = new AbortController(); const to2 = setTimeout(() => ctl2.abort(), PER_Q_TIMEOUT_MS);
          let regen = '';
          try { regen = (await collect(llm.streamChat(reaskPrompt, undefined, undefined, undefined, true, true, [], ctl2.signal))).trim(); } catch { /* keep */ } finally { clearTimeout(to2); }
          const regenVals = extractNumericFromText(regen);
          const recoveredMissing = detect.missing.filter((mv) => regenVals.has(mv)).length;
          if (regen.length >= 8 && recoveredMissing >= 1 && !completenessRegenFabricates(regen, vBlock)) ans = regen;
        }
      } catch { /* best-effort */ }
    } catch (e) { threw = e; capturing = false; } finally { clearTimeout(to); }
    // Fingerprint comes from the RETRIEVAL trace (step 1), which is the genuine hybrid path.
    const pathInfo = analyzePath(retrTrace);
    const fp = parseHybridSelectedTrace(retrTrace);
    return { ans: (ans || '').trim(), latency: Date.now() - start, threw, pathInfo, fingerprint: fp, block: hybridBlock, traceLineCount: retrTrace.length };
  }
  async function ask(q, priorContext, referentHint) {
    let r = await askOnce(q, priorContext, referentHint);
    const looksQuota = r.threw || r.ans.length < 8;
    if (looksQuota && keyIdx + 1 < geminiKeys.length) {
      keyIdx += 1; llm.setApiKey(geminiKeys[keyIdx].value);
      say(`[harness]   empty/error → rotated to keySlot=${geminiKeys[keyIdx].name}, retry once`);
      const r2 = await askOnce(q, priorContext, referentHint);
      if (r2.ans.length >= 8 || !r2.threw) return { ...r2, errored: false };
      return { ...r2, errored: true };
    }
    return { ...r, errored: looksQuota };
  }

  const results = []; const latencies = [];
  const excerpt = (t, n = 220) => t.replace(/\s+/g, ' ').trim().slice(0, n);
  // Aggregate PATH across all scored asks so the summary can assert hybrid vs lexical.
  const pathCounts = { hybrid: 0, 'hybrid-fellback-lexical': 0, lexical: 0, unknown: 0 };
  let anyTraceFired = false;
  function record(id, q, section, verdict, notes, ans, latency, extra) {
    latencies.push(latency);
    const fpExtra = extra || {};
    if (fpExtra.pathInfo) { pathCounts[fpExtra.pathInfo.path] = (pathCounts[fpExtra.pathInfo.path] || 0) + 1; if (fpExtra.pathInfo.traceFired) anyTraceFired = true; }
    const rec = { id, section, q, verdict, latency, notes, answerChars: ans.length, excerpt: excerpt(ans), answer: ans, ...fpExtra };
    results.push(rec);
    const p = fpExtra.pathInfo ? fpExtra.pathInfo.path : '-';
    say(`  ${verdict.padEnd(5)} ${id.padEnd(5)} ${latency}ms  PATH=${p}  ${notes.join('; ')}`);
    return rec;
  }
  const want = (id) => !ONLY.length || ONLY.some((o) => id === o || id.startsWith(o));
  // Build a compact fingerprint record from an ask result.
  const fpOf = (r) => ({ pathInfo: r.pathInfo, sectionsSelected: r.fingerprint ? (r.fingerprint.selected || []).map((c) => c.sec) : [], selectedScores: r.fingerprint ? (r.fingerprint.selected || []).map((c) => ({ sec: c.sec, fts: c.fts, vec: c.vec, combined: c.combined, file: c.file })) : [], selectedCount: r.fingerprint ? r.fingerprint.selectedCount : null });

  async function runStandardSection(name, rules, scorer) {
    say(`\n[harness] ── SECTION ${name} ──`);
    for (const rule of rules) {
      if (!want(rule.id)) continue;
      try {
        const r = await ask(rule.q, undefined);
        if (r.errored) { record(rule.id, rule.q, name, 'ERROR', ['quota/empty after rotation', r.threw ? String(r.threw.message || r.threw).slice(0, 80) : 'empty'], r.ans, r.latency, fpOf(r)); continue; }
        const s = scorer(rule, r.ans);
        record(rule.id, rule.q, name, s.verdict, s.notes, r.ans, r.latency, { matched: s.matched, missed: s.missed, ...fpOf(r) });
      } catch (e) { record(rule.id, rule.q, name, 'ERROR', ['harness-throw:' + String(e && e.message).slice(0, 80)], '', 0, {}); }
    }
  }

  await runStandardSection('A', SECTION_A, scoreStandard);

  say('\n[harness] ── SECTION B (pairs) ──');
  for (const pair of SECTION_B) {
    if (!want(pair.id) && !want(pair.a.id) && !want(pair.b.id)) continue;
    try {
      const ra = await ask(pair.a.q, undefined);
      const rb = await ask(pair.b.q, undefined);
      if (ra.errored || rb.errored) { record(pair.id, `${pair.a.q} || ${pair.b.q}`, 'B', 'ERROR', ['quota/empty on a pair member'], (ra.ans || rb.ans), Math.max(ra.latency, rb.latency), fpOf(ra)); continue; }
      const sa = scoreStandard(pair.a, ra.ans); const sb = scoreStandard(pair.b, rb.ans);
      const agreeA = pair.agreeRe.every((re) => re.test(ra.ans) || re.test(normalizeForFactMatch(ra.ans)));
      const agreeB = pair.agreeRe.every((re) => re.test(rb.ans) || re.test(normalizeForFactMatch(rb.ans)));
      const agree = agreeA && agreeB; const bothPass = sa.verdict === 'PASS' && sb.verdict === 'PASS';
      const verdict = (bothPass && agree) ? 'PASS' : 'FAIL';
      const notes = [`a=${sa.verdict}(${sa.notes.join(',')})`, `b=${sb.verdict}(${sb.notes.join(',')})`, `agree=${agree}(a=${agreeA},b=${agreeB} on ${pair.shared})`];
      record(pair.id, `${pair.a.q} || ${pair.b.q}`, 'B', verdict, notes, `[${pair.a.id}] ${ra.ans}\n\n[${pair.b.id}] ${rb.ans}`, ra.latency + rb.latency, { aVerdict: sa.verdict, bVerdict: sb.verdict, agree, aExcerpt: excerpt(ra.ans), bExcerpt: excerpt(rb.ans), aFingerprint: fpOf(ra), bFingerprint: fpOf(rb), pathInfo: ra.pathInfo });
    } catch (e) { record(pair.id, pair.id, 'B', 'ERROR', ['harness-throw:' + String(e && e.message).slice(0, 80)], '', 0, {}); }
  }

  await runStandardSection('C', SECTION_C, scoreStandard);
  await runStandardSection('D', SECTION_D, scoreD);

  say('\n[harness] ── SECTION E (chains) ──');
  for (const chain of SECTION_E) {
    if (!want(chain.id) && !chain.turns.some((_, i) => want(`${chain.id}t${i + 1}`))) continue;
    try {
      const transcript = []; const turnRecs = []; let chainLatency = 0; let anyError = false; let lastPathInfo = null;
      for (let i = 0; i < chain.turns.length; i++) {
        const turn = chain.turns[i];
        const priorSnapshot = transcript.map((it) => `[${it.role === 'ME' ? 'ME' : 'ASSISTANT (PREVIOUS SUGGESTION)'}]: ${it.text}`).join('\n');
        const stripped = stripPriorAssistantTurnsLocal(priorSnapshot);
        const priorContext = i === 0 ? undefined : (stripped.trim().length ? stripped : undefined);
        const referentHint = i === 0 ? undefined : [...transcript].reverse().find((it) => it.role === 'ASSISTANT')?.text;
        const r = await ask(turn.q, priorContext, referentHint);
        chainLatency += r.latency; lastPathInfo = r.pathInfo;
        if (r.errored) { anyError = true; turnRecs.push({ turn: i + 1, q: turn.q, verdict: 'ERROR', ans: r.ans, latency: r.latency, notes: ['quota/empty'], fingerprint: fpOf(r) }); break; }
        transcript.push({ role: 'ME', text: turn.q }); transcript.push({ role: 'ASSISTANT', text: r.ans });
        let tVerdict = 'PASS', tNotes = ['no-check-turn'];
        if (turn.must || turn.mustNot) { const s = scoreStandard(turn, r.ans); tVerdict = s.verdict; tNotes = s.notes; }
        turnRecs.push({ turn: i + 1, q: turn.q, verdict: tVerdict, notes: tNotes, latency: r.latency, excerpt: excerpt(r.ans), answer: r.ans, fingerprint: fpOf(r) });
      }
      let verdict;
      if (anyError) verdict = 'ERROR';
      else if (chain.passAllTurns) verdict = turnRecs.every((t) => t.verdict === 'PASS') ? 'PASS' : 'FAIL';
      else { const gate = turnRecs[chain.passOnTurn]; verdict = gate && gate.verdict === 'PASS' ? 'PASS' : 'FAIL'; }
      const notes = turnRecs.map((t) => `t${t.turn}=${t.verdict}`);
      record(chain.id, chain.turns.map((t) => t.q).join(' → '), 'E', verdict, notes, turnRecs.map((t) => `[t${t.turn}] ${t.answer || t.ans || ''}`).join('\n\n'), chainLatency, { turns: turnRecs, pathInfo: lastPathInfo });
    } catch (e) { record(chain.id, chain.id, 'E', 'ERROR', ['harness-throw:' + String(e && e.message).slice(0, 80)], '', 0, {}); }
  }

  await runStandardSection('F', SECTION_F, scoreF);

  // ── SUMMARY ──────────────────────────────────────────────────────────
  const byV = (v) => results.filter((r) => r.verdict === v).map((r) => r.id);
  const pass = byV('PASS'), fail = byV('FAIL'), weak = byV('WEAK'), error = byV('ERROR');
  const total = results.length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const p95 = sorted.length ? (sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1]) : 0;
  // Dominant path across scored asks.
  const dominantPath = Object.entries(pathCounts).sort((a, b) => b[1] - a[1])[0][0];
  const runValid = anyTraceFired && (dominantPath === 'hybrid');

  const summaryLine = `PASS ${pass.length}/${total}, FAIL [${fail.join(',')}], PATH=${dominantPath}, TRACE=${anyTraceFired ? 'fired' : 'absent'}`;
  say(`\n[harness] ${summaryLine}`);
  say(`[harness] WEAK [${weak.join(',')}], ERROR [${error.join(',')}]`);
  say(`[harness] pathCounts=${JSON.stringify(pathCounts)}  dominantPath=${dominantPath}  RUN_VALID(hybrid+trace)=${runValid}`);
  say(`[harness] latency median=${median}ms p95=${p95}ms`);
  if (!runValid) say(`[harness] *** RUN MARKED INVALID: hybrid trace tags did not dominate (per the mission prove-it rule). ***`);

  const sectionOf = (id) => id[0];
  const sections = {};
  for (const r of results) { const s = sectionOf(r.id); sections[s] = sections[s] || { pass: 0, fail: 0, weak: 0, error: 0, total: 0 }; sections[s].total++; sections[s][r.verdict.toLowerCase()]++; }
  say('[harness] per-section: ' + Object.entries(sections).map(([s, c]) => `${s}=${c.pass}/${c.total}`).join(' '));

  const out = {
    generatedAt: new Date().toISOString(),
    backend: 'gemini-direct/gemini-3.1-flash-lite',
    thesis: 'live Seminar mode reference file (DB copy)',
    documentGroundedCustomModeActive: true,
    embed: { wired: embedWired, provider: embedProvider, space: embedSpace },
    probe: { pathInfo: probePathInfo, sections: probeSections, fingerprint: probeFingerprint },
    indexFresh,
    runValid,
    dominantPath,
    anyTraceFired,
    pathCounts,
    summary: { total, pass: pass.length, fail: fail.length, weak: weak.length, error: error.length, passIds: pass, failIds: fail, weakIds: weak, errorIds: error },
    latency: { medianMs: median, p95Ms: p95 },
    sections,
    results,
    summaryLine,
  };
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(out, null, 2));

  const md = [];
  md.push('# Seminar Fix-2 — Phase-1 Regression Run');
  md.push('');
  md.push(`- Generated: ${out.generatedAt}`);
  md.push(`- Backend: ${out.backend}`);
  md.push(`- Embedder: wired=${embedWired} provider=${embedProvider} space=${embedSpace}`);
  md.push(`- Probe PATH: **${probePathInfo.path}** (tookHybrid=${probePathInfo.tookHybrid}, traceFired=${probePathInfo.traceFired})`);
  md.push(`- Dominant scored PATH: **${dominantPath}**  |  RUN_VALID(hybrid+trace)=**${runValid}**`);
  md.push(`- INDEX_FRESH: ${indexFresh.verdict} (persisted total=${indexFresh.persistedTotal}/tagged=${indexFresh.persistedTagged}; re-chunk total=${indexFresh.freshTotal}/tagged=${indexFresh.freshTagged})`);
  md.push(`- **${summaryLine}**`);
  md.push(`- WEAK [${weak.join(',')}], ERROR [${error.join(',')}]`);
  md.push(`- Latency: median ${median}ms, p95 ${p95}ms`);
  if (!runValid) md.push('- **RUN MARKED INVALID** — hybrid trace tags did not dominate (mission prove-it rule).');
  md.push('');
  md.push('## Per-section');
  md.push('');
  md.push('| Section | Pass | Total |');
  md.push('|---|---|---|');
  for (const [s, c] of Object.entries(sections)) md.push(`| ${s} | ${c.pass} | ${c.total} |`);
  md.push('');
  md.push('## Per-question (with retrieval fingerprint)');
  md.push('');
  md.push('| ID | Verdict | Latency | PATH | Sections selected | Notes | Answer excerpt |');
  md.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const notes = (r.notes || []).join('; ').replace(/\|/g, '\\|').slice(0, 180);
    const ex = (r.excerpt || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160);
    const p = r.pathInfo ? r.pathInfo.path : '-';
    const secs = r.sectionsSelected ? r.sectionsSelected.join(',') : (r.aFingerprint ? (r.aFingerprint.sectionsSelected || []).join(',') : '');
    md.push(`| ${r.id} | ${r.verdict} | ${r.latency}ms | ${p} | ${secs} | ${notes} | ${ex} |`);
  }
  fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n'));
  fs.writeFileSync(path.join(outDir, 'harness-log.txt'), log.join('\n'));
  say(`[harness] wrote results.json + report.md + harness-log.txt + raw-trace.log to ${outDir}`);

  return finish(fail.length === 0 && runValid ? 0 : 1, tmpDir, liveShaBefore, liveMtimeBefore, say, log, outDir);
}

// ── WIRING PROOF DOC ──────────────────────────────────────────────────────
function writeWiringProof(outDir, ctx) {
  const { probePathInfo, probeFingerprint, probeSections, probeBlock, probeTrace, embedWired, embedProvider, embedSpace, indexFresh } = ctx;
  const md = [];
  md.push('# Phase 1 — Wiring Proof (harness path === app path)');
  md.push('');
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push('');
  md.push('## Entry point');
  md.push('');
  md.push('The harness drives the EXACT live main-path retrieval call:');
  md.push('');
  md.push('```');
  md.push(`mm.buildRetrievedActiveModeContextBlockHybrid(`);
  md.push(`  "${PROBE_Q}",`);
  md.push(`  undefined, undefined, 'lecture_answer', true, undefined, /*allowRerank*/ true,`);
  md.push(`  { forceDocumentGrounding: true },`);
  md.push(`)`);
  md.push('```');
  md.push('');
  md.push('This is the identical call shape `LLMHelper._streamChatInner` makes at LLMHelper.ts:4310');
  md.push('(→ `ModesManager.buildRetrievedActiveModeContextBlockHybrid` :1016 → hybrid-first branch :1030');
  md.push('→ `ModeContextRetriever.retrieveHybrid` → `ModeHybridRetriever.retrieve`).');
  md.push('');
  md.push('## Embedder');
  md.push('');
  md.push(`- wired: **${embedWired}**`);
  md.push(`- provider: ${embedProvider}`);
  md.push(`- active space: ${embedSpace}`);
  md.push('');
  md.push('## PATH verdict');
  md.push('');
  const verdict = probePathInfo.path === 'hybrid' ? 'PATH = HYBRID (primary target achieved)'
    : probePathInfo.path === 'hybrid-fellback-lexical' ? 'PATH = HYBRID entered but fell back to LEXICAL (usedFallback) — NOT the primary target'
      : probePathInfo.path === 'lexical' ? 'PATH = LEXICAL (embedder unavailable) — NOT the primary target'
        : 'PATH = UNKNOWN (no trace captured)';
  md.push(`**${verdict}**`);
  md.push('');
  md.push('Assertions:');
  md.push(`- ModesManager hybrid-first branch fired: ${probePathInfo.hybridBranchFired}`);
  md.push(`- hybrid-first branch tookHybrid: **${probePathInfo.tookHybrid}**`);
  md.push(`- HYBRID retrieve() entry fired: ${probePathInfo.hybridEntryFired}`);
  md.push(`- HYBRID doc-grounded selected fired: **${probePathInfo.hybridSelectedFired}**`);
  md.push(`- LEXICAL retrieve() entry fired: ${probePathInfo.lexicalEntryFired}`);
  md.push(`- any trace fired: ${probePathInfo.traceFired}`);
  if (probePathInfo.path !== 'hybrid') {
    md.push('');
    md.push('> **BLOCKER**: the primary target is PATH=HYBRID. This run did NOT achieve it.');
    md.push('> Do not score the lexical path and call it hybrid. See PATH verdict above.');
  }
  md.push('');
  md.push('## Captured log-line SEQUENCE (probe question)');
  md.push('');
  md.push('```');
  if (probeTrace.length === 0) md.push('(no [FIX2-TRACE]/[ModeHybridRetriever]/[ModeContextRetriever] lines captured)');
  for (const l of probeTrace) md.push(l);
  md.push('```');
  md.push('');
  md.push('## Retrieval fingerprint (probe)');
  md.push('');
  md.push(`- sections in returned block: ${JSON.stringify(probeSections)}`);
  md.push(`- block snippet count: ${(probeBlock || '').match(/<snippet>/g)?.length || 0}`);
  if (probeFingerprint && Array.isArray(probeFingerprint.selected)) {
    md.push('');
    md.push('Selected chunks (from `[FIX2-TRACE] HYBRID doc-grounded selected`):');
    md.push('');
    md.push('| sec | fts | vec | combined | file | first80 |');
    md.push('|---|---|---|---|---|---|');
    for (const c of probeFingerprint.selected) md.push(`| ${c.sec} | ${c.fts} | ${c.vec} | ${c.combined} | ${c.file} | ${(c.first80 || '').replace(/\|/g, '\\|')} |`);
  } else {
    md.push('- (no HYBRID doc-grounded selected trace parsed — likely lexical/fallback path)');
  }
  md.push('');
  md.push('## Index freshness');
  md.push('');
  md.push(`- INDEX_FRESH: **${indexFresh.verdict}**`);
  md.push(`- persisted mode_reference_chunks: total=${indexFresh.persistedTotal}, section-tagged=${indexFresh.persistedTagged}`);
  md.push(`- re-chunk (DocumentMap, same code retriever uses): total=${indexFresh.freshTotal}, section-tagged=${indexFresh.freshTagged}`);
  md.push('- NOTE: no `chunker_version` marker exists yet (a Phase-2 product change). Freshness is');
  md.push('  approximated by re-chunk count parity against the persisted rows.');
  md.push('');
  fs.writeFileSync(path.join(outDir, '..', 'PHASE1_WIRING_PROOF.md'), md.join('\n'));
  // Also drop a copy inside the run dir for provenance.
  fs.writeFileSync(path.join(outDir, 'PHASE1_WIRING_PROOF.md'), md.join('\n'));
}

// ── FINISH — verify the live DB is byte-untouched, clean up the copy. ──────
function finish(code, tmpDir, liveShaBefore, liveMtimeBefore, say, log, outDir) {
  try {
    const liveShaAfter = sha256File(LIVE_DB);
    const liveMtimeAfter = mtimeOf(LIVE_DB);
    const untouched = liveShaBefore === liveShaAfter && liveMtimeBefore === liveMtimeAfter;
    const line1 = `[harness] LIVE DB after: sha256=${liveShaAfter ? liveShaAfter.slice(0, 16) + '…' : 'MISSING'} mtimeMs=${liveMtimeAfter}`;
    const line2 = `[harness] LIVE DB UNTOUCHED = ${untouched} (sha match=${liveShaBefore === liveShaAfter}, mtime match=${liveMtimeBefore === liveMtimeAfter})`;
    if (say) { say(line1); say(line2); } else { origLog(line1); origLog(line2); }
    if (log && outDir) { try { fs.writeFileSync(path.join(outDir, 'harness-log.txt'), log.join('\n')); } catch { /* ignore */ } }
    // Write a tiny DB-integrity receipt.
    if (outDir) { try { fs.writeFileSync(path.join(outDir, 'db-integrity.json'), JSON.stringify({ liveDb: LIVE_DB, shaBefore: liveShaBefore, shaAfter: liveShaAfter, mtimeBefore: liveMtimeBefore, mtimeAfter: liveMtimeAfter, untouched }, null, 2)); } catch { /* ignore */ } }
    if (!untouched) { origErr('[harness] *** WARNING: LIVE DB CHANGED — investigate immediately ***'); }
  } catch (e) { origErr('[harness] finish integrity-check error:', e && e.message); }
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  clearTimeout(watchdog);
  process.exit(code);
}

main().catch((e) => { origErr('[harness] FATAL', e && e.stack || e); clearTimeout(watchdog); process.exit(2); });
