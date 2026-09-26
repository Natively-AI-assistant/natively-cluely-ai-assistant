// A/B recorder for the overlay auto expand/contract motion.
//
// Playwright + system Chrome (channel:'chrome'): the bundled headless shell is
// not installed in this repo, and the Chrome MCP tab reports visibilityState
// 'hidden' which FREEZES rAF — framer-motion never advances there and every
// frame comes out identical. See memory: animation-verification-rig-2026-08-27.
//
// recordVideo, not a screenshot loop: a full-page screenshot at dsf 2 costs
// 40-80ms, so a "40fps" loop actually samples at ~15fps AND stretches wall
// clock — which would misrepresent the very thing being compared. The video
// track is captured by the browser at its own frame rate.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const URL = 'http://127.0.0.1:5180/overlayResizeHarness.html' + (process.env.HARNESS_QUERY ?? '');
const OUT = process.argv[2] ?? 'video';
const SCRIPT = JSON.parse(process.argv[3] ?? '[]'); // [{step, holdMs}]
const W = Number(process.env.HARNESS_W ?? 1540);
const H = Number(process.env.HARNESS_H ?? 700);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
const page = await context.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ab?.ready === true);
await page.waitForTimeout(900);

for (const { step, holdMs } of SCRIPT) {
  if (step) await page.evaluate((s) => window.__ab.step(s), step);
  await page.waitForTimeout(holdMs);
}

await page.close();
await context.close();
await browser.close();
console.log(`recorded -> ${OUT}`);
