// tests/answer-engine-ab/run.cjs — A/B test: does turning Long-term memory on change
// what the overlay answer engine sends to the provider?
//
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/answer-engine-ab/run.cjs
//   (after `npm run build:electron`; Electron-as-Node for the native DB ABI)
//
// Runs capture.cjs once per arm, each in a FRESH process so no flag cache or singleton
// carries between arms, then compares the provider payloads byte for byte:
//   PASS requires  A  == B    V3 (default) path: memory saving + search leave the engine untouched
//            and   A0 == B0   same on the V3-off fallback path
//            and   C0m != A0m on the backward-looking typed question, with the recall text
//                             in C0m's payload (control: fallback path inside a meeting —
//                             a transcript-sourced mode + live transcript — the one place
//                             live recall can run; proves the harness sees a difference).
// B arms also prove what the change is for, executed: the save handler's opt-in, a
// post-meeting retain reaching the server, and search:global-meetings recalling it.
// C, C0 and Cm (live recall on elsewhere) are reported as findings, not checks.
// Exits 1 on any failure. Only volatile values (timestamps, request ids) are normalised,
// and every normalisation is listed in the output.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-ab-run-'));
const electron = require('electron'); // path to the binary under plain node; the running binary otherwise
const exe = typeof electron === 'string' ? electron : process.execPath;

function arm(cond) {
  const out = path.join(dir, `${cond}.json`);
  const r = spawnSync(exe, [path.join(__dirname, 'capture.cjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AB_CONDITION: cond, AB_V3: /0m?$/.test(cond) ? '0' : '1', AB_MEETING: cond.endsWith('m') ? '1' : '0', AB_OUT: out },
    encoding: 'utf8', timeout: 240_000,
  });
  if (!fs.existsSync(out)) throw new Error(`arm ${cond} produced nothing (exit ${r.status})\n${r.stderr?.slice(-2000)}`);
  const json = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (json.error) throw new Error(`arm ${cond} failed:\n${json.error}`);
  return json;
}

const VOLATILE = [
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\b/g, '<iso>'],
  [/\b1[6-9]\d{11}\b/g, '<epoch-ms>'],
  [/\bv3-[a-z-]+-\d+\b/g, '<v3-request-id>'],
  [/\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM|am|pm)?\b/g, '<clock>'],
];
const HS_HOST = '127.0.0.1:18888';
const AB_MEETING_ID = 'a0b1c2d3-0000-4000-8000-00000000ab01';
const norm = (s) => VOLATILE.reduce((acc, [re, rep]) => acc.replace(re, rep), String(s));
const payloadText = (p) => norm(JSON.stringify(p));

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        -> ${detail}`}`); };

function firstDiff(a, b) {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `@${i}: A«${a.slice(Math.max(0, i - 60), i + 80)}» vs B«${b.slice(Math.max(0, i - 60), i + 80)}»`;
}

const ARMS = { A: arm('A'), B: arm('B'), C: arm('C'), A0: arm('A0'), B0: arm('B0'), C0: arm('C0'), A0m: arm('A0m'), B0m: arm('B0m'), C0m: arm('C0m'), Am: arm('Am'), Bm: arm('Bm'), Cm: arm('Cm') };
console.log(`\n##### Long-term memory A/B — overlay answer engine (${dir})`);
console.log(`  normalised volatile values: ${VOLATILE.map(([, r]) => r).join(', ')}`);

console.log('\n  Setup (identical in every arm)');
for (const [n, x] of Object.entries(ARMS)) {
  check(`${n}: Hindsight configured + healthy through the real handlers`, x.typed.hindsightSet?.success === true && x.typed.hindsightTest?.healthy === true, JSON.stringify({ set: x.typed.hindsightSet, test: x.typed.hindsightTest }));
}

function compare(label, X, Y) {
  for (const surface of ['typed', 'live']) {
    const turns = (x) => (surface === 'typed' ? x.typed.turns : x.live);
    console.log(`\n  ${label} · ${surface === 'typed' ? 'typed chat — real gemini-chat-stream handler' : 'live answer — real IntelligenceEngine.runWhatShouldISay'}`);
    for (const t of turns(X)) {
      const b = turns(Y).find((x) => x.question === t.question);
      const a = payloadText(t.payloads), bb = payloadText(b.payloads);
      check(`${t.question}: provider called (${t.payloads.length}/${b.payloads.length})`, t.payloads.length > 0 && b.payloads.length > 0, 'no dispatch captured');
      check(`${t.question}: identical payload (${a.length} chars)`, a === bb, firstDiff(a, bb));
    }
  }
}

compare('V3 (default) · A memory off vs B memory+saving on', ARMS.A, ARMS.B);
compare('Fallback (V3 off) · A0 vs B0', ARMS.A0, ARMS.B0);
compare('V3 (default), in a meeting · Am vs Bm', ARMS.Am, ARMS.Bm);
compare('Fallback (V3 off), in a meeting · A0m vs B0m', ARMS.A0m, ARMS.B0m);

console.log('\n  Control — the harness must SEE recall where recall can run (else it is blind)');
console.log('  (A0m/C0m: fallback path, inside a meeting; they differ ONLY in hindsightLiveRecall)');
const turn = (x, q) => x.typed.turns.find((t) => t.question === q);
const back = (x) => turn(x, 'backward');
check('C0m differs from A0m on the backward-looking question', payloadText(back(ARMS.C0m).payloads) !== payloadText(back(ARMS.A0m).payloads), `identical — recall never reached the prompt; gates ${JSON.stringify(ARMS.C0m.typed.gates)}`);
check('C0m carries the recalled memory text', payloadText(back(ARMS.C0m).payloads).includes('AB-MEMORY-MARKER'), 'marker absent');
check('C0m recall hit the (fake) Hindsight server', (ARMS.C0m.fetchLog || []).some((u) => u.includes('/memories/recall')), JSON.stringify(ARMS.C0m.fetchLog));
check('A0m and C0m identical on the questions that are not backward-looking', ['normal', 'coding'].every((q) => payloadText(turn(ARMS.A0m, q).payloads) === payloadText(turn(ARMS.C0m, q).payloads)), 'recall leaked into a non-backward question');

console.log('\n  What saving Hindsight now does (B arms: no flag env, the real handler decides)');
const B_ARMS = ['B', 'B0', 'Bm', 'B0m'];
for (const n of B_ARMS) {
  const t = ARMS[n].typed;
  check(`${n}: a save without the pane's opt-in leaves memory off`, !t.flagsAfterNoOptIn.memory && !t.flagsAfterNoOptIn.retain && !t.flagsAfterNoOptIn.liveRecall, JSON.stringify(t.flagsAfterNoOptIn));
  check(`${n}: the setup save turns memory + saving on, live recall stays off`, t.flagsAfterSetup.memory && t.flagsAfterSetup.retain && !t.flagsAfterSetup.liveRecall, JSON.stringify(t.flagsAfterSetup));
}

console.log('\n  Network during answers — memory on adds no calls');
for (const [a, b] of [['A', 'B'], ['A0', 'B0'], ['Am', 'Bm'], ['A0m', 'B0m']]) {
  check(`${a} vs ${b}: identical network calls while answering (${ARMS[a].answerFetches.length})`, JSON.stringify(ARMS[a].answerFetches) === JSON.stringify(ARMS[b].answerFetches), `${JSON.stringify(ARMS[a].answerFetches)} vs ${JSON.stringify(ARMS[b].answerFetches)}`);
}
check('No B arm called recall while answering', !B_ARMS.some((n) => ARMS[n].answerFetches.some((u) => u.includes('/memories/recall'))), '');

console.log('\n  Memory in use (B): the post-meeting save and past-meeting search, executed');
{
  const m = ARMS.B.memory;
  check('a meeting summary is queued to Hindsight', m.retainQueued, JSON.stringify(m));
  check('the retain reached the (fake) server', m.retainFetches.some((u) => u.startsWith('POST ') && u.includes(HS_HOST) && !u.includes('/recall')), JSON.stringify(m.retainFetches));
  check('search:global-meetings recalls from Hindsight', m.searchFetches.some((u) => u.includes('/memories/recall')), JSON.stringify(m.searchFetches));
  const hits = (m.search?.results || []).filter((r) => String(r.meetingId || '').startsWith('hindsight:'));
  check('the recalled memory comes back as a search result', hits.some((r) => String(r.matchedSnippet || '').includes('AB-MEMORY-MARKER')), JSON.stringify(m.search));
  console.log('\n  Launcher memory search (B): search:memories against a real saved meeting');
  check('the tagged meeting exists in the database', Array.isArray(m.meetingSaved) && m.meetingSaved.length === 1, JSON.stringify(m.meetingSaved));
  check('search:memories asks Hindsight', m.memorySearchFetches.some((u) => u.includes('/memories/recall')), JSON.stringify(m.memorySearchFetches));
  const rows = m.memorySearch?.results || [];
  const linked = rows.find((r) => String(r.text).includes('AB-MEMORY-MARKER'));
  const unlinked = rows.find((r) => String(r.text).includes('AB-UNLINKED-MEMORY'));
  check('the tagged memory links to its meeting (id + title)', linked?.meetingId === AB_MEETING_ID && linked?.meetingTitle === 'AB budget review', JSON.stringify(m.memorySearch));
  check('the untagged memory comes back unlinked', Boolean(unlinked) && !unlinked.meetingId, JSON.stringify(m.memorySearch));
}
for (const n of ['A', 'A0', 'Am', 'A0m']) {
  const off = ARMS[n].memoryOff;
  check(`${n}: memory off → search:memories not enabled, zero network calls`, off && off.res?.enabled === false && off.fetches.length === 0, JSON.stringify(off));
}

console.log('\n  Finding (informational) — where live recall reaches the prompt today');
for (const [n, note] of [['C', 'V3, General'], ['Cm', 'V3, in a meeting'], ['C0', 'fallback, General']]) {
  const hit = payloadText(back(ARMS[n]).payloads).includes('AB-MEMORY-MARKER');
  console.log(`  ${n} (${note}, live recall on): ${hit ? 'INJECTS recalled memory' : 'no recall in the prompt'}`);
}
console.log('  Memories reach the user through the Launcher search pill (search:memories), not answers.');

// AB_BASELINE=<dir of a previous run's arm JSONs>: every arm's answer payloads must be
// byte-identical to that run's (after normalisation). Used to prove a change outside the
// engine (e.g. the Launcher's memory search) left every answer — incl. the live-recall
// control — exactly as it was.
if (process.env.AB_BASELINE) {
  console.log(`\n  Baseline — every arm's answer payloads vs ${process.env.AB_BASELINE}`);
  for (const [n, x] of Object.entries(ARMS)) {
    const f = path.join(process.env.AB_BASELINE, `${n}.json`);
    if (!fs.existsSync(f)) { check(`${n}: baseline present`, false, f); continue; }
    const base = JSON.parse(fs.readFileSync(f, 'utf8'));
    const pay = (y) => payloadText([...y.typed.turns.map((t) => t.payloads), ...y.live.map((t) => t.payloads)]);
    const a = pay(base), b = pay(x);
    check(`${n}: typed + live payloads identical to baseline (${b.length} chars)`, a === b, firstDiff(a, b));
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n  ${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
