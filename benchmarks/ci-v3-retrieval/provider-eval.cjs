/**
 * Phase 8 §26.5 — provider-backed evaluation.
 *
 * Everything measured so far has been a DECISION. This is the first run that
 * looks at what the model actually says when handed a V3-composed prompt.
 *
 * SECRET HANDLING: the API key is read from .env IN PROCESS and is never
 * printed, never placed on a command line, and never included in the results
 * file. Only question ids, verdicts and counts are emitted.
 *
 * COST: one generation per question, cheapest tier, temperature 0. Bounded by
 * MAX_QUESTIONS.
 *
 * Usage:
 *   NATIVELY_TEST_USERDATA=<dir> NATIVELY_INTERNAL=1 ELECTRON_RUN_AS_NODE=1 \
 *     ./node_modules/.bin/electron benchmarks/ci-v3-retrieval/provider-eval.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { boot, assertVectorRunValid, REPO_ROOT, DIST } = require('./bootstrap.cjs');
const { ingestCorpus } = require('./ingest.cjs');

process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = '1';
// F23 — MUST be set, or this measurement is void.
//
// With the bundled LOCAL embedder and no live transcript, the legacy retriever's
// `shouldUseLexicalForLocalManualQuery` gate skips the vector path, and
// `keylessManualRetrievalUsesLexical` DEFAULTS TRUE. The lexical floor then
// rejects real matches: measured on a resume question whose answer is in the
// corpus, production returned 0 chunks with topScore 0 while the unfiltered pool
// held a chunk scoring 0.330. Setting this to 0 restores the vector path
// (0 chunks -> 1, topScore 0 -> 0.330).
//
// This is a LEGACY defect, not a V3 one, but it would silently zero out every
// grounded answer in this evaluation and make V3 look like the cause.
process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL =
  process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL ?? '0';

const d = (rel) => require(path.join(DIST, rel));

const MODEL = process.env.CI_V3_EVAL_MODEL || 'gemini-3.1-flash-lite';
const MAX_QUESTIONS = Number(process.env.CI_V3_EVAL_MAX || 42);

/** Read the key without ever surfacing it. */
function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const p = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(p)) return null;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.trim().match(/^(GEMINI_API_KEY|GEMINI_API_KEY_1)=(.*)$/);
    if (m) return m[2].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

async function generate(key, system, user) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        // Deterministic where the provider allows it (§26.5).
        generationConfig: { temperature: 0, maxOutputTokens: 400 },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) throw new Error(`provider ${res.status}`);
  const j = await res.json();
  return (j?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text || '').join('').trim();
}

// Must fold the same way verify-gold-facts.mjs does. The corpus stores
// "175–200k base" with an EN-DASH (U+2013); a model emitting a plain hyphen
// would otherwise score as a miss and be reported as a grounding failure.
const norm = (s) => String(s)
  .replace(/[\u2010-\u2015\u2212]/g, '-')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/\u00a0/g, ' ')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();


/**
 * Grade with a judge, because exact-string matching is not a quality measure.
 *
 * Measured example: gold "175–200k base" versus the answer
 * "$175,000 to $200,000 base salary" — a correct, well-grounded answer that
 * exact matching scores as a miss. Reporting that as a grounding failure would
 * misattribute a formatting difference to the system.
 *
 * The judge sees the gold fact and the answer ONLY — never the evidence — so it
 * cannot be talked into accepting an unsupported claim by a persuasive prompt.
 */
async function judgeGrounded(key, question, goldFacts, answer) {
  if (!goldFacts.length || !answer) return null;
  const sys = 'You grade whether an answer states a required fact. Reply with exactly one word: YES or NO. '
    + 'YES if the answer conveys the required fact, allowing different wording, units or formatting '
    + '(for example "$175,000 to $200,000" conveys "175-200k"). NO otherwise.';
  const user = `REQUIRED FACT: ${goldFacts.join(' | ')}\n\nANSWER: ${answer}\n\nDoes the answer convey the required fact? YES or NO.`;
  try {
    const v = await generate(key, sys, user);
    return /^\s*yes/i.test(v);
  } catch { return null; }
}

// Phrases that mean "I am telling you this is not covered" — the shape §20
// requires for an unsupported claim.
// Recognises "I am telling you this is not covered" — the §20 shape for an
// unsupported claim.
//
// The first version reported 0% disclosure while the model was in fact
// disclosing perfectly ("I do not have any information regarding...",
// "My resume does not explicitly list Postgres..."). It required "no
// information" and a fixed verb list, and missed both. A detector that
// under-reports disclosure makes a well-behaved system look like it fabricates.
const DISCLOSURE_RE = new RegExp([
  'do(es)? not (have|contain|include|list|specify|mention|state|say|cover|detail)',
  "don'?t have", "doesn'?t (have|list|mention|state|include|specify)",
  'no (information|mention|record|detail|reference|indication|data)',
  '(not|isn\'?t|aren\'?t) (covered|mentioned|stated|listed|specified|included|available|present|provided)',
  'cannot (find|determine|confirm)', "could ?n'?t find",
  'nothing (in|about|regarding)', 'not explicitly',
  'based on general knowledge', 'general knowledge',
  'unable to (find|determine|confirm)',
  'no such (information|detail)',
  '(material|document|resume|transcript|reference)s? do(es)? not',
].join('|'), 'i');

const CORPUS = [
  { path: 'tests/fixtures/modes/looking-for-work/lfw_resume.txt', label: 'RESUME' },
  { path: 'tests/fixtures/modes/looking-for-work/lfw_jd.md', label: 'JOB_DESCRIPTION' },
  { path: 'test-fixtures/ci-v3-corpus/additions/meeting_transcript_current.txt', label: 'MEETING_TRANSCRIPT' },
  { path: 'tests/fixtures/modes/sales/sales_pricing_policy.json', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/sales/sales_competitor_battlecard.md', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/recruiting/recruiting_compensation_policy.txt', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/technical-interview/tech_error_log.txt', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/lecture/lecture_pde_syllabus.md', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/team-meet/team_meet_risk_register.json', label: 'REFERENCE_FILE' },
  { path: 'test-fixtures/modes-corpus/papers/bert_1810.04805.pdf', label: 'REFERENCE_FILE' },
];
const MODE_FOR_SOURCE = {
  RESUME: 'looking-for-work', JOB_DESCRIPTION: 'looking-for-work',
  REFERENCE_FILE: 'seminar', MEETING_TRANSCRIPT: 'team-meet', PROFILE_FACT: 'looking-for-work',
};

(async () => {
  const key = loadKey();
  if (!key) { console.error('NO API KEY AVAILABLE — provider evaluation cannot run.'); process.exit(2); }

  const b = await boot({ verbose: false });
  const { orchestrate } = d('electron/context-intelligence/orchestration/orchestrator.js');
  const { composePrompt } = d('electron/context-intelligence/generation/prompt-composer.js');
  const { resolveModePolicy, isModeId } = d('electron/context-intelligence/policies/mode-policy-registry.js');
  const { createLegacyRetrievalPort } = d('electron/context-intelligence/retrieval/legacy-retrieval-port.js');
  const { ModesManager } = d('electron/services/ModesManager.js');

  const { mode, ingested } = await ingestCorpus(b, CORPUS);
  const indexed = ingested.filter((i) => i.file);
  assertVectorRunValid({ db: b.db, spaceKey: b.spaceKey, fileIds: indexed.map((i) => i.file.id) });

  const sourceTypes = new Map(); const activeVersions = new Map();
  for (const i of indexed) { sourceTypes.set(i.file.id, i.label); activeVersions.set(i.file.id, 'legacy'); }
  const mm = ModesManager.getInstance();
  const files = mm.getReferenceFiles(mode.id);

  const port = createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions },
    retrieve: async (query, opts) => {
      const res = await mm.retrieveHybridRaw(mode, files, { query, topK: opts.topK, tokenBudget: 3600, allowRerank: false });
      return (res?.chunks ?? []).map((c) => ({
        sourceId: c.sourceId, fileName: c.fileName, text: c.text,
        chunkIndex: c.chunkIndex, score: c.score, ftsScore: c.ftsScore, vectorScore: c.vectorScore,
      }));
    },
  });

  const bank = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'test-fixtures/ci-v3-corpus/questions.json'), 'utf8')).questions.slice(0, MAX_QUESTIONS);

  const rows = []; const lat = [];
  for (const q of bank) {
    const raw = MODE_FOR_SOURCE[(q.requiredSources || [])[0]] || 'general';
    const modeId = isModeId(raw) ? raw : 'general';
    const policy = resolveModePolicy(modeId);

    let answer = ''; let error = null;
    let result; let composed;
    try {
      result = await orchestrate({
        requestId: `pe-${q.id}`, requestSequence: 1, surface: 'manual-chat',
        modeId, scope: { userId: 'local' }, sessionId: 's', manualQuestion: q.question,
      }, port);
      composed = composePrompt({ decision: result.decision, policy, evidence: result.evidence });
      const t = Date.now();
      answer = await generate(key, composed.system, composed.user);
      lat.push(Date.now() - t);
    } catch (e) { error = e.message; }

    const a = norm(answer);
    const gold = (q.goldFacts || []).map(norm);
    const forbidden = (q.rubric?.forbiddenFacts || []).map(norm);

    // Did it state a fact the corpus says is present?
    const groundedHit = gold.length ? gold.some((g) => a.includes(g)) : null;
    // Did it assert something the corpus forbids?
    const forbiddenHit = forbidden.length ? forbidden.some((f) => a.includes(f)) : false;
    // For an unsupported-claim question (category C), did it DISCLOSE rather than invent?
    const disclosed = DISCLOSURE_RE.test(answer);
    // Over-refusal probe: a category-B general question must be answered, not refused.
    const refusedGeneral = q.category === 'B' && (disclosed || a.length < 40);

    rows.push({
      id: q.id, category: q.category, modeId, error,
      answerability: result?.answerability ?? null,
      evidence: result?.evidence.length ?? 0,
      answerChars: answer.length,
      exactStringHit: groundedHit, forbiddenHit, disclosed, refusedGeneral,
      answer,          // synthetic fixtures only — no user data in this corpus
      goldFacts: q.goldFacts || [],
    });
    console.log(`  ${q.id.padEnd(6)} [${(q.category)}] ev=${rows[rows.length - 1].evidence} ` +
      `${error ? 'ERROR ' + error : `exact=${groundedHit} disclosed=${disclosed} chars=${answer.length}`}`);
  }

  // Judge pass over the gold-scored rows.
  process.stdout.write('\njudging');
  for (const r of rows) {
    if (r.error || !r.goldFacts.length) { r.judgeGrounded = null; continue; }
    r.judgeGrounded = await judgeGrounded(key, null, r.goldFacts, r.answer);
    process.stdout.write(r.judgeGrounded === null ? '?' : (r.judgeGrounded ? '.' : 'x'));
  }
  console.log('');

  const ok = rows.filter((r) => !r.error);
  const withGold = ok.filter((r) => r.exactStringHit !== null);
  const catC = ok.filter((r) => r.category === 'C');
  const catB = ok.filter((r) => r.category === 'B');
  const p = (arr, x) => { const s = [...arr].sort((m, n) => m - n); return s[Math.floor(s.length * x)] ?? 0; };

  const summary = {
    runAt: new Date().toISOString(), model: MODEL, temperature: 0,
    questions: rows.length, errors: rows.length - ok.length,
    exactStringGrounding: withGold.length ? withGold.filter((r) => r.exactStringHit).length / withGold.length : null,
    judgedGrounding: (() => {
      const j = ok.filter((r) => typeof r.judgeGrounded === 'boolean');
      return j.length ? j.filter((r) => r.judgeGrounded).length / j.length : null;
    })(),
    factualGroundingN: withGold.length,
    forbiddenClaimRate: ok.length ? ok.filter((r) => r.forbiddenHit).length / ok.length : null,
    unsupportedDisclosureRate: catC.length ? catC.filter((r) => r.disclosed).length / catC.length : null,
    overRefusalRate: catB.length ? catB.filter((r) => r.refusedGeneral).length / catB.length : null,
    ttlMs: { p50: p(lat, 0.5), p95: p(lat, 0.95) },
    rows,
  };
  const outDir = path.join(REPO_ROOT, 'benchmarks/ci-v3-retrieval/results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'provider-eval-latest.json'), JSON.stringify(summary, null, 2));

  const pc = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  console.log('\n=== PROVIDER-BACKED EVALUATION ===');
  console.log(`model                          ${MODEL} @ temperature 0`);
  console.log(`questions / errors             ${rows.length} / ${summary.errors}`);
  console.log(`exact-string grounding         ${pc(summary.exactStringGrounding)}  (n=${summary.factualGroundingN}) — LOWER BOUND, formatting-sensitive`);
  console.log(`JUDGED factual grounding       ${pc(summary.judgedGrounding)}  <- the real measure`);
  console.log(`forbidden-claim rate           ${pc(summary.forbiddenClaimRate)}   (target 0%)`);
  console.log(`unsupported-claim disclosure   ${pc(summary.unsupportedDisclosureRate)}  (category C)`);
  console.log(`over-refusal on general Qs     ${pc(summary.overRefusalRate)}   (target 0%)`);
  console.log(`generation latency             p50 ${summary.ttlMs.p50}ms · p95 ${summary.ttlMs.p95}ms`);
  console.log(`\nwrote ${path.join(outDir, 'provider-eval-latest.json')}`);
  process.exit(0);
})().catch((e) => { console.error('PROVIDER EVAL FAILED:', e.message); process.exit(1); });
