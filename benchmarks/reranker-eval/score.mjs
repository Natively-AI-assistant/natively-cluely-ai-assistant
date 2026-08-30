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

/**
 * Per-query breakdown: only queries where the live (non-failed, non-skipped)
 * candidates disagree on their #1 pick — the design's "interesting
 * failure/success cases, not all queries verbatim." A candidate whose
 * result.perQuery has no entry for a given queryId (shouldn't happen, but
 * defensive) is silently excluded from that query's comparison rather than
 * crashing the report.
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
          topChunkText: chunk ? chunk.text.slice(0, 80).replace(/\n/g, ' ') : '(none)',
          isGold: pool.goldChunkPoolIndices.includes(topPoolIdx),
        };
      })
      .filter(Boolean);

    const uniqueTopPicks = new Set(picks.map((p) => p.topChunkText));
    if (uniqueTopPicks.size > 1) {
      rows.push({ queryId: pool.queryId, query: pool.query, picks });
    }
  }

  return rows.slice(0, limit);
}

function renderFailedRow(name, result) {
  if (result?.skipped) return `| ${name} | SKIPPED — no COHERE_API_KEY | | | | | | | |`;
  return `| ${name} | FAILED — see logs (${result?.error ?? 'unknown error'}) | | | | | | | |`;
}

export function renderReport(candidateMetrics, disagreements, baselineName = 'baseline') {
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
        : ' No candidate clears the live-path budget — none should be used on the live transcript path (ragSpeculativeRerank) without further tuning.';
    }
  }

  const disagreementSection = disagreements.length === 0
    ? '_No disagreements — every live candidate picked the same top chunk for every query._'
    : [
      '| Query | Candidate | Top pick (truncated) | Correct? |',
      '|---|---|---|---|',
      ...disagreements.flatMap((d) =>
        d.picks.map((p, i) => `| ${i === 0 ? d.query.replace(/\|/g, '\\|') : ''} | ${p.name} | ${p.topChunkText.replace(/\|/g, '\\|')}... | ${p.isGold ? '✅' : '❌'} |`),
      ),
    ].join('\n');

  return `# Reranker Benchmark Report

| Candidate | MRR | Recall@1 | Recall@3 | nDCG@10 | Δ MRR vs baseline | p50 latency | p95 latency | Peak RSS |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

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

  const report = renderReport(candidateMetrics, disagreements);
  const resultsDir = path.join(__dirname, 'results');
  writeFileSync(path.join(resultsDir, 'REPORT.md'), report);
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
