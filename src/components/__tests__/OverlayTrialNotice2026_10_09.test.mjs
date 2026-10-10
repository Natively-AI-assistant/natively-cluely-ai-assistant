/**
 * OverlayTrialNotice2026_10_09.test.mjs
 *
 * The free trial starts by itself when a meeting starts with no AI, and the
 * overlay says so. This pins the WIRING of that: where the hook runs in main,
 * what the overlay listens to, and that the Home card is gone and stays gone.
 *
 * The rules themselves are executed elsewhere: src/lib/trial/__tests__ (who
 * gets a trial; what the overlay shows and when) and
 * electron/services/__tests__/MeetingStartsTrial2026_10_09.test.mjs (the real
 * handler against a stand-in server).
 *
 * Source-level (`node --test`, no JSX renderer in this repo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const overlay = read('src/components/NativelyInterface.tsx');
const notice = read('src/components/overlay/TrialNotice.tsx');
const hook = read('src/components/overlay/useOverlayTrial.ts');
const main = read('electron/main.ts');
const ipc = read('electron/ipcHandlers.ts');
const preload = read('electron/preload.ts');

test('main asks for the trial once the meeting is really starting, and never waits for it', () => {
  const start = main.slice(main.indexOf('private async startMeetingTransition('));
  const call = start.indexOf('this.autoStartTrialForMeeting?.()');
  assert.ok(call > 0, 'startMeetingTransition must call the hook');
  // After the permission checks (a meeting that macOS refuses never starts a
  // trial) and after the funnel line (meeting_started.ai says what it began with).
  assert.ok(call > start.indexOf('this.isMeetingActive = true'), 'after the meeting is live');
  assert.ok(call > start.indexOf('funnelTelemetry.meetingStarted('), 'after the funnel line');
  // Before the overlay is reset, which main sends with no await in between:
  // the overlay's reset can never wipe the start that belongs to this meeting.
  const reset = start.indexOf("'session-reset'");
  assert.ok(call < reset, 'before session-reset');
  assert.ok(!/\bawait\b/.test(start.slice(call, reset)), 'nothing awaits between the hook and session-reset');
  assert.ok(!/await\s+this\.autoStartTrialForMeeting/.test(main), 'a meeting never waits on the network');
});

test('one body starts a trial, whoever asks', () => {
  assert.ok(ipc.includes("safeHandle('trial:start', async (_event, surface?: unknown) => startTrialFlow(surface));"));
  assert.ok(ipc.includes("return startTrialFlow('meeting_start');"), 'the automatic start is reported under its own surface');
  assert.equal((ipc.match(/\/v1\/trial\/start`/g) || []).length, 1, 'one request site');
});

test('the overlay is told on one channel, and every pending is closed', () => {
  assert.ok(ipc.includes("win.webContents.send('trial-auto-start', data)"));
  assert.ok(preload.includes("ipcRenderer.on('trial-auto-start', sub)"));
  const body = ipc.slice(ipc.indexOf('const autoStartTrialForMeeting = async'), ipc.indexOf('appState.autoStartTrialForMeeting ='));
  assert.ok(/finally \{[\s\S]*if \(told\) tell\(\{ state: 'settled' \}\);/.test(body), "a 'pending' with no end would hold the overlay's banner back for good");
});

test('the overlay mounts the trial state once and folds its notice like every other banner', () => {
  assert.equal((overlay.match(/useOverlayTrial\(\)/g) || []).length, 1);
  const at = overlay.indexOf('testId="fold-trial-notice"');
  assert.ok(at > 0);
  const tag = overlay.slice(overlay.lastIndexOf('<ChromeFold', at), at);
  assert.match(tag, /show=\{!!trial\.banner\} overlayVisible=\{isExpanded\} requestHeightMotion=\{requestChromeHeightMotion\}/);
  assert.ok(overlay.includes('{trial.banner && <TrialNoticeBanner trial={trial} />}'));
  // The countdown lives in the status row, which must open for it alone.
  assert.ok(overlay.includes('<ChromeFold show={hasStatusPill || !!trial.chip} '));
  assert.ok(overlay.includes('{trial.chip && <TrialChip minutesLeft={trial.chip.minutesLeft} tone={trial.chip.tone} />}'));
});

test('"Transcription Not Configured" stands down while the trial explains it', () => {
  assert.ok(overlay.includes("const trialExplainsNoStt = trial.pending || trial.banner === 'ended' || trial.banner === 'failed';"));
  assert.ok(overlay.includes('<ChromeFold show={sttNotConfigured && !trialExplainsNoStt} '));
  assert.ok(overlay.includes('{sttNotConfigured && !trialExplainsNoStt && ('));
});

test('the hook hears the start, the end, the automatic start and the new meeting', () => {
  for (const sub of ['getLocalTrial', 'onTrialStarted', 'onTrialEnded', 'onTrialAutoStart', 'onSessionReset']) {
    assert.ok(hook.includes(`api?.${sub}?.(`), sub);
  }
  assert.ok(hook.includes('if (ticker !== null) clearInterval(ticker);'), 'the clock is stopped on unmount');
  // State changes only when what is drawn changes: the overlay is too large to
  // re-render every second.
  assert.ok(hook.includes('setView((prev) => (sameView(prev, next) ? prev : next));'));
});

test('the buttons: own keys opens AI Providers and keeps the trial; plans opens Plans; the manual start is the overlay surface', () => {
  assert.ok(hook.includes("window.electronAPI?.openSettingsTab?.('ai-providers');"));
  assert.ok(hook.includes("window.electronAPI?.openSettingsTab?.('plans');"));
  assert.ok(hook.includes("window.electronAPI?.startTrial?.('overlay')"));
  // "Use my own keys" must never END the trial from here (owner's decision):
  // a misclick would spend the device's one trial.
  for (const src of [hook, notice]) assert.ok(!/endTrialByok|convertTrial/.test(src));
  // The only "Start free trial" button is in the failed banner.
  assert.equal((notice.match(/t\('Start free trial'\)/g) || []).length, 1);
  const failed = notice.slice(notice.indexOf("case 'failed':"), notice.indexOf('default:'));
  assert.ok(failed.includes("t('Start free trial')") && failed.includes('trial.startManually'));
});

test('only the started banner can be closed; the warning, ended and failed banners cannot', () => {
  const part = (from, to) => notice.slice(notice.indexOf(from), notice.indexOf(to));
  assert.ok(!part("case 'ended':", "case 'failed':").includes('onDismiss'));
  // Nothing transcribes or answers in either, and closing the failed one
  // would uncover "Transcription Not Configured" (see trialExplainsNoStt).
  assert.ok(!part("case 'failed':", 'default:').includes('onDismiss'));
  assert.ok(part("case 'started':", "case 'ending':").includes('onDismiss={trial.dismiss}'));
  // The warning stays for the last five minutes (owner's decision, 2026-10-10).
  assert.ok(!part("case 'ending':", "case 'ended':").includes('onDismiss'));
  assert.ok(hook.includes("if (banner !== 'started') return;"));
  // Good news is green, a warning amber, an end red: tone is never decoration.
  assert.ok(part("case 'started':", "case 'ending':").includes('tone="ok"'));
  assert.ok(part("case 'ended':", "case 'failed':").includes('tone="error"'));
});

test('motion: the trial notice moves with the banner kit, plus two swaps of its own', () => {
  // Evin, 2026-10-10: "add animations for the pill and banners in the meeting
  // overlay". The fold, the lines rising in, the icon pop and the title swap
  // come from ChromeFold and OverlayBanner. These are the trial's own.
  const failed = notice.slice(notice.indexOf("case 'failed':"), notice.indexOf('default:'));
  assert.ok(failed.includes("<SwapText swapKey={trial.starting ? 'starting' : 'start'}>"), 'Start free trial and Starting swap in place');
  const chip = notice.slice(notice.indexOf('export const TrialChip'));
  assert.ok(chip.includes('className="pc-chip-icon" aria-hidden="true" key={tone}'), 'the timer pops again when the countdown turns amber');
  assert.ok(chip.includes('<SwapText swapKey={rest}>'), 'the minute changes in place');
  // Every banner's buttons: the labels arrive with the lines, the glass does not fade.
  const bannerCss = readFileSync(resolve(ROOT, 'src/components/ui/OverlayBanner.css'), 'utf8');
  assert.match(bannerCss, /\.ov-banner-btn--primary \.lg-label,\s*\.ov-banner-btn--secondary \.lg-label\s*\{[^}]*transition-delay:\s*0ms/);
  assert.match(bannerCss, /@starting-style\s*\{\s*\.ov-banner-btn--primary \.lg-label,\s*\.ov-banner-btn--secondary \.lg-label\s*\{/);
});

test('motion, second pass: banners arrive and leave as objects, and the tone crosses over', () => {
  // Evin, 2026-10-10, of the first clips: "better animation for banner in the
  // meeting overlay" (the started banner arriving, closing into the pill, the
  // pill itself, the warning becoming the ended banner, the fallback arriving).
  // The first pass only uncovered a finished banner by the fold's clip.
  const css = readFileSync(resolve(ROOT, 'src/components/ui/OverlayBanner.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const chipCss = read('src/components/overlay/TrialNotice.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const banner = read('src/components/ui/OverlayBanner.tsx');
  const fold = read('src/components/overlay/ChromeFold.tsx');
  const startOf = (sheet, sel) => [...sheet.matchAll(/@starting-style\s*\{\s*([^{]+)\{([^}]*)\}/g)].find((m) => m[1].split(',').map((x) => x.trim()).includes(sel))?.[2];
  const rule = (sheet, sel) => sheet.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.[\]'=>:()]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1];

  // A fold says when it is leaving, so what is inside can leave too.
  assert.ok(fold.includes("data-fold-state={present ? 'in' : 'out'}"));

  // The body arrives by its paint and a small scale, never by opacity: an
  // opacity on the banner would blank the glass mark and buttons inside it.
  const body = startOf(css, '.ov-banner');
  assert.ok(body, 'the banner has an entrance of its own');
  assert.match(body, /transform:\s*scale\(0\.96\)/);
  assert.match(body, /background-color:\s*transparent/);
  assert.match(body, /border-color:\s*transparent/);
  assert.ok(!/opacity|filter/.test(body));

  // The glass pieces sit in wrappers that move by transform only.
  assert.ok(banner.includes('className="ov-banner-pop"') && banner.includes('ov-banner-actions'));
  for (const [sheet, sel] of [[css, '.ov-banner-pop'], [css, '.ov-banner-actions'], [chipCss, '.trial-chip-host']]) {
    const start = startOf(sheet, sel);
    assert.ok(start, `${sel} has an entrance`);
    assert.match(start, /transform:\s*scale\(/, sel);
    assert.ok(!/opacity|filter/.test(start), `${sel} holds glass: transform only`);
    const leaving = rule(sheet, `[data-fold-state='out'] ${sel}`);
    assert.ok(leaving, `${sel} leaves with its fold`);
    assert.match(leaving, /transform:\s*scale\(/);
    assert.ok(!/opacity|filter/.test(leaving), `${sel} holds glass: transform only on the way out too`);
    // Nothing bounces on the way out.
    assert.ok(!/0\.34, 1\.\d+, 0\.64/.test(leaving), `${sel} does not bounce shut`);
  }
  assert.ok(read('src/components/overlay/TrialNotice.tsx').includes('pc-chip-host trial-chip-host'));

  // A tone that changes while the banner is up crosses over: the triple the
  // mark and the primary button are tinted from is a registered list.
  assert.match(css, /@property --ovb-cta-tone\s*\{[^}]*syntax:\s*'<number>#'[^}]*inherits:\s*true/);
  assert.match(css, /--ovb-cta-tone 250ms ease-in-out/);
  // ...and the mark sends out one ring, only when the tone changed in place.
  assert.ok(banner.includes('const toneAtMount = React.useRef(tone);'));
  assert.ok(banner.includes('{tone !== toneAtMount.current && <span className="ov-banner-ping" key={tone} aria-hidden="true" />}'));

  // Reduced motion switches every new piece off.
  const guard = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/)[1];
  for (const sel of ['.ov-banner,', '.ov-banner-pop', '.ov-banner-actions', '.ov-banner-ping']) assert.ok(guard.includes(sel), `reduced motion covers ${sel}`);
  assert.match(chipCss, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.trial-chip-host/);
});

test('motion, third pass: the close is seen, the button keeps its width, the title line is never empty', () => {
  // Three refinements Evin approved (2026-10-10, "do that too").
  const fold = read('src/components/overlay/ChromeFold.tsx');
  const swap = read('src/components/ui/SwapText.tsx');
  const banner = read('src/components/ui/OverlayBanner.tsx');
  const css = readFileSync(resolve(ROOT, 'src/components/ui/OverlayBanner.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const chipCss = read('src/components/overlay/TrialNotice.css').replace(/\/\*[\s\S]*?\*\//g, '');

  // 1. A glass fold waits a beat before it shuts, so what is inside is seen
  //    leaving. No longer than the plain folds wait: the window hold
  //    (FOLD_EXIT_MS) is sized for theirs.
  const clipDelay = Number(fold.match(/const CLIP_COLLAPSE_DELAY_S = ([\d.]+);/)?.[1]);
  const fadeDelay = Number(fold.match(/const COLLAPSE_DELAY_S = ([\d.]+);/)[1]);
  assert.equal(clipDelay, 0.04);
  assert.ok(clipDelay <= fadeDelay);
  const exitClip = fold.slice(fold.indexOf('exitClip:'), fold.indexOf('const hasGlass'));
  assert.match(exitClip, /height: \{ duration: COLLAPSE_S, delay: CLIP_COLLAPSE_DELAY_S, ease: EASE_SMOOTH_OUT \}/);
  assert.match(exitClip, /y: \{ duration: COLLAPSE_S, delay: CLIP_COLLAPSE_DELAY_S, ease: EASE_SMOOTH_OUT \}/);

  // 2. "Start free trial" and "Starting…" both size the button, in every
  //    language, so the pill does not change width while the label swaps.
  const failed = notice.slice(notice.indexOf("case 'failed':"), notice.indexOf('default:'));
  assert.equal((failed.match(/className="trial-start-sizer" aria-hidden="true"/g) || []).length, 2);
  assert.ok(failed.includes('className="trial-start-label"'));
  assert.match(chipCss, /\.trial-start-label\s*\{[^}]*display:\s*inline-grid/);
  assert.match(chipCss, /\.trial-start-label > \*\s*\{[^}]*grid-area:\s*1 \/ 1/);
  assert.match(chipCss, /\.trial-start-sizer\s*\{[^}]*visibility:\s*hidden/);

  // 3. A banner's title and message cross over: the old words leave while the
  //    new ones arrive. Opt-in, so the Answer / Stop label and the chips keep
  //    the one-after-the-other swap their own layout depends on.
  assert.ok(swap.includes('overlap?: boolean;'));
  assert.ok(swap.includes('className="t-text-swap-leaving"'));
  assert.equal((banner.match(/<SwapText overlap swapKey=/g) || []).length, 2, 'the title and the message');
  for (const file of ['src/components/NativelyInterface.tsx', 'src/components/overlay/PageContextChip.tsx', 'src/components/overlay/TrialNotice.tsx']) {
    assert.ok(!/<SwapText overlap/.test(read(file)), `${file} keeps the sequential swap`);
  }
  const leaving = [...css.matchAll(/@starting-style\s*\{\s*([^{]+)\{([^}]*)\}/g)].find((m) => m[1].trim() === '.t-text-swap-leaving');
  assert.ok(leaving, 'the old words start where they were and leave from there');
  assert.match(css, /\.t-text-swap-leaving\s*\{[^}]*position:\s*absolute/);
  const guard = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/)[1];
  assert.ok(guard.includes('.t-text-swap-leaving'));
});

test('review fixes: the overlay hook knows whether a meeting is on, and rests when there is nothing to count', () => {
  // A review (2026-10-10) found the hook reported banners "shown" inside a
  // hidden overlay (a trial outliving its meeting warns and ends unseen), and
  // ran a one-second timer for ever in every user's overlay, trial or not.
  assert.ok(hook.includes('api?.onMeetingStateChanged?.('), 'it hears meetings start and end');
  assert.ok(hook.includes('api?.getMeetingActive?.()'), 'and asks once, for an overlay opened mid-meeting');
  assert.ok(hook.includes('if (f.meetingActive && f.expiresAt !== null && f.expiresAt > now) f.liveThisMeeting = true;'), 'a trial is "live in this meeting" only in a meeting');
  // Reported only while a meeting is on, and again when one begins under a banner already computed.
  assert.match(hook, /if \(!view\.active \|\| !view\.banner \|\| reported\.current\.has\(view\.banner\)\) return;/);
  assert.match(hook, /\}, \[view\.banner, view\.active\]\);/);
  // The clock runs only while a trial is counting down or a start is in flight.
  assert.ok(hook.includes('const counting = f.pendingSince !== null || (f.expiresAt !== null && f.expiresAt > Date.now());'));
  assert.ok(!/const id = setInterval\(refresh, 1000\);/.test(hook), 'no unconditional interval');
  // The trial's own length (both ends are the server's times) caps what a slow clock would show.
  assert.ok(hook.includes('durationMs: f.durationMs,'));
});

test('second review: a meeting that ends takes its trial talk with it', () => {
  // endMeeting sends the session reset BEFORE it flips the meeting flag, so the
  // reset alone left "the trial was live in this meeting" true again a moment
  // later. A trial that then ran out between meetings sat as "Free trial ended"
  // in the hidden overlay and was on screen when the next meeting opened.
  const ended = hook.slice(hook.indexOf('api?.onMeetingStateChanged?.('), hook.indexOf('api?.onTrialEnded?.('));
  assert.match(ended, /if \(!f\.meetingActive\) \{[^}]*f\.liveThisMeeting = false;[^}]*f\.announcedAt = null;[^}]*f\.startFailed = null;[^}]*f\.pendingSince = null;/);
});

test('second review: the fallback goes once the meeting has AI another way', () => {
  // "Free trial could not start" has no close. Someone who then added their own
  // key mid-meeting kept the banner, and its Start button would have moved them
  // off the key they had just saved.
  assert.ok(hook.includes('api?.onCredentialsChanged?.('));
  assert.match(hook, /if \(c\?\.hasOwnAiKey \|\| c\?\.hasNativelyKey\) \{ f\.startFailed = null; update\(\); \}/);
  assert.match(hook, /api\?\.onSttConfigChanged\?\.\(\(data\) => \{\s*let changed = false;\s*if \(data\?\.configured && f\.startFailed\) \{ f\.startFailed = null; changed = true; \}/);
});

test('review fix: the old words of a crossed-over line are taken out again', () => {
  // The timer that removes them was the effect's own cleanup, and the effect
  // re-ran (its key changed) before it could fire: the old title stayed in the
  // page for good, invisible, still found by select, copy and search.
  const swap = read('src/components/ui/SwapText.tsx');
  assert.ok(swap.includes('const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);'));
  assert.ok(!/return \(\) => clearTimeout\(done\);/.test(swap), 'not cancelled by the re-run it causes');
  assert.match(swap, /leaveTimer\.current = setTimeout\(\(\) => \{\s*leaveTimer\.current = null;\s*setLeaving\(null\);/);
  assert.match(swap, /useEffect\(\(\) => \(\) => \{ if \(leaveTimer\.current\) clearTimeout\(leaveTimer\.current\); \}, \[\]\);/, 'cleared when the line itself goes');
});

test('Settings words every refusal and remembers none of them against the device', () => {
  const settings = read('src/components/settings/NativelyApiSettings.tsx');
  assert.ok(settings.includes('setTrialError(trialRefusal(res?.error).message);'));
  // The network's cap and the hourly limit used to be recorded as a used trial.
  assert.ok(!/res\?\.error === 'trial_ip_limit' \|\| res\?\.error === 'trial_start_rate_limited'/.test(settings));
  // No raw code on screen.
  assert.ok(!/res\?\.error \|\| 'Could not start trial/.test(settings));
});

test('transcription is rebuilt AFTER the trial is announced, and the overlay waits for it', () => {
  // Main announces the trial, then rebuilds transcription (seconds: it waits
  // for the meeting's audio start-up, stops the captures and builds them
  // again). Dropping "on its way" at the announcement put the red
  // "Transcription Not Configured" banner beside "Free trial started".
  assert.ok(hook.includes('f.pendingSince = f.meetingActive ? Date.now() : null;'), 'held from the announcement, in a meeting');
  const started = hook.slice(hook.indexOf('api?.onTrialStarted?.('), hook.indexOf('api?.onMeetingStateChanged?.('));
  assert.ok(!started.includes('f.pendingSince = null;'));
  // ...until main says what transcription is now (it does once, when the rebuild is done).
  assert.match(hook, /api\?\.onSttConfigChanged\?\.\(\(data\) => \{[\s\S]{0,400}if \(f\.pendingSince !== null && f\.expiresAt !== null\) \{ f\.pendingSince = null; changed = true; \}/);
});

test('a manual start the server refuses for now says so and stays', () => {
  // "Too many trials from this network" and the day's ceiling: pressing Start
  // got the banner folded away with nothing said, and "Transcription Not
  // Configured" in its place.
  assert.ok(hook.includes("else if (outcome === 'network_limited') f.startFailed = 'paused';"));
  assert.ok(hook.includes("type Failure = 'unreachable' | 'rate_limited' | 'paused';"));
  const notice = read('src/components/overlay/TrialNotice.tsx');
  assert.ok(notice.includes("t('Free trials are not available right now. Try again later.')"));
  assert.ok(read('src/i18n.trial.ts').includes("'Free trials are not available right now. Try again later.': ["));
});

test('the Home trial card is gone', () => {
  assert.ok(!existsSync(resolve(ROOT, 'src/components/trial/TrialPromoToaster.tsx')));
  const host = read('src/components/onboarding/OrchestratedToasterHost.tsx');
  assert.ok(!host.includes('TrialPromoToaster'));
  assert.ok(!host.includes("startTrial?.('trial_promo')"));
  const catalog = read('src/lib/onboarding/stageCatalog.ts');
  assert.ok(!/id: 'trial_promo'/.test(catalog));
  // The id itself stays where old installs hold it.
  assert.ok(read('src/lib/cards/cardPolicy.mjs').includes('trial_promo:'));
  assert.ok(read('src/lib/funnel/funnelCatalog.mjs').includes("'trial_promo'"));
});

test('the welcome screen says it before any meeting', () => {
  const welcome = read('src/components/onboarding/WelcomeScreen.tsx');
  assert.ok(welcome.includes("{tr('Your 30 free minutes start with your first meeting. No card needed.')}"));
});
