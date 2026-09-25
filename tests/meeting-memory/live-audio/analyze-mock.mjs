// tests/meeting-memory/live-audio/analyze-mock.mjs
//   node tests/meeting-memory/live-audio/analyze-mock.mjs <results.json>
//
// Per-question view of a mock-interview run: did What-to-answer answer the
// question just asked, was the suggestion on topic, did memory-dependent
// questions get the earlier detail, and every miss listed for hand review.

import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const qs = run.probes.filter((p) => p.kind === 'wta' && p.asked);
const pct = (n, d) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : 'n/a');
const med = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const p90 = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(0.9 * s.length))] : NaN; };

// Sections by the order the script asks them in.
const SECTIONS = [
  ['background', (id) => /^Q0[1-8]/.test(id)],
];
const out = [];
out.push(`# Mock technical interview — ${qs.length} questions answered by What-to-answer (script has ${run.questions})`);
const answered = qs.filter((p) => p.answer);
out.push(`- answered: ${pct(answered.length, qs.length)} · errors: ${qs.filter((p) => !p.answer).length}`);
out.push(`- answered the question just asked (≥50% of its words in the prompt's question): ${pct(qs.filter((p) => p.questionOverlap >= 0.5).length, qs.length)}`);
out.push(`- on topic (per-question pattern): ${pct(qs.filter((p) => p.relevant).length, qs.length)}`);
out.push(`- refused / said it lacked the information: ${pct(qs.filter((p) => p.denied).length, qs.length)}`);
const mem = qs.filter((p) => p.memoryNeeded);
out.push(`- memory-dependent questions with the earlier detail in the answer: ${pct(mem.filter((p) => p.memoryRecalled).length, mem.length)}`);
const code = qs.filter((p) => p.codeProduced !== undefined);
if (code.length) out.push(`- coding ask produced code: ${pct(code.filter((p) => p.codeProduced).length, code.length)}`);
out.push(`- answer time: median ${Math.round(med(qs.map((p) => p.ms)))} ms · p90 ${Math.round(p90(qs.map((p) => p.ms)))} ms`);

out.push('\n## memory-dependent questions');
for (const p of mem) {
  out.push(`- [min ${p.minute}] ${p.id} — **${p.memoryRecalled ? 'recalled' : 'MISSED'}**${p.inEvidence ? ' · detail in evidence' : ''}${p.inHistory ? ' · detail in history' : ''}`);
  out.push(`  asked: ${p.asked}`);
  out.push(`  > ${(p.answer ?? '').replace(/\s+/g, ' ').slice(0, 240)}`);
}

out.push('\n## questions the overlay did not match to what was just asked (overlap < 0.5)');
for (const p of qs.filter((x) => x.questionOverlap < 0.5)) {
  out.push(`- [min ${p.minute}] ${p.id} overlap ${p.questionOverlap}: asked "${p.asked}" · prompt question "${String(p.promptQuestion).slice(0, 140)}"`);
}

out.push('\n## off-topic or refused (hand-check)');
for (const p of qs.filter((x) => !x.relevant || x.denied)) {
  out.push(`- [min ${p.minute}] ${p.id}${p.denied ? ' (refused)' : ''}: "${p.asked}"`);
  out.push(`  > ${(p.answer ?? '(no answer)').replace(/\s+/g, ' ').slice(0, 240)}`);
}

out.push('\n## behavioural questions asked BEFORE the candidate told the story (invented specifics?)');
for (const p of qs.filter((x) => x.storyBeforeTold)) {
  out.push(`- [min ${p.minute}] ${p.id}: "${p.asked}"`);
  out.push(`  > ${(p.answer ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
}

const typed = run.probes.filter((p) => p.kind === 'typed' && p.result);
if (typed.length) {
  out.push('\n## typed questions');
  for (const p of typed) out.push(`- [min ${p.minute}] ${p.id}: **${p.result}** — ${(p.answer ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
}
const idx = run.probes.filter((p) => p.kind === 'index');
if (idx.length) {
  out.push('\n## live-index search');
  for (const p of idx) out.push(`- [min ${p.minute}] ${p.id}: ${p.hitRank >= 0 ? `hit at rank ${p.hitRank + 1}` : (p.error ?? 'miss')}`);
}
const end = run.timeline[run.timeline.length - 1];
if (end) out.push(`\nlive index at the end: ${JSON.stringify(end.liveIndex)} · transcript ${JSON.stringify(end.transcript)}`);
out.push(`notes: ${JSON.stringify(run.notes)}`);
console.log(out.join('\n'));
