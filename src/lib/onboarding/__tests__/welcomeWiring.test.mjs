// App.tsx wiring for the first-launch welcome (source-level: App needs a DOM
// and the Electron bridge). The gate itself is welcomeGate.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.resolve(here, '../../../App.tsx'), 'utf8');

test('the splash holds until the welcome decision lands', () => {
  assert.match(app, /\{showStartup \|\| showWelcome === null \? \(/);
});

test('a hung flag read is bounded and decided from the local mirrors', () => {
  assert.match(app, /WELCOME_DECIDE_TIMEOUT_MS = 4000/);
  assert.match(app, /setShowWelcome\(prev => prev \?\? shouldShowWelcome\(null, readWelcomeLocal\(\)\)\)/);
});

test('nothing onboarding-related starts under the welcome', () => {
  assert.match(app, /showWelcome === false && !isSettingsOpen/, 'isAppReady must wait for the welcome');
  assert.match(app, /!isolateOnboarding && showWelcome === false/, 'the toaster orchestrator must not mount under it');
  assert.match(app, /if \(showStartup \|\| showWelcome !== false\) return;/, 'the Hindsight banner must not schedule under it');
});

test('the welcome is marked seen in both stores only when the tour ends', () => {
  const i = app.indexOf('const finishWelcome = useCallback');
  assert.notEqual(i, -1);
  const body = app.slice(i, i + 400);
  assert.ok(body.includes("localStorage.setItem(WELCOME_SEEN_KEY, '1')"));
  assert.ok(body.includes("onboardingSetFlag?.('seenStartup', true)"));
  assert.match(app, /<WelcomeFlow onDone=\{finishWelcome\} \/>/);
});
