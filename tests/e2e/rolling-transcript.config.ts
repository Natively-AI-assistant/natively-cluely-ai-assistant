import { defineConfig } from '@playwright/test';

const url = 'http://127.0.0.1:5194';

export default defineConfig({
  testDir: '.',
  testMatch: 'rolling-transcript-resize.spec.ts',
  workers: 1,
  use: {
    baseURL: url,
    viewport: { width: 1100, height: 650 },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5194 --strictPort',
    url: `${url}/tests/e2e/rolling-transcript.fixture.html`,
    reuseExistingServer: !process.env.CI,
  },
});
