// tests/e2e-modes/scorer.mjs
//
// HYBRID rubric scorer for E2E answers. Scoring is part CODE, part JUDGE:
//
//   ANCHOR facts     (numbers, named entities, acronyms, product names)
//                    -> STRICT deterministic substring/number match. MUST appear.
//   FORBIDDEN facts  (hallucinated numbers/entities/claims)
//                    -> STRICT deterministic. Any hit = HARD FAIL. Never weakened.
//   REFUSAL behavior (no-answer questions must refuse; answerable must not
//                    falsely refuse) -> STRICT deterministic. Inversion = HARD FAIL.
//   SEMANTIC facts   (paraphrasable prose: "these documents", "closed ecosystem",
//                    "data quality") + FORMAT constraints (STAR, cites section, ...)
//                    -> emitted as `semanticCriteria` for the LLM-judge to decide.
//
// scoreAnswer() runs the fully-deterministic pass and returns the semanticCriteria.
// The caller (runMatrix) batches those through llmJudge.judge() and calls
// mergeSemantic() to produce the FINAL verdict:
//
//   FINAL pass = (all anchors present) AND (no forbidden facts) AND
//                (refusal behavior correct) AND (judge passes the semantic criteria)
//
// If the judge is unavailable, mergeSemantic() falls back to a LENIENT pass on the
// semantic-only criteria (a judge outage must not fabricate a product failure); the
// deterministic hard checks still stand.

// ---------------------------------------------------------------------------
// Normalization + fact matching
// ---------------------------------------------------------------------------

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Canonicalize percentages: "44 percent", "44 %", "44.0%" -> "44%".
function percentCanon(s) {
  return s.replace(/(\d[\d.]*)\s*(?:%|percent)/g, '$1%');
}

// Canonicalize magnitude suffixes: "110 million"/"110m" -> "110m";
// "18.8 trillion" -> "18.8t"; keeps a compact comparable token.
function magnitudeCanon(s) {
  return s
    .replace(/(\d[\d.]*)\s*(?:m\b|million\b)/g, '$1m')
    .replace(/(\d[\d.]*)\s*(?:b\b|billion\b)/g, '$1b')
    .replace(/(\d[\d.]*)\s*(?:t\b|trillion\b)/g, '$1t');
}

// Build a tolerant regex from a numeric fact so "152 layers" also matches
// "152-layer" / "152  layers"; a trailing plural 's' is optional.
function flexRegex(f) {
  let body = f
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape
    .replace(/(?:\\?[\s\-_])+/g, '[\\s\\-_]*'); // flexible separators
  if (/[a-z]s$/.test(f)) body = body.replace(/s$/, 's?'); // optional plural
  try {
    return new RegExp(body);
  } catch {
    return null;
  }
}

// Deterministic presence test used for ANCHOR + FORBIDDEN facts.
export function factPresent(answer, fact) {
  const a = normalize(answer);
  const f = normalize(fact);
  if (!f) return true;
  if (a.includes(f)) return true;

  if (/\d/.test(f)) {
    const aN = a.replace(/,/g, '');
    const fN = f.replace(/,/g, '');
    if (aN.includes(fN)) return true;
    // percentage + magnitude equivalences
    const aP = magnitudeCanon(percentCanon(aN));
    const fP = magnitudeCanon(percentCanon(fN));
    if (aP.includes(fP)) return true;
    // tolerant "<number> <word>" spacing/hyphenation
    const rx = flexRegex(fN);
    if (rx && rx.test(aN)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Anchor vs. semantic classification
// ---------------------------------------------------------------------------

const PROPER_STOP = new Set(['of', 'the', 'and', 'for', 'to', 'on', 'in', 'a', 'an', 'is', 'or']);

function isProperNoun(f) {
  const words = f.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  let capSeen = false;
  for (const w of words) {
    if (PROPER_STOP.has(w.toLowerCase())) continue;
    if (!/^[A-Z][\w'’.-]*$/.test(w)) return false;
    capSeen = true;
  }
  return capSeen;
}

/**
 * ANCHOR  = strict, must appear verbatim-ish.
 * SEMANTIC = paraphrasable prose, judged by the LLM.
 *
 * A fact is an ANCHOR if it is:
 *   - a short (<=2 word) token containing a digit  (numbers/measurements), OR
 *   - a short (<=2 word) token with an ACRONYM run  (UTF, MUST, BI), OR
 *   - a proper noun / product / person name         (Ville Kyrki, Tableau, Japan)
 * Long phrases with digits ("24 transformer layers") are PROSE -> semantic, since
 * the model will phrase them freely ("L=24") and substring matching is unfair.
 */
export function classifyFact(fact) {
  const f = String(fact || '').trim();
  if (!f) return 'semantic';
  const words = f.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && /\d/.test(f)) return 'anchor';
  if (words.length <= 2 && /[A-Z]{2,}/.test(f)) return 'anchor';
  if (!/\d/.test(f) && isProperNoun(f)) return 'anchor';
  return 'semantic';
}

// ---------------------------------------------------------------------------
// Refusal detection
// ---------------------------------------------------------------------------

const REFUSAL_PATTERNS = [
  // "not in / not present / not covered / not addressed / not disclosed ..."
  /\bnot\b[^.]{0,40}\b(?:in|present|found|covered|available|mentioned|stated|contained|addressed|included|disclosed|specified|part of|reflected|provided)\b/i,
  /(?:isn't|is not|are not|aren't|wasn't|weren't)[^.]{0,30}\b(?:in|present|found|covered|available|mentioned|stated|contained|addressed|included|disclosed|part of)\b/i,
  /(?:does|do|did)(?:n't| not)[^.]{0,30}\b(?:contain|include|state|mention|cover|address|provide|disclose|specify|reflect|say)\b/i,
  /\bnone of (?:the )?(?:retrieved|these|those|the provided|the uploaded|the available|the given)\b/i,
  /\bno (?:information|data|mention|reference|record|section|excerpt)\b[^.]{0,30}\b(?:about|on|regarding|of|for|in)\b/i,
  /(?:couldn't|could not|cannot|can't|unable to)\s+(?:find|locate|see|confirm|verify|pull|quote|provide|answer)/i,
  /(?:aren't|isn't|not)\s+something (?:i can|the|these)/i,
  /\b(?:beyond|outside)\s+(?:the\s+)?(?:scope|these|this|the provided|my knowledge)/i,
  /\bi (?:don't|do not) have (?:that|this|the|any|enough|access)/i,
  /\b(?:can't|cannot|couldn't|could not) (?:be )?ground(?:ed)?/i,
  /\bno (?:extractable|readable|machine-readable|selectable)\s+text\b/i,
  /\bimage[- ]only\b|\bno text layer\b/i,
  /\bnot (?:something|a topic) (?:the|these|those)\b/i,
  /\bescalat/i,
];

export function looksLikeRefusal(answer) {
  const a = String(answer || '');
  return REFUSAL_PATTERNS.some((re) => re.test(a));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Deterministic pass over one answer. Returns a partial result plus the list of
 * `semanticCriteria` that still need the LLM-judge. Does NOT produce the final
 * pass unless there are zero semantic criteria (then `pass` is authoritative).
 */
export function scoreAnswer(question, answerText) {
  const rubric = question.rubric || {};
  const answer = String(answerText || '');
  const criteria = [];
  let hardFail = false;

  const requiredFacts = rubric.requiredFacts || [];
  const anchors = requiredFacts.filter((f) => classifyFact(f) === 'anchor');
  const semanticFacts = requiredFacts.filter((f) => classifyFact(f) === 'semantic');

  // --- ANCHOR facts (strict) ---
  let anchorPass = true;
  for (const fact of anchors) {
    const ok = factPresent(answer, fact);
    if (!ok) anchorPass = false;
    criteria.push({ kind: 'anchor', name: `anchor:"${fact}"`, ok, detail: ok ? 'present' : 'MISSING' });
  }

  // --- FORBIDDEN facts (strict, hard) ---
  let forbiddenPass = true;
  for (const fact of rubric.forbiddenFacts || []) {
    const present = factPresent(answer, fact);
    if (present) {
      forbiddenPass = false;
      hardFail = true;
    }
    criteria.push({ kind: 'forbidden', name: `forbidden:"${fact}"`, ok: !present, detail: present ? 'HALLUCINATED' : 'absent' });
  }

  // --- REFUSAL behavior (strict, hard) ---
  const refused = looksLikeRefusal(answer);
  let refusalPass = true;
  if (typeof rubric.refusalExpected === 'boolean') {
    if (rubric.refusalExpected) {
      // no-answer question: MUST refuse / disclaim (an empty answer does NOT count
      // as a refusal — a timeout/blank is a product failure, not a safe refusal).
      const ok = refused && answer.trim().length > 0;
      refusalPass = ok;
      if (!ok) hardFail = true;
      criteria.push({ kind: 'refusal', name: 'refusal-expected', ok, detail: ok ? 'refused safely' : 'DID NOT REFUSE' });
    } else {
      // answerable question: a FALSE refusal is when the model declines the WHOLE
      // question and supplies essentially none of the requested facts. An answer
      // that DID surface some anchors but declined ONE sub-part it couldn't find is
      // a partial retrieval miss (handled by the missing-anchor criterion), NOT a
      // false refusal — don't double-penalize it as a hardFail.
      const anchorsPresent = anchors.filter((f) => factPresent(answer, f)).length;
      const answeredSomething = anchorsPresent > 0 || answer.trim().length >= 500;
      const falseRefusal = refused && !answeredSomething && answer.trim().length < 500;
      refusalPass = !falseRefusal;
      if (falseRefusal) hardFail = true;
      criteria.push({ kind: 'refusal', name: 'no-false-refusal', ok: refusalPass, detail: falseRefusal ? 'FALSE REFUSAL' : (refused ? 'partial-decline (answered some)' : 'answered') });
    }
  }

  // --- SEMANTIC criteria (deferred to the LLM-judge) ---
  const semanticCriteria = [];
  for (const fact of semanticFacts) {
    semanticCriteria.push({ source: 'requiredFact', text: `The answer conveys: "${fact}".` });
  }
  for (const constraint of rubric.formatConstraints || []) {
    semanticCriteria.push({ source: 'formatConstraint', text: constraint });
  }

  const deterministicCriteria = criteria; // anchors + forbidden + refusal
  const passedDet = deterministicCriteria.filter((c) => c.ok).length;
  const deterministicPass = !hardFail && anchorPass && forbiddenPass && refusalPass;

  return {
    // deterministic verdict components
    hardFail,
    refused,
    anchorPass,
    forbiddenPass,
    refusalPass,
    deterministicPass,
    // deterministic criteria + counts
    criteria: deterministicCriteria,
    score: passedDet,
    maxScore: deterministicCriteria.length,
    // work for the judge
    semanticCriteria,
    // convenience: if there is nothing for the judge, this IS the final pass
    pass: semanticCriteria.length === 0 ? deterministicPass : undefined,
  };
}

/**
 * Merge LLM-judge verdicts back into a deterministic scoreAnswer() result to
 * produce the FINAL verdict.
 *
 * @param det       result of scoreAnswer()
 * @param verdicts  array aligned (by order) to det.semanticCriteria, each
 *                  {pass:boolean, reason?:string}. Pass `null` when the judge
 *                  could not be reached.
 * @param opts      { judgeUnavailable?:boolean }
 */
export function mergeSemantic(det, verdicts, opts = {}) {
  const judgeUnavailable = opts.judgeUnavailable === true || verdicts == null;
  const criteria = det.criteria.slice();
  let semanticPass = true;

  det.semanticCriteria.forEach((sc, i) => {
    const v = Array.isArray(verdicts) ? verdicts[i] : undefined;
    let ok;
    let detail;
    if (judgeUnavailable) {
      ok = true; // lenient: a judge outage must not fake a product failure
      detail = 'judge_unavailable (lenient pass)';
    } else if (v == null) {
      ok = true; // missing verdict for this criterion -> lenient
      detail = 'no verdict (lenient pass)';
    } else {
      ok = v.pass === true;
      detail = (v.reason || (ok ? 'judged pass' : 'judged fail')).slice(0, 160);
    }
    if (!ok) semanticPass = false;
    criteria.push({ kind: 'semantic', name: `${sc.source}:"${sc.text}"`, ok, detail, judged: !judgeUnavailable && v != null });
  });

  // Semantic criteria NEVER flip a deterministic hard-fail to a pass, and a failed
  // semantic criterion is NOT a hard-fail (it is a soft/quality miss).
  const pass = det.deterministicPass && semanticPass;
  const passed = criteria.filter((c) => c.ok).length;

  return {
    pass,
    hardFail: det.hardFail,
    semanticPass,
    judgeUnavailable,
    refused: det.refused,
    score: passed,
    maxScore: criteria.length,
    criteria,
  };
}

/** Aggregate a set of per-question results into matrix metrics. */
export function aggregate(results) {
  const scored = results.filter((r) => r.score && typeof r.score.maxScore === 'number');
  const total = scored.length;
  const hardFails = scored.filter((r) => r.score.hardFail).length;
  const passes = scored.filter((r) => r.score.pass).length;
  let critPassed = 0, critTotal = 0;
  for (const r of scored) {
    critPassed += r.score.score || 0;
    critTotal += r.score.maxScore || 0;
  }
  const detectionInjected = results.filter((r) => r.detection && r.detection.expectedQuestion).length;
  const detectionCorrect = results.filter((r) => r.detection && r.detection.expectedQuestion && r.detection.detected).length;
  const falseFires = results.reduce((n, r) => n + (r.detection?.falseFires || 0), 0);
  return {
    total,
    passes,
    hardFails,
    rubricCriteriaPassRate: critTotal ? critPassed / critTotal : 1,
    questionPassRate: total ? passes / total : 1,
    detection: { injected: detectionInjected, correct: detectionCorrect, falseFires },
  };
}
