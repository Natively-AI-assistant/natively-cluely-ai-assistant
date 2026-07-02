import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

async function extract(rel) {
  const { PDFParse } = await import('pdf-parse');
  const buf = fs.readFileSync('test-fixtures/modes-corpus/' + rel);
  const p = new PDFParse({ data: buf });
  const r = await p.getText();
  let t = '';
  if (r.pages?.length) r.pages.forEach((pg, i) => { t += `[Page ${i + 1}]\n${pg.text || ''}\n`; });
  else t = r.text || '';
  return { text: t, pages: r.total || r.pages?.length || 0 };
}

const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: { ...process.env, NATIVELY_E2E: '1', NATIVELY_API_URL: 'http://localhost:3000', NODE_ENV: 'development', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test' },
  timeout: 60000,
});
const win = await app.firstWindow({ timeout: 30000 });
await win.waitForLoadState('domcontentloaded').catch(() => {});
const R = async (ch, ...a) => {
  for (let k = 0; k < 4; k++) {
    try {
      const win2 = app.windows()[0] || await app.firstWindow();
      return await win2.evaluate(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
    } catch (e) { if (k === 3) throw e; await new Promise(r => setTimeout(r, 1500)); }
  }
};
const evalMain = async (fn, arg) => {
  const win2 = app.windows()[0];
  return await win2.evaluate(fn, arg);
};

try {
  await R('__e2e__:enable-pro');
  const draft = JSON.parse(fs.readFileSync('test-results/modes-autopilot/generated-modes/thesis-defense.json', 'utf8')).draft;
  const created = await evalMain(async (d) => {
    const api = window.electronAPI || window.api;
    const c = await api.modesCreate({ name: d.name, templateType: d.templateType });
    await api.modesUpdate(c.mode.id, { customContext: d.customContext });
    await api.modesSetActive(c.mode.id);
    return c.mode.id;
  }, draft);
  const { text, pages } = await extract('thesis/institutional_thesis.pdf');
  await R('__e2e__:add-reference-file', { modeId: created, fileName: 'institutional_thesis.pdf', content: text, pageCount: pages });
  for (let i = 0; i < 20; i++) { const st = await R('__e2e__:index-status', created); if ((st?.statuses || []).length >= 1) break; await new Promise(r => setTimeout(r, 1000)); }
  const reidx = await R('__e2e__:reindex-embeddings', created);
  console.log('reindex:', JSON.stringify((reidx?.statuses || []).map(s => s.status)));

  const q = 'According to the thesis, what is the name of the proposed system and which robot is it deployed on?';
  const insp = await R('__e2e__:inspect-retrieval', { modeId: created, query: q, forceDocumentGrounding: true });
  console.log('retrieval len:', insp?.blockLength, 'has AgenticVLA:', /AgenticVLA/i.test(insp?.block || ''), 'has Mercury:', /Mercury/i.test(insp?.block || ''));

  const a1 = await R('__e2e__:ask', { question: q, timeoutMs: 70000 });
  const t1 = a1?.answer || a1?.streamedTokens || '';
  console.log('ASK#1 len:', t1.length, 'AgenticVLA:', /AgenticVLA/i.test(t1), 'Mercury:', /Mercury/i.test(t1));
  console.log('  A1:', t1.slice(0, 180));

  for (const t of ['Thanks for taking the time to meet with me today.', 'I have been really looking forward to this conversation.', 'Let me share a bit of background about the team first.', 'Can you walk me through how your approach actually works in practice?']) {
    await R('__e2e__:detect-question', { text: t, confidence: 0.9 });
  }
  const a2 = await R('__e2e__:ask', { question: q, timeoutMs: 70000 });
  const t2 = a2?.answer || a2?.streamedTokens || '';
  console.log('ASK#2 (after detect seq) len:', t2.length, 'AgenticVLA:', /AgenticVLA/i.test(t2), 'Mercury:', /Mercury/i.test(t2));
  console.log('  A2:', t2.slice(0, 180));
} catch (e) {
  console.log('ERROR:', e.message);
} finally {
  await app.close().catch(() => {});
  console.log('CLOSED');
}
