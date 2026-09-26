// The trial clock lives in the launcher, and 0:00 hands straight to Trial
// ended (toaster policy Phase 3, spec §5 rows 1-2, §7.5).
//
// - App mounts in the launcher AND the overlay; both polled trial:status every
//   30 s, and every poll could settle (wipe) the expiry. Only the launcher
//   keeps the clock now.
// - At 0:00 the banner used to just say "Trial ended" and wait for the next
//   server poll (never, offline). It now tells App, which settles the expiry
//   from the LOCAL clock (trial:get-local) and opens the card.
// - The banner's "free trial" label and pip icons used Tailwind opacity
//   modifiers on a bare var() colour token, which emit no CSS (index.css
//   notes this), so they rendered browser-default black.
//
// Source assertions: App's mount effect and the banner are not unit-rendered here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, '..', '..', 'App.tsx'), 'utf8');
const banner = readFileSync(join(here, '..', 'trial', 'FreeTrialBanner.tsx'), 'utf8');

test('only the launcher keeps the trial clock', () => {
  assert.ok(app.includes('const ownsTrialClock = isLauncherWindow || isDefault;'));
  assert.ok(app.includes('if (ownsTrialClock) window.electronAPI?.getLocalTrial?.().then((local: any) => {'), 'the mount read and its poll');
  const started = app.slice(app.indexOf('const removeTrialStartedListener'), app.indexOf('// ── Onboarding orchestrator — push user-state patches'));
  assert.ok(started.includes('if (ownsTrialClock && !trialPollId) {'), 'a trial started mid-session polls in the launcher only');
});

test('the banner reports 0:00 once', () => {
  assert.ok(banner.includes('onExpired?: () => void;'));
  assert.ok(banner.includes('if (left === 0 && !expiredReportedRef.current) { expiredReportedRef.current = true; onExpiredRef.current?.(); }'));
});

test('App settles 0:00 from the local clock and opens the card, no server wait', () => {
  assert.ok(app.includes('onExpired={handleTrialClockExpired}'));
  const handler = app.slice(app.indexOf('const handleTrialClockExpired'), app.indexOf('}, []);', app.indexOf('const handleTrialClockExpired')));
  assert.ok(handler.includes('window.electronAPI?.getLocalTrial?.()'), 'local settle: works offline');
  assert.ok(handler.includes('if (local?.showEndedCard) { setActiveTrial(null); setShowTrialExpiredModal(true); }'));
  assert.ok(!handler.includes('getTrialStatus'), 'never waits for the server');
});

test('the banner label and pips have a real colour', () => {
  assert.ok(!/text-text-tertiary\/\d+/.test(banner), 'an opacity modifier on a bare var() token emits no CSS');
});
