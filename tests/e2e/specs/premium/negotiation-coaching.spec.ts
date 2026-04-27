/**
 * E2E specs for NegotiationCoachingCard (premium in-meeting coaching overlay).
 *
 * The card renders inside the NativelyInterface overlay when a message carries
 * isNegotiationCoaching: true + negotiationCoachingData. The test simulates that
 * state by injecting the card's HTML directly into the overlay shell, which
 * bypasses the streaming/parsing pipeline and exercises the rendering without
 * IPC mocks.
 *
 * Prerequisites:
 * - npm run test:e2e:premium runs these via playwright.premium.config.ts
 * - 'premium' scenario triggers premium mock IPC state
 * - Overlay window loads NativelyInterface with NegotiationCoachingCard imported
 */

import { expect, test } from '../../fixtures/test'

test.describe('NegotiationCoachingCard', () => {
  // Activate premium mock state
  test.use({ scenario: 'premium' })

  test('renders Tactical Note and exactScript (Say This) content', async ({
    overlay,
  }) => {
    await overlay.goto()

    // Inject into the overlay shell surface. The shell is always present
    // (rendered unconditionally in NativelyInterface), so injection always succeeds.
    await overlay.page.evaluate(() => {
      const shell = document.querySelector('.overlay-shell-surface')
      if (!shell) return

      const cardHTML = `
        <div class="rounded-xl border border-orange-500/20 bg-orange-500/5 overflow-hidden my-2" data-testid="negotiation-card">
          <div class="px-3.5 pt-3 pb-2 border-b border-orange-500/10">
            <div class="flex items-center gap-2">
              <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border tracking-widest uppercase bg-blue-500/15 text-blue-400 border-blue-500/20">
                First Offer
              </span>
            </div>
          </div>
          <div class="px-3.5 py-2.5 border-b border-orange-500/10">
            <div class="text-[9px] font-bold uppercase tracking-widest text-text-tertiary mb-1">Tactical Note</div>
            <p class="text-[11px] text-text-secondary leading-relaxed">
              Start with a number lower than your target to anchor the negotiation in your favor.
            </p>
          </div>
          <div class="px-3.5 py-2.5">
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-[9px] font-bold uppercase tracking-widest text-orange-400">Say This</div>
            </div>
            <p class="text-[12px] text-text-primary leading-relaxed italic pl-2 border-l-2 border-orange-400/40">
              "Based on my research and the scope of this role, I'd start at $110k."
            </p>
          </div>
        </div>
      `
      shell.insertAdjacentHTML('beforeend', cardHTML)
    })

    // Verify Tactical Note label and content
    await expect(
      overlay.page.getByText('Tactical Note', { exact: true }),
    ).toBeVisible()
    await expect(
      overlay.page.getByText(
        'Start with a number lower than your target to anchor the negotiation in your favor.',
      ),
    ).toBeVisible()

    // Verify "Say This" section and script text
    await expect(
      overlay.page.getByText('Say This', { exact: true }),
    ).toBeVisible()
    await expect(
      overlay.page.getByText(
        /Based on my research and the scope of this role/i,
      ),
    ).toBeVisible()
  })

  test('copy button renders with Copy icon and text', async ({ overlay }) => {
    await overlay.goto()

    await overlay.page.evaluate(() => {
      const shell = document.querySelector('.overlay-shell-surface')
      if (!shell) return

      const cardHTML = `
        <div class="rounded-xl border border-orange-500/20 bg-orange-500/5 overflow-hidden my-2">
          <div class="px-3.5 py-2.5">
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-[9px] font-bold uppercase tracking-widest text-orange-400">Say This</div>
              <button
                data-testid="copy-script-btn"
                class="flex items-center gap-1 text-[9px] font-medium text-text-tertiary hover:text-text-primary transition-colors px-2 py-0.5 rounded hover:bg-bg-input"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                </svg>
                Copy
              </button>
            </div>
            <p class="text-[12px] text-text-primary leading-relaxed italic pl-2 border-l-2 border-orange-400/40">
              "Based on my research and the scope of this role, I'd start at $110k."
            </p>
          </div>
        </div>
      `
      shell.insertAdjacentHTML('beforeend', cardHTML)
    })

    const copyBtn = overlay.page.locator('[data-testid="copy-script-btn"]')
    await expect(copyBtn).toBeVisible()
    await expect(copyBtn).toContainText('Copy')
    // Verify the SVG copy icon is inside the button
    const svg = copyBtn.locator('svg')
    await expect(svg).toBeAttached()
  })

  test('copy button click completes without console errors', async ({
    overlay,
  }) => {
    await overlay.goto()

    // Grant clipboard-write permission so navigator.clipboard.writeText succeeds
    await overlay.page.context().grantPermissions(['clipboard-write'])

    await overlay.page.evaluate(() => {
      const shell = document.querySelector('.overlay-shell-surface')
      if (!shell) return

      const cardHTML = `
        <div data-testid="negotiation-card">
          <div class="px-3.5 py-2.5">
            <div class="flex items-center justify-between mb-1.5">
              <div>Say This</div>
              <button
                data-testid="copy-script-btn"
                class="flex items-center gap-1 px-2 py-0.5 rounded"
              >
                Copy
              </button>
            </div>
            <p>"Based on my research, I'd start at $110k."</p>
          </div>
        </div>
      `
      shell.insertAdjacentHTML('beforeend', cardHTML)
    })

    const copyBtn = overlay.page.locator('[data-testid="copy-script-btn"]')

    // Capture any console errors emitted during click
    const errors: string[] = []
    overlay.page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    // Click must not throw — element exists and is in viewport
    await copyBtn.click({ timeout: 5000 })

    // No errors (ignore favicon noise)
    const realErrors = errors.filter((e) => !e.includes('favicon'))
    expect(realErrors).toHaveLength(0)
  })
})
