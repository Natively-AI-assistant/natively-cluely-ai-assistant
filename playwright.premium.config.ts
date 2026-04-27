import { defineConfig, devices } from '@playwright/test'
import 'dotenv/config'

/**
 * Playwright config for premium E2E specs.
 * Copies the key settings from playwright.config.ts and overrides testDir.
 * All other settings (reporter, projects, webServer, etc.) are inherited.
 */
export default defineConfig({
  testDir: './tests/e2e/specs/premium',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    process.env.CI ? ['github'] : ['list'],
  ],
  globalTimeout: process.env.CI ? 10 * 60 * 1000 : undefined,
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'on-first-retry',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
    headless: true,
    testIdAttribute: 'data-testid',
    launchOptions: {
      args: ['--disable-web-security'],
    },
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
})
