import { test, expect, type Locator, type Page } from '@playwright/test';

// Real component and production CSS, with synthetic props and no Electron bridge.
// Run: npx playwright test --config tests/e2e/rolling-transcript.config.ts
const gap = (scroller: Locator) => scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
const atBottom = async (scroller: Locator) => expect.poll(() => gap(scroller)).toBeLessThanOrEqual(4);
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const layoutSettled = (page: Page) => page.evaluate(() => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const scrollSettled = (scroller: Locator) => scroller.evaluate(el => new Promise<void>(resolve => {
  let lastTop = el.scrollTop;
  let stableFrames = 0;
  const frame = () => {
    stableFrames = el.scrollTop === lastTop ? stableFrames + 1 : 0;
    lastTop = el.scrollTop;
    if (stableFrames >= 5) resolve();
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}));
const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }, info) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeObserver = window.ResizeObserver;
    const state = { active: 0 };
    Object.assign(window, { transcriptResizeObservers: state });
    window.ResizeObserver = class extends NativeObserver {
      private connected = false;
      override observe(target: Element, options?: ResizeObserverOptions) {
        if (!this.connected) { this.connected = true; state.active++; }
        super.observe(target, options);
      }
      override disconnect() {
        if (this.connected) { this.connected = false; state.active--; }
        super.disconnect();
      }
    };
  });
  const base = info.project.use.baseURL ?? 'http://127.0.0.1:5194';
  await page.goto(new URL('/tests/e2e/rolling-transcript.fixture.html', base).href);
  const scroller = page.locator('.overlay-transcript-surface');
  await expect(scroller).toBeVisible();
  await atBottom(scroller);
  await expect.poll(() => errors).toEqual([]);
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test('keeps unchanged transcript text pinned when width shrinks', async ({ page }, info) => {
  const scroller = page.locator('.overlay-transcript-surface');
  const before = await scroller.textContent();
  await click(page, 'Narrow');
  await layoutSettled(page);
  await atBottom(scroller);
  await expect(scroller).toHaveText(before!);
  await page.screenshot({ path: info.outputPath('narrow-pinned.png') });
});

test('pins text that first becomes scrollable after narrowing', async ({ page }) => {
  const scroller = page.locator('.overlay-transcript-surface');
  await click(page, 'Short transcript');
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight)).toBe(0);
  await click(page, 'Narrow');
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
  await atBottom(scroller);
});

test('keeps the bottom visible when the viewport height shrinks', async ({ page }) => {
  const scroller = page.locator('.overlay-transcript-surface');
  await click(page, 'Short viewport');
  await atBottom(scroller);
});

test('keeps the bottom visible when text size changes without a viewport resize', async ({ page }) => {
  const scroller = page.locator('.overlay-transcript-surface');
  const before = await scroller.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }));
  await click(page, 'Large text');
  await layoutSettled(page);
  await atBottom(scroller);
  expect(await scroller.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }))).toEqual(before);
});

test('resizing and new text respect a manual shortcut pause', async ({ page }) => {
  const scroller = page.locator('.overlay-transcript-surface');
  await click(page, 'Scroll up');
  await expect.poll(() => gap(scroller)).toBeGreaterThan(4);
  await click(page, 'Narrow');
  await click(page, 'Append');
  await layoutSettled(page);
  await scrollSettled(scroller);
  await expect.poll(() => gap(scroller)).toBeGreaterThan(4);
  await click(page, 'Bottom');
  await atBottom(scroller);
  await click(page, 'Wide');
  await click(page, 'Narrow');
  await atBottom(scroller);
});

test('resizing respects a wheel pause', async ({ page }) => {
  const scroller = page.locator('.overlay-transcript-surface');
  await scroller.hover();
  await page.mouse.wheel(0, -180);
  await expect.poll(() => gap(scroller)).toBeGreaterThan(4);
  await click(page, 'Narrow');
  await layoutSettled(page);
  await scrollSettled(scroller);
  await expect.poll(() => gap(scroller)).toBeGreaterThan(4);
});

test('resizing respects a synthetic touch-scroll pause', async ({ page }) => {
  const scroller = page.locator('.overlay-transcript-surface');
  await scroller.dispatchEvent('touchmove');
  await scroller.evaluate(el => {
    el.scrollTop -= 100;
    el.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => gap(scroller)).toBeGreaterThan(4);
  await click(page, 'Narrow');
  await click(page, 'Append');
  await layoutSettled(page);
  await scrollSettled(scroller);
  await expect.poll(() => gap(scroller)).toBeGreaterThan(4);
});

test('restored channel and repeated text still pin after resizing', async ({ page }) => {
  const scroller = page.locator('.overlay-transcript-surface');
  await click(page, 'Fail channel');
  await expect(scroller).toHaveText('');
  await click(page, 'Narrow');
  await click(page, 'Recover channel');
  await atBottom(scroller);
  await click(page, 'Clear');
  await click(page, 'Wide');
  await click(page, 'Restore');
  await atBottom(scroller);
  await click(page, 'Narrow');
  await atBottom(scroller);
});

test('disconnects resize observation on unmount without late errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const count = () => page.evaluate(() => (window as typeof window & {
    transcriptResizeObservers: { active: number };
  }).transcriptResizeObservers.active);
  await expect.poll(count).toBeGreaterThan(0);
  await click(page, 'Narrow');
  await click(page, 'Unmount');
  await expect.poll(count).toBe(0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(errors).toEqual([]);
});
