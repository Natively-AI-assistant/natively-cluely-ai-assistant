// Composes the two real-overlay screencast captures into one side-by-side clip.
//
// Screencast frames arrive at the WINDOW's live size, which changes mid-capture —
// so each frame is padded onto a fixed canvas, anchored top-centre, exactly how
// the real window grows downward from a fixed origin. Padding rather than
// scaling is the point: scaling each frame to a common size would normalise away
// the very thing being compared.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [oldDir, newDir, out] = process.argv.slice(2);
// DEVICE pixels: screencast frames come back at the display's DPR (2x here), so
// a canvas sized from the CSS metadata is half the size of the actual JPEGs.
const CANVAS_W = 1500;
const CANVAS_H = 1120;
const FPS = 30;

const load = (d) => {
  const m = JSON.parse(readFileSync(`${d}/meta.json`, 'utf8'));
  const files = readdirSync(d).filter((f) => f.endsWith('.jpg')).sort();
  return { frames: m.frames, files: files.map((f) => `${d}/${f}`), t0: m.frames[0].t };
};

// Resample both captures onto one wall clock so the columns stay in step even
// though each was recorded in its own run at its own frame cadence.
const resample = (cap, startMs, durMs) => {
  const idx = [];
  for (let t = 0; t < durMs; t += 1000 / FPS) {
    const want = cap.t0 + startMs + t;
    let best = 0;
    for (let i = 0; i < cap.frames.length; i++) if (cap.frames[i].t <= want) best = i;
    idx.push(cap.files[best]);
  }
  return idx;
};

const a = load(oldDir);
const b = load(newDir);
// Both runs send at ~+1400ms; the endMeeting contract lands near +14.4s. The
// answer streaming between them is not what is being compared, so the clip is
// two SEGMENTS spliced together rather than one long take: the expand and the
// contract, each at real speed.
const SEGMENTS = [
  [1150, 2400], // send → expand → settle
];
const seqA = SEGMENTS.flatMap(([st, d]) => resample(a, st, d));
const seqB = SEGMENTS.flatMap(([st, d]) => resample(b, st, d));

const tmp = `${out}.frames`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

for (let i = 0; i < seqA.length; i++) {
  const o = `${tmp}/c${String(i).padStart(4, '0')}.png`;
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', seqA[i],
    '-i', seqB[i],
    '-filter_complex',
    `[0:v]pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:56:color=0x141418[a];` +
      `[1:v]pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:56:color=0x141418[b];` +
      `[a][b]hstack=inputs=2[v]`,
    '-map', '[v]', '-frames:v', '1', o,
  ]);
}

const label = process.argv[5];
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', `${tmp}/c%04d.png`,
  '-i', label,
  '-filter_complex',
  `[0:v][1:v]overlay=0:0,scale=1100:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=max_colors=160[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
  '-loop', '0', out,
]);
rmSync(tmp, { recursive: true, force: true });
console.log('wrote', out, `(${seqA.length} frames @ ${FPS}fps)`);
