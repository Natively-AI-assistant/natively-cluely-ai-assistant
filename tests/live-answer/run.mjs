// Runs a question set through the REAL app pipeline (isolated dev:agent instance).
// usage: node run.mjs <label> <set: bench|regression|all> [--models=a,b] [--surfaces=wta,typed] [--n=2] [--mode=general] [--only=B01,B02]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { connect, connectTarget, setup, setMode, askWTA, askTyped, askHotkey } from './cdp.mjs';
const require = createRequire(import.meta.url);
const { BENCH, REGRESSION } = require('./dataset.cjs');
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = process.argv[2]; const set = process.argv[3] || 'bench';
const models = arg('models', 'gemini-3.1-flash-lite,deepseek-flash').split(',');
const surfaces = arg('surfaces', 'wta,typed').split(',');
const N = Number(arg('n', 2)); const mode = arg('mode', 'general'); const only = arg('only', '');
let items = set === 'bench' ? BENCH : set === 'regression' ? REGRESSION : [...BENCH, ...REGRESSION];
if (only) items = items.filter(i => only.split(',').includes(i.id));
const RESULTS = new URL('./results/', import.meta.url);
fs.mkdirSync(RESULTS, { recursive: true });
const out = new URL(`${label}.jsonl`, RESULTS);
const c = await connect(); const overlay = surfaces.includes('hotkey') ? await connectTarget('window=overlay') : null;
for (const model of models) {
  const s = await setup(c, model); console.log('setup', model, JSON.stringify(s.cfg));
  const m = await setMode(c, mode); console.log('mode', JSON.stringify(m));
  for (let k = 1; k <= N; k++) for (const it of items) for (const surface of surfaces) {
    let r;
    try { r = surface === 'wta' ? await askWTA(c, it.q) : surface === 'hotkey' ? await askHotkey(c, overlay, it.q, it.prior || []) : await askTyped(c, it.q); }
    catch (e) { r = { surface, ok: false, err: String(e).slice(0, 300), final: '', raw: '' }; }
    const rec = { label, id: it.id, kind: it.kind, tag: it.tag, q: it.q, model, mode, surface, sample: k, ...r };
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
    console.log(`${it.id} ${surface} ${model} #${k} ${r.ok ? 'ok' : 'ERR ' + r.err} ${r.ms}ms ${JSON.stringify((r.final || '').slice(0, 90))}`);
  }
}
c.close(); process.exit(0);
