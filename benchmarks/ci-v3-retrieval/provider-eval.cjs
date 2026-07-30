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
// ONE corpus, shared with golden-live.cjs. These two lists had drifted to 10
// files versus 13 — the thesis and both superseded revisions were missing here,
// so §26.5 was measured on a smaller corpus than the gates it is reported beside.
const { MODE_FOR_SOURCE, docsForGroup, groupForQuestion, buildRegistry } = require('./corpus.cjs');

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

/**
 * PROVIDER SELECTION.
 *
 * `gemini` is the intended provider for §26.5. It is currently UNUSABLE: both
 * keys — and they are the same two keys the backend uses — return
 * "prepayment credits are depleted", which is not a rate limit.
 *
 * `minimax` runs MiniMax-M3, which this repo already designates as the
 * "Gemini is rate-limited / out of credits / unusable" safety net in the standard
 * AI chain (natively-api/lib/minimaxProvider.js). Using it keeps §26.5's
 * behavioural gates measurable, but it is a DIFFERENT MODEL and every result
 * records which one produced it — the numbers are not interchangeable with the
 * earlier gemini run.
 */
const PROVIDER = process.env.CI_V3_EVAL_PROVIDER || 'gemini';
const MODEL = process.env.CI_V3_EVAL_MODEL
  || (PROVIDER === 'minimax' ? 'MiniMax-M3' : 'gemini-3.1-flash-lite');
const MAX_QUESTIONS = Number(process.env.CI_V3_EVAL_MAX || 42);

/**
 * Read every available key without ever surfacing one.
 *
 * The repo already keeps a rotation pool (GEMINI_API_KEY, _1.._5) because a
 * single key hits per-minute limits. This runner exhausted one key across
 * repeated full runs and reported 39/42 as `provider 429` — numbers that had to
 * be discarded. Rotating plus backing off makes a full run survivable.
 */
function loadKeys() {
  const keys = [];
  const push = (v) => { const t = (v || '').trim().replace(/^['"]|['"]$/g, ''); if (t && !keys.includes(t)) keys.push(t); };
  const prefix = PROVIDER === 'minimax' ? 'MINIMAX_API_KEY' : 'GEMINI_API_KEY';
  push(process.env[prefix]);
  const re = new RegExp(`^(${prefix}(?:_\\d+)?)=(.*)$`);
  // The backend keeps its own pool; for MiniMax only one of the keys has credit,
  // so both files are read and duplicates collapsed by value.
  for (const rel of ['.env', 'natively-api/.env']) {
    const p = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.trim().match(re);
      if (m) push(m[2]);
    }
  }
  return keys;
}

// MiniMax-M3 emits a leading <think> block even with reasoning disabled. Left in,
// it would wreck every metric here: the word-count ceiling, the boilerplate
// detector and the disclosure detector would all be reading chain-of-thought
// rather than the answer. Reuses the provider's OWN stripper rather than a second
// implementation that could drift from it.
const stripLeadingThink = PROVIDER === 'minimax'
  ? require(path.join(REPO_ROOT, 'natively-api/lib/minimaxProvider.js')).stripLeadingThink
  : (t) => t;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Keys whose credit is exhausted, by index.
 *
 * Exhaustion is a property of ONE key, not of the provider. Treating it as
 * provider-wide aborted the run on the first dead key while a sibling key with
 * credit sat unused — which is exactly what happened on the MiniMax pool, where
 * key #1 is over its token plan and key #2 works. The run may only give up once
 * EVERY key is dead.
 */
const deadKeys = new Set();

/**
 * Generate with key rotation and exponential backoff.
 *
 * A 429 is a quota condition, not a system defect — treating it as an error row
 * silently corrupts every rate downstream (a run reporting 0% boilerplate on
 * n=3 looks like a pass).
 */
async function generate(keys, system, user, attempt = 0) {
  const live = keys.map((k, i) => i).filter((i) => !deadKeys.has(i));
  if (!live.length) {
    const err = new Error(`all ${keys.length} ${PROVIDER} key(s) exhausted`);
    err.allKeysDead = true;
    throw err;
  }
  const keyIndex = live[attempt % live.length];
  const key = keys[keyIndex];

  const res = PROVIDER === 'minimax'
    ? await fetch('https://api.minimax.io/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0, max_tokens: 600, stream: false,
      }),
      signal: AbortSignal.timeout(90_000),
    })
    : await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

  if (!res.ok) {
    // A 429 is not always transient. Both keys once returned
    // "prepayment credits are depleted", which no amount of backoff clears —
    // reported as a bare `provider 429` it looked like throttling and cost an
    // hour of waiting for a limit that was never going to lift. So the reason is
    // read out of the body and a non-retryable exhaustion fails FAST.
    let reason = '';
    try {
      const body = await res.json();
      reason = String(body?.error?.message ?? '').slice(0, 200);
    } catch { /* body already consumed or not JSON */ }

    const depleted = /credit|billing|depleted|token plan|usage limit|exceeded your current quota/i.test(reason);
    if (depleted) {
      // Retire THIS key and immediately try a sibling. Only when the whole pool is
      // dead does the run stop.
      deadKeys.add(keyIndex);
      if (deadKeys.size < keys.length) return generate(keys, system, user, attempt + 1);
      const err = new Error(`all ${keys.length} ${PROVIDER} key(s) exhausted — last: ${reason}`);
      err.allKeysDead = true;
      throw err;
    }
    if (res.status === 429 && attempt < keys.length * 3) {
      // Transient throttling: rotate first, then back off.
      const waitMs = attempt < live.length ? 250 : 2000 * Math.pow(2, attempt - live.length);
      await sleep(waitMs);
      return generate(keys, system, user, attempt + 1);
    }
    throw new Error(`provider ${res.status}${reason ? `: ${reason}` : ''}`);
  }
  const j = await res.json();
  if (PROVIDER === 'minimax') {
    // MiniMax returns HTTP 200 with an in-body failure code, so base_resp must be
    // checked or a failed call is scored as an empty answer.
    const code = j?.base_resp?.status_code;
    if (code !== undefined && code !== 0) {
      throw new Error(`minimax base_resp ${code}: ${String(j?.base_resp?.status_msg ?? '').slice(0, 120)}`);
    }
    return stripLeadingThink(String(j?.choices?.[0]?.message?.content ?? '')).trim();
  }
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
async function judgeGrounded(keys, question, goldFacts, answer) {
  if (!goldFacts.length || !answer) return null;
  const sys = 'You grade whether an answer states a required fact. Reply with exactly one word: YES or NO. '
    + 'YES if the answer conveys the required fact, allowing different wording, units or formatting '
    + '(for example "$175,000 to $200,000" conveys "175-200k"). NO otherwise.';
  const user = `REQUIRED FACT: ${goldFacts.join(' | ')}\n\nANSWER: ${answer}\n\nDoes the answer convey the required fact? YES or NO.`;
  try {
    const v = await generate(keys, sys, user);
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


// ── §20 read-aloud quality ───────────────────────────────────────────────────
//
// Grounding and safety are not the same as a good spoken answer. §20 is explicit
// that the answer must sound like something the user can say immediately, and
// that attribution boilerplate and blanket disclaimers are failures even when
// the facts are right.

/** The phrasings §20 names as the thing to avoid. */
const BOILERPLATE_RE = /\b(according to the (uploaded |provided )?(document|material|file|reference)|based on the provided (context|document|material)|the reference file states|as (stated|mentioned) in the (document|material)|per the (document|provided) )/i;

/** A spoken answer is a few sentences, not an essay. §11 budgets 15-30s. */
const SPOKEN_WORD_CEILING = 120;

function spokenQuality(answer, answerability) {
  const words = String(answer).trim().split(/\s+/).filter(Boolean).length;
  return {
    words,
    // Attribution boilerplate: forbidden regardless of correctness.
    boilerplate: BOILERPLATE_RE.test(answer),
    // Length discipline for a read-aloud answer.
    overLong: words > SPOKEN_WORD_CEILING,
    // A disclosure on a turn the DECISION called FULL.
    //
    // Named carefully, because inspection showed this is usually NOT the model
    // hedging unnecessarily — it is the model correctly reporting that the
    // retrieved evidence does not contain the fact, on a turn where
    // evidenceSupportsClaim() wrongly counted a chunk as support. Salient-term
    // overlap is too lenient: a BERT-paper chunk shared enough vocabulary with
    // "what success rate did the proposed system achieve?" to satisfy a claim
    // about the thesis.
    //
    // So this metric measures DECISION PRECISION, not answer style, and the
    // model is the more accurate of the two.
    disclosureOnFullTurn: answerability === 'FULL' && DISCLOSURE_RE.test(answer),
  };
}


(async () => {
  const keys = loadKeys();
  if (!keys.length) { console.error('NO API KEY AVAILABLE — provider evaluation cannot run.'); process.exit(2); }
  console.log(`[eval] provider=${PROVIDER} model=${MODEL} · ${keys.length} key(s) in rotation`);

  const b = await boot({ verbose: false });
  const { orchestrate } = d('electron/context-intelligence/orchestration/orchestrator.js');
  const { composePrompt } = d('electron/context-intelligence/generation/prompt-composer.js');
  const { resolveModePolicy, isModeId } = d('electron/context-intelligence/policies/mode-policy-registry.js');
  const { createLegacyRetrievalPort } = d('electron/context-intelligence/retrieval/legacy-retrieval-port.js');
  const { ModesManager } = d('electron/services/ModesManager.js');

  // Per-GROUP ingestion, matching golden-live. A merged corpus put two different
  // people's résumés under one RESUME label and contaminated the C-* fabrication
  // probes — including C-02, the canonical JD-as-experience case.
  const mm = ModesManager.getInstance();
  const groups = {};
  for (const group of ['base', 'versioned']) {
    const { mode, ingested } = await ingestCorpus(b, docsForGroup(group), {
      modeName: `CIv3 Eval ${group}`,
    });
    const indexed = ingested.filter((i) => i.file);
    assertVectorRunValid({ db: b.db, spaceKey: b.spaceKey, fileIds: indexed.map((i) => i.file.id) });
    const registry = buildRegistry(indexed);
    const files = mm.getReferenceFiles(mode.id);
    groups[group] = {
      port: createLegacyRetrievalPort({
        registry,
        retrieve: async (query, opts) => {
          const res = await mm.retrieveHybridRaw(mode, files, {
            query, topK: opts.topK, tokenBudget: 3600, allowRerank: false,
          });
          return (res?.chunks ?? []).map((c) => ({
            sourceId: c.sourceId, fileName: c.fileName, text: c.text,
            chunkIndex: c.chunkIndex, score: c.score, ftsScore: c.ftsScore, vectorScore: c.vectorScore,
          }));
        },
      }),
    };
    console.log(`[eval] group ${group}: ${indexed.length} files`);
  }

  const bank = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'test-fixtures/ci-v3-corpus/questions.json'), 'utf8')).questions.slice(0, MAX_QUESTIONS);

  const rows = []; const lat = [];
  for (const q of bank) {
    const raw = MODE_FOR_SOURCE[(q.requiredSources || [])[0]] || 'general';
    const modeId = isModeId(raw) ? raw : 'general';
    const policy = resolveModePolicy(modeId);
    // Retrieval group (which documents exist) and policy mode (which source
    // types may be read) are different axes.
    const { port } = groups[groupForQuestion(q.id)];

    let answer = ''; let error = null;
    let result; let composed;
    try {
      result = await orchestrate({
        requestId: `pe-${q.id}`, requestSequence: 1, surface: 'manual-chat',
        modeId, scope: { userId: 'local' }, sessionId: 's', manualQuestion: q.question,
      }, port);
      composed = composePrompt({ decision: result.decision, policy, evidence: result.evidence });
      const t = Date.now();
      answer = await generate(keys, composed.system, composed.user);
      await sleep(400);   // pace the run so a full pass does not self-throttle
      lat.push(Date.now() - t);
    } catch (e) {
      error = e.message;
      // Credit exhaustion will not resolve within the run. Stopping immediately
      // beats emitting 42 identical failure rows and a results file whose rates
      // are all computed over an empty numerator.
      if (e.allKeysDead) {
        console.error(`\n*** ABORTING — every ${PROVIDER} key is out of credit, so §26.5 cannot be measured.\n`
          + `    ${e.message}\n`
          + `    This is NOT a rate limit; waiting will not clear it. Top up the key's billing,\n`
          + `    then re-run. No result file is written, so no stale numbers can be quoted.`);
        process.exit(3);
      }
    }

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
      ...spokenQuality(answer, result?.answerability ?? null),
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
    r.judgeGrounded = await judgeGrounded(keys, null, r.goldFacts, r.answer);
    await sleep(300);
    process.stdout.write(r.judgeGrounded === null ? '?' : (r.judgeGrounded ? '.' : 'x'));
  }
  console.log('');

  const ok = rows.filter((r) => !r.error);
  const withGold = ok.filter((r) => r.exactStringHit !== null);
  const catC = ok.filter((r) => r.category === 'C');
  const catB = ok.filter((r) => r.category === 'B');
  const p = (arr, x) => { const s = [...arr].sort((m, n) => m - n); return s[Math.floor(s.length * x)] ?? 0; };

  const summary = {
    runAt: new Date().toISOString(), provider: PROVIDER, model: MODEL, temperature: 0,
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
    boilerplateRate: ok.length ? ok.filter((r) => r.boilerplate).length / ok.length : null,
    overLongRate: ok.length ? ok.filter((r) => r.overLong).length / ok.length : null,
    disclosureOnFullTurnRate: (() => {
      const full = ok.filter((r) => r.answerability === 'FULL');
      return full.length ? full.filter((r) => r.disclosureOnFullTurn).length / full.length : null;
    })(),
    words: { p50: p(ok.map((r) => r.words), 0.5), p95: p(ok.map((r) => r.words), 0.95) },
    rows,
  };
  const outDir = path.join(REPO_ROOT, 'benchmarks/ci-v3-retrieval/results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'provider-eval-latest.json'), JSON.stringify(summary, null, 2));

  const errRate = (rows.length - ok.length) / Math.max(1, rows.length);
  if (errRate > 0.1) {
    console.log(`\n*** RUN VOID — ${rows.length - ok.length}/${rows.length} requests failed `
      + `(${(errRate * 100).toFixed(0)}%). Rates below are NOT reportable. ***`);
  }
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
  console.log('\n--- §20 READ-ALOUD QUALITY ---');
  console.log(`  attribution boilerplate      ${pc(summary.boilerplateRate)}   (target 0%)`);
  console.log(`  over-long for spoken use     ${pc(summary.overLongRate)}   (>${SPOKEN_WORD_CEILING} words)`);
  console.log(`  disclosure on a FULL turn    ${pc(summary.disclosureOnFullTurnRate)}   <- decision precision, not style`);
  console.log(`  answer length                p50 ${summary.words.p50} words · p95 ${summary.words.p95}`);
  console.log(`\nwrote ${path.join(outDir, 'provider-eval-latest.json')}`);
  process.exit(0);
})().catch((e) => { console.error('PROVIDER EVAL FAILED:', e.message); process.exit(1); });
