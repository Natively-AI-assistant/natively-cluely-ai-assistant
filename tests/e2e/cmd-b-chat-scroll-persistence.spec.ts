// tests/e2e/cmd-b-chat-scroll-persistence.spec.ts
//
// Regression test for: Cmd+B hides the meeting overlay, scroll position is
// lost on re-show ("chat appears at the top of the meeting overlay").
//
// Validates the always-mounted shell fix in src/components/NativelyInterface.tsx
// — see comments around L5604 (the new <motion.div data-shell-root> wrapper)
// and L5614 (animate prop drives opacity/scale/pointer-events).
//
// What this test does NOT cover: the global Electron accelerator for Cmd+B.
// Playwright can synthesize the keypress and the OS-level shortcut routes to
// the same `toggle-expand` IPC the user would hit. If the accelerator is
// disabled or moved, this test will still exercise the IPC channel by
// dispatching a `Meta+b` key event on the page.
//
// Skip conditions copied from tests/e2e/basic-smoke.spec.ts:
//   - ELECTRON_APP_PORT not set → dev server not running
//   - CI=true                  → no display available in CI containers

import { test, expect } from '@playwright/test';

const CI = process.env.CI === 'true';
const APP_PORT = parseInt(process.env.ELECTRON_APP_PORT ?? '0', 10);

test.describe('Cmd+B chat-scroll persistence', () => {
  test.beforeEach(async ({ page }) => {
    if (CI) {
      test.skip();
      return;
    }
    if (!APP_PORT) {
      test.skip('Set ELECTRON_APP_PORT to the dev server port (e.g. 5173) before running E2E tests');
      return;
    }
  });

  test('scrollTop survives toggle-expand (Cmd+B hide then show)', async ({ page }) => {
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    // Wait for the meeting overlay shell to mount. After the always-mounted
    // fix, [data-shell-root] is always present when the overlay window is open.
    const shell = page.locator('[data-shell-root]').first();
    await shell.waitFor({ state: 'attached', timeout: 10_000 });

    // Inject enough content to make the chat scrollable, so we can verify
    // scrollTop persists at a non-bottom position. We use DOM seeding via
    // page.evaluate so the test does not depend on STT/LLM wiring — the
    // bug is purely about shell mount lifecycle.
    await page.evaluate(() => {
      const scrollEl = document.querySelector(
        '.flex-1.overflow-y-auto.p-4.space-y-3.no-drag.isolate'
      ) as HTMLElement | null;
      if (!scrollEl) throw new Error('scroll container not found');
      // 200 dummy rows ≈ 8000px tall, well past clientHeight.
      for (let i = 0; i < 200; i++) {
        const row = document.createElement('div');
        row.style.height = '40px';
        row.textContent = `row ${i}`;
        scrollEl.appendChild(row);
      }
    });

    // Scroll the chat to a known non-bottom position.
    await page.evaluate(() => {
      const scrollEl = document.querySelector(
        '.flex-1.overflow-y-auto.p-4.space-y-3.no-drag.isolate'
      ) as HTMLElement | null;
      if (!scrollEl) throw new Error('scroll container not found');
      scrollEl.scrollTop = 1234;
    });

    const before = await page.evaluate(() => {
      const scrollEl = document.querySelector(
        '.flex-1.overflow-y-auto.p-4.space-y-3.no-drag.isolate'
      ) as HTMLElement | null;
      return scrollEl?.scrollTop ?? null;
    });
    expect(before).toBe(1234);

    // Fire Cmd+B twice (hide + show). The 400ms hideWindow grace period
    // plus Framer Motion fade timing means we wait 700ms before re-pressing.
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(700);
    await page.keyboard.press('Meta+b');
    // Allow fade-in + any post-show auto-scroll effect to settle.
    await page.waitForTimeout(700);

    const after = await page.evaluate(() => {
      const scrollEl = document.querySelector(
        '.flex-1.overflow-y-auto.p-4.space-y-3.no-drag.isolate'
      ) as HTMLElement | null;
      return scrollEl?.scrollTop ?? null;
    });

    // The bug: after returns to 0 because the shell unmounted.
    // The fix: after returns 1234 because the shell stays mounted and the
    // scroll container's scrollTop is preserved.
    expect(after).toBe(1234);
  });

  test('shell stays mounted across toggle-expand (DOM identity)', async ({ page }) => {
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    const shell = page.locator('[data-shell-root]').first();
    await shell.waitFor({ state: 'attached', timeout: 10_000 });

    // Stamp the shell so we can detect re-mounts. We do this through
    // a property assignment, which would be cleared on unmount/remount.
    const stamp = await page.evaluate(() => {
      const el = document.querySelector('[data-shell-root]') as HTMLElement | null;
      if (!el) return null;
      (el as any).__scrollTestStamp = Date.now();
      return (el as any).__scrollTestStamp;
    });
    expect(stamp).not.toBeNull();

    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(700);
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(700);

    const afterStamp = await page.evaluate(() => {
      const el = document.querySelector('[data-shell-root]') as HTMLElement | null;
      return el ? (el as any).__scrollTestStamp ?? null : null;
    });
    // Same DOM node survived the Cmd+B cycle — property was preserved.
    expect(afterStamp).toBe(stamp);
  });

  // Regression guard for the scroll-listener deps bug: when the scroll
  // container is gated by showAnswerPanel (not isExpanded), an over-eager
  // dependency simplification ([checkCodeVisibility] only) leaves the scroll
  // listener bound to a null/stale node and never re-attached — silently
  // killing scroll-driven code-width auto-resize for the whole session.
  //
  // This test proves the listener is LIVE end-to-end by exercising BOTH
  // directions: a scroll event with a [data-code-msg] block ON-SCREEN must
  // EXPAND the shell, and a scroll event with it OFF-SCREEN must CONTRACT it.
  // A dead listener leaves the width unchanged in both directions, so the
  // expand assertion (widthExpanded > widthCollapsedStart) fails — no
  // false-pass. The previous version only scrolled away and never established
  // the expanded baseline, so a dead listener could pass on the weak checks.
  test('scroll listener is live (code-width auto-resize responds to scroll)', async ({ page }) => {
    await page.goto(`http://localhost:${APP_PORT}`);
    await page.waitForLoadState('networkidle');

    const shell = page.locator('[data-shell-root]').first();
    await shell.waitFor({ state: 'attached', timeout: 10_000 });

    const SCROLL_SEL = '.flex-1.overflow-y-auto.p-4.space-y-3.no-drag.isolate';

    // Seed a tall code block at the TOP of the chat, then filler below it so
    // it can be scrolled off-screen. The block is taller than the viewport so
    // when scrolled to top it is unambiguously "visible" to the scanner.
    const seeded = await page.evaluate((sel) => {
      const scrollEl = document.querySelector(sel) as HTMLElement | null;
      if (!scrollEl) return false;
      const code = document.createElement('div');
      code.setAttribute('data-code-msg', '');
      code.style.height = '600px';
      code.textContent = 'CODE BLOCK';
      scrollEl.appendChild(code);
      for (let i = 0; i < 200; i++) {
        const row = document.createElement('div');
        row.style.height = '40px';
        row.textContent = `row ${i}`;
        scrollEl.appendChild(row);
      }
      return true;
    }, SCROLL_SEL);
    // If the scroll container is not mounted (no live meeting content in this
    // harness), this path can't be exercised — skip rather than false-fail.
    if (!seeded) {
      test.skip('scroll container not mounted (no active meeting content in this harness)');
      return;
    }

    const readWidth = () =>
      page.evaluate(() => {
        const card = document.querySelector('[data-shell-card]') as HTMLElement | null;
        return card ? Math.round(card.getBoundingClientRect().width) : null;
      });

    const scrollTo = (top: number) =>
      page.evaluate(
        ({ sel, top }) => {
          const scrollEl = document.querySelector(sel) as HTMLElement | null;
          if (!scrollEl) throw new Error('scroll container not found');
          scrollEl.scrollTop = top;
          scrollEl.dispatchEvent(new Event('scroll'));
        },
        { sel: SCROLL_SEL, top },
      );

    // checkCodeVisibility is rAF-coalesced + STABILITY_MS(120ms)-gated, and
    // the width spring takes ~700ms. 1200ms gives each transition room.
    const SETTLE = 1200;

    const widthCollapsedStart = await readWidth();
    expect(widthCollapsedStart).not.toBeNull();

    // 1) Scroll so the code block is ON-SCREEN → scanner should EXPAND.
    await scrollTo(0);
    await page.waitForTimeout(SETTLE);
    const widthExpanded = await readWidth();
    expect(widthExpanded).not.toBeNull();

    // The decisive assertion: a live listener expands the shell when code is
    // visible. A dead listener leaves it at the collapsed start width. We use
    // a small tolerance instead of an exact constant so theme/padding drift
    // doesn't make this brittle — the collapsed→expanded delta is ~130px.
    expect(widthExpanded! - widthCollapsedStart!).toBeGreaterThan(40);

    // 2) Scroll the code block fully OFF-SCREEN → scanner should CONTRACT.
    await scrollTo(2000);
    await page.waitForTimeout(SETTLE);
    const widthContracted = await readWidth();
    expect(widthContracted).not.toBeNull();
    expect(widthContracted!).toBeLessThan(widthExpanded!);
  });
});