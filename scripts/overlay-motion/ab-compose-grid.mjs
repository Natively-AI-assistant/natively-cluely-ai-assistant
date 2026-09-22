// Lays four real-overlay screencast captures out as a 2x2 grid at close to full
// size — four side-by-side columns are unreadable once scaled to a shareable
// width, and the thing being judged is a 150px height change.
//
// Screencast frames arrive at the WINDOW's live size, which changes mid-capture,
// so each is padded onto a fixed canvas anchored top-centre — exactly how the
// real window grows downward from a fixed origin. Padding, not scaling: scaling
// each frame to a common size would normalise away the whole comparison.
//
// All four captures run the SAME scripted send, and each is aligned on its own
// `sentAt`, so t=0 is the keypress in every cell.
import { readFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = process.argv[2];
const LABEL = process.argv[3];
const DIRS = process.argv.slice(4); // 4 capture dirs, row-major

const CELL_W = 1500;
const CELL_H = 780;
const LABEL_H = 64;
const FPS = 30;
const FROM_MS = -400;
const TO_MS = 1500;

const load = (d) => {
  const m = JSON.parse(readFileSync(`${d}/meta.json`, 'utf8'));
  const files = readdirSync(d).filter((f) => f.endsWith('.jpg')).sort();
  return { frames: m.frames, files: files.map((f) => `${d}/${f}`), zero: m.sentAt };
};

const caps = DIRS.map(load);
const resample = (cap, speed) => {
  const idx = [];
  for (let t = FROM_MS; t < TO_MS; t += (1000 / FPS) * speed) {
    const want = cap.zero + t;
    let best = 0;
    for (let i = 0; i < cap.frames.length; i++) if (cap.frames[i].t <= want) best = i;
    idx.push(cap.files[best]);
  }
  return idx;
};
// Real speed first, then the same window again at half speed. The expand lasts
// ~700ms; at real speed that is ~21 frames, which is enough to feel but not
// enough to compare four of them. The slow pass is the one you actually judge on.
const seqs = caps.map((c) => [...resample(c, 1), ...resample(c, 0.5)]);
const n = Math.min(...seqs.map((s) => s.length));

const tmp = `${OUT}.frames`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

for (let i = 0; i < n; i++) {
  const inputs = seqs.flatMap((s) => ['-i', s[i]]);
  const pads = seqs
    .map((_, k) => `[${k}:v]pad=${CELL_W}:${CELL_H}:(ow-iw)/2:${LABEL_H}:color=0x141418[c${k}]`)
    .join(';');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', ...inputs,
    '-filter_complex',
    `${pads};[c0][c1]hstack=inputs=2[top];[c2][c3]hstack=inputs=2[bot];[top][bot]vstack=inputs=2[v]`,
    '-map', '[v]', '-frames:v', '1', `${tmp}/g${String(i).padStart(4, '0')}.png`,
  ]);
}

execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', `${tmp}/g%04d.png`,
  '-i', LABEL,
  '-filter_complex',
  `[0:v][1:v]overlay=0:0,scale=1320:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=max_colors=72[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`,
  '-loop', '0', OUT,
]);
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${OUT} (${n} frames @ ${FPS}fps, t=${FROM_MS}..${TO_MS}ms around SEND)`);
