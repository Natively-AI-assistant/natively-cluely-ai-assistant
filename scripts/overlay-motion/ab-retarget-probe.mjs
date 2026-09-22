// Measures the one thing a tween gives up vs a spring: velocity continuity when
// a transition is RETARGETED in flight (the scroll scanner re-firing
// startTransition as a code block crosses the viewport edge).
//
// The metric has to be taken AT the retarget instants. A whole-run "max jerk"
// is useless here: it is dominated by the tween's own launch from rest, which
// is the fast departure the curve is chosen for, not a stutter. So the page
// clock records when each retarget was issued and the velocity step is read
// across that instant only.
import { chromium } from 'playwright';

const b = await chromium.launch({ channel: 'chrome', headless: false });
const p = await b.newPage({ viewport: { width: 1540, height: 700 } });
// `?v=before,after` pins the two columns this probe indexes by position; the
// harness's default column set is the three options under consideration.
const EXTRA = process.argv[2] ? `&${process.argv[2].replace(/^[?&]/, '')}` : '';
await p.goto(`http://127.0.0.1:5180/overlayResizeHarness.html?v=before,after${EXTRA}`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ab?.ready === true);
await p.evaluate(() => window.__ab.step('answer'));
await p.waitForTimeout(700);

// A long await inside one eval times out the CDP call at 45s; start the sampler,
// return immediately, read the global afterwards (memory: animation rig).
await p.evaluate(() => {
  window.__w = [];
  window.__marks = [];
  window.__t0 = performance.now();
  const cards = [...document.querySelectorAll('[data-card]')];
  const tick = () => {
    window.__w.push([
      performance.now() - window.__t0,
      ...cards.map((c) => c.getBoundingClientRect().width),
    ]);
    if (performance.now() - window.__t0 < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

for (const s of ['code', 'collapse', 'code', 'collapse', 'code']) {
  await p.evaluate((x) => {
    window.__marks.push(performance.now() - window.__t0);
    window.__ab.step(x);
  }, s);
  await p.waitForTimeout(150);
}
await p.waitForTimeout(2000);

const { samples, marks } = await p.evaluate(() => ({ samples: window.__w, marks: window.__marks }));
await b.close();

const velocities = (idx) => {
  const v = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i][0] - samples[i - 1][0];
    if (dt <= 0) continue;
    v.push({ t: samples[i][0], v: (samples[i][idx] - samples[i - 1][idx]) / dt });
  }
  return v;
};

// The velocity step ACROSS a retarget: last velocity before the mark vs the
// first sustained velocity after it (2 frames later, once the new animation has
// actually been scheduled and sampled).
const report = (idx, name) => {
  const v = velocities(idx);
  const at = (t) => {
    const i = v.findIndex((s) => s.t >= t);
    return i;
  };
  const steps = [];
  marks.slice(1).forEach((m) => {
    const i = at(m);
    if (i < 1 || i + 2 >= v.length) return;
    steps.push(Math.abs(v[i + 2].v - v[i - 1].v));
  });
  const peak = Math.max(...v.map((s) => Math.abs(s.v)));
  console.log(
    `${name.padEnd(7)} retargets=${steps.length} ` +
      `velocityStepAcrossRetarget: max=${Math.max(...steps).toFixed(3)} ` +
      `mean=${(steps.reduce((a, c) => a + c, 0) / steps.length).toFixed(3)} px/ms ` +
      `| peakSpeed=${peak.toFixed(3)}px/ms`,
  );
};
console.log(`samples=${samples.length} retargets marked=${marks.length - 1}`);
report(1, 'before');
report(2, 'after');
