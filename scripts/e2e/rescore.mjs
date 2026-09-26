// scripts/e2e/rescore.mjs
// Re-score a captured round's raw results against the CURRENT scorer + meta
// (deterministic; no LLM). Lets us apply scorer/meta improvements to already-run
// rounds without paying for another live round.
// Usage: node scripts/e2e/rescore.mjs round-12 [round-01 ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreQuestion, aggregate } from './lib/scorer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const artRoot = path.join(repoRoot, 'debug-artifacts', 'profile-e2e');
const fixturesRoot = path.join(repoRoot, 'test-fixtures', 'profiles');

const rounds = process.argv.slice(2).filter((a) => /^round-\d+$/.test(a));
if (!rounds.length) { console.error('usage: rescore.mjs round-XX'); process.exit(2); }

for (const round of rounds) {
  const dir = path.join(artRoot, round);
  if (!fs.existsSync(dir)) { console.log(`${round}: not found`); continue; }
  const profiles = fs.readdirSync(dir).filter((d) => /^p\d\d$/.test(d)).sort();
  const rows = [];
  for (const pid of profiles) {
    const resPath = path.join(dir, pid, 'results.json');
    const metaPath = path.join(fixturesRoot, pid, 'meta.json');
    if (!fs.existsSync(resPath) || !fs.existsSync(metaPath)) continue;
    const r = JSON.parse(fs.readFileSync(resPath, 'utf8'));
    if (!r.questions) { rows.push({ pid, error: r.error || 'no questions' }); continue; }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const rescored = r.questions.map((q) => ({ ...q, score: scoreQuestion(q, meta) }));
    const agg = aggregate(rescored, meta);
    rows.push({ pid, agg });
  }
  console.log(`\n=== ${round} (re-scored) ===`);
  let fSum = 0, dSum = 0, fabSum = 0, misSum = 0, n = 0;
  for (const row of rows) {
    if (row.error) { console.log(`  ${row.pid}: ERROR ${row.error}`); continue; }
    const a = row.agg;
    console.log(`  ${row.pid}: detect=${a.detectionRate} fact=${a.factualRate} answered=${a.answeredRate} fab=${a.fabrications} misfire=${a.smalltalkMisfires} inject=${a.injectionCompliance} p95=${a.p95LatencyMs}ms`);
    fSum += a.factualRate; dSum += a.detectionRate; fabSum += a.fabrications; misSum += a.smalltalkMisfires; n++;
  }
  if (n) {
    console.log(`  --- mean: detect=${(dSum / n).toFixed(3)} fact=${(fSum / n).toFixed(3)} totalFab=${fabSum} totalMisfire=${misSum} profiles=${n}`);
  }
}
