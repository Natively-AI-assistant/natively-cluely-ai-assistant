// Offline: why the live-transcript port admits one window. Needs an esbuild bundle of the app port next to it:
//   (in an app worktree) npx esbuild electron/context-intelligence/retrieval/live-transcript-port.ts electron/context-intelligence/retrieval/bm25.ts --bundle --platform=node --format=esm --outdir=<this dir>/ltp
import { filler } from './filler.mjs';
import * as L from './ltp/live-transcript-port.js';
import * as B from './ltp/bm25.js';
const q = 'Sorry, remind me what the project codename is, when we are launching, and who owns it?';
for (const nLines of [20, 80, 160]) {
  const facts = [{ at: 1, s: `For the record, the project codename is ATLASVINE-${nLines}.` }, { at: Math.floor(nLines / 2), s: `Quick note, the launch target moved to the ninth of November, reference LAUNCH-${nLines}.` }, { at: nLines - 3, s: `And Maya Ortholan owns the rollout, ticket OWNER-${nLines}.` }];
  const segs = []; for (let i = 0; i < nLines; i++) { const f = facts.find((x) => x.at === i); segs.push({ speaker: i % 2 ? 'other' : 'user', text: f ? f.s : filler(160, nLines * 1000 + i).replace(/\n/g, ' '), final: true }); }
  segs.push({ speaker: 'interviewer', text: q, final: true });
  const chunks = L.chunkLiveTranscript(segs);
  const idx = new B.Bm25Index(chunks.map((text, i) => ({ id: String(i), text })));
  const sc = idx.scoreNormalized(q);
  const tag = (t) => ['ATLASVINE', 'LAUNCH-', 'OWNER-'].filter((m) => t.includes(m)).join('+') || (t.includes('remind me') ? 'QUESTION' : '-');
  console.log(`${nLines} lines → ${chunks.length} windows; scored ${sc.length}; ≥0.2: ${sc.filter((x) => x.score >= 0.2).length}; top: ${sc.slice(0, 5).map((x) => `${tag(chunks[+x.id])}:${x.score.toFixed(2)}`).join(' ')}; fact windows: ${chunks.map((c, i) => [tag(c), i]).filter(([t]) => t !== '-').map(([t, i]) => `${t}@${(sc.find((x) => +x.id === i)?.score ?? 0).toFixed(2)}`).join(' ')}`);
}
