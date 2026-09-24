// Manual visual check for the ad toasters in both themes:
//   natively_api  premium/src/NativelyApiPromoToaster.tsx
//   jd            premium/src/JDAwarenessToaster.tsx
//
// Launches the real Electron app against the Vite dev server, opens the card
// with the dev-only `?forceAd=<ad>` switch in App.tsx, and saves a
// screenshot of the launcher in dark and light. It also checks the parts of
// the family contract a screenshot can't show on its own: the dialog is
// labelled, the art loaded, and Escape closes it.
//
// Prerequisites:
//   npm run dev -- --host 127.0.0.1 --port 5180 --strictPort   (leave running)
//   npm run build:electron                                      (if main.js is stale)
//
// Run: node scripts/audit/toaster-preview.mjs <natively_api|jd> [outDir]
// Exit code: 0 all checks passed, 1 a check failed, 2 could not launch.

import { _electron as electron } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CARDS = {
  natively_api: { titleId: 'nap-toast-title', descId: 'nap-toast-desc', art: 'BE-black', cta: /Replace all three|Get a Natively key/ },
  jd:           { titleId: 'jd-toast-title',  descId: 'jd-toast-desc',  art: 'jd',       cta: /Upgrade to Pro/ },
};
const ad = process.argv[2];
const card = CARDS[ad];
if (!card) { console.error(`usage: toaster-preview.mjs <${Object.keys(CARDS).join('|')}> [outDir]`); process.exit(2); }
const outDir = resolve(process.argv[3] || join(tmpdir(), `toaster-preview-${ad}`));
mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg); };

let app;
try {
  app = await electron.launch({
    args: ['dist-electron/electron/main.js'],
    env: { ...process.env, NODE_ENV: 'development', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1' },
    timeout: 60_000,
  });
} catch (e) {
  console.error('Could not launch Electron:', String(e).slice(0, 400));
  process.exit(2);
}

try {
  // The launcher is the main-app window, not the overlay/settings/cropper ones.
  const deadline = Date.now() + 60_000;
  let page = null;
  while (!page && Date.now() < deadline) {
    page = app.windows().find(w => {
      const u = w.url();
      return u.startsWith('http://127.0.0.1:5180') && !/window=(overlay|settings|cropper|model)/.test(u);
    }) ?? null;
    if (!page) await new Promise(r => setTimeout(r, 500));
  }
  if (!page) throw new Error('launcher window never loaded from the dev server; is Vite running on 5180?');

  const url = new URL(page.url());
  url.searchParams.set('forceAd', ad);
  await page.goto(url.toString());

  const dialog = page.locator(`[role="dialog"][aria-labelledby="${card.titleId}"]`);
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });

  // Other cards (onboarding, trial upsell) can open on a dev profile, even
  // mid-run; hide them so each screenshot shows only this one. Display-only;
  // React state is untouched.
  const hideOtherDialogs = () => page.evaluate(titleId => {
    document.querySelectorAll('[role="dialog"]').forEach(d => {
      if (d.getAttribute('aria-labelledby') !== titleId) {
        const scrim = d.parentElement;
        if (scrim) scrim.style.display = 'none';
      }
    });
  }, card.titleId);
  await hideOtherDialogs();

  // The API card picks its copy from this machine's stored provider keys.
  const variant = ad !== 'natively_api' ? ad
    : (await page.locator(`#${card.titleId}`).innerText()).includes('One key') ? 'natively-api-existing' : 'natively-api-new';
  console.log(`variant: ${variant}`);

  check(await page.locator(`#${card.descId}`).isVisible(), 'dialog has a visible description');
  const artLoaded = await page.evaluate(async art => {
    const el = [...document.querySelectorAll('[role="dialog"] div[aria-hidden]')]
      .find(d => getComputedStyle(d).backgroundImage.includes(art));
    if (!el) return false;
    const src = getComputedStyle(el).backgroundImage.slice(5, -2);
    const img = new Image(); img.src = src;
    try { await img.decode(); return img.naturalWidth > 0; } catch { return false; }
  }, card.art);
  check(artLoaded, `${card.art}.png art panel loaded`);

  for (const theme of ['dark', 'light']) {
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    // Let the entrance spring and the theme swap settle.
    await page.waitForTimeout(1200);
    await hideOtherDialogs();
    const bg = await dialog.evaluate(el => getComputedStyle(el).backgroundColor);
    const expected = theme === 'dark' ? 'rgb(28, 28, 30)' : 'rgb(247, 248, 252)';
    check(bg === expected, `${theme}: card ground is ${expected} (got ${bg})`);

    const file = join(outDir, `${variant}-${theme}.png`);
    await page.screenshot({ path: file });
    console.log(`saved ${file}`);

    // Hover state: the art pushes in and the CTA outline strengthens.
    await page.getByRole('button', { name: card.cta }).hover();
    await page.waitForTimeout(1300);
    await hideOtherDialogs();
    const hoverFile = join(outDir, `${variant}-${theme}-hover.png`);
    await page.screenshot({ path: hoverFile });
    console.log(`saved ${hoverFile}`);
    await page.mouse.move(2, 2);
  }

  // Escape closes one card per press, so a card forced open on top of this
  // one (a dev profile's onboarding card) takes a press of its own.
  const others = await page.evaluate(titleId =>
    [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-labelledby') !== titleId).length,
  card.titleId);
  let closed = false;
  for (let i = 0; i <= others && !closed; i++) {
    await page.keyboard.press('Escape');
    closed = await dialog.waitFor({ state: 'detached', timeout: 2_000 }).then(() => true, () => false);
  }
  check(closed, `Escape closes the card${others ? ` (with ${others} other card(s) open, one press each)` : ''}`);
} catch (e) {
  check(false, String(e).slice(0, 400));
} finally {
  await app.close().catch(() => {});
}

console.log(`\nscreenshots: ${outDir}`);
process.exit(failures.length ? 1 : 0);
