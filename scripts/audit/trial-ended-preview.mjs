// Manual visual check for the end-of-trial card (src/components/trial/FreeTrialModal.tsx)
// in both themes. Opens it with the dev-only `?forceTrialEnded=1` switch in App.tsx.
//
// Prerequisites:
//   npm run dev -- --host 127.0.0.1 --port 5180 --strictPort   (leave running)
//   npm run build:electron                                      (if main.js is stale)
//
// Run: node scripts/audit/trial-ended-preview.mjs [outDir]

import { _electron as electron } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const outDir = resolve(process.argv[2] || join(tmpdir(), 'toaster-preview-trial-ended'));
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: { ...process.env, NODE_ENV: 'development', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1' },
  timeout: 60_000,
});

try {
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
  url.searchParams.set('forceTrialEnded', '1');
  const dialog = page.locator('[role="dialog"][aria-labelledby="trial-end-title"]');

  const hideOtherDialogs = () => page.evaluate(() => {
    document.querySelectorAll('[role="dialog"]').forEach(d => {
      if (d.getAttribute('aria-labelledby') !== 'trial-end-title' && d.parentElement) d.parentElement.style.display = 'none';
    });
  });

  // Reload per theme: a dev profile's own trial/licence checks can close the
  // card a few seconds after it opens.
  for (const theme of ['dark', 'light']) {
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await dialog.waitFor({ state: 'visible', timeout: 30_000 });
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(1500);
    await hideOtherDialogs();
    await page.screenshot({ path: join(outDir, `trial-ended-${theme}.png`) });

    await page.getByRole('button', { name: /^Max,/ }).hover();
    await page.waitForTimeout(1300);
    await hideOtherDialogs();
    await page.screenshot({ path: join(outDir, `trial-ended-${theme}-hover.png`) });
    await page.mouse.move(2, 2);
  }
  console.log(`screenshots: ${outDir}`);
} finally {
  await app.close().catch(() => {});
}
