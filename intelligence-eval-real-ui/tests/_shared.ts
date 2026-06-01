// intelligence-eval-real-ui/tests/_shared.ts
// Shared setup for the Playwright spec files: launch the real app once, activate
// Pro, expose helpers. Each spec drives the REAL UI.

import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchNatively, type LaunchedApp } from '../helpers/launch-natively.ts';
import { activateProWithKey, isPremium } from '../helpers/auth-helper.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(__dirname, '../fixtures');

export const cases = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../test-cases/real-ui-100-e2e.json'), 'utf8')
).cases as any[];

type Fixtures = { natively: LaunchedApp };

export const test = base.extend<{}, Fixtures>({
  natively: [async ({}, use) => {
    const app = await launchNatively();
    const settings = await app.settingsWindow();
    const key = process.env.NATIVELY_TEST_API_KEY!.trim();
    await activateProWithKey(settings, key);
    await use(app);
    await app.close();
  }, { scope: 'worker' }],
});

export { expect, isPremium };
