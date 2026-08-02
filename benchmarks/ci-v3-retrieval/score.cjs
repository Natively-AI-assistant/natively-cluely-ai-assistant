/**
 * Phase 2 bake-off — deterministic scorer.
 *
 * A retrieved chunk is GOLD iff its text contains a goldFacts substring after
 * normalisation. Chunker-independent by construction, so the same labels score
 * every configuration fairly. See test-fixtures/ci-v3-corpus/SCHEMA.md.
 */
'use strict';

const norm = (s) => String(s)
  .replace(/ /g, ' ')
  .replace(/[‐-―]/g, '-')
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ')
  .toLowerCase()
  .trim();

const isGold = (chunkText, goldFacts) => {
  const t = norm(chunkText);
  return goldFacts.some((f) => t.includes(norm(f)));
};

/**
 * @param {Array} ranked  candidates in rank order, each { text, fileName }
 * @param {object} q      question record from questions.json
 * @param {Map<string,string>} fileLabel  fileName -> SourceType label
 */
function scoreQuestion(ranked, q, fileLabel) {
  const at = (k) => ranked.slice(0, k);
  const goldIn = (k) => q.goldFacts?.length ? at(k).some((c) => isGold(c.text, q.goldFacts)) : null;

  // Contamination is scored INDEPENDENTLY of whether the answer was right —
  // a prohibited source in the top-k is a failure even when the answer is fine.
  const prohibited = new Set(q.prohibitedSources || []);
  const contaminated = at(5).some((c) => prohibited.has(fileLabel.get(c.fileName)));

  // Stale-version: retriever found something, but the wrong generation of truth.
  const stale = at(5).some((c) => /resume_v1_2023/.test(c.fileName || ''));

  // Category-B questions must not retrieve AT ALL.
  const falseRetrieval = (q.category === 'B') ? ranked.length > 0 : null;

  const precisionAt3 = (q.goldFacts?.length && q.expectedAnswerability === 'FULL')
    ? at(3).filter((c) => isGold(c.text, q.goldFacts)).length / Math.max(1, Math.min(3, ranked.length))
    : null;

  return {
    id: q.id,
    category: q.category,
    scoring: q.scoring,
    recall1: goldIn(1), recall3: goldIn(3), recall5: goldIn(5),
    precision3: precisionAt3,
    contaminated, stale, falseRetrieval,
    retrieved: ranked.length,
    topFile: ranked[0]?.fileName ?? null,
  };
}

const pct = (arr) => {
  const vals = arr.filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  return vals.filter(Boolean).length / vals.length;
};

function aggregate(rows) {
  const det = rows.filter((r) => r.scoring === 'deterministic');
  const p3 = det.map((r) => r.precision3).filter((v) => v !== null);
  return {
    n: rows.length,
    nDeterministic: det.length,
    recall1: pct(det.map((r) => r.recall1)),
    recall3: pct(det.map((r) => r.recall3)),
    recall5: pct(det.map((r) => r.recall5)),
    precision3: p3.length ? p3.reduce((a, b) => a + b, 0) / p3.length : null,
    contaminationRate: pct(rows.map((r) => r.contaminated)),
    staleVersionRate: pct(rows.map((r) => r.stale)),
    falseRetrievalRate: pct(rows.map((r) => r.falseRetrieval)),
  };
}

module.exports = { scoreQuestion, aggregate, isGold, norm };
