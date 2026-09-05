// Blind pairwise judgement. The judge never sees which condition produced which
// answer, and the two are presented in a randomised order per question so a
// positional preference cannot masquerade as a quality preference.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const API = 'http://127.0.0.1:8788';
const KEY = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8')
  .split('\n').find((l) => l.startsWith('NATIVELY_API_KEY=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8'));
const PAIRS = [['none', 'oracle'], ['none', 'production'], ['none', 'router']];
const tally = {};

for (const [a, b] of PAIRS) {
  tally[`${a} vs ${b}`] = { a: 0, b: 0, tie: 0 };
  for (const r of rows) {
    if (!r[a]?.text || !r[b]?.text) continue;
    const flip = Math.random() < 0.5;
    const [X, Y] = flip ? [r[b], r[a]] : [r[a], r[b]];
    const prompt = `A candidate is in a LIVE interview and is reading this off screen to help them answer out loud. The interviewer just asked:

"${r.question}"

ANSWER 1:
${X.text.slice(0, 2500)}

ANSWER 2:
${Y.text.slice(0, 2500)}

Which is more useful to the candidate in that live moment? Weigh correctness, and whether it can actually be used while speaking. Reply with exactly one word: 1, 2, or TIE.`;
    try {
      const res = await fetch(`${API}/v1/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-natively-key': KEY },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      });
      const j = await res.json();
      const v = (j.content ?? '').trim().toUpperCase().slice(0, 4);
      const winner = v.startsWith('1') ? (flip ? b : a) : v.startsWith('2') ? (flip ? a : b) : 'tie';
      if (winner === 'tie') tally[`${a} vs ${b}`].tie++;
      else if (winner === a) tally[`${a} vs ${b}`].a++;
      else tally[`${a} vs ${b}`].b++;
    } catch { /* skip */ }
  }
}
console.log('\nBLIND PAIRWISE, judged for usefulness in a live interview\n');
for (const [k, v] of Object.entries(tally)) {
  const [a, b] = k.split(' vs ');
  console.log(`${k.padEnd(24)}  ${a} ${v.a}  |  ${b} ${v.b}  |  tie ${v.tie}`);
}
