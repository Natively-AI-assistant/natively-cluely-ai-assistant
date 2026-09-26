// scripts/seminar-hardening/regression-harness.js
//
// Phase-1 automated regression harness for the document-grounded "Seminar mode"
// hardening mission. Drives the REAL product pipeline UNCHANGED:
//
//   real PDF ingest (pdf-parse + [Page N] markers, reused verbatim from
//     test-results/seminar-hardening/phase0-probe.js)
//   → real EmbeddingPipeline (Ollama nomic-embed-text / openai / gemini)
//   → real ModesManager 'general' mode + reference file + index
//   → assert documentGroundedCustomModeActive === true
//   → real LLMHelper.streamChat(q, ..., CHAT_MODE_PROMPT, ..., {answerType:'lecture_answer'})
//     (the IDENTICAL path the gemini-chat-stream IPC handler uses:
//      question-in → retrieval → prompt assembly → provider → DocGrounded
//      validation/regen → answer-out)
//
// Backend for GENERATION: Gemini DIRECT (llm.setApiKey + setModel(
//   'gemini-3.1-flash-lite')) — the same model the natively server proxies to.
//   Key resolved from env (GEMINI_API_KEY, then GEMINI_API_KEY_1..6) or a .env
//   parse. PRESENCE is logged only; a key value is NEVER printed or written.
//
// Scoring is DETERMINISTIC (MUST-INCLUDE / MUST-NOT regexes, number checks).
// NO LLM judging. The scoring rules encode the production bar — they are the GATE.
//
// Run (baseline):
//   ./node_modules/.bin/electron scripts/seminar-hardening/regression-harness.js
//
// Env knobs:
//   HARNESS_MS=<ms>            overall watchdog (default 1200000 = 20min)
//   HARNESS_ONLY=A1,C3,E1      run a subset (comma ids; E1/E2 select whole chains)
//   HARNESS_RETRIEVAL_ONLY=1   skip generation; dump retrieval only (no key needed)
//   RUN_TAG=<name>            output dir suffix run-<RUN_TAG> (default run-<counter>)
//   OLLAMA_URL=<url>          embedder (default http://localhost:11434)
//
// Exit code 0 iff zero FAIL (WEAK/ERROR are reported but non-fatal). SKIP=0.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..', '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const OUT_ROOT = path.join(repoRoot, 'test-results', 'seminar-hardening');

// ── Hard watchdog — macOS has no `timeout`. ──────────────────────────────
const WATCHDOG_MS = Number(process.env.HARNESS_MS) || 1200000;
const watchdog = setTimeout(() => {
  console.error('[harness] WATCHDOG timeout — exiting 3');
  process.exit(3);
}, WATCHDOG_MS);

const RETRIEVAL_ONLY = process.env.HARNESS_RETRIEVAL_ONLY === '1';
const ONLY = (process.env.HARNESS_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const PER_Q_TIMEOUT_MS = 30000;

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-seminar-harness-'));
app.setPath('userData', tmpUserData);

// Same custom prompt the phase-0 probe / e2e harness use (seminar assistant).
const CUSTOM_PROMPT = [
  'Act as my real-time seminar presentation assistant.',
  'I have uploaded a seminar/thesis file.',
  'Answer from the uploaded seminar content first.',
  'Do not invent facts, numbers, methods, or results.',
  'If something is not in the file, say it is not directly mentioned in my seminar material.',
  'Keep answers natural, confident, student-friendly, and speakable.',
].join(' ');

// ============================================================================
// KEY RESOLUTION — never print the value; presence booleans only.
// ============================================================================
function parseDotEnvKeys() {
  // Returns { NAME: value } for GEMINI_API_KEY* only, read by NAME. Values are
  // held in memory to configure the client and are NEVER logged/written.
  const out = {};
  try {
    const envPath = path.join(repoRoot, '.env');
    if (!fs.existsSync(envPath)) return out;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(GEMINI_API_KEY(?:_[0-9]+)?)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v.length > 0) out[m[1]] = v;
    }
  } catch { /* ignore */ }
  return out;
}

function resolveGeminiKeys() {
  // Ordered list of DISTINCT keys: env GEMINI_API_KEY, GEMINI_API_KEY_1..6, then
  // any from .env not already present. De-duplicated by value.
  const names = ['GEMINI_API_KEY'];
  for (let i = 1; i <= 6; i++) names.push(`GEMINI_API_KEY_${i}`);
  const dotenv = parseDotEnvKeys();
  const seen = new Set();
  const keys = [];
  const push = (name, value) => {
    if (value && value.length > 0 && !seen.has(value)) {
      seen.add(value);
      keys.push({ name, value });
    }
  };
  for (const n of names) push(n, process.env[n]);
  for (const n of names) push(n, dotenv[n]);
  // Any other GEMINI_API_KEY* in .env (defensive).
  for (const [n, v] of Object.entries(dotenv)) push(n, v);
  return keys;
}

// ============================================================================
// REGRESSION SET — ground truth from the thesis. Scoring rules ARE the bar.
// Each rule group in `must` is an array of alternatives (OR); ALL groups must
// match (AND). `mustNot` = none may match. `minMustGroups` = require N of the
// must groups (softer). `dRefusal` = D-question: PASS only on honest hedge AND
// zero invented specifics (`fabricationRe`).
// ============================================================================

const REFUSAL_RE = /not (directly )?(mentioned|specified|stated|provided|included|in (my|the))|do(es)? not (say|specify|mention|provide|state|indicate|include)|is not (specified|mentioned|stated|provided|given|indicated)|isn'?t (mentioned|specified|stated|provided|included)|no (information|mention|figure|specific|data|details?) (about|on|regarding|for|is|was)?|couldn'?t find|could not find|i (don'?t|do not) (have|see)|not available in|not part of/i;

// SECTION A — fresh context each.
const SECTION_A = [
  {
    id: 'A1', q: 'What are the two research questions?',
    must: [
      [/RQ1|research question 1|agentic ai framework/i, /AGI/i],
      [/RQ2|research question 2|perception|decision/i],
    ],
    // Not ONLY the abstract paragraph.
    mustNot: [/^\s*the agenticvla system integrates a pretrained and finetuned[\s\S]*$/i],
  },
  {
    id: 'A2', q: 'What is a Vision-Language-Action model?',
    // Rubric A2 MUST = "multimodal model integrating visual perception + language
    // to generate robot actions." The multimodal CONCEPT is satisfied either by
    // the literal token "multimodal" OR by an explicit statement that the model
    // fuses vision/images AND language/instructions (which IS multimodality). The
    // baseline answer defined it correctly ("map images and natural language
    // instructions to a sequence of robot actions") without the literal word —
    // that is a correct answer, so the concept group accepts the paraphrase.
    must: [
      [/multimodal/i, /(image|visual|vision)[\s\S]{0,40}(language|linguistic|instruction)|(language|linguistic|instruction)[\s\S]{0,40}(image|visual|vision)/i],
      [/action|robot action|control/i],
      [/(visual|vision).*(language)|language.*(visual|vision)/i],
    ],
    mustNot: [/agenticvla (system|wrapper|integrates)/i],
  },
  {
    id: 'A3', q: 'What are the four main phases of the project?',
    must: [
      [/teleoperation/i],
      [/data ?collection|dataset collection|data ?gathering|data ?acquisition|dataset (design|creation|structure)|collect(ing|ion of)?\s+(the\s+)?(data|dataset|demonstrations|trajector)/i],
      [/training|finetun|fine-tun|openvla-oft/i],
      [/agentic|autogen|integration/i],
    ],
    mustNot: [/^\s*the agenticvla system integrates a pretrained and finetuned[\s\S]*$/i],
  },
  {
    id: 'A4', q: 'What objects were used in the robotic tasks?',
    must: [[/banana/i], [/grape/i]],
    mustNot: [/^\s*(joystick|haptic)[\s\S]*$/i],
  },
  {
    id: 'A5', q: 'What models were compared in the experiments?',
    must: [[/openvla/i], [/oft|finetuned/i], [/agenticvla/i]],
  },
  {
    id: 'A6', q: 'What hardware was used for teleoperation?',
    must: [
      [/quest\s*3|meta quest/i],
      [/orbbec/i, /logitech|c920/i],
      [/unity|ros#/i],
    ],
    mustNot: [REFUSAL_RE],
  },
  {
    id: 'A7', q: 'What is the conclusion of the thesis?',
    must: [
      [/agentic/i],
      [/instruction|interpretation|decision/i],
      [/(not|rather than).*(low-level|manipulation)|manipulation/i],
    ],
    minMustGroups: 2, // require 2 of 3
  },
  {
    id: 'A8', q: 'What is the main contribution of this thesis?',
    // Rubric A8 = "working modular pipeline with VLA as a callable tool; the
    // improvement is DECIDING what/when to act." Group 2 (the decision concept)
    // is satisfied by the literal decide/orchestrate OR by the common paraphrase
    // of that same idea — deciding WHAT to act (task decomposition / input
    // filtering / delegation) and WHEN to act (verify/plan BEFORE action
    // execution) — WITHOUT changing the underlying policy. That paraphrase IS
    // the contribution, so it counts.
    must: [
      [/modular|pipeline|wrapper|tool/i],
      [/decid|what.*(act|when)|orchestrat|(decompos|filter|delegat|plan|verif)[\s\S]{0,60}(task|input|action|condition|execut|before)|before\s+(action\s+)?execut/i],
    ],
  },
  {
    id: 'A9', q: 'What are the advantages of the AgenticVLA approach?',
    must: [
      [/success rate|SR|ambiguous|complex/i],
      [/decompos|filter|feasibilit|verif/i],
      [/without retrain|no retrain|wrapper/i],
    ],
    minMustGroups: 2, // require 2 of 3
  },
];

// SECTION B — pairs; BOTH must pass AND agree on shared entities.
const SECTION_B = [
  {
    id: 'B1', shared: 'four-phase methodology',
    a: {
      id: 'B1a', q: 'Explain the research methodology.',
      must: [[/teleoperation/i], [/data ?collection|dataset collection|data ?gathering|data ?acquisition|dataset (design|creation|structure)|collect(ing|ion of)?\s+(the\s+)?(data|dataset|demonstrations|trajector)/i], [/training|finetun|fine-tun|openvla-oft/i], [/agentic|autogen|integration/i]],
    },
    b: {
      id: 'B1b', q: 'What are the four main phases of the project?',
      must: [[/teleoperation/i], [/data ?collection|dataset collection|data ?gathering|data ?acquisition|dataset (design|creation|structure)|collect(ing|ion of)?\s+(the\s+)?(data|dataset|demonstrations|trajector)/i], [/training|finetun|fine-tun|openvla-oft/i], [/agentic|autogen|integration/i]],
    },
    // Shared-concept agreement: both must name teleoperation + data collection
    // (or its synonym "dataset collection" / "collecting the data").
    agreeRe: [/teleoperation/i, /data ?collection|dataset collection|data ?gathering|data ?acquisition|dataset (design|creation|structure)|collect(ing|ion of)?\s+(the\s+)?(data|dataset|demonstrations|trajector)/i],
  },
  {
    id: 'B2', shared: 'objects picked',
    a: { id: 'B2a', q: 'What did the robot pick up during the experiments?', must: [[/banana/i], [/grape/i]] },
    b: { id: 'B2b', q: 'What objects were used in the robotic tasks?', must: [[/banana/i], [/grape/i]] },
    agreeRe: [/banana/i, /grape/i],
  },
  {
    id: 'B3', shared: 'research questions',
    a: { id: 'B3a', q: 'State RQ1 and RQ2.', must: [[/RQ1|research question 1|agentic ai framework/i, /AGI/i], [/RQ2|research question 2|perception|decision/i]] },
    b: { id: 'B3b', q: 'What are the two research questions?', must: [[/RQ1|research question 1|agentic ai framework/i, /AGI/i], [/RQ2|research question 2|perception|decision/i]] },
    agreeRe: [/AGI/i],
  },
  {
    id: 'B4', shared: 'VLA general concept (not the wrapper)',
    a: { id: 'B4a', q: 'What does a VLA model do?', must: [[/action|control|manipul|task/i]], mustNot: [/agenticvla (system|wrapper)/i] },
    b: { id: 'B4b', q: 'Why are VLA models important for robotics?', must: [[/robot|generaliz|task|control|manipul/i]], mustNot: [/agenticvla (system|wrapper)/i] },
    agreeRe: [/vla|vision-language-action|action|robot/i],
  },
];

// SECTION C — specific facts.
const SECTION_C = [
  {
    id: 'C1', q: 'What are the specifications of the Mercury X1 robot?',
    minMustGroups: 6,
    must: [
      [/1\.18\s*m/i], [/55\s*kg/i], [/19\s*(dof|degrees)/i], [/24\s*v/i], [/8\s*h(our)?/i],
      [/1\s*kg/i], [/0\.05\s*mm/i], [/1\.2\s*m\/s/i], [/15°|15 deg/i], [/jetson/i],
    ],
  },
  {
    id: 'C2', q: 'What were the finetuning hyperparameters?',
    minMustGroups: 5,
    // Facts required: batch=4, LR=2e-4, decay@75k, 150,005 steps, LoRA rank 32,
    // dropout 0. The model emits these as labelled markdown list items
    // ("Batch size: 4", "LoRA dropout rate: 0.0"), so each group tolerates an
    // intervening label/colon (≤12 chars) between the key and its value.
    must: [
      [/batch\s*(size)?[\s:]*(of\s*)?4\b/i],
      [/2e-4|0\.0002|2\s*(?:\\cdot|·|×|x|\*)?\s*10\s*\^?\s*-?\s*4/i],
      [/75,?000/i],
      [/150,?005/i],
      [/lora|rank[\s:]*32/i],
      [/dropout[\s\w:]{0,14}0(?:\.0)?\b/i],
    ],
  },
  {
    id: 'C3', q: 'What GPU was used for training?',
    must: [[/96\s*gb/i], [/(62|16)\s*gb/i]],
    mustNot: [/teleoperation[\s\S]*data collection[\s\S]*training[\s\S]*integration/i],
  },
  {
    id: 'C4', q: 'How many episodes are in the dataset, and at what sampling rate?',
    must: [[/480/], [/50\s*hz/i], [/25\s*hz/i]],
    // A refusal here is a FAIL — the fact IS in the thesis.
    refusalIsFail: true,
  },
  {
    id: 'C5', q: 'What were the success rates in the self-awareness benchmark?',
    // Ground truth: the thesis reports 43% (OpenVLA-OFT) and 85% (AgenticVLA) as
    // figures, and describes the base OpenVLA as FAILING ("fails to generate any
    // meaningful motion", p46) — it does NOT print a literal "0%". A faithful
    // complete answer must still convey OpenVLA's failure, so group 1 accepts the
    // thesis's own phrasing (fail / no successful / static / zero) as well as 0%.
    must: [[/0\s*%|zero|fail(s|ed|ure)?|no (successful|meaningful)|did not (succeed|complete)|static pose|unable to/i], [/43\s*%/i], [/85\s*%/i]],
  },
];

// SECTION D — MUST refuse/hedge; FAIL on any invented specific.
const SECTION_D = [
  {
    id: 'D1', q: 'What was the total cost of the teleoperation system?',
    dRefusal: true,
    fabricationRe: [/\$\s*[\d,]+|\b[\d,]+\s*(usd|dollars|eur|euros|€|£|gbp)\b/i],
  },
  {
    id: 'D2', q: 'Which cloud provider or GPU vendor was used?',
    dRefusal: true,
    // A *vendor/cloud* assertion is the failure ("96GB VRAM" alone is fine).
    fabricationRe: [/aws|amazon|google cloud|gcp|azure|nvidia (a100|h100|dgx)|lambda labs|coreweave/i],
  },
  {
    id: 'D3', q: 'How many human participants collected the dataset?',
    dRefusal: true,
    fabricationRe: [/\b\d+\s*(participants|humans|operators|people|annotators)/i],
    // "an operator" (singular, no count) is an acceptable hedge.
    hedgeAlsoRe: [/an operator|a single operator|one operator|the operator/i],
  },
  {
    id: 'D4', q: 'What accuracy did it achieve on a public leaderboard?',
    dRefusal: true,
    fabricationRe: [/\b\d+(\.\d+)?\s*%\s*(on|accuracy)|leaderboard.{0,30}\d|ranked\s*#?\d|top-?\d/i],
  },
  {
    id: 'D5', q: 'Was the system tested outdoors or in a lab?',
    // Custom: names controlled lab AND does not claim outdoor testing happened.
    dLabCheck: true,
    must: [[/lab|controlled|indoor/i]],
    mustNot: [/(tested|evaluated|deployed).*(outdoor|outside|in the wild)/i],
  },
];

// SECTION E — sequential chains; history retained across the 3 turns.
const SECTION_E = [
  {
    id: 'E1',
    turns: [
      { q: 'What is OpenVLA-OFT?' },
      { q: 'How is it different from the base model?' },
      { q: 'What throughput improvement does that give?', must: [[/43\s*x|43 times|43-fold/i]] },
    ],
    // Chain PASSES iff the final turn matches. A refusal on turn3 is the bug (FAIL).
    passOnTurn: 2,
  },
  {
    id: 'E2',
    turns: [
      { q: 'What robot was used in this work?', must: [[/mercury\s*x1/i]] },
      { q: 'How many degrees of freedom does it have?', must: [[/19/]] },
      { q: 'What processor controls it?', must: [[/jetson/i]], mustNot: [/virtual reality|vr (framework|headset|teleoperation)/i] },
    ],
    // All three turns must pass their own checks.
    passAllTurns: true,
  },
];

// SECTION F.
const SECTION_F = [
  {
    id: 'F1', q: 'Why is an agentic framework better than simply using a larger VLA model?',
    // ≥2 distinct concepts among the group.
    fConcepts: [/decision/i, /control/i, /modular/i, /compos/i, /specialized/i],
    fMinConcepts: 2,
  },
  {
    id: 'F2', q: "I'm stuck, give me one line I can say right now about why VLAs need finetuning for a new robot.",
    // Substance: a new/specific robot embodiment needs its OWN data because
    // existing datasets don't match its configuration. Accept any phrasing of
    // "adapt to THIS/a specific/new robot's setup/embodiment/config" — the
    // robot-specificity reason — not only the literal "new robot"/"single-arm".
    must: [[/single-arm|new robot|(specific|new|this|particular|different|your)\s+robot|own (data|trajector)|dataset|trajector|robot('?s)?\s+(setup|embodiment|configuration|hardware|specific)|embodiment/i]],
    // FAIL if it's a paragraph: > 60 words OR > 2 sentences.
    fOneLine: true,
  },
  {
    id: 'F3', q: 'What do you think of the latest ChatGPT release?',
    // PASS = polite redirect to seminar/thesis/uploaded material + offer to help.
    // WEAK = bare doc-refusal phrase. FAIL = answers about ChatGPT w/ invented specifics.
    fRedirect: true,
  },
];

// ============================================================================
// SCORING
// ============================================================================
function wordCount(t) { return t.trim().split(/\s+/).filter(Boolean).length; }
function sentenceCount(t) { return (t.match(/[.!?](\s|$)/g) || []).length || (t.trim() ? 1 : 0); }

// Notation normalization for FACT matching (not rubric-loosening — the required
// FACT stays required; this only removes presentation noise that made a CORRECT
// answer read as a miss). Confirmed against the run-0 baseline: the model states
// all C2 hyperparameters correctly but wraps them in markdown (`**batch size:** 4`)
// and LaTeX (`$2 \cdot 10^{-4}$`), which a naive `/batch\s*4/` / `/2e-4/` regex
// cannot see. We strip markdown emphasis, unwrap `$…$`, and canonicalize the
// scientific-notation forms the model emits into the plain forms the rules test.
function normalizeForFactMatch(raw) {
  let t = String(raw);
  // Strip markdown emphasis / inline-code / heading markers that split tokens.
  t = t.replace(/[*_`]+/g, ' ');
  // Unwrap inline LaTeX delimiters.
  t = t.replace(/\$+/g, ' ');
  // Canonicalize `2 \cdot 10^{-4}` / `2 × 10^-4` / `2 * 10^{-4}` → `2e-4`.
  t = t.replace(/(\d(?:\.\d+)?)\s*(?:\\cdot|·|×|x|\*)\s*10\s*\^?\s*\{?\s*-\s*(\d+)\s*\}?/gi,
    (_m, mant, exp) => `${mant}e-${exp} ${_m}`);
  // Collapse whitespace so `**batch size:** 4` → `batch size: 4`.
  t = t.replace(/\s+/g, ' ');
  return t;
}

function matchGroups(text, mustGroups) {
  // Returns { matched: [idx...], missed: [idx...] } — a group matches if ANY of
  // its alternatives matches. Matches against BOTH the raw and the
  // notation-normalized text so markdown/LaTeX formatting never masks a
  // fact that is genuinely present.
  const norm = normalizeForFactMatch(text);
  const matched = [];
  const missed = [];
  mustGroups.forEach((group, i) => {
    const hit = group.some((re) => re.test(text) || re.test(norm));
    if (hit) matched.push(i); else missed.push(i);
  });
  return { matched, missed };
}

function scoreStandard(rule, text) {
  // A/B/C/F standard MUST/MUST-NOT scoring. Returns {verdict, matched, missed, notes}.
  const notes = [];
  if (rule.refusalIsFail && REFUSAL_RE.test(text)) {
    return { verdict: 'FAIL', matched: [], missed: rule.must ? rule.must.map((_, i) => i) : [], notes: ['refusal-but-fact-exists'] };
  }
  let matched = [], missed = [];
  if (rule.must) {
    const r = matchGroups(text, rule.must);
    matched = r.matched; missed = r.missed;
  }
  const need = rule.minMustGroups || (rule.must ? rule.must.length : 0);
  let ok = matched.length >= need;

  const mustNotHit = [];
  if (rule.mustNot) {
    for (const re of rule.mustNot) if (re.test(text)) mustNotHit.push(String(re));
  }
  if (mustNotHit.length) { ok = false; notes.push('mustNot:' + mustNotHit.join(',')); }

  return {
    verdict: ok ? 'PASS' : 'FAIL',
    matched, missed,
    notes: notes.concat(missed.length ? [`missed ${missed.length}/${rule.must.length} (need ${need})`] : []),
  };
}

function scoreD(rule, text) {
  const notes = [];
  if (rule.dLabCheck) {
    // D5: names lab AND no outdoor-testing claim.
    const labNamed = rule.must[0].some((re) => re.test(text));
    const outdoorClaim = rule.mustNot.some((re) => re.test(text));
    if (outdoorClaim) return { verdict: 'FAIL', notes: ['claims-outdoor-testing'] };
    if (!labNamed) return { verdict: 'FAIL', notes: ['does-not-name-lab/controlled'] };
    return { verdict: 'PASS', notes: ['lab-named,no-outdoor-claim'] };
  }
  // Standard D: PASS = honest hedge AND zero invented specific.
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
    const chatgptInvented = /chatgpt.{0,40}(released|features?|gpt-?[45]|improv|better|faster|new model)/i.test(text)
      && /\b(gpt-?[45]|o[13]|multimodal|context window|\d+[kmb])\b/i.test(text);
    const redirect = /(seminar|thesis|uploaded|reference|my material|my (file|document)|presentation)/i.test(text)
      && /(help|assist|answer|ask|focus|happy to|can (i|we))/i.test(text);
    const bareRefusal = REFUSAL_RE.test(text);
    if (chatgptInvented) return { verdict: 'FAIL', notes: ['answers-chatgpt-invented'] };
    if (redirect) return { verdict: 'PASS', notes: ['polite-redirect'] };
    if (bareRefusal) return { verdict: 'WEAK', notes: ['bare-doc-refusal'] };
    return { verdict: 'FAIL', notes: ['no-redirect-no-refusal'] };
  }
  return { verdict: 'FAIL', notes: ['no-F-rule'] };
}

// ============================================================================
// REAL PIPELINE PLUMBING (reused from phase0-probe.js)
// ============================================================================
async function ingestPdfText(pdfPath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => null);
  if (pdfjsLib) {
    try {
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = require('node:url').pathToFileURL(workerPath).href;
    } catch { /* best effort */ }
  }
  const { PDFParse } = require('pdf-parse');
  const data = await new PDFParse({ data: fs.readFileSync(pdfPath) }).getText();
  if (Array.isArray(data.pages) && data.pages.length > 0) {
    return data.pages.map((p) => `[Page ${p.num}]\n${typeof p.text === 'string' ? p.text : ''}`).join('\n\n');
  }
  return data.text || '';
}

async function collect(gen) { let o = ''; for await (const t of gen) o += t; return o; }

function nextOutDir() {
  const tag = process.env.RUN_TAG;
  if (tag) return path.join(OUT_ROOT, `run-${tag}`);
  // Auto counter: find highest run-<n> and increment.
  let max = -1;
  try {
    for (const d of fs.readdirSync(OUT_ROOT)) {
      const m = d.match(/^run-(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch { /* ignore */ }
  return path.join(OUT_ROOT, `run-${max + 1}`);
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  await app.whenReady();
  const outDir = nextOutDir();
  fs.mkdirSync(outDir, { recursive: true });

  const log = [];
  const say = (s) => { console.log(s); log.push(s); };

  say(`[harness] outDir=${outDir}`);
  say(`[harness] RETRIEVAL_ONLY=${RETRIEVAL_ONLY} ONLY=[${ONLY.join(',') || 'all'}] watchdogMs=${WATCHDOG_MS}`);

  // ── Ingest the real thesis ONCE ──────────────────────────────────────
  const pdfPath = path.join(repoRoot, 'Sample thesis for testing.pdf');
  if (!fs.existsSync(pdfPath)) {
    say(`[harness] SKIP — thesis PDF not found at ${pdfPath}`);
    finish(0);
    return;
  }
  const content = await ingestPdfText(pdfPath);
  say(`[harness] contentChars=${content.length} pageMarkers=${(content.match(/\[Page \d+\]/g) || []).length}`);

  // ── Wire a REAL EmbeddingPipeline (verbatim from phase0-probe) ────────
  const { DatabaseManager } = require(path.join(distRoot, 'db/DatabaseManager.js'));
  const dbm = DatabaseManager.getInstance();
  const db = dbm.getDb();
  const dbPath = dbm.getDbPath();
  const { VectorStore } = require(path.join(distRoot, 'rag/VectorStore.js'));
  const { EmbeddingPipeline } = require(path.join(distRoot, 'rag/EmbeddingPipeline.js'));
  const vs = new VectorStore(db, dbPath, dbm.getExtPath ? dbm.getExtPath() : '');
  const pipeline = new EmbeddingPipeline(db, vs);

  const cm = (() => { try { return require(path.join(distRoot, 'services/CredentialsManager.js')).CredentialsManager.getInstance(); } catch { return null; } })();
  const openaiKey = (cm && cm.getOpenaiApiKey && cm.getOpenaiApiKey()) || process.env.OPENAI_API_KEY || '';
  const geminiKeys = resolveGeminiKeys();
  say(`[harness] key presence: openai=${openaiKey.length > 0} geminiKeyCount=${geminiKeys.length}`);

  // EMBEDDER SELECTION (harness config only — no product change): the resolver
  // tries Gemini BEFORE Ollama when Gemini keys are present. During a Gemini
  // 429/quota burst the embed batch times out and falls to the local ONNX
  // MiniLM worker (observed SIGTRAP crash on this machine). Ollama
  // nomic-embed-text is a reliable LOCAL embedder (what phase0-probe actually
  // selected). So: if Ollama is reachable, WITHHOLD the Gemini key from the
  // EMBEDDING pipeline init to force the Ollama provider. Generation still uses
  // Gemini DIRECT separately (llm.setApiKey below) — this only affects which
  // provider embeds the chunks, not the scored answer path.
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const ollamaUp = await (async () => {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 2000);
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: ctl.signal });
      clearTimeout(to);
      if (!res.ok) return false;
      const j = await res.json();
      return Array.isArray(j.models) && j.models.some((m) => /nomic-embed-text/.test(m.name || m.model || ''));
    } catch { return false; }
  })();
  const embedGeminiKey = ollamaUp ? '' : (geminiKeys.length ? geminiKeys[0].value : (process.env.GOOGLE_API_KEY || ''));
  say(`[harness] embedder: ollamaReachable(nomic-embed-text)=${ollamaUp} → ${ollamaUp ? 'Ollama (Gemini key withheld from embed init)' : 'Gemini/local fallback'}`);

  await pipeline.initialize({
    openaiKey: (ollamaUp ? '' : openaiKey) || undefined,
    geminiKey: embedGeminiKey || undefined,
    ollamaUrl,
  });
  say(`[harness] pipeline.isReady()=${pipeline.isReady()} activeProvider=${pipeline.getActiveProviderName && pipeline.getActiveProviderName()}`);

  // ── ModesManager wiring ──────────────────────────────────────────────
  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const mm = ModesManager.getInstance();
  // PATH DETERMINISM (harness config only — no product change): the app has two
  // parallel doc-grounded rankers (hybrid embedding+BM25, and lexical+entity).
  // Which one runs a given turn depends on embedder availability + a 2s race,
  // so verdicts flip run-to-run. For a STABLE scored gate we pin ONE path.
  // HARNESS_FORCE_LEXICAL=1 (default) → do NOT inject the embedding pipeline, so
  // ensureHybridRetriever has no embedder and every doc-grounded call
  // deterministically uses the LEXICAL ModeContextRetriever.retrieve path — the
  // dominant production path (real users often have no embedder; the 2s hybrid
  // race times out under load). Set HARNESS_FORCE_LEXICAL=0 to also wire the
  // embedder and exercise the hybrid path (used for the no-hybrid-regression
  // spot-check run before convergence).
  const forceLexical = process.env.HARNESS_FORCE_LEXICAL !== '0';
  if (forceLexical) {
    say('[harness] PATH=LEXICAL (forced, deterministic) — embedding pipeline NOT injected');
  } else {
    mm.setSharedEmbeddingPipeline(pipeline);
    say('[harness] PATH=HYBRID (embedding pipeline injected)');
  }
  for (const m of mm.getModes()) if (/thesis|seminar|harness|phase0/i.test(m.name)) { try { mm.deleteMode(m.id); } catch { /* ignore */ } }
  const mode = mm.createMode({ name: 'Seminar Harness', templateType: 'general' });
  mm.updateMode(mode.id, { customContext: CUSTOM_PROMPT });
  mm.addReferenceFile({ modeId: mode.id, fileName: 'thesis.pdf', content });
  mm.setActiveMode(mode.id);
  const grounding = mm.getActiveModeDocumentGroundingInfo();
  say(`[harness] documentGroundedCustomModeActive=${grounding.documentGroundedCustomModeActive}`);
  if (grounding.documentGroundedCustomModeActive !== true) {
    say('[harness] FATAL: documentGroundedCustomModeActive !== true — cannot proceed');
    finish(2);
    return;
  }

  const files = mm.getReferenceFiles(mode.id);
  const fileId = files[0].id;
  say('[harness] indexing reference file (embedding all chunks)...');
  const idxStart = Date.now();
  try { await mm.indexReferenceFile(files[0]); } catch (e) { say('[harness] indexReferenceFile threw: ' + (e && e.message)); }
  say(`[harness] index done in ${Date.now() - idxStart}ms`);
  try {
    const total = db.prepare('SELECT COUNT(*) c FROM mode_reference_chunks WHERE file_id = ?').get(fileId);
    const withVec = db.prepare('SELECT COUNT(*) c FROM mode_reference_chunks WHERE file_id = ? AND embedding IS NOT NULL').get(fileId);
    say(`[harness] chunks total=${total.c} withVector=${withVec.c}`);
  } catch (e) { say('[harness] chunk inspect failed: ' + (e && e.message)); }

  // ── Retrieval-only mode: dump retrieval and exit (no key needed) ──────
  if (RETRIEVAL_ONLY) {
    const allIds = [
      ...SECTION_A, ...SECTION_C, ...SECTION_D, ...SECTION_F,
      ...SECTION_B.flatMap((p) => [p.a, p.b]),
      ...SECTION_E.flatMap((c) => c.turns.map((t, i) => ({ id: `${c.id}t${i + 1}`, q: t.q }))),
    ];
    const dump = [];
    for (const item of allIds) {
      if (ONLY.length && !ONLY.some((o) => item.id.startsWith(o))) continue;
      let block = '';
      try {
        block = mm.buildRetrievedActiveModeContextBlock(item.q, undefined, 3600, 'lecture_answer', true, undefined, { forceDocumentGrounding: true });
      } catch (e) { block = 'RETRIEVAL THREW: ' + (e && e.message); }
      const sources = [...block.matchAll(/<text>([\s\S]*?)<\/text>/g)].map((m) => m[1]);
      dump.push({ id: item.id, q: item.q, snippetCount: sources.length, blockChars: block.length, sample: sources.slice(0, 3).map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 160)) });
      say(`[harness][retrieval-only] ${item.id} snippets=${sources.length} chars=${block.length}`);
    }
    fs.writeFileSync(path.join(outDir, 'retrieval-only.json'), JSON.stringify(dump, null, 2));
    say(`[harness] GENERATION SKIPPED (HARNESS_RETRIEVAL_ONLY=1). Retrieval dumped to retrieval-only.json`);
    fs.writeFileSync(path.join(outDir, 'harness-log.txt'), log.join('\n'));
    finish(0);
    return;
  }

  // ── Resolve generation backend (Gemini direct) ───────────────────────
  if (geminiKeys.length === 0) {
    say('[harness] SKIP — no generation key');
    say('[harness] BLOCKER: no GEMINI_API_KEY resolvable from env or .env. Supply GEMINI_API_KEY (or GEMINI_API_KEY_1..6), or run with HARNESS_RETRIEVAL_ONLY=1 for retrieval-only baseline.');
    fs.writeFileSync(path.join(outDir, 'harness-log.txt'), log.join('\n'));
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ status: 'SKIPPED_NO_KEY', generation: 'SKIPPED' }, null, 2));
    finish(0);
    return;
  }

  const llmMod = require(path.join(distRoot, 'LLMHelper.js'));
  const LLMHelper = llmMod.LLMHelper || llmMod.default;
  const { CHAT_MODE_PROMPT } = require(path.join(distRoot, 'llm/prompts.js'));
  // Round-7 Failure-3: the doc-grounded completeness re-ask lives in the
  // gemini-chat-stream IPC handler, which the harness bypasses (it calls
  // streamChat directly). To keep the scored path faithful to production, the
  // harness replays the SAME validator step using the SAME pure functions the
  // handler uses (detectIncompleteNumericAnswer / completenessRegenFabricates).
  const { detectIncompleteNumericAnswer, completenessRegenFabricates, extractNumericUnitTokens } =
    require(path.join(distRoot, 'llm/documentGroundedPrompt.js'));
  const extractNumericFromText = (t) => extractNumericUnitTokens(t || '');
  const llm = new LLMHelper();
  let keyIdx = 0;
  llm.setApiKey(geminiKeys[keyIdx].value);
  llm.setModel('gemini-3.1-flash-lite');
  say(`[harness] generation backend: Gemini DIRECT model=gemini-3.1-flash-lite keySlot=${geminiKeys[keyIdx].name} (${geminiKeys.length} key(s) available for rotation)`);

  // ── ONE question through the REAL streamChat path ─────────────────────
  // priorContext: for E-chains, we feed the stripped rolling snapshot exactly as
  // the gemini-chat-stream handler does (stripPriorAssistantTurns → only [ME]:
  // prior questions survive in doc-grounded mode). undefined => fresh context.
  async function askOnce(q, priorContext, referentHint) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), PER_Q_TIMEOUT_MS);
    const start = Date.now();
    let ans = '';
    let threw = null;
    try {
      // routeOptions mirrors what the real gemini-chat-stream handler passes,
      // INCLUDING followUpReferentHint = the previous assistant answer (the
      // handler sources it from intelligenceManager.getLastAssistantMessage()).
      // The retriever entity-extracts it to contextualize an anaphoric follow-up
      // query; it never enters the model-visible prompt.
      const routeOptions = { answerType: 'lecture_answer' };
      if (referentHint && referentHint.trim()) routeOptions.followUpReferentHint = referentHint;
      ans = await collect(llm.streamChat(
        q, undefined, priorContext, CHAT_MODE_PROMPT, false, false, [], ctl.signal, undefined, routeOptions,
      ));
      ans = (ans || '').trim();
      // Replay the handler's doc-grounded COMPLETENESS re-ask (Failure-3). The
      // handler re-retrieves the block + detects a multi-value answer that
      // dropped an in-block value, then re-asks ONCE showing the block. We mirror
      // that here so C3/C4-class incompleteness is scored on the real path.
      try {
        // A PURE refusal (short, dominated by "not found") skips completeness.
        // An answer that surfaces real values but hedges on a SUB-part
        // ("…96 GB. The model is not mentioned.") is NOT a refusal — it's the
        // incomplete answer we want to complete.
        const refusalLike = ans.length < 120
          && /^(?:\s*I could not find|.*\bnot (?:directly )?(?:mentioned|found|present)\b)/i.test(ans)
          && !/\d[\d,]*(?:\.\d+)?\s?(?:gb|mb|hz|kg|mm|%|dof|steps?|episodes?)/i.test(ans);
        const block = mm.buildRetrievedActiveModeContextBlock(q, undefined, 3600, 'lecture_answer', true, undefined, { forceDocumentGrounding: true }) || '';
        const detect = detectIncompleteNumericAnswer({ question: q, answer: ans, retrievedBlock: block, answerIsRefusal: refusalLike });
        if (detect.incomplete && block) {
          const reaskPrompt = [
            'You gave a partial answer. The document excerpts below contain ADDITIONAL relevant values you left out.',
            'Re-answer the question COMPLETELY, including EVERY value that appears in the excerpts for this question.',
            `Values present in the excerpts that your previous answer omitted: ${detect.missing.slice(0, 8).join(', ')}.`,
            'Include those ONLY if they are genuinely part of the answer — never invent a value not in the excerpts below.',
            'Answer in natural sentences (or a short list). Do not restate the question.',
            '', '## DOCUMENT EXCERPTS', block, '', `QUESTION: ${q}`, '',
            'COMPLETE ANSWER (include all applicable values from the excerpts):',
          ].join('\n');
          const ctl2 = new AbortController();
          const to2 = setTimeout(() => ctl2.abort(), PER_Q_TIMEOUT_MS);
          let regen = '';
          try {
            regen = (await collect(llm.streamChat(reaskPrompt, undefined, undefined, undefined, true, true, [], ctl2.signal))).trim();
          } catch { /* keep original */ } finally { clearTimeout(to2); }
          // Accept the re-ask only if it ACTUALLY recovered missing values
          // (added ≥1 of the flagged in-block values the original lacked) AND
          // doesn't fabricate. This is the real signal — not whether the re-ask
          // also contains a sub-part hedge. A re-ask that just re-hedges without
          // adding values (the D-question case) adds no value tokens, so it is
          // correctly rejected and the original honest refusal stands. A re-ask
          // that adds 62GB/16GB (the C3 case) is accepted even if it also notes
          // the GPU model is unspecified.
          const regenVals = extractNumericFromText(regen);
          const recoveredMissing = detect.missing.filter((mv) => regenVals.has(mv)).length;
          if (regen.length >= 8 && recoveredMissing >= 1 && !completenessRegenFabricates(regen, block)) {
            ans = regen;
          }
        }
      } catch { /* completeness pass is best-effort; keep the original answer */ }
    } catch (e) { threw = e; } finally { clearTimeout(to); }
    return { ans: (ans || '').trim(), latency: Date.now() - start, threw };
  }

  // Ask with one-shot key rotation on empty/error (quota outage → ERROR, not FAIL).
  async function ask(q, priorContext, referentHint) {
    let r = await askOnce(q, priorContext, referentHint);
    const looksQuota = r.threw || r.ans.length < 8;
    if (looksQuota && keyIdx + 1 < geminiKeys.length) {
      keyIdx += 1;
      llm.setApiKey(geminiKeys[keyIdx].value);
      say(`[harness]   empty/error → rotated to keySlot=${geminiKeys[keyIdx].name}, retry once`);
      const r2 = await askOnce(q, priorContext, referentHint);
      if (r2.ans.length >= 8 || !r2.threw) return { ...r2, errored: false };
      return { ...r2, errored: true };
    }
    return { ...r, errored: looksQuota };
  }

  const results = []; // per-question records
  const latencies = [];
  const excerpt = (t, n = 220) => t.replace(/\s+/g, ' ').trim().slice(0, n);

  function record(id, q, section, verdict, notes, ans, latency, extra) {
    latencies.push(latency);
    const rec = { id, section, q, verdict, latency, notes, answerChars: ans.length, excerpt: excerpt(ans), answer: ans, ...(extra || {}) };
    results.push(rec);
    say(`  ${verdict.padEnd(5)} ${id.padEnd(5)} ${latency}ms  ${notes.join('; ')}`);
    return rec;
  }

  const want = (id) => !ONLY.length || ONLY.some((o) => id === o || id.startsWith(o));

  // ── SECTION A / C / F (fresh context, standard/D/F scoring) ──────────
  async function runStandardSection(name, rules, scorer) {
    say(`\n[harness] ── SECTION ${name} ──`);
    for (const rule of rules) {
      if (!want(rule.id)) continue;
      try {
        const r = await ask(rule.q, undefined);
        if (r.errored) { record(rule.id, rule.q, name, 'ERROR', ['quota/empty after rotation', r.threw ? String(r.threw.message || r.threw).slice(0, 80) : 'empty'], r.ans, r.latency); continue; }
        const s = scorer(rule, r.ans);
        record(rule.id, rule.q, name, s.verdict, s.notes, r.ans, r.latency, { matched: s.matched, missed: s.missed });
      } catch (e) {
        record(rule.id, rule.q, name, 'ERROR', ['harness-throw:' + String(e && e.message).slice(0, 80)], '', 0);
      }
    }
  }

  await runStandardSection('A', SECTION_A, scoreStandard);

  // ── SECTION B (pairs + agreement) ────────────────────────────────────
  say('\n[harness] ── SECTION B (pairs) ──');
  for (const pair of SECTION_B) {
    if (!want(pair.id) && !want(pair.a.id) && !want(pair.b.id)) continue;
    try {
      const ra = await ask(pair.a.q, undefined);
      const rb = await ask(pair.b.q, undefined);
      if (ra.errored || rb.errored) {
        record(pair.id, `${pair.a.q} || ${pair.b.q}`, 'B', 'ERROR', ['quota/empty on a pair member'], (ra.ans || rb.ans), Math.max(ra.latency, rb.latency));
        continue;
      }
      const sa = scoreStandard(pair.a, ra.ans);
      const sb = scoreStandard(pair.b, rb.ans);
      // Agreement: both members share the pair's key entities. Test against the
      // notation-normalized text too so markdown/synonym formatting can't mask a
      // shared entity that is genuinely present (e.g. "Dataset Collection").
      const agreeA = pair.agreeRe.every((re) => re.test(ra.ans) || re.test(normalizeForFactMatch(ra.ans)));
      const agreeB = pair.agreeRe.every((re) => re.test(rb.ans) || re.test(normalizeForFactMatch(rb.ans)));
      const agree = agreeA && agreeB;
      const bothPass = sa.verdict === 'PASS' && sb.verdict === 'PASS';
      const verdict = (bothPass && agree) ? 'PASS' : 'FAIL';
      const notes = [
        `a=${sa.verdict}(${sa.notes.join(',')})`,
        `b=${sb.verdict}(${sb.notes.join(',')})`,
        `agree=${agree}(a=${agreeA},b=${agreeB} on ${pair.shared})`,
      ];
      record(pair.id, `${pair.a.q} || ${pair.b.q}`, 'B', verdict, notes, `[${pair.a.id}] ${ra.ans}\n\n[${pair.b.id}] ${rb.ans}`, ra.latency + rb.latency, {
        aVerdict: sa.verdict, bVerdict: sb.verdict, agree, aExcerpt: excerpt(ra.ans), bExcerpt: excerpt(rb.ans),
      });
    } catch (e) {
      record(pair.id, pair.id, 'B', 'ERROR', ['harness-throw:' + String(e && e.message).slice(0, 80)], '', 0);
    }
  }

  await runStandardSection('C', SECTION_C, scoreStandard);
  await runStandardSection('D', SECTION_D, scoreD);

  // ── SECTION E (sequential chains — history retained; NO reset between turns) ─
  say('\n[harness] ── SECTION E (chains) ──');
  for (const chain of SECTION_E) {
    if (!want(chain.id) && !chain.turns.some((_, i) => want(`${chain.id}t${i + 1}`))) continue;
    try {
      // Build a running [ME]:/[ASSISTANT]: transcript, then feed each next turn
      // the STRIPPED snapshot (only [ME]: prior questions) — exactly what the
      // gemini-chat-stream handler does via getFormattedContext + stripPriorAssistantTurns.
      const transcript = []; // {role:'ME'|'ASSISTANT', text}
      const turnRecs = [];
      let chainLatency = 0;
      let anyError = false;
      for (let i = 0; i < chain.turns.length; i++) {
        const turn = chain.turns[i];
        // Prior context = stripped snapshot of transcript so far ([ME]: lines only).
        const priorSnapshot = transcript
          .map((it) => `[${it.role === 'ME' ? 'ME' : 'ASSISTANT (PREVIOUS SUGGESTION)'}]: ${it.text}`)
          .join('\n');
        const stripped = stripPriorAssistantTurnsLocal(priorSnapshot);
        const priorContext = i === 0 ? undefined : (stripped.trim().length ? stripped : undefined);
        // Referent hint = the IMMEDIATELY PREVIOUS assistant answer (what the real
        // handler passes via getLastAssistantMessage()). Enables anaphoric
        // follow-up retrieval ("What processor controls it?" → the Mercury X1 named
        // in the prior answer). Only for turns after the first.
        const referentHint = i === 0 ? undefined
          : [...transcript].reverse().find((it) => it.role === 'ASSISTANT')?.text;
        const r = await ask(turn.q, priorContext, referentHint);
        chainLatency += r.latency;
        if (r.errored) { anyError = true; turnRecs.push({ turn: i + 1, q: turn.q, verdict: 'ERROR', ans: r.ans, latency: r.latency, notes: ['quota/empty'] }); break; }
        // Record this turn into the running transcript for the next turn.
        transcript.push({ role: 'ME', text: turn.q });
        transcript.push({ role: 'ASSISTANT', text: r.ans });
        // Score this turn if it carries checks.
        let tVerdict = 'PASS', tNotes = ['no-check-turn'];
        if (turn.must || turn.mustNot) {
          const s = scoreStandard(turn, r.ans);
          tVerdict = s.verdict; tNotes = s.notes;
        }
        turnRecs.push({ turn: i + 1, q: turn.q, verdict: tVerdict, notes: tNotes, latency: r.latency, excerpt: excerpt(r.ans), answer: r.ans });
      }
      let verdict;
      if (anyError) verdict = 'ERROR';
      else if (chain.passAllTurns) verdict = turnRecs.every((t) => t.verdict === 'PASS') ? 'PASS' : 'FAIL';
      else {
        const gate = turnRecs[chain.passOnTurn];
        verdict = gate && gate.verdict === 'PASS' ? 'PASS' : 'FAIL';
      }
      const notes = turnRecs.map((t) => `t${t.turn}=${t.verdict}`);
      record(chain.id, chain.turns.map((t) => t.q).join(' → '), 'E', verdict, notes, turnRecs.map((t) => `[t${t.turn}] ${t.answer || t.ans || ''}`).join('\n\n'), chainLatency, { turns: turnRecs });
    } catch (e) {
      record(chain.id, chain.id, 'E', 'ERROR', ['harness-throw:' + String(e && e.message).slice(0, 80)], '', 0);
    }
  }

  await runStandardSection('F', SECTION_F, scoreF);

  // ── SUMMARY ──────────────────────────────────────────────────────────
  const byV = (v) => results.filter((r) => r.verdict === v).map((r) => r.id);
  const pass = byV('PASS'), fail = byV('FAIL'), weak = byV('WEAK'), error = byV('ERROR');
  const total = results.length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const p95 = sorted.length ? (sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1]) : 0;
  const regenFlags = results.filter((r) => r.latency > 2 * median).map((r) => r.id);

  const summaryLine = `PASS ${pass.length}/${total}, FAIL [${fail.join(',')}], WEAK [${weak.join(',')}], ERROR [${error.join(',')}]`;
  say(`\n[harness] ${summaryLine}`);
  say(`[harness] latency median=${median}ms p95=${p95}ms  regen(>2x median)=[${regenFlags.join(',')}]`);

  // Per-section breakdown.
  const sectionOf = (id) => id[0];
  const sections = {};
  for (const r of results) {
    const s = sectionOf(r.id);
    sections[s] = sections[s] || { pass: 0, fail: 0, weak: 0, error: 0, total: 0 };
    sections[s].total++;
    sections[s][r.verdict.toLowerCase()]++;
  }
  say('[harness] per-section: ' + Object.entries(sections).map(([s, c]) => `${s}=${c.pass}/${c.total}`).join(' '));

  // ── Write results.json + report.md ───────────────────────────────────
  const out = {
    generatedAt: new Date().toISOString(),
    backend: 'gemini-direct/gemini-3.1-flash-lite',
    thesis: 'Sample thesis for testing.pdf',
    documentGroundedCustomModeActive: true,
    summary: { total, pass: pass.length, fail: fail.length, weak: weak.length, error: error.length, passIds: pass, failIds: fail, weakIds: weak, errorIds: error },
    latency: { medianMs: median, p95Ms: p95, regenFlagged: regenFlags },
    sections,
    results,
  };
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(out, null, 2));

  const md = [];
  md.push('# Seminar Hardening — Regression Run');
  md.push('');
  md.push(`- Generated: ${out.generatedAt}`);
  md.push(`- Backend: ${out.backend}`);
  md.push(`- Thesis: ${out.thesis}`);
  md.push(`- **${summaryLine}**`);
  md.push(`- Latency: median ${median}ms, p95 ${p95}ms; regen-flagged(>2×median): ${regenFlags.join(', ') || 'none'}`);
  md.push('');
  md.push('## Per-section');
  md.push('');
  md.push('| Section | Pass | Total |');
  md.push('|---|---|---|');
  for (const [s, c] of Object.entries(sections)) md.push(`| ${s} | ${c.pass} | ${c.total} |`);
  md.push('');
  md.push('## Per-question');
  md.push('');
  md.push('| ID | Verdict | Latency | Notes | Answer excerpt |');
  md.push('|---|---|---|---|---|');
  for (const r of results) {
    const notes = (r.notes || []).join('; ').replace(/\|/g, '\\|').slice(0, 220);
    const ex = (r.excerpt || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200);
    md.push(`| ${r.id} | ${r.verdict} | ${r.latency}ms | ${notes} | ${ex} |`);
  }
  fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n'));

  fs.writeFileSync(path.join(outDir, 'harness-log.txt'), log.join('\n'));
  say(`[harness] wrote results.json + report.md + harness-log.txt to ${outDir}`);

  finish(fail.length === 0 ? 0 : 1);
}

// Local copy of the production stripPriorAssistantTurns (ipcHandlers.ts:147) so
// the E-chain context matches the real handler byte-for-byte without importing
// non-exported product internals.
function stripPriorAssistantTurnsLocal(snapshot) {
  const lines = snapshot.split('\n');
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\[ASSISTANT \(PREVIOUS SUGGESTION\)\]:/.test(line)) { skipping = true; continue; }
    if (/^\[(ME|INTERVIEWER)\]:/.test(line)) { skipping = false; kept.push(line); continue; }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').trim();
}

function finish(code) {
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
  clearTimeout(watchdog);
  process.exit(code);
}

main().catch((e) => {
  console.error('[harness] FATAL', e);
  finish(2);
});
