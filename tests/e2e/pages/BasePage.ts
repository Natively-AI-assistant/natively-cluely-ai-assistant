import type { Page } from '@playwright/test'

/**
 * BasePage provides common functionality for all page objects.
 * Following Page Object Model pattern with DRY principle.
 */
export class BasePage {
  constructor(protected page: Page) {}

  /**
   * Dismiss all known overlays and modals that might block interactions.
   * This is a defense-in-depth approach for unexpected overlays.
   */
  async dismissOverlays(): Promise<void> {
    // Skip if settings panel is already visible - don't dismiss buttons inside it
    const settingsPanelVisible = await this.page
      .locator('#settings-panel')
      .isVisible()
      .catch(() => false)
    if (settingsPanelVisible) return

    // Expand patterns to cover ALL known overlay dismiss buttons
    const dismissButtonPatterns = [
      // Exact match dismiss buttons from various overlays
      /^(dismiss|close|×|✕)$/i,
      /^(no thanks|continue|skip)$/i,
      // Natively API trial overlay
      /^(start free trial|i'll set up manually)$/i,
      // Natively Plans upsell overlay
      /^(see max & ultra plans|i'm happy with pro)$/i,
      // Modes Beta dismiss
      /^(dismiss|try it out)$/i,
    ]

    // Process each pattern separately; click what matches
    for (const textPattern of dismissButtonPatterns) {
      try {
        const buttons = this.page.getByRole('button', { name: textPattern })

        // Collect all buttons (check visibility inline, O(N) instead of O(N²))
        const allButtons = await buttons.all()
        const visibleButtons: typeof allButtons = []

        // Check visibility without nested loops
        for (const button of allButtons) {
          const visible = await button.isVisible().catch(() => false)
          if (visible) visibleButtons.push(button)
        }

        // Click all visible dismiss buttons in parallel
        await Promise.all(
          visibleButtons.map(async (button) => {
            try {
              await button.click({ timeout: 1500 })
            } catch {
              // Silently ignore click failures - overlay may have moved or already dismissed
            }
          }),
        )
      } catch {
        // Silently ignore pattern matching failures
      }
    }

    // Also try clicking any overlay backdrop or generic dismiss buttons
    // This handles overlays that might not match above patterns
    try {
      const genericDismisses = this.page
        .locator('button')
        .filter({ hasText: /^(dismiss|close|no thanks|skip|cancel|×)/i })
      const dismissAll = await genericDismisses.all()
      for (const btn of dismissAll) {
        try {
          const visible = await btn.isVisible().catch(() => false)
          if (visible) await btn.click({ timeout: 1000 })
        } catch {}
      }
    } catch {}
  }

  /**
   * Click a button inside a potentially overlaid container using JS evaluation.
   * Use this when overlays may intercept standard Playwright clicks.
   */
  async clickButtonInside(
    container: string,
    buttonText: string,
  ): Promise<void> {
    await this.page.evaluate(
      ({ sel, text }) => {
        const container = document.querySelector(sel)
        if (!container) return
        const btns = container.querySelectorAll('button')
        const btn = Array.from(btns).find(
          (b: HTMLButtonElement) => b.textContent?.trim() === text,
        )
        if (btn instanceof HTMLElement) btn.click()
      },
      { sel: container, text: buttonText },
    )
  }

  /**
   * Click a button inside a container using JS, targeting ALL matching text variations.
   * Useful for buttons that may have nested elements (icon + text).
   */
  async clickButtonInsideFlexible(
    container: string,
    buttonText: string,
  ): Promise<void> {
    await this.page.evaluate(
      ({ sel, text }) => {
        const container = document.querySelector(sel)
        if (!container) return
        const btns = container.querySelectorAll('button')
        const normalizedTarget = text.toLowerCase().trim()
        const btn = Array.from(btns).find((b: HTMLButtonElement) => {
          const btnText = b.textContent?.trim().toLowerCase() ?? ''
          return (
            btnText === normalizedTarget || btnText.includes(normalizedTarget)
          )
        })
        if (btn instanceof HTMLElement) btn.click()
      },
      { sel: container, text: buttonText },
    )
  }

  /**
   * Ensure page is stable (no loading spinners) before interacting.
   */
  async waitForStable(): Promise<void> {
    await this.page.waitForLoadState('networkidle')
    await this.page.waitForTimeout(200)
  }
}
