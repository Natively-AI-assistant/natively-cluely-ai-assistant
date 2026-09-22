// This ffmpeg build has no drawtext filter, so the label bar is rendered once in
// Chrome and overlaid as a PNG.
import { chromium } from 'playwright';
const [out, w, h] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: w, height: h } });
await p.setContent(`<body style="margin:0;background:#141418;display:flex;font:600 30px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em">
  <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#8b8b96">A · BEFORE — HEIGHT CUTS</div>
  <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#6ee7b7">B · AFTER — 300MS CARD RESIZE</div>
</body>`);
await p.screenshot({ path: out });
await b.close();
