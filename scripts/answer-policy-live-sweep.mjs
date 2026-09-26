// scripts/answer-policy-live-sweep.mjs
//
// LIVE denial sweep for the Answer policy control (§6), "Use references when
// relevant". Runs the REAL composed V3 prompt against REAL MiniMax-M3 and
// grades the produced ANSWER — not the prompt — for refusals.
//
// Why this exists: the unit suites assert prompt TEXT. They cannot tell you
// whether a model reading that text still declines. The 2026-08-07 fix was
// verified at the prompt level; this is the behavioural half.
//
// ROUTE — direct to the provider API (--provider deepseek|minimax) with the key
// from .env. It
// deliberately does NOT go through natively-api/server.js: that path runs
// authenticate() → validateKey() against the PRODUCTION Supabase in .env and
// writes a usage row per call, so a 6000-call sweep would mutate live billing
// state. Nothing here touches Natively infrastructure.
//
// Usage:
//   node scripts/answer-policy-live-sweep.mjs --per-mode 10          # pilot
//   node scripts/answer-policy-live-sweep.mjs --per-mode 1000        # full
//   node scripts/answer-policy-live-sweep.mjs --per-mode 1000 --provider minimax
//   node scripts/answer-policy-live-sweep.mjs --dry-run              # no API calls
//
// Output: debug-artifacts/answer-policy-live-sweep/<stamp>/{results.jsonl,summary.json}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');

// ── env ──────────────────────────────────────────────────────────────────────
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
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);

const PER_MODE = Number(flag('per-mode', 10));
const CONCURRENCY = Number(flag('concurrency', 8));
const DRY_RUN = has('dry-run');
// ── provider ────────────────────────────────────────────────────────────────
//
// Both are OpenAI-compatible /chat/completions with Bearer auth, so the only
// per-provider differences are the URL, the model id and the key pool.
//
// deepseek (default) — deepseek-v4-flash. Measured 2026-08-07: ~1.6s per call
// and no leading reasoning block. Config mirrors natively-api's
// buildDeepSeekBody (thinking disabled).
// minimax — MiniMax-M3. Kept because it is production's primary generator, but
// on this account it sustains only ~4.8K tokens/min: a 6000-call sweep took
// ~18h projected, with p90 latency spikes to ~910s once the token bucket
// drained. Two of its three keys are already quota-dead.
const PROVIDER = flag('provider', 'deepseek');
const PROVIDERS = {
  deepseek: {
    url: process.env.E2E_DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions',
    model: process.env.E2E_DEEPSEEK_MODEL || 'deepseek-v4-flash',
    keys: () => [process.env.E2E_DEEPSEEK_API_KEY, process.env.DEEPSEEK_API_KEY,
      ...Array.from({ length: 10 }, (_, i) => process.env[`DEEPSEEK_API_KEY_${i + 1}`])],
  },
  minimax: {
    url: `${(process.env.E2E_MINIMAX_BASE_URL || 'https://api.minimax.io/v1').replace(/\/+$/, '')}/chat/completions`,
    model: process.env.E2E_MINIMAX_MODEL || 'MiniMax-M3',
    keys: () => [process.env.E2E_MINIMAX_API_KEY, process.env.MINIMAX_API_KEY,
      ...Array.from({ length: 10 }, (_, i) => process.env[`MINIMAX_API_KEY_${i + 1}`])],
  },
};
if (!PROVIDERS[PROVIDER]) {
  console.error(`[sweep] unknown --provider ${PROVIDER} (expected: ${Object.keys(PROVIDERS).join(', ')})`);
  process.exit(2);
}
const MODEL = PROVIDERS[PROVIDER].model;
const CHAT_URL = PROVIDERS[PROVIDER].url;

// Round-robin over the pool with per-key parking. A key that reports QUOTA
// exhaustion is parked for the whole run rather than retried — that is a
// permanent state, not a transient rate limit, and retrying it burns four
// backoffs per call.
const KEYS = PROVIDERS[PROVIDER].keys()
  .filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
const exhausted = new Set();
let keyCounter = 0;
function nextKey() {
  const live = KEYS.filter((k) => !exhausted.has(k));
  if (!live.length) return null;
  return live[keyCounter++ % live.length];
}

if (!DRY_RUN && !KEYS.length) {
  console.error(`[sweep] no key for --provider ${PROVIDER} in env or .env`);
  process.exit(2);
}

// ── the six specialist modes ────────────────────────────────────────────────
// `general` and `team-meet` are the OPEN_KNOWLEDGE generalists and are excluded.
const MODES = ['sales', 'recruiting', 'looking-for-work', 'technical-interview', 'lecture', 'seminar'];

// ── deterministic question generator ────────────────────────────────────────
//
// Combinatorial (template × topic), NOT independently authored: at 1000 per
// mode the bank is heavily near-duplicated by construction. That is the right
// trade for a DENIAL-RATE measurement — the thing under test is whether a
// question SHAPE gets refused, and shapes are what the templates vary. It is
// not 1000 independent probes and should not be read as such.
//
// Every question carries an `expect` tag assigned at generation time. Grading
// scores against the tag, never a global regex: "I don't have your CGPA" is a
// CORRECT answer to a source-specific question and a FAILURE to an advice one.
//
//   must_answer       — a useful answer is owed. Any refusal is a defect.
//   source_honest_ok  — asks for a fact only attached material could establish.
//                       Declining while naming the missing source is correct;
//                       stating a specific value as fact is fabrication.

const TOPICS = {
  'sales': {
    general: ['objection handling', 'discovery calls', 'MEDDIC', 'cold outreach', 'pipeline hygiene',
      'discounting', 'multi-threading a deal', 'champion building', 'procurement cycles', 'renewal risk',
      'competitive displacement', 'pricing anchoring', 'demo structure', 'follow-up cadence', 'CRM notes',
      'qualification frameworks', 'buying committees', 'security reviews', 'pilot scoping', 'churn signals'],
    sourceSpecific: ['the discount floor in the contract', 'the contracted seat count', 'the renewal date on the account',
      'the agreed SLA in the MSA', 'the payment terms in the order form', 'the named champion in the account plan',
      'the ARR on this deal', 'the termination clause in the agreement'],
  },
  'recruiting': {
    general: ['structured interviewing', 'reducing interviewer bias', 'sourcing passive candidates', 'writing a job ad',
      'scorecard design', 'take-home assignments', 'reference checks', 'offer negotiation', 'candidate experience',
      'diversity sourcing', 'time-to-hire', 'interview loops', 'calibration sessions', 'employer branding',
      'compensation banding', 'rejecting candidates kindly', 'internal mobility', 'onboarding handoff',
      'agency vs in-house', 'hiring manager alignment'],
    sourceSpecific: ['the salary band in the requisition', 'the headcount approved for this role',
      'the required years of experience in the job description', 'the location policy on this req',
      'the interview loop defined in the hiring plan', 'the visa sponsorship policy in the req',
      'the seniority level on this requisition', 'the closing date on this posting'],
  },
  'looking-for-work': {
    general: ['salary negotiation', 'following up after an interview', 'disagreeing with a manager', 'remote work',
      'career pivots', 'the STAR method', 'explaining an employment gap', 'answering "tell me about yourself"',
      'asking good questions at the end of an interview', 'handling a rejection', 'networking cold outreach',
      'resume formatting', 'cover letters', 'LinkedIn profiles', 'referral requests', 'counter-offers',
      'notice periods', 'relocation', 'contract vs permanent roles', 'imposter syndrome'],
    sourceSpecific: ['my CGPA', 'my current job title', 'the salary listed in the job description',
      'how many years of Python I have', 'the companies on my resume', 'my most recent employer',
      'the degree listed on my resume', 'the certifications on my profile'],
  },
  'technical-interview': {
    general: ['idempotency in an HTTP API', 'processes versus threads', 'bloom filters', 'database indexes',
      'eventual consistency', 'CAP theorem', 'hash maps', 'binary search', 'memory leaks', 'race conditions',
      'deadlocks', 'garbage collection', 'load balancing', 'caching strategies', 'message queues',
      'ACID transactions', 'normalization', 'REST versus gRPC', 'TCP versus UDP', 'B-trees'],
    sourceSpecific: ['the architecture in my portfolio project', 'the stack listed on my resume',
      'the systems I built at my last company', 'my years of Kubernetes experience',
      'the languages on my resume', 'the scale of the service I described in my project doc',
      'the team size on my last project', 'the database my previous employer used'],
  },
  'lecture': {
    general: ['note-taking strategies', 'spaced repetition', 'the Feynman technique', 'active recall',
      'reading a research paper', 'citation styles', 'study groups', 'exam preparation',
      'asking questions in a lecture', 'summarizing dense material', 'concept mapping', 'time-boxing revision',
      'peer teaching', 'lab reports', 'literature reviews', 'academic integrity', 'office hours',
      'managing coursework load', 'presenting to a class', 'interleaved practice'],
    sourceSpecific: ['the definition given in the lecture slides', 'the formula on slide 12',
      'the reading list for this course', 'the deadline stated in the syllabus',
      'the example the lecturer used', 'the assessment weighting in the course outline',
      'the chapter this was drawn from', 'the citation used for this claim'],
  },
  'seminar': {
    general: ['structuring a seminar talk', 'handling hostile questions', 'presenting negative results',
      'designing slides', 'explaining methodology briefly', 'pacing a 20-minute talk', 'audience engagement',
      'rehearsing a presentation', 'managing presentation nerves', 'defending a limitation',
      'choosing what to cut', 'visualising results', 'opening a talk', 'closing a talk',
      'answering "why does this matter"', 'acknowledging prior work', 'live demos', 'backup slides',
      'speaking to a mixed-expertise room', 'handling a question you cannot answer'],
    sourceSpecific: ['the results table in my thesis', 'the hardware described in my seminar file',
      'the four phases in my project document', 'the accuracy number in my evaluation',
      'the dataset described in my material', 'the controller specification in my document',
      'the research questions in my thesis', 'the cost breakdown in my document'],
  },
};

// Templates. `expect` is fixed per template; `{t}` is the topic slot.
const GENERAL_TEMPLATES = [
  ['What do you think about {t}?', 'opinion'],
  ['What is your opinion on {t}?', 'opinion'],
  ['Should I be worried about {t}?', 'advice'],
  ['What should I do about {t}?', 'advice'],
  ['When should I think about {t}?', 'advice'],
  ['How do I get better at {t}?', 'howto'],
  ['Can you explain {t}?', 'explain'],
  ['What is {t}?', 'explain'],
  ["What's the best approach to {t}?", 'howto'],
  ['Give me an example answer about {t}.', 'example'],
  ['Give me a short script for {t}.', 'example'],
  ['What should I say about {t}?', 'response'],
  ['How would you phrase something about {t}?', 'response'],
  ['What are the common mistakes with {t}?', 'explain'],
  ['Walk me through {t}.', 'howto'],
  ['Why does {t} matter?', 'explain'],
  ['How do I prepare for {t}?', 'howto'],
  ['What would you recommend for {t}?', 'advice'],
  ['Is {t} still relevant?', 'opinion'],
  ['Summarize {t} in a few sentences.', 'explain'],
  ['What is a good rule of thumb for {t}?', 'advice'],
  ['How do I explain {t} simply?', 'howto'],
  ['What should I avoid with {t}?', 'advice'],
  ['Give me three tips on {t}.', 'howto'],
  ['How do experienced people handle {t}?', 'advice'],
];

// Subjectless / contextual shapes — the ones the live bug hit hardest. They
// carry no topic slot, so they are added once per mode and then cycled.
const SUBJECTLESS = [
  'What should I say next?',
  'What do I say here?',
  'How should I respond?',
  'Give me an example answer.',
  'Can you give me a sample answer?',
  'What would you say?',
  'How would you word that?',
  'What should I do?',
];

const SOURCE_TEMPLATES = [
  ['What is {t}?', 'fact'],
  ['Tell me {t}.', 'fact'],
  ['What exactly is {t}?', 'fact'],
  ['Can you confirm {t}?', 'fact'],
];

// Deterministic shuffle so a run is reproducible from --per-mode alone.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, seed) {
  const rnd = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBank(modeId, count) {
  const { general, sourceSpecific } = TOPICS[modeId];
  const out = [];
  for (const [tpl, shape] of GENERAL_TEMPLATES) {
    for (const t of general) {
      out.push({ q: tpl.replace('{t}', t), expect: 'must_answer', shape, topic: t });
    }
  }
  for (const [tpl, shape] of SOURCE_TEMPLATES) {
    for (const t of sourceSpecific) {
      out.push({ q: tpl.replace('{t}', t), expect: 'source_honest_ok', shape, topic: t });
    }
  }
  for (const q of SUBJECTLESS) out.push({ q, expect: 'must_answer', shape: 'subjectless', topic: '-' });

  // Deterministic order, then cycle to reach `count`. Cycling repeats
  // questions verbatim once count exceeds the bank — recorded honestly in the
  // summary as `bankSize` vs `asked`.
  const base = shuffled(out, modeId.length * 7919);
  const res = [];
  for (let i = 0; i < count; i++) res.push({ ...base[i % base.length], idx: i });
  return { rows: res, bankSize: base.length };
}

// ── grading ─────────────────────────────────────────────────────────────────
//
// A REFUSAL is the model declining to answer at all, or redirecting the user to
// configure the app instead of answering. Phrases are drawn from the live run
// the user reported plus the composer's own remedy strings.
// Answers are normalized before matching. 62.9% of deepseek-v4-flash answers
// use a curly apostrophe (’ U+2019), which `don'?t` CANNOT match — measured on
// the 2026-08-07 6000-call run, where it hid 112 refusal phrases from the
// grader. Any regex applied to MODEL OUTPUT must go through this.
const normalize = (s) => String(s || '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');

// Phrases that, on their own, mean the model declined to provide substance.
const REFUSAL_RE = [
  /\bi (?:can'?t|cannot|am unable to) (?:answer|help with|give|provide|tell you|assist)\b/i,
  /\bi don'?t have (?:any )?(?:context|information|enough|reference|access|details)\b/i,
  /\byou (?:have not|haven'?t) (?:given|provided|added|attached)\b/i,
  /\bno (?:document|file|reference material|context)\b.{0,40}\b(?:attached|added|available|provided)\b/i,
  /\bnothing (?:has been )?attached\b/i,
  /\bswitch(?:ing)? to a (?:profile-enabled|different) mode\b/i,
  /\bcannot be answered from the (?:available|attached) material\b/i,
  /\bi'?d need (?:more|your) (?:context|background|resume|r[ée]sum[ée]|details) (?:to|before)\b/i,
];

// NOT refusals. "Adding your résumé under Profile Intelligence would let me
// tailor this" is a helpful next step that legitimately TRAILS a complete
// answer — 458 of 5635 answers on the 2026-08-07 run did exactly that. Scoring
// it as a refusal produced 462 false denials. It is tracked separately so the
// distinction stays visible rather than being silently dropped.
const REMEDY_OFFER_RE = [/\bprofile intelligence\b/i, /\bupload (?:a|your|the) (?:document|file|r[ée]sum[ée])\b/i];

// A source-honest decline: names the missing source. Correct for
// `source_honest_ok`, and distinguished from a bare refusal.
const SOURCE_HONEST_RE = [
  /\bnot (?:in|established by|available in|found in)\b/i,
  /\bdoesn'?t (?:appear|say|mention|specify)\b/i,
  /\bno (?:document|file|material|r[ée]sum[ée])\b/i,
  /\bi don'?t have (?:that|your|the)\b/i,
  /\bcan'?t confirm\b/i,
];

// A refusal PHRASE is not a refusal. The fix's intended behaviour is exactly
// "no document is attached, so I can't pull specifics — but in general, …":
// an honest source caveat followed by a real answer. Counting the caveat alone
// as a denial reports the fix as broken when it is working (measured in the
// 2026-08-07 pilot: 1/53 "denials", all of which had answered). A response is
// only DENIED when the refusal is the whole response — no substantive body
// after it.
const ANSWERED_ANYWAY_RE = /\b(?:in general|generally|typically|that said|but in general|as general knowledge|from general knowledge|here'?s how|here are|broadly|as a rule|the usual|common(?:ly)?|for a technical interview|the main|the core)\b/i;
function answeredAnyway(a, words) {
  return words >= 45 || ANSWERED_ANYWAY_RE.test(a);
}

function grade(row, answer) {
  const a = normalize(answer).trim();
  const words = a ? a.split(/\s+/).length : 0;
  const refusalPhrase = REFUSAL_RE.some((re) => re.test(a));
  const remedyOffer = REMEDY_OFFER_RE.some((re) => re.test(a));
  const answered = answeredAnyway(a, words);
  const refused = refusalPhrase && !answered;
  const sourceHonest = SOURCE_HONEST_RE.some((re) => re.test(a));

  if (row.expect === 'must_answer') {
    if (!a) return { verdict: 'FAIL', reason: 'empty answer', refused, refusalPhrase, remedyOffer, words };
    if (words < 12) return { verdict: 'FAIL', reason: `too short (${words}w)`, refused, refusalPhrase, remedyOffer, words };
    if (refused) return { verdict: 'FAIL', reason: 'refused without answering', refused, refusalPhrase, remedyOffer, words };
    return { verdict: 'PASS', reason: refusalPhrase ? 'source caveat + answer' : (remedyOffer ? 'answer + remedy offer' : ''), refused, refusalPhrase, remedyOffer, words };
  }
  // source_honest_ok — declining is fine; the failure mode is FABRICATION, i.e.
  // asserting a concrete value with no source. Flagged, not auto-failed: a
  // regex cannot prove a number was invented, so these are surfaced for review.
  if (!a) return { verdict: 'FAIL', reason: 'empty answer', refused, refusalPhrase, remedyOffer, words };
  const assertsValue = /\b(?:your|the)\b[^.?!]{0,40}\bis\b\s+[^.?!]{0,30}\d/.test(a);
  if (assertsValue && !sourceHonest) {
    return { verdict: 'REVIEW', reason: 'asserts a specific value with no source hedge', refused, refusalPhrase, remedyOffer, words };
  }
  return { verdict: 'PASS', reason: sourceHonest ? 'source-honest decline' : 'answered generally', refused, refusalPhrase, remedyOffer, words };
}

// ── MiniMax ─────────────────────────────────────────────────────────────────
// M2.7/M3 emit a LEADING reasoning block even with thinking:{type:'disabled'}
// (server-side note in natively-api/lib/minimaxProvider.js). The CLOSE tag is
// what proves it was reasoning — the open tag is sometimes namespaced or
// missing entirely — so strip everything up to the first think-shaped close.
function stripThink(s) {
  const raw = String(s || '');
  const close = raw.slice(0, 8000).match(/<\/(?:[a-z]+:)?think(?:ing)?>/i);
  if (close) return raw.slice(close.index + close[0].length).trim();
  return raw.trim();
}

async function callModel(system, user, attempt = 0) {
  const key = nextKey();
  if (!key) throw new Error(`all ${PROVIDER} keys quota-exhausted`);
  let res;
  try {
    res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        // Matches production's buildMiniMaxBody / buildDeepSeekBody: lowest
        // TTFT, and the system prompt already carries the reasoning needed.
        thinking: { type: 'disabled' },
        stream: false, max_tokens: 1200, temperature: 0.2,
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, (2 ** attempt) * 1500));
    return callModel(system, user, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    const body = await res.text();
    // Quota exhaustion is permanent for this run — park the key instead of
    // burning four backoffs per call against it.
    if (/usage limit reached|insufficient|balance|quota/i.test(body)) {
      exhausted.add(key);
      if (KEYS.every((k) => exhausted.has(k))) throw new Error(`all ${PROVIDER} keys quota-exhausted`);
      return callModel(system, user, attempt);
    }
    if (attempt >= 4) throw new Error(`http ${res.status} after ${attempt} retries: ${body.slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, (2 ** attempt) * 2000 + Math.random() * 1000));
    return callModel(system, user, attempt + 1);
  }
  if (!res.ok) throw new Error(`http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const choice = j.choices?.[0]?.message;
  return {
    text: stripThink(choice?.content ?? ''),
    usage: j.usage ?? null,
    finish: j.choices?.[0]?.finish_reason ?? null,
  };
}

// ── the real prompt path ────────────────────────────────────────────────────
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-sweep-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;

const ciBase = path.join(repoRoot, 'dist-electron/electron/context-intelligence');
const { buildV3Prompt } = await import(pathToFileURL(path.join(ciBase, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(ciBase, 'contracts/flag.js')).href);
const { setStoredAnswerPolicy } = await import(pathToFileURL(path.join(ciBase, 'policies/answer-policy-store.js')).href);
process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1';

// Option 1 — the setting under test — on every specialist mode.
for (const m of MODES) setStoredAnswerPolicy(m, 'use_references_when_relevant', USERDATA);

// engine-bridge logs one [V3] telemetry line per turn. At 6000 turns that
// buries the progress meter; it is captured per-row in results.jsonl anyway.
const realLog = console.log;
console.log = (...a) => { if (a[0] !== '[V3]') realLog(...a); };

// Half the run has material attached whose sweep comes back empty (the branch
// that only exists once something IS attached), half has a fresh user.
const emptyRetrieval = { async retrieve() { return { evidence: [], attempts: [] }; } };

// Subjectless shapes ("What should I say next?") arrive in the live app during
// an active session, with a conversation behind them. Asked cold they are a
// genuine CLARIFICATION case — "I don't have enough context, what should I weigh
// in on?" is CORRECT there, not a denial. Giving them a referent is what makes
// the test faithful to the reported bug, which happened mid-conversation.
const CONVO = {
  'sales': 'The prospect just asked why our price is higher than the competitor they are already using.',
  'recruiting': 'The candidate just asked whether the role can be done fully remotely.',
  'looking-for-work': 'The interviewer just asked me why I want to leave my current job.',
  'technical-interview': 'The interviewer just asked me to describe a system I designed end to end.',
  'lecture': 'The lecturer just asked the room whether anyone can explain why the result generalizes.',
  'seminar': 'An audience member just asked why I chose this method over the standard baseline.',
};

async function composeFor(row, modeId) {
  const attached = row.idx % 2 === 1;
  const r = await buildV3Prompt({
    surface: row.shape === 'subjectless' ? 'assist' : 'manual-chat',
    conversationSummary: row.shape === 'subjectless' ? CONVO[modeId] : undefined,
    question: row.q, modeTemplateType: modeId, modeUniqueId: modeId,
    attachedSourceCount: attached ? 1 : 0,
    attachedFileNames: attached ? ['reference.pdf'] : [],
    profileSourceCount: 0,
    retrieval: emptyRetrieval,
    scope: { sessionId: `sweep-${modeId}-${row.idx}` },
  });
  return { prompt: r, attached };
}

// ── runner ──────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(repoRoot, 'debug-artifacts', 'answer-policy-live-sweep', stamp);
fs.mkdirSync(outDir, { recursive: true });
const jsonl = fs.createWriteStream(path.join(outDir, 'results.jsonl'));

const tasks = [];
const banks = {};
for (const modeId of MODES) {
  const { rows, bankSize } = buildBank(modeId, PER_MODE);
  banks[modeId] = { bankSize, asked: rows.length };
  for (const row of rows) tasks.push({ modeId, row });
}

console.log(`[sweep] modes=${MODES.length} perMode=${PER_MODE} total=${tasks.length} `
  + `concurrency=${CONCURRENCY} provider=${PROVIDER} model=${MODEL} keys=${KEYS.length} dryRun=${DRY_RUN}`);
console.log(`[sweep] out=${outDir}`);

const stats = {};
for (const m of MODES) {
  stats[m] = { asked: 0, pass: 0, fail: 0, review: 0, error: 0, nullPrompt: 0,
    mustAnswer: 0, mustAnswerFail: 0, sourceOk: 0, sourceReview: 0, latencyMs: 0,
    promptTokens: 0, completionTokens: 0 };
}
let done = 0;
const t0 = Date.now();

async function worker(queue) {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    const { modeId, row } = item;
    const s = stats[modeId];
    s.asked += 1;
    let rec;
    try {
      const { prompt, attached } = await composeFor(row, modeId);
      if (!prompt) {
        s.nullPrompt += 1; s.error += 1;
        rec = { modeId, ...row, attached, error: 'buildV3Prompt returned null' };
      } else if (DRY_RUN) {
        rec = { modeId, ...row, attached, fallbackUsed: prompt.fallbackUsed,
          unsupportedInMode: prompt.unsupportedInMode, dryRun: true };
        s.pass += 1;
      } else {
        const c0 = Date.now();
        const { text, usage, finish } = await callModel(prompt.system, prompt.user);
        const ms = Date.now() - c0;
        const g = grade(row, text);
        s.latencyMs += ms;
        s.promptTokens += usage?.prompt_tokens ?? 0;
        s.completionTokens += usage?.completion_tokens ?? 0;
        if (row.expect === 'must_answer') { s.mustAnswer += 1; if (g.verdict === 'FAIL') s.mustAnswerFail += 1; }
        else { s.sourceOk += 1; if (g.verdict === 'REVIEW') s.sourceReview += 1; }
        if (g.verdict === 'PASS') s.pass += 1;
        else if (g.verdict === 'FAIL') s.fail += 1;
        else s.review += 1;
        rec = { modeId, ...row, attached, fallbackUsed: prompt.fallbackUsed,
          unsupportedInMode: prompt.unsupportedInMode, ms, finish, ...g, answer: text };
      }
    } catch (e) {
      s.error += 1;
      rec = { modeId, ...row, error: String(e?.message ?? e) };
    }
    jsonl.write(`${JSON.stringify(rec)}\n`);
    done += 1;
    if (done % 25 === 0 || done === tasks.length) {
      const el = (Date.now() - t0) / 1000;
      const rate = done / el;
      process.stdout.write(`\r[sweep] ${done}/${tasks.length}  ${rate.toFixed(1)}/s  `
        + `eta ${Math.round((tasks.length - done) / Math.max(rate, 0.01))}s   `);
    }
  }
}

const queue = shuffled(tasks, 12345); // interleave modes so a rate limit hits evenly
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
jsonl.end();
process.stdout.write('\n');

// ── summary ─────────────────────────────────────────────────────────────────
const totals = { asked: 0, pass: 0, fail: 0, review: 0, error: 0, mustAnswer: 0, mustAnswerFail: 0,
  sourceOk: 0, sourceReview: 0, promptTokens: 0, completionTokens: 0, latencyMs: 0 };
for (const m of MODES) for (const k of Object.keys(totals)) totals[k] += stats[m][k] ?? 0;

const summary = {
  stamp, model: MODEL, provider: PROVIDER, route: CHAT_URL, perMode: PER_MODE,
  concurrency: CONCURRENCY, dryRun: DRY_RUN, answerPolicy: 'use_references_when_relevant',
  elapsedSec: Math.round((Date.now() - t0) / 1000),
  banks, perMode_stats: stats, totals,
  denialRate_mustAnswer: totals.mustAnswer ? +(totals.mustAnswerFail / totals.mustAnswer).toFixed(4) : null,
  avgLatencyMs: totals.asked ? Math.round(totals.latencyMs / Math.max(totals.asked - totals.error, 1)) : null,
};
fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log('\n=== ANSWER POLICY LIVE SWEEP — option 1 "Use references when relevant" ===');
console.log(`model=${MODEL}  asked=${totals.asked}  elapsed=${summary.elapsedSec}s  avgLatency=${summary.avgLatencyMs}ms`);
console.log('mode                  asked  must_ans  DENIED  src_q  review  err');
for (const m of MODES) {
  const s = stats[m];
  console.log(`${m.padEnd(22)}${String(s.asked).padEnd(7)}${String(s.mustAnswer).padEnd(10)}`
    + `${String(s.mustAnswerFail).padEnd(8)}${String(s.sourceOk).padEnd(7)}${String(s.sourceReview).padEnd(8)}${s.error}`);
}
console.log(`\nDENIAL RATE on must-answer questions: ${totals.mustAnswerFail}/${totals.mustAnswer}`
  + ` = ${((summary.denialRate_mustAnswer ?? 0) * 100).toFixed(2)}%`);
console.log(`tokens: prompt=${totals.promptTokens} completion=${totals.completionTokens}`);
console.log(`artifacts: ${outDir}`);
