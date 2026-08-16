// Semantic-admission floor calibration — REAL embeddings, both spaces.
//
// Measures the cosine(query, node) distributions that the admission gate
// (electron/llm/semanticAdmissionGate.ts) must separate, using the SAME
// providers production uses: gemini-embedding-2 (768d, cloud) and the
// bundled Xenova/all-MiniLM-L6-v2 (384d, keyless fallback).
//
// Corpus design mirrors the failure the gate exists to fix (audit §5): for
// each query we label which nodes a correct retriever should admit
// (RELEVANT) vs reject (IRRELEVANT), with the irrelevant set deliberately
// including boost-bait (recent, long-tenure, org-name-matching nodes whose
// CONTENT is off-topic). The floor per space is chosen as the midpoint of
// the calibration gap [max(irrelevant), min(relevant)] measured across all
// query×node pairs, and reported with the gap width so a fragile margin is
// visible. Per-pair labels are query-specific: a node is judged against
// each query independently.
//
// Run:
//   npm run build:electron
//   ./node_modules/.bin/electron scripts/calibrate-semantic-floors.js

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

for (const line of fs.readFileSync(path.join(repoRoot, '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// ── Node corpus: 12 profile-style nodes across domains ─────────────────────
const NODES = {
  billing: 'Built a distributed billing reconciliation pipeline in Go and Kafka processing 40k events per second with exactly-once semantics',
  postgres: 'Deep PostgreSQL schema design and query optimization experience across multi-tenant SaaS databases, including partitioning and index tuning',
  ledger: 'Designed the event-sourced ledger service handling multi-currency transaction reconciliation across regional deployments',
  k8s: 'Operated production Kubernetes clusters with Terraform-managed AWS infrastructure, autoscaling, and cost optimization',
  frontend: 'Led the React and TypeScript rewrite of the customer dashboard, improving Core Web Vitals and accessibility compliance',
  mlPipeline: 'Trained and deployed gradient-boosted models for churn prediction, owning the feature store and evaluation pipeline',
  mentoring: 'Mentored six junior engineers through structured pairing, design reviews, and a promotion-focused growth framework',
  hiring: 'Ran the backend hiring loop: screened resumes, designed take-home exercises, and calibrated interview rubrics',
  party: 'Organized the annual company holiday party and managed catering vendor relationships for office events',
  facilities: 'Coordinated the office relocation project including furniture procurement and badge access setup',
  gym: 'Personal interests include marathon running, sourdough baking, and competitive chess',
  patents: 'Filed two patents on stream deduplication methods and presented at KubeCon and QCon on reliability engineering',
};

// ── Queries with per-query relevance labels ────────────────────────────────
const QUERIES = [
  { q: 'tell me about my event streaming and database work', rel: ['billing', 'postgres', 'ledger'], irr: ['party', 'facilities', 'gym', 'frontend'] },
  { q: 'what infrastructure and cloud experience do I have?', rel: ['k8s'], irr: ['party', 'gym', 'mentoring', 'hiring'] },
  { q: 'describe my frontend development experience', rel: ['frontend'], irr: ['party', 'billing', 'facilities', 'gym'] },
  { q: 'what machine learning work have I done?', rel: ['mlPipeline'], irr: ['party', 'facilities', 'frontend', 'gym'] },
  { q: 'how have I shown leadership and grown other engineers?', rel: ['mentoring', 'hiring'], irr: ['party', 'gym', 'billing'] },
  { q: 'what public speaking or publications do I have?', rel: ['patents'], irr: ['party', 'facilities', 'gym', 'postgres'] },
  { q: 'tell me about my database optimization experience', rel: ['postgres'], irr: ['party', 'gym', 'frontend', 'facilities'] },
  { q: 'what high-throughput systems have I built?', rel: ['billing', 'ledger'], irr: ['party', 'gym', 'facilities', 'hiring'] },
];

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], p10: q(0.1), p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'number' && k !== 'n' ? v.toFixed(4) : v}`).join(' ');

async function calibrateSpace(label, provider) {
  console.log(`\n===== ${label} (${provider.space}) =====`);
  const nodeEmb = {};
  for (const [k, text] of Object.entries(NODES)) nodeEmb[k] = await provider.embed(text);
  const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  };
  const relevant = [], irrelevant = [];
  for (const { q, rel, irr } of QUERIES) {
    const qe = await provider.embedQuery(q);
    const line = [];
    for (const k of rel) { const c = cosine(qe, nodeEmb[k]); relevant.push(c); line.push(`${k}:R=${c.toFixed(3)}`); }
    for (const k of irr) { const c = cosine(qe, nodeEmb[k]); irrelevant.push(c); line.push(`${k}:I=${c.toFixed(3)}`); }
    console.log(`  "${q}" → ${line.join(' ')}`);
  }
  const R = stats(relevant), I = stats(irrelevant);
  console.log(`  RELEVANT   ${fmt(R)}`);
  console.log(`  IRRELEVANT ${fmt(I)}`);
  // Floor selection: aim between the irrelevant p90 and the relevant p10 —
  // a floor must reject the bulk of off-topic content without clipping the
  // weakest genuinely-relevant match. Report overlap honestly.
  const overlap = I.max - R.min;
  const floorMid = (I.p90 + R.p10) / 2;
  console.log(`  gap analysis: irrelevant.p90=${I.p90.toFixed(4)} relevant.p10=${R.p10.toFixed(4)} ` +
    `overlap(I.max−R.min)=${overlap.toFixed(4)} → suggested floor ≈ ${floorMid.toFixed(3)}`);
  // False-accept/false-reject rates at candidate floors:
  for (const f of [floorMid - 0.02, floorMid, floorMid + 0.02].map((x) => Math.round(x * 1000) / 1000)) {
    const fa = irrelevant.filter((c) => c >= f).length / irrelevant.length;
    const fr = relevant.filter((c) => c < f).length / relevant.length;
    console.log(`    floor=${f}: false-admit=${(fa * 100).toFixed(1)}% false-reject=${(fr * 100).toFixed(1)}%`);
  }
  return { space: provider.space, suggested: floorMid, R, I };
}

async function main() {
  await app.whenReady();
  const out = [];
  const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
  if (GEMINI_KEY) {
    const { GeminiEmbeddingProvider } = require(path.join(distRoot, 'rag/providers/GeminiEmbeddingProvider.js'));
    out.push(await calibrateSpace('GEMINI', new GeminiEmbeddingProvider([GEMINI_KEY])));
  } else {
    console.log('[calibrate] GEMINI_API_KEY absent — skipping cloud space');
  }
  const { LocalEmbeddingProvider } = require(path.join(distRoot, 'rag/providers/LocalEmbeddingProvider.js'));
  out.push(await calibrateSpace('LOCAL MiniLM', new LocalEmbeddingProvider()));
  console.log('\n===== RECOMMENDATION =====');
  for (const r of out) console.log(`  ${r.space}: floor ≈ ${r.suggested.toFixed(3)}`);
  process.exit(0);
}

main().catch((e) => { console.error('[calibrate] FATAL:', e); process.exit(1); });
