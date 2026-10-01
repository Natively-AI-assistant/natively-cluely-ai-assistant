// node tests/live-answer/heldout.mjs <label> [--modes-only]   (held-out questions + other-mode smoke tests)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { connect, setup, setMode, askTyped, askHotkey } from './cdp.mjs';
const require = createRequire(import.meta.url);
const { HELDOUT, MODESMOKE, SEMINAR_PAPER } = require('./dataset.cjs');
const label = process.argv[2];
const modesOnly = process.argv.includes('--modes-only');
const RESULTS = new URL('./results/', import.meta.url);
fs.mkdirSync(RESULTS, { recursive: true });
const out = new URL(`${label}.jsonl`, RESULTS);
const c = await connect();
const models = ['gemini-3.1-flash-lite', 'deepseek-flash'];
// attach the paper to the built-in seminar mode once
const modes = await c.evaluate(`window.electronAPI.modesGetAll()`);
const sem = modes.find(m => m.templateType === 'seminar');
const files = await c.evaluate(`(window.electronAPI.modesGetReferenceFiles ? window.electronAPI.modesGetReferenceFiles(${JSON.stringify(sem.id)}) : Promise.resolve([]))`).catch(() => []);
if (!Array.isArray(files) || !files.some(f => (f.fileName || f.name) === 'hybrid_retrieval_paper.txt')) {
  const r = await c.invoke('__e2e__:add-reference-file', { modeId: sem.id, fileName: 'hybrid_retrieval_paper.txt', content: SEMINAR_PAPER });
  await c.invoke('__e2e__:prewarm-mode', sem.id);
  console.log('seminar paper attached', r?.success);
}
for (const model of models) {
  await setup(c, model);
  await setMode(c, 'general');
  for (const it of (modesOnly ? [] : HELDOUT)) for (const surface of ['hotkey', 'typed']) {
    let r; try { r = surface === 'hotkey' ? await askHotkey(c, null, it.q) : await askTyped(c, it.q); } catch (e) { r = { surface, ok: false, err: String(e).slice(0, 200), final: '' }; }
    fs.appendFileSync(out, JSON.stringify({ set: 'heldout', id: it.id, kind: it.kind, tag: it.tag, q: it.q, model, mode: 'general', surface, sample: 1, ...r }) + '\n');
    console.log(it.id, surface, model, r.ok ? 'ok' : 'ERR', JSON.stringify((r.final || '').slice(0, 90)));
  }
  for (const it of MODESMOKE) {
    await setMode(c, it.mode);
    let r; try { r = it.surface === 'hotkey' ? await askHotkey(c, null, it.q, it.prior || []) : await askTyped(c, it.q, {}, it.prior || []); } catch (e) { r = { surface: it.surface, ok: false, err: String(e).slice(0, 200), final: '' }; }
    fs.appendFileSync(out, JSON.stringify({ set: 'modes', id: it.id, kind: it.kind, tag: it.mode, expect: it.expect, q: it.q, model, mode: it.mode, surface: it.surface, sample: 1, ...r }) + '\n');
    console.log(it.id, it.mode, it.surface, model, r.ok ? 'ok' : 'ERR', JSON.stringify((r.final || '').slice(0, 90)));
  }
  await setMode(c, 'general');
}
process.exit(0);
