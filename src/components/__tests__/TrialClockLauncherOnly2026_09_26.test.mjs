// The trial clock lives in the launcher, and 0:00 hands straight to Trial
// ended (toaster policy Phase 3, spec §5 rows 1-2, §7.5).
//
// - App mounts in the launcher AND the overlay; both polled trial:status every
//   30 s, and every poll could settle (wipe) the expiry. Only the launcher
//   keeps the clock now.
// - At 0:00 the launcher used to wait for the next server poll (never,
//   offline). App now settles the expiry from the LOCAL clock (trial:get-local)
//   and opens the card.
// - The countdown banner that carried that clock was removed on 2026-10-04 (it
//   sat below the window's bottom edge and was never seen). The clock stayed,
//   as useTrialExpiry: no state, so App does not re-render every second.
//
// Source assertions: App's mount effect and the hook are not unit-rendered here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, '..', '..', 'App.tsx'), 'utf8');
const expiry = readFileSync(join(here, '..', 'trial', 'useTrialExpiry.ts'), 'utf8');

test('only the launcher keeps the trial clock', () => {
  assert.ok(app.includes('const ownsTrialClock = isLauncherWindow || isDefault;'));
  assert.ok(app.includes('if (ownsTrialClock) window.electronAPI?.getLocalTrial?.().then((local: any) => {'), 'the mount read and its poll');
  const started = app.slice(app.indexOf('const removeTrialStartedListener'), app.indexOf('// ── Onboarding orchestrator — push user-state patches'));
  assert.ok(started.includes('if (ownsTrialClock && !trialPollId) {'), 'a trial started mid-session polls in the launcher only');
});

test('the clock reports 0:00 once per trial, and keeps no state', () => {
  assert.ok(expiry.includes('if (!reported) { reported = true; onExpiredRef.current(); }'));
  assert.ok(expiry.includes('}, [expiresAt]);'), 'a new trial reports again');
  assert.ok(expiry.includes('id = setInterval(tick, 1000);'), 'the wall clock is re-read each second: a sleep past 0:00 hands over on wake');
  assert.ok(!expiry.includes('useState'), 'App must not re-render every second');
});

test('the countdown banner is gone, and only the launcher runs the clock', () => {
  assert.ok(!existsSync(join(here, '..', 'trial', 'FreeTrialBanner.tsx')));
  assert.ok(!app.includes('FreeTrialBanner'));
  assert.ok(app.includes('!isolateGlobalSurfaces && (isLauncherWindow || isDefault) && activeTrial ? activeTrial.expiresAt : null,'));
});

test('App settles 0:00 from the local clock and opens the card, no server wait', () => {
  assert.ok(/useTrialExpiry\(\s*[^;]*?,\s*handleTrialClockExpired,\s*\);/.test(app));
  const handler = app.slice(app.indexOf('const handleTrialClockExpired'), app.indexOf('}, []);', app.indexOf('const handleTrialClockExpired')));
  assert.ok(handler.includes('window.electronAPI?.getLocalTrial?.()'), 'local settle: works offline');
  assert.ok(handler.includes('if (local?.showEndedCard) { setActiveTrial(null); setShowTrialExpiredModal(true); }'));
  assert.ok(!handler.includes('getTrialStatus'), 'never waits for the server');
});
