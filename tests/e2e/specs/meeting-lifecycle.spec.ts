import { test, expect } from '../fixtures/test'

test.describe('Meeting Lifecycle', () => {
  test.use({ scenario: 'withMeetings' })

  test('displays meeting list with date group headers @smoke', async ({ launcher }) => {
    await launcher.goto()
    await expect(launcher.page.locator('#launcher-container')).toBeVisible()
    const meetingItems = await launcher.getMeetingItems()
    await expect(meetingItems.first()).toBeVisible()
  })

  test('shows refresh button with correct title', async ({ launcher }) => {
    await launcher.goto()
    const refreshButton = await launcher.getRefreshButton()
    await expect(refreshButton).toBeVisible()
    await expect(refreshButton).toHaveAttribute('title', 'Refresh State')
  })

  test('shows calendar card', async ({ launcher }) => {
    await launcher.goto()
    const calendarCard = await launcher.getCalendarCard()
    await expect(calendarCard).toBeVisible()
  })

  test('clicking meeting opens detail view', async ({ launcher, meeting, page }) => {
    await launcher.goto()
    await meeting.clickMeeting(0)
    await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible()
  })

  test('meeting detail shows tabs', async ({ launcher, meeting, page }) => {
    await launcher.goto()
    await meeting.clickMeeting(0)
    await expect(page.getByRole('button', { name: 'Transcript', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible()
  })

  test('tab switching in meeting detail works @navigation', async ({ launcher, meeting, page }) => {
    await launcher.goto()
    await meeting.clickMeeting(0)
    await page.getByRole('button', { name: 'Summary', exact: true }).click()
    await expect(page.locator('main.flex-1.overflow-y-auto')).toBeVisible()
  })

  test('back button returns to meeting list', async ({ launcher, meeting }) => {
    await launcher.goto()
    await meeting.clickMeeting(0)
    await meeting.goBack()
    await expect(launcher.page.locator('#launcher-container')).toBeVisible()
  })

  test('scrollable meeting list area', async ({ launcher }) => {
    await launcher.goto()
    await expect(launcher.page.locator('main.flex-1.overflow-y-auto')).toBeVisible()
  })
})
