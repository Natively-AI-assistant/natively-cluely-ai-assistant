// Provider canary (second spec, Part 7): the same three questions through each
// reachable provider path, so the wire records show whether providers receive
// the same live-answer contract. A provider without a key is driven with a
// dummy one and MUST have its host in NATIVELY_PROMPT_DEBUG_BLOCK_HOSTS: the
// request is captured and answered locally, never sent.
//
//   node tests/live-answer/canary.mjs <label> [--providers=openai,openrouter,claude,natively]
import fs from 'node:fs';
import path from 'node:path';
import { connect, setup, setMode, askTyped, askHotkey, promptDebug, setKeys, useModel, readEnv } from './cdp.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = process.argv[2];
const providers = arg('providers', 'openai,openrouter,claude').split(',').filter(Boolean);
const RESULTS = process.env.LIVE_ANSWER_RESULTS ? path.resolve(process.env.LIVE_ANSWER_RESULTS) : path.resolve(new URL('./results/', import.meta.url).pathname);
fs.mkdirSync(RESULTS, { recursive: true });
const outFile = path.join(RESULTS, `${label}.jsonl`);
const sysFile = path.join(RESULTS, `${label}.systems.json`);
const systems = fs.existsSync(sysFile) ? JSON.parse(fs.readFileSync(sysFile, 'utf8')) : {};
const env = readEnv();

const CONFIG = {
  openai: { keys: { openai: env.OPENAI_API_KEY }, model: 'gpt-5.4' },
  openrouter: { keys: { openrouter: env.OPENROUTER_API_KEY }, model: 'openrouter/google/gemini-3.1-flash-lite' },
  claude: { keys: { claude: 'sk-ant-prompt-debug-dummy' }, model: 'claude-haiku-4-5', blocked: true },
  natively: { keys: { natively: env.NATIVELY_API_KEY }, model: 'natively', blocked: true },
};
const QUESTIONS = [
  { id: 'S01', q: 'What is the difference between a process and a thread?' },
  { id: 'S03', q: 'Tell me about a time you faced a difficult challenge while working on a project.' },
  { id: 'S07', q: 'Tell me about yourself.' },
];

const c = await connect();
await setup(c, 'gemini-3.1-flash-lite');
await setMode(c, 'general');
for (const p of providers) {
  const cfg = CONFIG[p];
  if (!cfg) continue;
  const k = await setKeys(c, cfg.keys);
  const u = await useModel(c, cfg.model);
  console.log(`== ${p}: keys ${JSON.stringify(k)} model ${JSON.stringify(u?.cfg)}`);
  for (const it of QUESTIONS) for (const surface of ['hotkey', 'typed']) {
    await promptDebug(c, { clear: true });
    let r;
    try { r = surface === 'hotkey' ? await askHotkey(c, null, it.q) : await askTyped(c, it.q); }
    catch (e) { r = { surface, ok: false, err: String(e).slice(0, 200), final: '' }; }
    const dbg = await promptDebug(c, { clear: true });
    const recs = (dbg.records || []).filter(x => !/cachedContents/.test(x.path || ''));
    const linked = recs.filter(x => x.note);
    for (const x of recs) systems[x.systemSha] = x.system;
    const row = {
      label, provider: p, id: it.id, q: it.q, surface, final: r.final, ok: r.ok, err: r.err,
      attempts: recs.map(x => ({ seq: x.seq, provider: x.provider, model: x.model, blocked: x.blocked, status: x.status, systemSha: x.systemSha, systemChars: (x.system || '').length, linked: Boolean(x.note), personaAction: x.note?.extra?.turnFacts?.personaAction ?? null, promptSource: x.note?.promptSource ?? null, params: x.params, userChars: (x.messages?.at(-1)?.text || '').length })),
      adapter: (dbg.adapter || []).map(a => a.provider),
      linkedProviders: linked.map(x => x.provider),
    };
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
    console.log(`${p} ${it.id} ${surface} ok=${r.ok} attempts=${row.attempts.map(a => `${a.provider}${a.blocked ? '[blocked]' : ''}:${a.status}:${a.systemChars}`).join(' → ')} ${JSON.stringify((r.final || r.err || '').slice(0, 80))}`);
  }
}
fs.writeFileSync(sysFile, JSON.stringify(systems));
await useModel(c, 'gemini-3.1-flash-lite');
c.close();
process.exit(0);
