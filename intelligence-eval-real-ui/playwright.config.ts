// intelligence-eval-real-ui/playwright.config.ts
// Playwright config for the REAL Natively UI eval (Electron via _electron).
// Projects are launched in-test through helpers/launch-natively.ts, so the
// config is mainly artifact/reporter/timeout policy. No webServer / no baseURL —
// this drives the packaged Electron main process, not a dev web server.

import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  // Live LLM streams are ~6-10s each; a full profile setup runs a real ingest
  // (LLM extraction). Generous per-test timeout, but bounded.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // Electron app launches are stateful (single app instance per worker, real
  // profile DB); run serially to avoid cross-test context bleed + API rate limits.
  workers: 1,
  fullyParallel: false,
  retries: 0,                          // a real LLM nondeterministic retry would mask findings; the runner handles transient network
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(__dirname, 'results', 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.join(__dirname, 'results', 'playwright-results.json') }],
  ],
  use: {
    // Artifacts. Traces/screenshots/video retained on failure; all on demand via
    // NATIVELY_UI_EVAL_SAVE_ALL_ARTIFACTS=true.
    trace: process.env.NATIVELY_UI_EVAL_SAVE_ALL_ARTIFACTS === 'true' ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
  },
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  globalTeardown: path.join(__dirname, 'global-teardown.ts'),
  outputDir: path.join(__dirname, 'results', 'test-output'),
});
