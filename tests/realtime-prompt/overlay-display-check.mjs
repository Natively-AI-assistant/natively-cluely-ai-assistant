// tests/realtime-prompt/overlay-display-check.mjs — see README.md. STARTS A REAL MEETING (mic + system audio).
//
// Starts a REAL meeting in the isolated instance, triggers a live answer, and
// reads what the OVERLAY WINDOW actually renders (DOM text + a screenshot).
import fs from 'node:fs';
import os from 'node:os';
const PORT = 9366; const outDir = process.argv[2] || os.tmpdir();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json`); break; } catch { await sleep(1500); } }
const targets = async () => (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const connect = async (t) => {
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  return { send, evaluate, close: () => ws.close() };
};
await sleep(4000);
const launcher = await connect((await targets()).find(t => t.url.includes('window=launcher')));

const setMode = (template, ins) => launcher.evaluate(`(async()=>{ const api=window.electronAPI; const m=(await api.modesGetAll()).find(x=>x.templateType===${JSON.stringify(template)}); await api.modesUpdate(m.id,{customContext:${JSON.stringify(ins)}}); await api.modesSetActive(m.id); return m.name; })()`);
console.log('mode set:', await setMode('seminar', 'Answer as exactly three bullet points.'));
const started = await launcher.evaluate(`window.electronAPI.startMeeting().then(r => JSON.stringify(r)).catch(e => 'ERR ' + e)`);
console.log('startMeeting ->', started);
await sleep(5000);

const overlay = await connect((await targets()).find(t => t.url.includes('window=overlay') && !t.url.includes('overlay-')));
const vis = await overlay.evaluate(`JSON.stringify({ visibility: document.visibilityState, w: innerWidth, h: innerHeight })`);
console.log('overlay window:', vis);

const runTurn = async (label, question, check) => {
  const before = await overlay.evaluate(`document.body.innerText.length`);
  const answer = await launcher.evaluate(`window.electronAPI.generateWhatToSay(${JSON.stringify(question)}).then(r => (r && r.answer) || ('ERR ' + JSON.stringify(r))).catch(e => 'ERR ' + e)`);
  await sleep(2500);
  const text = await overlay.evaluate(`document.body.innerText`);
  const norm = (s) => s.replace(/[*_\`#>-]/g, ' ').replace(/\\s+/g, ' ').trim().toLowerCase();
  // Does the overlay SHOW the engine's answer? Compare on a distinctive slice of the answer's prose.
  const probe = norm(String(answer).replace(/\`\`\`[\\s\\S]*?\`\`\`/g, ' ')).split(' ').filter(w => w.length > 3).slice(2, 10);
  const shown = probe.filter(w => norm(text).includes(w)).length;
  const [ok, note] = check(String(answer), text);
  console.log(`\\n${label}\\n  engine answer : ${JSON.stringify(String(answer).slice(0, 150))}\\n  overlay text  : ${before} -> ${text.length} chars; ${shown}/${probe.length} answer words visible in the overlay DOM\\n  instruction   : ${ok ? 'FOLLOWED' : 'NOT FOLLOWED'} (${note})\\n  DISPLAYED     : ${shown >= Math.max(3, probe.length - 2) ? 'YES' : 'NO'}`);
  const shot = await overlay.send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) { const f = `${outDir}/overlay-${label.split(' ')[0]}.png`; fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64')); console.log('  screenshot    :', f); }
};
const bullets = (t) => (t.match(/^\\s*(?:[-*•]|\\d+[.)])\\s+\\S/gm) || []).length;
await runTurn('T1 seminar · "exactly three bullet points"', 'Can you explain what gradient descent is?', (a) => [bullets(a) === 3, `${bullets(a)} bullets`]);
await setMode('technical-interview', 'Use Java only');
await runTurn('T2 technical-interview · "Use Java only"', 'Write a function to reverse a linked list.', (a) => { const f = (a.match(/\`\`\`([A-Za-z0-9+#]*)/) || [])[1]; return [String(f).toLowerCase() === 'java', 'fence=' + f]; });

console.log('\\nendMeeting ->', await launcher.evaluate(`window.electronAPI.endMeeting().then(r => JSON.stringify(r)).catch(e => 'ERR ' + e)`));
launcher.close(); overlay.close(); process.exit(0);
