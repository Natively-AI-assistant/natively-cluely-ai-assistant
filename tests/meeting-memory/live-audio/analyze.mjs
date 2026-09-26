// tests/meeting-memory/live-audio/analyze.mjs
//   node tests/meeting-memory/live-audio/analyze.mjs <results.json>
//
// Summarises a live-audio run: probe outcomes by route, the live index over
// time (saved / embedded / pending — the injected-failure window shows the
// retry), and STT lateness: for every spoken line, how long after the speaker
// stopped its words reached the meeting transcript (matched by word overlap).

import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
const pct = (n, d) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : 'n/a');

// ── probes ───────────────────────────────────────────────────────────────────
for (const kind of ['wta', 'typed', 'index']) {
  const ps = run.probes.filter((p) => p.kind === kind);
  if (!ps.length) continue;
  out.push(`\n## ${kind === 'wta' ? 'What-to-answer (no question; resolved from live speech)' : kind === 'typed' ? 'typed questions' : 'live-index semantic search (top 3)'}`);
  for (const p of ps) {
    const verdict = kind === 'index' ? (p.hitRank >= 0 ? `hit at rank ${p.hitRank + 1}` : (p.error ?? 'miss')) : p.result;
    const extra = kind === 'index' ? '' : ` ${p.ms} ms${p.inEvidence ? ' · in evidence' : ''}${p.inHistory ? ' · in history' : ''}`;
    out.push(`- [min ${p.minute}] ${p.id}: **${verdict}**${extra}${p.resolvedQuestion ? ` · question seen: "${String(p.resolvedQuestion).slice(0, 90)}"` : ''}`);
    const ans = (p.answer ?? (p.top?.[0]?.text ?? '')).replace(/\s+/g, ' ').slice(0, 220);
    if (ans) out.push(`  > ${ans}`);
  }
}

// ── live index ───────────────────────────────────────────────────────────────
out.push('\n## live index over time');
for (const t of run.timeline.filter((x, i, a) => x.tag !== 'tick' || i % 5 === 0 || i === a.length - 1)) {
  const li = t.liveIndex ?? {};
  out.push(`- min ${t.minute} ${t.tag === 'tick' ? '' : `(${t.tag}) `}saved ${li.saved} · embedded ${li.embedded} · pending ${li.pending} · transcript ${t.transcript?.count} (${JSON.stringify(t.transcript?.bySpeaker ?? {})})`);
}
const fail = run.timeline.findIndex((t) => t.tag === 'fail-embeds');
if (fail >= 0) {
  const after = run.timeline.slice(fail).map((t) => `${t.minute}:${t.liveIndex?.pending}`).slice(0, 8).join(' ');
  out.push(`- pending after the injected failures (minute:pending): ${after}`);
}
if (run.liveChunks?.length) {
  const labelled = run.liveChunks.filter((c) => /^(ME|THEM): /m.test(c.cleaned_text)).length;
  out.push(`- ${run.liveChunks.length} live chunks at the end, ${labelled} with speaker labels`);
}

// ── STT lateness ─────────────────────────────────────────────────────────────
const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
const tx = (run.transcript ?? []).map((s) => ({ ...s, w: new Set(words(s.text)) }));
const lat = { interviewer: [], user: [] };
let unmatched = { interviewer: 0, user: 0 };
for (const say of run.says ?? []) {
  const w = words(say.text);
  if (w.length < 4) continue;
  // The first transcript segment of the same speaker, at/after the line started,
  // that shares at least half of the line's last 6 content words = the line's tail landing.
  const tail = w.slice(-6);
  const seg = tx.find((s) => s.speaker === say.who && s.timestamp >= say.start && tail.filter((x) => s.w.has(x)).length >= Math.ceil(tail.length / 2));
  if (!seg) { unmatched[say.who]++; continue; }
  lat[say.who].push(seg.timestamp - say.end);
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
out.push('\n## STT lateness — speaker stops → words in the transcript');
for (const who of ['interviewer', 'user']) {
  const xs = lat[who];
  out.push(`- ${who === 'interviewer' ? 'interviewer (system audio)' : 'you (mic)'}: ${xs.length} lines matched, ${unmatched[who]} not found · median ${Math.round(q(xs, 0.5) / 100) / 10} s · p90 ${Math.round(q(xs, 0.9) / 100) / 10} s · over 10 s: ${pct(xs.filter((x) => x > 10000).length, xs.length)}`);
}
out.push(`\nnotes: ${JSON.stringify(run.notes)}`);
console.log(out.join('\n'));
