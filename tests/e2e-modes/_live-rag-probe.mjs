// LIVE-SESSION probe: launches the REAL Natively Electron app (real main.ts
// bootstrap, real RAGManager -> shared EmbeddingPipeline wiring, real
// ModesManager), uploads reference files over the real IPC surface, and asks
// questions through the real retrieval entry point. Verifies via main-process
// stdout that the ONNX embedder and cross-encoder reranker actually ran.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const userData = path.join(path.dirname(fileURLToPath(import.meta.url)), 'live-userdata');
fs.mkdirSync(userData, { recursive: true });
// KEYLESS SIMULATION: deny the cloud-embeddings privacy scope up front so the
// resolver takes the lazy bundled-local path (the shape the cold-load
// deadlock lived in), regardless of any trial token enable-pro sets.
fs.writeFileSync(path.join(userData, 'settings.json'),
  JSON.stringify({ providerDataScopes: { embeddings: false } }));

const FILES = [
  ['voyager-launch-plan.md', `# Project Voyager Launch Plan\n\n## Launch date and venue\nThe public launch happens on March 14, 2027 at a press event in Lisbon. The venue holds four hundred guests and the keynote runs ninety minutes.\n\n## Budget\nThe marketing budget for the launch is $2.4 million, split across digital campaigns, the launch event itself, and a retail end-cap program. Finance reviews spending monthly.\n\n## Staffing\nThe launch team consists of nineteen people led by the director of product marketing. Two contractors handle localization for six languages.\n\n## Risks\nSupply chain lead times for the optical assembly remain the largest risk. The backup date is April 9, 2027.`],
  ['hr-handbook.md', `# Employee Handbook — Meridian Labs\n\n## Vacation policy\nFull-time employees receive 23 paid vacation days per year, accruing monthly from the first day of employment. Unused days roll over up to a cap of ten days.\n\n## Remote work\nRemote employees receive a stipend of €180 per month for home office costs. The stipend covers internet, electricity, and ergonomic equipment.\n\n## Health coverage\nHealth insurance is provided through MediShield Plus, covering medical, dental, and vision. Enrollment windows open twice per year.`],
  ['arch-notes.md', `# Platform Architecture Notes\n\n## Retry policy\nDownstream calls use a retry policy of 7 attempts with exponential backoff and a multiplier of 1.8. Retries apply only to idempotent operations.\n\n## Data layer\nThe primary datastore is CockroachDB, chosen for multi-region consistency. Read replicas serve analytical queries.\n\n## Performance targets\nThe p99 latency target for the read path is 220ms measured at the gateway. Write-path budgets are looser.`],
];

const QUESTIONS = [
  ['When is Project Voyager launching and in which city?', 'March 14, 2027'],
  ['How many paid vacation days do employees get per year?', '23 paid vacation days'],
  ['What retry policy do downstream service calls use?', '7 attempts'],
  ['Which database does the platform use as its primary datastore?', 'CockroachDB'],
];

const mainLog = [];
const app = await electron.launch({
  args: [path.join(repoRoot, 'dist-electron/electron/main.js')],
  cwd: repoRoot,
  env: {
    ...process.env,
    NATIVELY_E2E: '1',
    NATIVELY_H4_STAGE_TRACE: '1',
    NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
    ELECTRON_IS_DEV: '0',
    NATIVELY_TEST_USERDATA: userData,
    NODE_ENV: 'production',
  },
  timeout: 90_000,
});
app.process().stdout?.on('data', (d) => mainLog.push(d.toString()));
app.process().stderr?.on('data', (d) => mainLog.push(d.toString()));

try {
  const win = await app.firstWindow({ timeout: 60_000 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  const w = () => app.windows()[0];
  const R = (ch, ...a) => w().evaluate(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });

  const pro = await R('__e2e__:enable-pro');
  console.log('enable-pro:', JSON.stringify(pro));
  console.log('embedding status:', JSON.stringify(
    await w().evaluate(() => (window.electronAPI || window.api).getEmbeddingStatus?.() ?? 'no api')));
  const created = await w().evaluate(async () => {
    const api = window.electronAPI || window.api;
    const c = await api.modesCreate({ name: 'RAG Probe Mode', templateType: 'general' });
    if (!c?.mode) return c;
    await api.modesSetActive(c.mode.id);
    return { success: true, id: c.mode.id };
  });
  console.log('mode created:', JSON.stringify(created));
  if (!created?.id) throw new Error('mode creation failed: ' + JSON.stringify(created));
  const modeId = created.id;

  for (const [fileName, content] of FILES) {
    const ing = await R('__e2e__:add-reference-file', { modeId, fileName, content });
    console.log(`ingest ${fileName}:`, ing?.success !== false ? 'ok' : JSON.stringify(ing));
  }

  // Wait for the async fire-and-forget indexing to finish embedding.
  let status;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    status = await R('__e2e__:index-status', modeId).catch(() => null);
    const list = Array.isArray(status) ? status : status?.files ?? [];
    if (list.length >= FILES.length && list.every((f) => (f.status ?? f.state) === 'ready')) break;
  }
  console.log('index status:', JSON.stringify(status));

  await R('__e2e__:prewarm-mode', modeId).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000)); // let the reranker prewarm land

  let pass = 0, fail = 0;
  for (const [q, want] of QUESTIONS) {
    const insp = await R('__e2e__:inspect-retrieval', { modeId, query: q, forceDocumentGrounding: true });
    const block = insp?.block || '';
    const ok = block.includes(want);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} "${q}" -> block ${block.length} chars, contains "${want}": ${ok}`);
    if (!ok) console.log('  BLOCK SAMPLE:', block.slice(0, 300));
  }

  // Recovery path: does the app's own retry mechanism ever embed these files?
  const reindexed = await R('__e2e__:reindex-embeddings', modeId).catch((e) => ({ error: String(e) }));
  console.log('\nreindex-embeddings result:', JSON.stringify(reindexed));
  await new Promise((r) => setTimeout(r, 5000));
  const statusAfter = await R('__e2e__:index-status', modeId).catch(() => null);
  console.log('index status after reindex:', JSON.stringify(statusAfter));

  // Evidence from the real main process
  const log = mainLog.join('');
  const evidence = {
    embeddingWorkerLoaded: /Feature-extraction model loaded/.test(log),
    embeddingProviderSelected: (log.match(/\[EmbeddingProviderResolver\] Selected provider: [^\n]+/) || [])[0] ?? null,
    rerankerWorkerLoaded: /Cross-encoder loaded successfully/.test(log),
    rerankGateSeen: /"stage":"rerank_gate"/.test(log),
    rerankRan: /"stage":"rerank_exit","atMs":\d+,"reranked":true/.test(log),
    hybridRan: /"stage":"perform_hybrid_exit"/.test(log),
    lexicalShortcut: /Local ONNX provider active for manual query/.test(log),
    embeddedLines: (log.match(/embedded \d+\/\d+ chunks/g) || []),
  };
  console.log('\nMAIN-PROCESS EVIDENCE:', JSON.stringify(evidence, null, 2));
  console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
} finally {
  await app.close().catch(() => {});
  console.log('CLOSED');
}
