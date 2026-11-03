// The trial's AI allowance, said and counted: the main-process half (2026-11-03).
// Renderer and catalogue half: src/lib/__tests__/trialAllowanceSignals2026_11_03.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const loadDirectAssist = () => import(pathToFileURL(path.join(root, 'dist-electron/electron/direct-assist/index.js')).href);

// ── (a) Direct Assist ──────────────────────────────────────────────────────

test('a refusal marked as a Natively limit is TRIAL_ENDED or PLAN_LIMIT, read before its 429', async () => {
  const { normalizeDirectAssistError, DIRECT_ASSIST_ERROR_CODES } = await loadDirectAssist();
  assert.ok(DIRECT_ASSIST_ERROR_CODES.includes('TRIAL_ENDED'));
  assert.ok(DIRECT_ASSIST_ERROR_CODES.includes('PLAN_LIMIT'));

  const onTrial = Object.assign(new Error('Natively API stream HTTP 429'), { status: 429, nativelyLimit: { code: 'ai_quota_exceeded', onTrial: true } });
  const trial = normalizeDirectAssistError(onTrial);
  assert.equal(trial.code, 'TRIAL_ENDED');
  assert.equal(trial.retryable, false, 'asking again cannot help');

  const paid = Object.assign(new Error('Natively API stream HTTP 429'), { status: 429, nativelyLimit: { code: 'ai_quota_exceeded', onTrial: false } });
  assert.equal(normalizeDirectAssistError(paid).code, 'PLAN_LIMIT');

  // An ordinary 429 (a provider's rate limit) is unchanged.
  const rate = Object.assign(new Error('HTTP 429'), { status: 429 });
  assert.equal(normalizeDirectAssistError(rate).code, 'RATE_LIMITED');
  // A nativelyLimit that is not an object is ignored.
  assert.equal(normalizeDirectAssistError(Object.assign(new Error('x'), { status: 429, nativelyLimit: 'trial' })).code, 'RATE_LIMITED');
});

test('LLMHelper marks the Direct Assist refusal, and the held-back requests after it', () => {
  const src = read('electron/LLMHelper.ts');
  assert.match(src, /const planLimit = this\.noteNativelyPlanLimit\(response\.status, response\.headers, errData, nativelyKey === TRIAL_SENTINEL_KEY\);/);
  assert.match(src, /throw planLimit \? this\.withNativelyLimit\(error\) : error;/);
  const guard = src.slice(src.indexOf('private assertNativelyNotBlocked('), src.indexOf('private static readonly CIRCUIT_429_THRESHOLD'));
  assert.match(guard, /throw this\.withNativelyLimit\(new Error\(/);
  // The Direct Assist message stays content-free: the status line only.
  assert.match(src, /new Error\(`Natively API stream HTTP \$\{response\.status\}`\)/);
});

// ── (b) the warning before the answers stop ────────────────────────────────

test('the status poll tells every window when the allowance is in its last quarter', () => {
  const src = read('electron/ipcHandlers.ts');
  assert.match(src, /import \{ shouldEndTrialForUsedAllowance, isTrialAllowanceLow \} from '\.\.\/src\/lib\/trial\/trialAllowance\.mjs';/);
  const at = src.indexOf("isTrialAllowanceLow({ used: data?.usage?.ai_tokens, limit: data?.limits?.ai_tokens })");
  assert.ok(at > 0, 'reads the server\'s own usage and limit');
  const near = src.slice(at - 400, at + 400);
  assert.match(near, /cm\.getNativelyApiKey\(\) === TRIAL_SENTINEL_KEY/, 'only while the app runs on the trial');
  assert.match(near, /webContents\.send\('trial-allowance-low'/);

  const preload = read('electron/preload.ts');
  assert.match(preload, /ipcRenderer\.on\('trial-allowance-low', sub\)/);
  assert.match(preload, /ipcRenderer\.removeListener\('trial-allowance-low', sub\)/);
});

test('the overlay turns the broadcast into the warning, and says why', () => {
  const hook = read('src/components/overlay/useOverlayTrial.ts');
  assert.match(hook, /api\?\.onTrialAllowanceLow\?\.\(/);
  assert.match(hook, /allowanceLow: f\.allowanceLow,/);
  assert.match(hook, /endedBy: f\.endedBy,/);
  assert.match(hook, /f\.endedBy = 'allowance';/);
  const notice = read('src/components/overlay/TrialNotice.tsx');
  assert.match(notice, /trial\.reason === 'allowance'/);
});

// ── (c) what ended the trial, for the funnel ───────────────────────────────

test('trial_expired says whether the clock or the allowance ended the trial', () => {
  const src = read('electron/ipcHandlers.ts');
  assert.match(src, /const endExpiredTrialRuntime = async \(reason: string, endedBy: 'clock' \| 'allowance' = 'clock'\)/);
  assert.match(src, /funnelTelemetry\.track\('trial_expired', \{ reason: endedBy \}\);/);
  assert.match(src, /await endExpiredTrialRuntime\('Trial AI allowance used', 'allowance'\);/);
  assert.equal((src.match(/funnelTelemetry\.track\('trial_expired'/g) ?? []).length, 1, 'one place reports it');
});
