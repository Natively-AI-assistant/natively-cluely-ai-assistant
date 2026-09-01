#!/usr/bin/env node
// benchmarks/reranker-eval/score.mjs
//
// Reads results/raw/*.json (written by run.mjs) and computes ranking +
// latency + memory metrics per candidate, writing results/REPORT.md.
// Pure scoring functions are exported for testing; the file-reading/writing
// main() only runs when this file is executed directly, not when imported
// by the test.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reciprocalRank, recallAtK, ndcgAtK, aggregateMetrics } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computeCandidateMetrics(pools, result) {
  if (!result || result.failed || result.skipped) return null;

  const poolById = new Map(pools.map((p) => [p.queryId, p]));
  const perQueryMetrics = [];
  const latencies = [];

  for (const r of result.perQuery) {
    const pool = poolById.get(r.queryId);
    if (!pool || pool.goldChunkPoolIndices.length === 0) continue; // unscorable — gold never made the pool

    const goldSet = new Set(pool.goldChunkPoolIndices);
    const rankedGoldFlags = r.order.map((poolIdx) => goldSet.has(poolIdx));

    perQueryMetrics.push({
      mrr: reciprocalRank(rankedGoldFlags),
      recallAt1: recallAtK(rankedGoldFlags, 1),
      recallAt3: recallAtK(rankedGoldFlags, 3),
      ndcg: ndcgAtK(rankedGoldFlags, 10),
    });
    if (typeof r.latencyMs === 'number') latencies.push(r.latencyMs);
  }

  const agg = aggregateMetrics(perQueryMetrics);
  const sortedLatencies = [...latencies].sort((a, b) => a - b);

  return {
    ...agg,
    p50LatencyMs: percentile(sortedLatencies, 50),
    p95LatencyMs: percentile(sortedLatencies, 95),
    peakRssMb: result.peakRssMb ?? null,
    scoredQueryCount: perQueryMetrics.length,
  };
}

function fmt(n) {
  return n === null || n === undefined ? '—' : (Number.isInteger(n) ? String(n) : n.toFixed(3));
}

const DISAGREEMENT_TRUNCATE_LEN = 80;

/**
 * Truncates chunk text for display, but only appends "..." when the
 * original text was actually longer than the truncation length — otherwise
 * a short chunk (e.g. a bare heading with no body) looks identical to a
 * genuinely-truncated long one, hiding a real content-quality signal (see
 * findContentFreeTopPicks below).
 */
function truncateChunkText(text) {
  const oneLine = text.replace(/\n/g, ' ');
  if (oneLine.length <= DISAGREEMENT_TRUNCATE_LEN) return oneLine;
  return oneLine.slice(0, DISAGREEMENT_TRUNCATE_LEN) + '...';
}

/**
 * Per-query breakdown: only queries where the live (non-failed, non-skipped)
 * candidates disagree on their #1 pick — the design's "interesting
 * failure/success cases, not all queries verbatim." A candidate whose
 * result.perQuery has no entry for a given queryId (shouldn't happen, but
 * defensive) is silently excluded from that query's comparison rather than
 * crashing the report.
 *
 * The returned array is sliced to `limit`, but carries a non-enumerable-ish
 * `.totalCount` property (arrays can hold arbitrary extra properties in JS)
 * with the FULL disagreement count before slicing, so callers can report
 * how many additional disagreeing queries were left out.
 */
export function findDisagreements(pools, candidateResults, limit = 15) {
  const live = candidateResults.filter((c) => c.result && !c.result.failed && !c.result.skipped);
  const rows = [];

  for (const pool of pools) {
    const picks = live
      .map((c) => {
        const pq = c.result.perQuery.find((r) => r.queryId === pool.queryId);
        if (!pq || pq.order.length === 0) return null;
        const topPoolIdx = pq.order[0];
        const chunk = pool.pool[topPoolIdx];
        return {
          name: c.name,
          topChunkText: chunk ? truncateChunkText(chunk.text) : '(none)',
          isGold: pool.goldChunkPoolIndices.includes(topPoolIdx),
        };
      })
      .filter(Boolean);

    const uniqueTopPicks = new Set(picks.map((p) => p.topChunkText));
    if (uniqueTopPicks.size > 1) {
      rows.push({ queryId: pool.queryId, query: pool.query, picks });
    }
  }

  const sliced = rows.slice(0, limit);
  sliced.totalCount = rows.length;
  return sliced;
}

/**
 * A chunk counts as "content-free" when, after stripping the `[context: ...]`
 * annotation prefix that semanticChunker.ts prepends, either:
 *   (a) EVERY remaining non-empty line is itself a markdown heading (no body
 *       line at all) — this is the defining property of a "bare title" or
 *       "empty heading" chunk, regardless of how long the heading text is
 *       (e.g. "# Senior Backend Engineer — CloudScale Systems" is a bare
 *       document-title chunk with real words but zero body underneath it), or
 *   (b) after also stripping heading markers, fewer than ~15 characters of
 *       actual content remain (catches short non-heading junk).
 * A short-text-length check ALONE would under-catch case (a) for a heading
 * whose title text happens to be long.
 */
export function isContentFreeChunk(text) {
  if (!text) return true;
  let t = text.trim();
  t = t.replace(/^\[context:[^\]]*\]\s*/i, '');

  const lines = t.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const allHeadings = lines.length > 0 && lines.every((l) => /^#+\s/.test(l) || /^#+$/.test(l));
  if (allHeadings) return true;

  const stripped = t.replace(/^#+\s*/gm, '').trim();
  return stripped.length < 15;
}

/**
 * For every live (non-failed, non-skipped) candidate, counts how many of its
 * #1 picks across ALL queries (not just the disagreement subset — that's
 * limited to `limit` rows and would undercount) are content-free chunks per
 * isContentFreeChunk(). This is what surfaces the production-quality finding
 * that a reranker can score well on MRR while still frequently surfacing an
 * unhelpful, content-free top chunk.
 */
export function findContentFreeTopPicks(pools, candidateResults) {
  const poolById = new Map(pools.map((p) => [p.queryId, p]));
  const live = candidateResults.filter((c) => c.result && !c.result.failed && !c.result.skipped);

  return live.map((c) => {
    let count = 0;
    let total = 0;
    for (const r of c.result.perQuery) {
      const pool = poolById.get(r.queryId);
      if (!pool || !r.order || r.order.length === 0) continue;
      total += 1;
      const chunk = pool.pool[r.order[0]];
      if (chunk && isContentFreeChunk(chunk.text)) count += 1;
    }
    return { name: c.name, count, total };
  });
}

function renderFailedRow(name, result) {
  if (result?.skipped) return `| ${name} | SKIPPED — no COHERE_API_KEY | | | | | | | |`;
  return `| ${name} | FAILED — see logs (${result?.error ?? 'unknown error'}) | | | | | | | |`;
}

function fmtPct(count, total) {
  return total > 0 ? `${count}/${total} (${Math.round((count / total) * 100)}%)` : `${count}/${total}`;
}

export function renderReport(candidateMetrics, disagreements, options = {}) {
  const {
    baselineName = 'baseline',
    provenance = null, // { scoredQueryCount, poolSize }
    contentFreeStats = [], // from findContentFreeTopPicks
  } = typeof options === 'string' ? { baselineName: options } : options; // back-compat: 3rd arg used to be baselineName string

  const baseline = candidateMetrics.find((c) => c.name === baselineName);
  const rows = candidateMetrics.map((c) => {
    if (!c.metrics) return renderFailedRow(c.name, c.result);
    const deltaMrr = baseline?.metrics ? (c.metrics.mrr - baseline.metrics.mrr) : null;
    return `| ${c.name} | ${fmt(c.metrics.mrr)} | ${fmt(c.metrics.recallAt1)} | ${fmt(c.metrics.recallAt3)} | ${fmt(c.metrics.ndcg)} | ${deltaMrr === null ? '—' : (deltaMrr >= 0 ? '+' : '') + deltaMrr.toFixed(3)} | ${fmt(c.metrics.p50LatencyMs)}ms | ${fmt(c.metrics.p95LatencyMs)}ms | ${c.metrics.peakRssMb ? c.metrics.peakRssMb.toFixed(0) + 'MB' : '—'} |`;
  });

  const ranked = candidateMetrics
    .filter((c) => c.metrics && c.name !== baselineName)
    .sort((a, b) => b.metrics.mrr - a.metrics.mrr);
  const winner = ranked[0];

  const LIVE_PATH_BUDGET_MS = 1200; // matches ModeHybridRetriever.ts's RERANK_BUDGET_MS
  let verdict;
  if (!winner) {
    verdict = 'No candidate produced usable results — check results/raw/*.json for errors.';
  } else {
    const clearsBudget = winner.metrics.p95LatencyMs < LIVE_PATH_BUDGET_MS;
    verdict = `**${winner.name}** has the highest MRR (${winner.metrics.mrr.toFixed(3)}, `
      + `+${(winner.metrics.mrr - (baseline?.metrics?.mrr ?? 0)).toFixed(3)} vs baseline). `
      + `It ${clearsBudget ? 'CLEARS' : 'DOES NOT CLEAR'} the ${LIVE_PATH_BUDGET_MS}ms live-path latency budget `
      + `(p95: ${fmt(winner.metrics.p95LatencyMs)}ms).`;
    if (!clearsBudget) {
      const budgetWinner = ranked.find((c) => c.metrics.p95LatencyMs < LIVE_PATH_BUDGET_MS);
      verdict += budgetWinner
        ? ` The best candidate that DOES clear the budget is **${budgetWinner.name}** (MRR ${budgetWinner.metrics.mrr.toFixed(3)}).`
        : ' No candidate clears the live-path budget among the candidates that actually ran — none should be used on the live transcript path (ragSpeculativeRerank) without further tuning.';
    }
  }

  // Scope the verdict to what was actually measured: a skipped/failed
  // candidate is unmeasured, not a candidate that "failed to clear the
  // budget" — the two must never be conflated in a claim someone will act on.
  const unmeasured = candidateMetrics.filter((c) => !c.metrics && (c.result?.skipped || c.result?.failed));
  for (const c of unmeasured) {
    if (c.result?.skipped) {
      verdict += ` **${c.name}** was SKIPPED (no COHERE_API_KEY) and remains unmeasured — this verdict does not evaluate it.`;
    } else {
      verdict += ` **${c.name}** FAILED to run (${c.result?.error ?? 'unknown error'}) and remains unmeasured — this verdict does not evaluate it.`;
    }
  }

  const disagreementRows = disagreements.length === 0
    ? '_No disagreements — every live candidate picked the same top chunk for every query._'
    : [
      '| Query | Candidate | Top pick (truncated) | Correct? |',
      '|---|---|---|---|',
      ...disagreements.flatMap((d) =>
        d.picks.map((p, i) => `| ${i === 0 ? d.query.replace(/\|/g, '\\|') : ''} | ${p.name} | ${p.topChunkText.replace(/\|/g, '\\|')} | ${p.isGold ? '✅' : '❌'} |`),
      ),
    ].join('\n');
  const truncatedCount = (disagreements.totalCount ?? disagreements.length) - disagreements.length;
  const disagreementSection = truncatedCount > 0
    ? `${disagreementRows}\n\n_(${truncatedCount} more disagreeing quer${truncatedCount === 1 ? 'y' : 'ies'} not shown — see the raw JSON for the full list.)_`
    : disagreementRows;

  const contentFreeLine = contentFreeStats.length > 0
    ? `**Content-free top-picks:** ${contentFreeStats.map((s) => `${s.name}: ${fmtPct(s.count, s.total)}`).join(', ')} — the share of queries where a candidate's #1 pick is a content-free chunk (a bare title or empty heading with no body text), per \`isContentFreeChunk()\` in score.mjs.`
    : null;

  const provenanceSection = provenance
    ? `## About this report

- **n = ${provenance.scoredQueryCount} scored queries** (queries whose gold chunk resolved into the candidate pool) drawn from a candidate pool of **${provenance.poolSize} chunks** per query.
- \`peakRssMb\` measures the ENTIRE subprocess's resident memory, not the model's own footprint in isolation — a high number includes Node/V8/ONNX-runtime baseline overhead, not just the model weights.
- The \`baseline\` candidate is cosine-similarity-only ranking; production's actual current behavior (when reranking is off) uses a hybrid FTS+cosine combined score, not pure cosine — so "Δ MRR vs baseline" here is an upper-bound comparison against a simpler baseline than what ships today, not a direct A/B against production's exact current ordering.
- Production reranks in batches of 6 chunks per cross-encoder call (\`RERANK_BATCH_SIZE\` in \`ModeHybridRetriever.ts\`); this benchmark issues one single \`rerank()\` call per query covering the full pool — meaning production's real per-call overhead (multiple round-trips) is likely equal to or higher than what's measured here, so the "does not clear the live-path budget" conclusion is if anything conservative (production could be slower, not faster, than what's benchmarked).

`
    : '';

  return `# Reranker Benchmark Report

${provenanceSection}| Candidate | MRR | Recall@1 | Recall@3 | nDCG@10 | Δ MRR vs baseline | p50 latency | p95 latency | Peak RSS |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
${contentFreeLine ? `\n${contentFreeLine}\n` : ''}
## Verdict

${verdict}

## Where candidates disagree

${disagreementSection}

_Generated by benchmarks/reranker-eval/score.mjs. Raw per-query data: results/raw/*.json._
`;
}

async function main() {
  const rawDir = path.join(__dirname, 'results', 'raw');
  const pools = JSON.parse(readFileSync(path.join(rawDir, '_pools.json'), 'utf8'));

  const candidateFiles = readdirSync(rawDir).filter((f) => f.endsWith('.json') && f !== '_pools.json');
  const rawResults = candidateFiles.map((file) => {
    const result = JSON.parse(readFileSync(path.join(rawDir, file), 'utf8'));
    return { name: result.candidate, result };
  });
  const candidateMetrics = rawResults.map(({ name, result }) => ({
    name,
    metrics: computeCandidateMetrics(pools, result),
    result,
  }));
  const disagreements = findDisagreements(pools, rawResults);
  const contentFreeStats = findContentFreeTopPicks(pools, rawResults);

  const poolSizes = pools.map((p) => p.pool.length);
  const minPoolSize = Math.min(...poolSizes);
  const maxPoolSize = Math.max(...poolSizes);
  const poolSize = minPoolSize === maxPoolSize ? String(minPoolSize) : `${minPoolSize}–${maxPoolSize} (varies by query)`;

  const scoredCounts = candidateMetrics.filter((c) => c.metrics).map((c) => c.metrics.scoredQueryCount);
  const scoredQueryCount = scoredCounts.length === 0
    ? 0
    : scoredCounts.every((n) => n === scoredCounts[0])
      ? scoredCounts[0]
      : `${Math.min(...scoredCounts)}–${Math.max(...scoredCounts)} (varies by candidate)`;

  const report = renderReport(candidateMetrics, disagreements, {
    provenance: { scoredQueryCount, poolSize },
    contentFreeStats,
  });
  const resultsDir = path.join(__dirname, 'results');
  writeFileSync(path.join(resultsDir, 'REPORT.md'), report);
  // Date is UTC (toISOString), not the machine's local calendar date — a run
  // late at night in a timezone ahead of UTC can land in the "next day"'s
  // filename. Low-stakes: this only affects the archival filename, not
  // REPORT.md itself, which is always overwritten regardless of date.
  const timestamp = new Date().toISOString().slice(0, 10);
  writeFileSync(path.join(resultsDir, `${timestamp}-run.md`), report);
  console.log(`[score] wrote results/REPORT.md and results/${timestamp}-run.md`);
  console.log(report);
}

// Only run main() when executed directly (`node score.mjs`), not when
// imported by the test file above. Compared as file:// URLs (via
// pathToFileURL) rather than raw string interpolation so this matches
// correctly on Windows, where process.argv[1] is a backslash path
// (C:\...\score.mjs) that a naive `file://${process.argv[1]}` template
// would never equal import.meta.url's percent-encoded, forward-slash form
// (file:///C:/.../score.mjs) — that mismatch would silently skip main()
// and make `npm run benchmark:reranker:score` a silent no-op on Windows.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('[score] FATAL:', e);
    process.exit(1);
  });
}
