// LIVE probe with REAL internet documents: the Transformer paper (PDF), the
// Bitcoin whitepaper (PDF), and RFC 768 (text) go through the app's REAL
// parser (__e2e__:upload-reference-file-from-path), hosted Natively embeddings
// (voyage-4), hybrid vector retrieval, and the hosted rerank-2.5-lite reranker.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixtureRoot = 'C:/Users/midhu/AppData/Local/Temp/claude/D--Natively-natively-cluely-ai-assistant/873a4b90-7328-49d0-9636-4a200d0719bd/scratchpad/net-fixtures';
const userData = fs.mkdtempSync(path.join(repoRoot, 'tests', 'e2e-modes', 'net-userdata-'));

const envFile = Object.fromEntries(
  fs.readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!envFile.NATIVELY_API_KEY) throw new Error('NATIVELY_API_KEY missing from .env');

const FILES = ['attention-is-all-you-need.pdf', 'bitcoin-whitepaper.pdf', 'rfc768-udp.txt'];

// [question, regex the retrieved block must match, source hint]
const QUESTIONS = [
  ['What BLEU score does the Transformer (big) model achieve on the WMT 2014 English-to-German translation task?', /28\.4/, 'attention.pdf'],
  ['How long and on how many GPUs was the big Transformer model trained?', /3\.5 days|eight P100|8\s*P100/i, 'attention.pdf'],
  ['In the Bitcoin whitepaper, what does the longest chain serve as proof of?', /largest pool of CPU power/i, 'bitcoin.pdf'],
  ['According to the Bitcoin paper, what do nodes accept as proof of what happened while they were gone?', /longest proof-of-work chain/i, 'bitcoin.pdf'],
  ['What is the minimum value of the Length field in a UDP datagram?', /minimum\s+value\s+of\s+the\s+length\s+is\s+eight/i, 'rfc768'],
  ['What IP protocol number is UDP?', /number 17|protocol\s+17/i, 'rfc768'],
];

const mainLog = [];
const app = await electron.launch({
  args: [path.join(repoRoot, 'dist-electron/electron/main.js')],
  cwd: repoRoot,
  env: {
    ...process.env,
    NATIVELY_API_KEY: envFile.NATIVELY_API_KEY,
    NATIVELY_E2E: '1',
    NATIVELY_E2E_REFERENCE_ROOT: fixtureRoot,
    NATIVELY_H4_STAGE_TRACE: '1',
    NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
    ELECTRON_IS_DEV: '0',
    NATIVELY_TEST_USERDATA: userData,
    NODE_ENV: 'production',
  },
  timeout: 90_000,
});
const crashLogPath = path.join(repoRoot, 'tests', 'e2e-modes', 'net-probe-main.log');
fs.writeFileSync(crashLogPath, '');
const sink = (d) => { const s = d.toString(); mainLog.push(s); fs.appendFileSync(crashLogPath, s); };
app.process().stdout?.on('data', sink);
app.process().stderr?.on('data', sink);
app.process().on('exit', (code, signal) => fs.appendFileSync(crashLogPath, `\n=== APP EXIT code=${code} signal=${signal} ===\n`));

try {
  const win = await app.firstWindow({ timeout: 60_000 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  const w = () => app.windows()[0];
  const R = (ch, ...a) => w().evaluate(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });

  console.log('enable-pro:', JSON.stringify(await R('__e2e__:enable-pro')));
  console.log('setNativelyApiKey:', JSON.stringify(
    await w().evaluate((k) => (window.electronAPI || window.api).setNativelyApiKey(k), envFile.NATIVELY_API_KEY)));
  await new Promise((r) => setTimeout(r, 4000));
  console.log('embedding status:', JSON.stringify(
    await w().evaluate(() => (window.electronAPI || window.api).getEmbeddingStatus?.() ?? 'no api')));

  const created = await w().evaluate(async () => {
    const api = window.electronAPI || window.api;
    const c = await api.modesCreate({ name: 'Internet Docs Probe', templateType: 'general' });
    if (!c?.mode) return c;
    await api.modesSetActive(c.mode.id);
    return { success: true, id: c.mode.id };
  });
  console.log('mode created:', JSON.stringify(created));
  if (!created?.id) throw new Error('mode creation failed: ' + JSON.stringify(created));
  const modeId = created.id;

  // Hosted reranker on from the start so every question exercises it.
  console.log('setRerankerConfig:', JSON.stringify(
    await w().evaluate(() => (window.electronAPI || window.api).setRerankerConfig({ provider: 'natively' }))));

  for (const f of FILES) {
    const t0 = Date.now();
    const ing = await R('__e2e__:upload-reference-file-from-path', { modeId, filePath: path.join(fixtureRoot, f) });
    console.log(`upload ${f}: ${ing?.success ? 'ok' : JSON.stringify(ing)} chars=${ing?.file?.content?.length ?? '?'} pages=${ing?.file?.pageCount ?? '-'} (${Date.now() - t0}ms)`);
  }

  let statuses = [];
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await R('__e2e__:index-status', modeId).catch(() => null);
    statuses = s?.statuses ?? [];
    if (statuses.length >= FILES.length && statuses.every((f) => f.status === 'ready' && f.embeddedChunkCount >= f.chunkCount)) break;
  }
  console.log('index status:', JSON.stringify(statuses));

  await R('__e2e__:prewarm-mode', modeId).catch(() => {});

  let pass = 0, fail = 0;
  for (const [q, want] of QUESTIONS) {
    const t0 = Date.now();
    const insp = await R('__e2e__:inspect-retrieval', { modeId, query: q, forceDocumentGrounding: true });
    const block = insp?.block || '';
    const ok = want.test(block);
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} (${Date.now() - t0}ms, block ${block.length} chars) ${q}`);
    if (!ok) console.log('   BLOCK SAMPLE:', block.replace(/\s+/g, ' ').slice(0, 400));
  }

  const log = mainLog.join('');
  console.log('\nMAIN-PROCESS EVIDENCE:', JSON.stringify({
    providerSelected: (log.match(/\[EmbeddingProviderResolver\] Selected provider: [^\n]+/g) || []),
    hybridRan: /"stage":"perform_hybrid_exit"/.test(log),
    rerankGates: (log.match(/"stage":"rerank_gate"[^\n]*/g) || []).slice(-3),
    rerankExits: (log.match(/"stage":"rerank_(exit|timeout|skipped_deadline)"[^\n]*/g) || []).slice(-3),
    ingestAudit: (log.match(/INGESTION AUDIT[^\n]*/g) || []),
  }, null, 2));
  console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
} catch (err) {
  console.error('\nPROBE ERROR:', err?.message || err);
  console.error('\n--- last main-process output ---\n' + mainLog.join('').slice(-3000));
} finally {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  console.log('CLOSED');
}
