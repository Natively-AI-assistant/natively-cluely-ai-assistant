// Score an aa-harness run: which turns fired, how fast, on what question.
//   node tests/auto-answer-live/analyze.mjs results/<label>.json [--log <app log> [--from <line>]]
//
// A "generation" is one answer the overlay received (token batches + final
// sharing a generationId). Each is attributed to the interviewer turn its
// question text overlaps most, among turns spoken before it started.
import fs from 'node:fs';
import { SCRIPTS } from './scripts.mjs';

const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const logFile = opt('log', null);
const logFrom = Number(opt('from', 0));
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const script = SCRIPTS[r.script];
const byId = Object.fromEntries(script.filter((s) => s.id).map((s) => [s.id, s]));

const words = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
function overlap(a, b) {
  const A = new Set(words(a)); const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

const turns = r.turns.filter((t) => t.who === 'interviewer');
// Main sends each answer to ONE window, whichever mode the app is in
// (WindowHelper.getMainWindow): the overlay, or the launcher when someone
// switched to it mid-run. Either way the engine answered.
const ev = r.events.filter((e) => (e.win === 'overlay' || e.win === 'launcher') && e.phase !== 'warmup' && e.t >= (r.warmupEnd ?? 0));
const gens = new Map();
// Id-less emitters (brainstorm, legacy paths) send tokens and a final with no
// generationId: one run = the id-less tokens up to and including the id-less final.
let nogenRun = 0;
let nogenOpen = false;
for (const e of ev) {
  if (e.k === 'discard') continue;
  if (e.gen == null && !nogenOpen) { nogenRun++; nogenOpen = true; }
  const key = e.gen ?? `nogen-${nogenRun}`;
  if (e.gen == null && e.k === 'final') nogenOpen = false;
  const g = gens.get(key) ?? { gen: key, first: null, final: null, q: null, answer: null, tokens: 0 };
  if (e.k === 'token') { g.first = g.first ?? e.t; g.tokens++; g.q = g.q ?? e.q; g.firstLen = g.firstLen ?? e.len; }
  if (e.k === 'final') { g.final = e.t; g.q = e.q ?? g.q; g.answer = e.answer; g.first = g.first ?? e.t; }
  gens.set(key, g);
}
for (const g of gens.values()) {
  const candidates = turns.filter((t) => t.speechStart <= (g.first ?? g.final));
  // The question label often carries the lead-in turns before the ask, and
  // overlap() normalizes by the shorter text, so EVERY earlier turn contained
  // in it scores ~1. The ask is the latest of the near-best matches.
  const scored = candidates.map((t) => ({ t, sc: overlap(g.q, t.text) }));
  const top = Math.max(-1, ...scored.map((x) => x.sc));
  // (The ask itself may be cut short in the label when the judge fired on its
  // main clause, so "near-best" is generous: 0.6.)
  const best = [...scored].reverse().find((x) => x.sc >= Math.min(top, 0.6)) ?? null;
  g.turn = best?.t.id ?? null; g.qScore = best ? +best.sc.toFixed(2) : -1;
}

const rows = [];
for (const t of turns) {
  const mine = [...gens.values()].filter((g) => g.turn === t.id).sort((a, b) => a.first - b.first);
  // A generation that started before the interviewer finished answered a PART
  // of the turn (an announced spec, a setup): count it as an early fire. The
  // turn's latency is the first answer after the end of speech, and its
  // content check is the LAST answer — the one the user ends up reading.
  const early = mine.filter((x) => x.first < t.speechEnd);
  const onTime = mine.filter((x) => x.first >= t.speechEnd);
  const g = onTime[0] ?? mine[mine.length - 1];
  const last = mine[mine.length - 1];
  const s = byId[t.id];
  const fired = Boolean(g);
  const verdict = t.expect === 'either' ? (fired ? 'ok(fired)' : 'ok(silent)')
    : t.expect === 'answer' ? (fired ? 'OK' : 'MISS')
    : (fired ? 'FALSE_FIRE' : 'OK');
  const check = fired && s?.check ? s.check.test(last.answer ?? '') : null;
  rows.push({
    id: t.id, expect: t.expect, verdict,
    firstMs: g ? g.first - t.speechEnd : null,
    finalMs: g?.final ? g.final - t.speechEnd : null,
    streamed: g ? g.tokens > 1 || (g.firstLen ?? 0) < (g.answer?.length ?? 0) : null,
    dup: early.length || onTime.length > 1 ? `${early.length}e${onTime.length > 1 ? `+${onTime.length - 1}` : ''}` : '',
    check,
    q: g?.q ? String(g.q).slice(0, 90) : '',
  });
}
const pad = (v, n) => String(v ?? '').padEnd(n);
console.log(`${pad('id', 4)} ${pad('expect', 7)} ${pad('verdict', 11)} ${pad('first', 6)} ${pad('final', 6)} ${pad('strm', 5)} ${pad('dup', 3)} ${pad('chk', 5)} question`);
for (const x of rows) console.log(`${pad(x.id, 4)} ${pad(x.expect, 7)} ${pad(x.verdict, 11)} ${pad(x.firstMs, 6)} ${pad(x.finalMs, 6)} ${pad(x.streamed, 5)} ${pad(x.dup, 3)} ${pad(x.check, 5)} ${x.q}`);
const answered = rows.filter((x) => x.expect === 'answer');
const firsts = answered.map((x) => x.firstMs).filter((v) => v != null).sort((a, b) => a - b);
const med = (a) => (a.length ? a[Math.floor((a.length - 1) / 2)] : null);
const p90 = (a) => (a.length ? a[Math.min(a.length - 1, Math.ceil(a.length * 0.9) - 1)] : null);
console.log(`\nanswer turns: ${answered.filter((x) => x.verdict === 'OK').length}/${answered.length} fired; silent turns: ${rows.filter((x) => x.expect === 'silent' && x.verdict === 'OK').length}/${rows.filter((x) => x.expect === 'silent').length} quiet; content checks ${answered.filter((x) => x.check).length}/${answered.filter((x) => x.check !== null).length}`);
console.log(`stop→first token: median ${med(firsts)} ms, p90 ${p90(firsts)} ms, max ${firsts[firsts.length - 1] ?? null} ms`);
const orphans = [...gens.values()].filter((g) => !g.turn);
if (orphans.length) console.log(`unattributed generations: ${orphans.length}`);

if (args.includes('--answers')) {
  for (const g of [...gens.values()].sort((a, b) => a.first - b.first)) {
    console.log(`\n── ${g.turn} gen ${g.gen} q="${g.q}"\n${String(g.answer ?? '(no final)').slice(0, 700)}`);
  }
}

// Log decomposition: per turn, the engine's own milestones relative to speech end.
if (logFile) {
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').slice(logFrom);
  const pick = /\[STT:interviewer\] |\[AutoAnswer:text\] (judging|verdict|superseded|deferred)|\[AutoAnswer:simple\]|prefetch fired|Speculative stream accepted|Revealing the prefetched|Finishing the adopted|JSON pre-response failure|tfftMs|serverModel|Structured generation|Automatic trigger|cooldown|parked/;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const end = (turns[i + 1]?.speechStart ?? r.finishedAt) + 3000;
    console.log(`\n== ${t.id} (${t.expect}) "${t.text.slice(0, 70)}"`);
    for (const l of lines) {
      const ts = Number(l.slice(0, 13));
      if (!ts || ts < t.speechStart - 500 || ts > end) continue;
      const body = l.slice(14);
      if (!pick.test(body)) continue;
      console.log(`  ${String(ts - t.speechEnd).padStart(6)}  ${body.trim().slice(0, 150)}`);
    }
  }
}
