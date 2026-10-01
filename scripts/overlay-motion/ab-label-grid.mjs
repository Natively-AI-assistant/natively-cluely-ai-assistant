// Transparent label overlay for the 2x2 grid (this ffmpeg build has no drawtext).
import { chromium } from 'playwright';
const [out, cw, ch, lh] = process.argv.slice(2).map((x, i) => (i === 0 ? x : Number(x)));
const cells = [
  ['1 · ORIGINAL CURVE, HEIGHT MOVES', 'spring 420ms · bounce 0 · both axes', '#7dd3fc'],
  ['2 · SPRING WIDTH, BEZIER HEIGHT', 'spring 420ms · bezier 300ms', '#fcd34d'],
  ['3 · ORIGINAL CURVE, LOOSENED', 'spring 420ms · bounce 0.35 · both axes', '#f0abfc'],
  ['4 · ORIGINAL CURVE, QUICKER', 'spring 300ms · bounce 0 · both axes', '#fda4af'],
];
const cell = (i) => `
  <div style="position:absolute;left:${(i % 2) * cw}px;top:${Math.floor(i / 2) * ch}px;
       width:${cw}px;height:${lh}px;display:flex;flex-direction:column;
       align-items:center;justify-content:center;gap:6px">
    <div style="font:700 26px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;color:${cells[i][2]}">${cells[i][0]}</div>
    <div style="font:20px/1 ui-monospace,Menlo,monospace;color:#7a7a86">${cells[i][1]}</div>
  </div>`;
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: cw * 2, height: ch * 2 } });
await p.setContent(`<body style="margin:0;background:transparent">${cells.map((_, i) => cell(i)).join('')}</body>`);
await p.screenshot({ path: out, omitBackground: true });
await b.close();
