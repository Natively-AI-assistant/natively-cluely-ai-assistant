// tests/realtime-prompt/drive-running-app.mjs — see README.md (needs an ISOLATED instance on :9366)
//
// Drives the REAL running app (isolated profile) over CDP: real renderer API ->
// real `gemini-chat-stream` IPC handler in ipcHandlers.ts -> real provider.
const PORT = 9366;
const surface = process.argv.includes('--overlay') ? 'overlay' : 'chat';
const only = (process.argv.find(a => a.startsWith('--only=')) || '--only=').slice(7);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const launcher = targets.find(t => t.url.includes('window=launcher'));
if (!launcher) { console.log('no launcher window'); process.exit(2); }
const ws = new WebSocket(launcher.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

// identity check: this must be OUR instance (isolated DB => "General" has an empty prompt at first run)
const who = await evaluate(`(async()=>{ const m = await window.electronAPI.modesGetAll(); return { api: typeof window.electronAPI.streamGeminiChat, modes: m.map(x => x.templateType + ':' + (x.customContext||'').length) }; })()`);
console.log('instance check:', JSON.stringify(who));

const ask = (template, instructions, question) => evaluate(`(async () => {
  const api = window.electronAPI;
  const modes = await api.modesGetAll();
  const mode = modes.find(m => m.templateType === ${JSON.stringify(template)} && m.isBuiltin !== false) || modes.find(m => m.templateType === ${JSON.stringify(template)});
  if (!mode) return { error: 'no mode ' + ${JSON.stringify(template)} };
  const u = await api.modesUpdate(mode.id, { customContext: ${JSON.stringify(instructions)} });
  const a = await api.modesSetActive(mode.id);
  if (u?.success === false || a?.success === false) return { error: 'mode api: ' + JSON.stringify([u, a]) };
  return await new Promise((resolve) => {
    let text = ''; const offs = [];
    const finish = (r) => { offs.forEach(f => { try { f(); } catch {} }); resolve(r); };
    offs.push(api.onGeminiStreamToken((t) => { text += t; }));
    offs.push(api.onGeminiStreamDone((d) => finish({ text: (d && d.finalText) || text })));
    offs.push(api.onGeminiStreamError((e) => finish({ error: String(e), text })));
    setTimeout(() => finish({ error: 'timeout', text }), 90000);
    if (${JSON.stringify(surface)} === 'overlay') api.generateWhatToSay(${JSON.stringify(question)}).then((r) => finish(r && r.answer ? { text: r.answer } : { error: 'wts: ' + JSON.stringify(r).slice(0, 200), text })).catch((e) => finish({ error: 'invoke: ' + e, text }));
    else api.streamGeminiChat(${JSON.stringify(question)}).catch((e) => finish({ error: 'invoke: ' + e, text }));
  });
})()`);

const prose = (t) => t.replace(/```[\s\S]*?```/g, ' ');
const words = (t) => (prose(t).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
const fence = (t) => (t.match(/```([A-Za-z0-9+#]*)/) || [])[1]?.toLowerCase() || '(none)';
const bullets = (t) => (t.match(/^\s*(?:[-*•]|\d+[.)])\s+\S/gm) || []).length;
const CONTRACT = 'Pair programming contract: for every coding question respond in exactly this format. First restate the problem in one line. Then list the approach as numbered steps. Then give the code in Java. Then give a dry run on one example. Do not use the Approach / Complexity / Edge cases headings.';
const PY_STUB = 'Solve this one. This is what is in the editor:\n```python\nclass Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        pass\n```';

const SCEN = [
  ['A1', 'general', 'Answer in 100 words.', 'What is a good return policy for opened items in an electronics store?', a => { const w = words(a); return [w >= 85 && w <= 115, `${w} words`]; }],
  ['A2', 'seminar', 'Answer as exactly three bullet points.', 'Can you explain what gradient descent is?', a => { const b = bullets(a); return [b === 3, `${b} bullets`]; }],
  ['A3', 'call-center', 'Always reply in Spanish.', 'My internet has been down since morning, what should I tell the customer?', a => { const es = (a.toLowerCase().match(/\b(el|la|los|las|de|que|para|con|una|por|es|en|su|usted|nuestro|lamento|servicio)\b/g) || []).length; const en = (a.toLowerCase().match(/\b(the|and|is|of|to|you|your|we|our|with|for)\b/g) || []).length; return [es >= 3 && es > en * 2, `es=${es} en=${en}`]; }],
  ['A4', 'technical-interview', 'Use Java only', PY_STUB, a => { const f = fence(a); return [f === 'java', `fence=${f}`]; }],
  ['A5', 'technical-interview', CONTRACT, 'Write a function to solve two sum.', a => { const dsa = /^##\s*(Approach|Complexity|Technique|Interviewer)/mi.test(a) || /O\(\?\)/.test(a); const f = fence(a); return [!dsa && f === 'java', `${dsa ? 'DSA-headings' : 'user-format'} fence=${f}`]; }],
  ['A6', 'technical-interview', '', 'Write a function to solve two sum.', a => { const ok = /^## Approach/m.test(a) && /^## Complexity/m.test(a); return [ok, ok ? 'CONTROL: default six-section contract intact' : 'CONTROL: default contract missing']; }],
].filter(s => !only || only.split(',').includes(s[0]));

let pass = 0;
for (const [sid, template, ins, q, score] of SCEN) {
  const r = await ask(template, ins, q);
  if (!r || r.error) { console.log(`${sid} [${template}] ERROR ${r && r.error} text=${JSON.stringify((r && r.text || '').slice(0, 120))}`); continue; }
  const [ok, note] = score(r.text || '');
  if (ok) pass++;
  console.log(`${sid} [${template}] ${ok ? 'PASS' : 'FAIL'}  ${note}   instr=${JSON.stringify(ins.slice(0, 44))}`);
  if (!ok) console.log('     answer: ' + JSON.stringify((r.text || '').slice(0, 300)));
}
console.log(`\nreal app, ${surface === 'overlay' ? 'LIVE what-to-say (overlay engine path)' : 'typed chat'}: ${pass}/${SCEN.length}`);
ws.close(); process.exit(0);
