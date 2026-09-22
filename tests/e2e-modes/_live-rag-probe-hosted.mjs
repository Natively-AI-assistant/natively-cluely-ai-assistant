// LIVE-SESSION probe, HOSTED path: real app + real Natively API key from .env.
// Verifies (1) managed cloud embeddings actually index reference files,
// (2) hybrid vector retrieval answers the questions, (3) the hosted Natively
// reranker runs unconditionally once selected in settings.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const userData = fs.mkdtempSync(path.join(repoRoot, 'tests', 'e2e-modes', 'hosted-userdata-'));

// Minimal .env parse — one key, no dependency.
const envFile = Object.fromEntries(
  fs.readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!envFile.NATIVELY_API_KEY) throw new Error('NATIVELY_API_KEY missing from .env');

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
    NATIVELY_API_KEY: envFile.NATIVELY_API_KEY,
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

  console.log('enable-pro:', JSON.stringify(await R('__e2e__:enable-pro')));

  // The embedding resolver reads the Natively key ONLY from CredentialsManager
  // (embeddingConfigIdentity.ts:139 — no env fallback), so store it like the
  // settings UI would.
  const keySet = await w().evaluate((k) => (window.electronAPI || window.api).setNativelyApiKey(k), envFile.NATIVELY_API_KEY);
  console.log('setNativelyApiKey:', JSON.stringify(keySet));
  await new Promise((r) => setTimeout(r, 4000)); // let the pipeline re-resolve

  const embStatus = await w().evaluate(() => (window.electronAPI || window.api).getEmbeddingStatus?.() ?? 'no api');
  console.log('embedding status:', JSON.stringify(embStatus));

  const created = await w().evaluate(async () => {
    const api = window.electronAPI || window.api;
    const c = await api.modesCreate({ name: 'RAG Hosted Probe', templateType: 'general' });
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

  let statuses = [];
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await R('__e2e__:index-status', modeId).catch(() => null);
    statuses = s?.statuses ?? [];
    if (statuses.length >= FILES.length && statuses.every((f) => f.status === 'ready' && f.embeddedChunkCount >= f.chunkCount)) break;
  }
  console.log('index status:', JSON.stringify(statuses));

  await R('__e2e__:prewarm-mode', modeId).catch(() => {});

  let pass = 0, fail = 0;
  console.log('\n--- hosted embeddings, default reranker gate ---');
  for (const [q, want] of QUESTIONS) {
    const insp = await R('__e2e__:inspect-retrieval', { modeId, query: q, forceDocumentGrounding: true });
    const ok = (insp?.block || '').includes(want);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} "${q}" contains "${want}": ${ok}`);
  }

  // Select the hosted Natively reranker, confirm eligibility, re-ask.
  console.log('\n--- hosted Natively reranker selected ---');
  const setCfg = await w().evaluate(() => (window.electronAPI || window.api).setRerankerConfig({ provider: 'natively' }));
  console.log('setRerankerConfig:', JSON.stringify(setCfg));
  const rrStatus = await w().evaluate(() => (window.electronAPI || window.api).getRerankerStatus());
  console.log('reranker status:', JSON.stringify(rrStatus));
  const rrTest = await w().evaluate(() => (window.electronAPI || window.api).rerankerTest?.() ?? null).catch(() => null);
  if (rrTest) console.log('reranker test:', JSON.stringify(rrTest));

  for (const [q, want] of QUESTIONS) {
    const insp = await R('__e2e__:inspect-retrieval', { modeId, query: q, forceDocumentGrounding: true });
    const ok = (insp?.block || '').includes(want);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} "${q}" contains "${want}": ${ok}`);
  }

  const log = mainLog.join('');
  const evidence = {
    providerSelected: (log.match(/\[EmbeddingProviderResolver\] Selected provider: [^\n]+/g) || []),
    embeddedLines: (log.match(/embedded \d+\/\d+ chunks[^\n]*/g) || []).slice(0, 5),
    hybridRan: /"stage":"perform_hybrid_exit"/.test(log),
    lexicalShortcut: /Local ONNX provider active for manual query/.test(log),
    rerankGates: (log.match(/"stage":"rerank_gate"[^\n]*/g) || []).slice(-4),
    rerankExits: (log.match(/"stage":"rerank_(exit|timeout|skipped_deadline)"[^\n]*/g) || []).slice(-4),
    localCrossEncoderLoaded: /Cross-encoder loaded successfully/.test(log),
  };
  console.log('\nMAIN-PROCESS EVIDENCE:', JSON.stringify(evidence, null, 2));
  console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
} catch (err) {
  console.error('\nPROBE ERROR:', err?.message || err);
  console.error('\n--- last main-process output ---\n' + mainLog.join('').slice(-4000));
} finally {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  console.log('CLOSED');
}
