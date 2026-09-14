// Samples the candidate motion options per rAF so the differences between them
// are numbers, not an impression of a gif. Reports the card's height through one
// expand and one contract, plus any overshoot past the resting value (the thing
// that separates a bounce-0 spring from a loosened one).
//
// READ THE "+ WIDTH" ROWS WITH CARE. The rig's code block is `white-space: pre`
// and does not re-wrap, so in those two scenarios the height jumps to its final
// value the instant the block mounts and is then changed by the width spring —
// height is NOT a function of width here the way it is in the real app. Their
// settle times and their ~23px "overshoot" are artifacts of that, not of the
// motion; all options read the same there because the height snaps during a
// width transition anyway. Judge the mixed case in the real overlay (drive the
// manual resize toggle with real answer text in the panel) — that is the only
// place the text genuinely re-wraps.
import { chromium } from 'playwright';

const b = await chromium.launch({ channel: 'chrome', headless: false });
const p = await b.newPage({ viewport: { width: 2350, height: 730 } });
await p.goto('http://127.0.0.1:5180/overlayResizeHarness.html', { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ab?.ready === true);
await p.waitForTimeout(600);

const run = async (from, to, label) => {
  await p.evaluate((s) => window.__ab.step(s), from);
  await p.waitForTimeout(900);
  await p.evaluate(() => {
    window.__h = [];
    const cards = [...document.querySelectorAll('[data-card]')];
    window.__keys = cards.map((c) => c.getAttribute('data-card'));
    const t0 = performance.now();
    const tick = () => {
      window.__h.push([
        Math.round(performance.now() - t0),
        ...cards.map((c) => Math.round(c.getBoundingClientRect().height * 10) / 10),
      ]);
      if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await p.waitForTimeout(60);
  await p.evaluate((s) => window.__ab.step(s), to);
  await p.waitForTimeout(1500);
  const { h, keys } = await p.evaluate(() => ({ h: window.__h, keys: window.__keys }));
  console.log(`\n=== ${label}: ${from} -> ${to} ===`);
  keys.forEach((k, i) => {
    const col = h.map((r) => r[i + 1]);
    const rest = col[col.length - 1];
    const start = col[0];
    const growing = rest > start;
    // time to within 1px of rest
    let settleAt = null;
    for (let j = 0; j < col.length; j++) {
      if (Math.abs(col[j] - rest) <= 1) { settleAt = h[j][0]; break; }
    }
    const overshoot = growing ? Math.max(...col) - rest : rest - Math.min(...col);
    console.log(
      `${k.padEnd(6)} ${String(start).padStart(6)} -> ${String(rest).padStart(6)}px  ` +
        `settles@${String(settleAt).padStart(4)}ms  overshoot ${overshoot.toFixed(1)}px`,
    );
  });
};

await run('empty', 'thinking', 'EXPAND (viewport mounts)');
await run('answer', 'code', 'EXPAND + WIDTH (code block)');
await run('code', 'collapse', 'CONTRACT + WIDTH');
await run('answer', 'clear', 'CONTRACT to empty');
await b.close();
