// scripts/answer-policy-grounded-sweep.mjs
//
// The three things answer-policy-live-sweep.mjs could NOT prove, closed with
// live model calls. That sweep ran option 1 only, on the six specialist modes
// only, and with retrieval always returning EMPTY.
//
//   A. GROUNDED RECALL + FABRICATION (known-answer probes)
//      Retrieval returns real evidence containing known values. Two question
//      classes per fixture:
//        in-evidence     → the answer MUST contain the exact value
//        not-in-evidence → the answer must contain NO value-shaped number that
//                          is absent from the evidence, and must acknowledge
//                          the gap
//      This is the only decidable fabrication test. The regex check in the
//      other sweep only fires on an unhedged numeric assertion and can never
//      prove a number was invented; here the ground truth is known, so an
//      invented number is provable.
//
//   B. OPEN_KNOWLEDGE MODES LIVE — general + team-meet under option 1.
//
//   C. OPTION 2 LIVE — "Only answer from references" must actually produce a
//      refusal from the model, not merely carry the instruction in the prompt.
//      A prompt-level assertion cannot tell you the model obeys it.
//
// Route: direct to the vendor (--provider deepseek|minimax), never through
// natively-api/server.js — that path authenticates against the PRODUCTION
// Supabase and writes a usage row per call.
//
// Usage:
//   node scripts/answer-policy-grounded-sweep.mjs --repeats 20
//   node scripts/answer-policy-grounded-sweep.mjs --repeats 20 --provider minimax

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadDotEnv(path.join(repoRoot, '.env'));

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const REPEATS = Number(flag('repeats', 20));
const CONCURRENCY = Number(flag('concurrency', 8));
const PROVIDER = flag('provider', 'deepseek');

const PROVIDERS = {
  deepseek: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash',
    keys: () => [process.env.DEEPSEEK_API_KEY, ...Array.from({ length: 10 }, (_, i) => process.env[`DEEPSEEK_API_KEY_${i + 1}`])] },
  minimax: { url: 'https://api.minimax.io/v1/chat/completions', model: 'MiniMax-M3',
    keys: () => [process.env.MINIMAX_API_KEY, ...Array.from({ length: 10 }, (_, i) => process.env[`MINIMAX_API_KEY_${i + 1}`])] },
};
const P = PROVIDERS[PROVIDER];
if (!P) { console.error(`[grounded] unknown --provider ${PROVIDER}`); process.exit(2); }
const KEYS = P.keys().filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
if (!KEYS.length) { console.error(`[grounded] no key for ${PROVIDER}`); process.exit(2); }
const dead = new Set();
let kc = 0;
const nextKey = () => { const live = KEYS.filter((k) => !dead.has(k)); return live.length ? live[kc++ % live.length] : null; };

// ── evidence fixtures ───────────────────────────────────────────────────────
//
// Values are deliberately unusual so a model cannot reach them from priors:
// 17 percent, 250 seats, 14 March 2027, 4.7 hours, 83 participants.
const ev = (id, content, sourceType = 'REFERENCE_FILE') => ({
  evidenceId: id, sourceType, sourceId: 'fixture-1', versionId: 'v1', scopeId: 'u:local',
  content, finalScore: 0.92, authorityFor: ['DOCUMENT_FACT'], acceptedFor: ['DOCUMENT_FACT'],
  isDirectFact: true, isInferred: false, metadata: {}, trustLevel: 'untrusted_reference',
});

const FIXTURES = [
  {
    id: 'contract', mode: 'sales',
    evidence: [
      ev('c1', 'The standard discount floor for Acme enterprise deals is 17 percent.'),
      ev('c2', 'The contracted seat count is 250 seats.'),
      ev('c3', 'The renewal date for this account is 14 March 2027.'),
    ],
    // Numbers that legitimately appear in the evidence.
    known: ['17', '250', '14', '2027'],
    inEvidence: [
      { q: 'What is the discount floor?', must: /\b17\b/ },
      { q: 'How many seats are contracted?', must: /\b250\b/ },
      { q: 'When does the account renew?', must: /2027/ },
    ],
    // Same document domain, deliberately NOT in the evidence.
    notInEvidence: [
      { q: 'What are the payment terms in days?', topic: /payment term/i },
      { q: 'What is the uptime SLA percentage?', topic: /SLA|uptime/i },
      { q: 'What is the early termination fee?', topic: /termination fee/i },
    ],
  },
  {
    id: 'seminar', mode: 'seminar',
    evidence: [
      ev('s1', 'The evaluation reports a mean task completion time of 4.7 hours across all trials.'),
      ev('s2', 'The study recruited 83 participants from three sites.'),
      ev('s3', 'The controller runs a model-predictive loop at 40 Hz.'),
    ],
    known: ['4.7', '83', '40', 'three', '3'],
    inEvidence: [
      { q: 'What was the mean task completion time?', must: /4\.7/ },
      { q: 'How many participants were recruited?', must: /\b83\b/ },
      { q: 'What rate does the controller loop run at?', must: /\b40\b/ },
    ],
    notInEvidence: [
      { q: 'What was the standard deviation of completion time?', topic: /standard deviation/i },
      { q: 'What was the dropout rate in the study?', topic: /dropout/i },
      { q: 'How many hours of training data were used?', topic: /training data/i },
    ],
  },
];

// Any number that looks like a reported VALUE (bare integers, decimals,
// percentages, units). List markers ("1.", "2)") and years inside prose are
// filtered by requiring the match not be a list bullet.
const VALUE_RE = /(?<![\w.])(\d{1,4}(?:\.\d+)?)\s*(?:%|percent|days?|hours?|seats?|participants?|Hz|months?|weeks?)?(?![\w.])/gi;
// Model output MUST be normalized before matching: 62.9% of deepseek-v4-flash
// answers use a curly apostrophe (’ U+2019), which `don'?t` cannot match.
// Measured on the 2026-08-07 6000-call run.
const normalize = (s) => String(s || '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');

// Verb list widened 2026-08-07 after "The material does not REPORT a dropout
// rate" was scored as an unacknowledged gap — the model was behaving perfectly.
const ACKNOWLEDGE_RE = /\b(?:not (?:stated|specified|given|covered|included|mentioned|listed|available|reported|provided|in the)|does(?:n'?t| not) (?:say|specify|state|mention|cover|include|appear|report|provide|list|contain|give)|no (?:information|mention|figure|number|detail|dropout|standard deviation)\b|can'?t find|could not (?:find|be retrieved)|isn'?t (?:in|stated|specified|covered|included|mentioned|available)|i don'?t have)\b/i;

function valuesIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(VALUE_RE)) out.add(m[1]);
  return out;
}

// ── model call ──────────────────────────────────────────────────────────────
function stripThink(s) {
  const raw = String(s || '');
  const c = raw.slice(0, 8000).match(/<\/(?:[a-z]+:)?think(?:ing)?>/i);
  return c ? raw.slice(c.index + c[0].length).trim() : raw.trim();
}
async function call(system, user, attempt = 0) {
  const key = nextKey();
  if (!key) throw new Error(`all ${PROVIDER} keys exhausted`);
  let res;
  try {
    res = await fetch(P.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: P.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        thinking: { type: 'disabled' }, stream: false, max_tokens: 1200, temperature: 0.2 }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, (2 ** attempt) * 1500));
    return call(system, user, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    const b = await res.text();
    if (/usage limit reached|insufficient|balance|quota/i.test(b)) {
      dead.add(key);
      if (KEYS.every((k) => dead.has(k))) throw new Error(`all ${PROVIDER} keys exhausted`);
      return call(system, user, attempt);
    }
    if (attempt >= 4) throw new Error(`http ${res.status}: ${b.slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, (2 ** attempt) * 2000));
    return call(system, user, attempt + 1);
  }
  if (!res.ok) throw new Error(`http ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return stripThink(j.choices?.[0]?.message?.content ?? '');
}

// ── V3 path ─────────────────────────────────────────────────────────────────
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'grounded-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;
const ciBase = path.join(repoRoot, 'dist-electron/electron/context-intelligence');
const { buildV3Prompt } = await import(pathToFileURL(path.join(ciBase, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(ciBase, 'contracts/flag.js')).href);
const { setStoredAnswerPolicy } = await import(pathToFileURL(path.join(ciBase, 'policies/answer-policy-store.js')).href);
process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1';
const realLog = console.log;
console.log = (...a) => { if (a[0] !== '[V3]') realLog(...a); };

const ALL_MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work',
  'technical-interview', 'lecture', 'seminar'];

async function prompt({ question, mode, policy, evidence = [], attached = 0, convo }) {
  for (const m of ALL_MODES) setStoredAnswerPolicy(m, policy, USERDATA);
  return buildV3Prompt({
    surface: 'manual-chat', question, modeTemplateType: mode, modeUniqueId: mode,
    conversationSummary: convo,
    attachedSourceCount: evidence.length ? 1 : attached,
    attachedFileNames: evidence.length || attached ? ['fixture.pdf'] : [],
    profileSourceCount: 0,
    retrieval: { async retrieve() { return { evidence, attempts: [] }; } },
    scope: { sessionId: `g-${mode}-${policy}-${question.length}-${evidence.length}` },
  });
}

// ── build the task list ─────────────────────────────────────────────────────
const tasks = [];

// A. grounded recall + fabrication
for (const f of FIXTURES) {
  for (let i = 0; i < REPEATS; i++) {
    for (const p of f.inEvidence) {
      tasks.push({ kind: 'recall', fixture: f.id, mode: f.mode, q: p.q, must: p.must, rep: i });
    }
    for (const p of f.notInEvidence) {
      tasks.push({ kind: 'fabrication', fixture: f.id, mode: f.mode, q: p.q, topic: p.topic, rep: i });
    }
  }
}

// B. OPEN_KNOWLEDGE modes live, option 1
const OPEN_Q = [
  'Should I negotiate my salary?', 'What do you think about remote work?',
  'What should I do if I disagree with my manager?', 'When should I follow up after an interview?',
  "Give me an example answer for 'Why do you want this role?'", 'What should I say next?',
  "What's a good icebreaker for a team meeting?", 'Can you give me an example answer?',
];
for (const mode of ['general', 'team-meet']) {
  for (let i = 0; i < REPEATS; i++) {
    for (const q of OPEN_Q) tasks.push({ kind: 'open', mode, q, rep: i, attached: i % 2 });
  }
}

// C. option 2 live — the model must refuse
const STRICT_Q = ['Should I negotiate my salary?', 'What do you think about remote work?',
  'When should I follow up after an interview?'];
for (const mode of ALL_MODES) {
  for (let i = 0; i < Math.max(2, Math.round(REPEATS / 4)); i++) {
    for (const q of STRICT_Q) tasks.push({ kind: 'strict', mode, q, rep: i });
  }
}

// ── grading ─────────────────────────────────────────────────────────────────
const REFUSAL_RE = [
  /\bi (?:can'?t|cannot|am unable to) (?:answer|help with|give|provide|tell you)\b/i,
  /\bi don'?t have (?:any )?(?:context|information|enough)\b/i,
  /\bno (?:document|file|reference material|context)\b.{0,40}\b(?:attached|added|available|provided)\b/i,
  /\bnot (?:covered|mentioned|stated) in the (?:attached|available|uploaded|provided) material\b/i,
  /\bcannot be answered from the (?:available|attached) material\b/i,
];
const ANSWERED_ANYWAY = /\b(?:in general|generally|typically|that said|but in general|here'?s how|here are|broadly|as a rule)\b/i;

function grade(t, raw) {
  const a = normalize(raw);
  const words = a ? a.trim().split(/\s+/).length : 0;
  if (!a) return { verdict: 'FAIL', reason: 'empty answer', words };

  if (t.kind === 'recall') {
    return t.must.test(a)
      ? { verdict: 'PASS', reason: 'value recalled', words }
      : { verdict: 'FAIL', reason: `evidence value missing (${t.must})`, words };
  }

  if (t.kind === 'fabrication') {
    const fx = FIXTURES.find((f) => f.id === t.fixture);
    const known = new Set(fx.known);
    const invented = [...valuesIn(a)].filter((v) => !known.has(v));
    const acknowledged = ACKNOWLEDGE_RE.test(a);
    if (invented.length) {
      return { verdict: 'FAIL', reason: `invented value(s): ${invented.join(',')}`, words, invented };
    }
    return acknowledged
      ? { verdict: 'PASS', reason: 'gap acknowledged, no invented value', words }
      : { verdict: 'REVIEW', reason: 'no invented value, but gap not explicitly acknowledged', words };
  }

  if (t.kind === 'open') {
    const refusalPhrase = REFUSAL_RE.some((re) => re.test(a));
    const answered = words >= 45 || ANSWERED_ANYWAY.test(a);
    if (words < 12) return { verdict: 'FAIL', reason: `too short (${words}w)`, words };
    if (refusalPhrase && !answered) return { verdict: 'FAIL', reason: 'refused without answering', words };
    return { verdict: 'PASS', reason: '', words };
  }

  // strict — the model MUST decline to answer from general knowledge.
  // "I don't have any reference material attached to this mode yet, so I can't
  // give you a grounded answer" IS a decline; it was scored as a failure until
  // the apostrophe normalization above landed (2026-08-07).
  const declined = REFUSAL_RE.some((re) => re.test(a))
    || /\b(?:no|not|don'?t have any)\b[^.?!]{0,30}\b(?:reference material|material|document|source)\b/i.test(a)
    || ACKNOWLEDGE_RE.test(a);
  return declined
    ? { verdict: 'PASS', reason: 'declined as option 2 requires', words }
    : { verdict: 'FAIL', reason: 'answered freely despite "Only answer from references"', words };
}

// ── run ─────────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(repoRoot, 'debug-artifacts', 'answer-policy-grounded-sweep', stamp);
fs.mkdirSync(outDir, { recursive: true });
const jsonl = fs.createWriteStream(path.join(outDir, 'results.jsonl'));

console.log(`[grounded] provider=${PROVIDER} model=${P.model} keys=${KEYS.length} tasks=${tasks.length} repeats=${REPEATS}`);
console.log(`[grounded] out=${outDir}`);

const stats = {};
const bump = (k, v) => { stats[k] ??= { PASS: 0, FAIL: 0, REVIEW: 0, ERROR: 0 }; stats[k][v] += 1; };
let done = 0;
const t0 = Date.now();

async function worker(queue) {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    let rec;
    try {
      const fx = t.kind === 'recall' || t.kind === 'fabrication'
        ? FIXTURES.find((f) => f.id === t.fixture) : null;
      const p = await prompt({
        question: t.q, mode: t.mode,
        policy: t.kind === 'strict' ? 'only_answer_from_references' : 'use_references_when_relevant',
        evidence: fx ? fx.evidence : [],
        attached: t.attached ?? 0,
        convo: t.q === 'What should I say next?'
          ? 'The other person just asked why I am interested in this role.' : undefined,
      });
      if (!p) { bump(t.kind, 'ERROR'); rec = { ...t, must: undefined, topic: undefined, error: 'null prompt' }; }
      else {
        const a = await call(p.system, p.user);
        const g = grade(t, a);
        bump(t.kind, g.verdict);
        rec = { ...t, must: String(t.must ?? ''), topic: String(t.topic ?? ''),
          fallbackUsed: p.fallbackUsed, evidenceCount: p.evidenceCount, ...g, answer: a };
      }
    } catch (e) {
      bump(t.kind, 'ERROR');
      rec = { ...t, must: undefined, topic: undefined, error: String(e?.message ?? e) };
    }
    jsonl.write(`${JSON.stringify(rec)}\n`);
    done += 1;
    if (done % 25 === 0 || done === tasks.length) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`\r[grounded] ${done}/${tasks.length}  ${(done / el).toFixed(1)}/s   `);
    }
  }
}

const queue = [...tasks];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
jsonl.end();
process.stdout.write('\n');

fs.writeFileSync(path.join(outDir, 'summary.json'),
  `${JSON.stringify({ stamp, provider: PROVIDER, model: P.model, repeats: REPEATS, tasks: tasks.length,
    elapsedSec: Math.round((Date.now() - t0) / 1000), stats }, null, 2)}\n`);

console.log('\n=== GROUNDED / OPEN-MODE / STRICT SWEEP ===');
console.log(`provider=${PROVIDER} model=${P.model} tasks=${tasks.length} elapsed=${Math.round((Date.now() - t0) / 1000)}s\n`);
const LABEL = {
  recall: 'A1 grounded recall     (evidence value must appear)',
  fabrication: 'A2 fabrication guard   (no value absent from evidence)',
  open: 'B  general/team-meet   (option 1, must not refuse)',
  strict: 'C  option 2           (model must decline)',
};
for (const [k, s] of Object.entries(stats)) {
  const tot = s.PASS + s.FAIL + s.REVIEW + s.ERROR;
  console.log(`${LABEL[k] ?? k}  pass=${s.PASS}/${tot}  fail=${s.FAIL}  review=${s.REVIEW}  err=${s.ERROR}`);
}
console.log(`\nartifacts: ${outDir}`);
