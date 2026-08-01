export function aggregateQuality(perPrompt, categoryByPrompt) {
  const buckets = new Map(); // `${modelId}::${category}` -> {sum, count}
  for (const p of perPrompt) {
    const category = categoryByPrompt[p.promptId] || 'unknown';
    for (const d of p.detail) {
      const key = `${d.modelId}::${category}`;
      const total = (d.scores.correctness || 0) + (d.scores.completeness || 0) + (d.scores.actionability || 0);
      const bucket = buckets.get(key) || { sum: 0, count: 0 };
      bucket.sum += total;
      bucket.count += 1;
      buckets.set(key, bucket);
    }
  }
  return [...buckets.entries()].map(([key, { sum, count }]) => {
    const [modelId, category] = key.split('::');
    return { modelId, category, meanScore: sum / count, promptCount: count };
  });
}

export function aggregateCoding(codingResults) {
  const buckets = new Map(); // `${modelId}::${difficulty}` -> {passSum, totalSum, count}
  for (const r of codingResults.filter((r) => r.execution)) {
    const key = `${r.modelId}::${r.difficulty}`;
    const bucket = buckets.get(key) || { passSum: 0, totalSum: 0, count: 0 };
    bucket.passSum += r.passCount || 0;
    bucket.totalSum += r.totalCount || 0;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, { passSum, totalSum, count }]) => {
    const [modelId, difficulty] = key.split('::');
    return { modelId, difficulty, passRate: totalSum === 0 ? 0 : passSum / totalSum, problemCount: count };
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function aggregateLatencyCost(raw) {
  const byModel = new Map();
  for (const r of raw.filter((r) => !r.error)) {
    if (!byModel.has(r.modelId)) byModel.set(r.modelId, []);
    byModel.get(r.modelId).push(r);
  }
  return [...byModel.entries()].map(([modelId, rows]) => {
    const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
    const totalCostUsd = rows.reduce((s, r) => s + (r.costUsd || 0), 0);
    return {
      modelId,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      totalCostUsd,
      avgCostPerCall: totalCostUsd / rows.length,
    };
  });
}

export function renderMarkdownReport({ quality, coding, latencyCost, contested }) {
  const lines = [];
  lines.push('# DeepSeek vs Gemini Raw-Model Benchmark Report\n');

  lines.push('## Quality by category (mean of correctness+completeness+actionability, max 15)\n');
  lines.push('| Model | Category | Mean Score | Prompts |');
  lines.push('|---|---|---|---|');
  for (const q of quality) lines.push(`| ${q.modelId} | ${q.category} | ${q.meanScore.toFixed(2)} | ${q.promptCount} |`);

  lines.push('\n## Coding pass rate by difficulty\n');
  lines.push('| Model | Difficulty | Pass Rate | Problems |');
  lines.push('|---|---|---|---|');
  for (const c of coding) lines.push(`| ${c.modelId} | ${c.difficulty} | ${(c.passRate * 100).toFixed(1)}% | ${c.problemCount} |`);

  lines.push('\n## Latency and cost\n');
  lines.push('| Model | p50 ms | p95 ms | Total cost $ | Avg cost/call $ |');
  lines.push('|---|---|---|---|---|');
  for (const l of latencyCost) lines.push(`| ${l.modelId} | ${l.p50LatencyMs} | ${l.p95LatencyMs} | ${l.totalCostUsd.toFixed(4)} | ${l.avgCostPerCall.toFixed(6)} |`);

  lines.push('\n## Contested pairs (closest score margins — recommend manual review)\n');
  for (const c of contested) lines.push(`- ${c.promptId} (margin: ${c.marginBetweenTop2.toFixed(2)})`);

  return lines.join('\n');
}
