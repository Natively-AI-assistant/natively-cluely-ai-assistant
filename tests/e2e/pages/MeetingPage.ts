import { BasePage } from './BasePage'

export class MeetingPage extends BasePage {
  getMeetingItems() {
    return this.page.locator(
      '[data-testid="meeting-item"], main .group.relative.flex.items-center',
    )
  }

  async clickMeeting(index: number = 0) {
    await this.dismissOverlays()
    const items = this.getMeetingItems()
    await items.nth(index).click()
  }

  getDetailTabs() {
    return this.page.locator(
      '[role="tablist"] button, header button:has-text("Transcript"), header button:has-text("Summary"), header button:has-text("Usage")',
    )
  }

  async switchToTab(tabName: string) {
    await this.dismissOverlays()
    await this.page.getByRole('button', { name: tabName }).click()
  }

  getBackButton() {
    return this.page
      .getByRole('button', { name: /back/i })
      .or(this.page.locator('header button').first())
  }

  async goBack() {
    await this.dismissOverlays()
    await this.getBackButton().click()
  }

  getTranscriptContent() {
    return this.page
      .locator('[data-testid="transcript-content"], .transcript-content')
      .first()
  }

  getSummaryContent() {
    return this.page
      .locator('[data-testid="summary-content"], .summary-content')
      .first()
  }

  getActionItemsContent() {
    return this.page
      .locator('[data-testid="action-items-content"], .action-items-content')
      .first()
  }
}
