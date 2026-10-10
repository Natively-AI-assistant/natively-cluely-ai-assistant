// The launcher's small free-trial card (2026-10-10): the clock and the two
// allowances a trial can run out of, in the bottom-right corner while a trial
// runs. What it shows is src/lib/trial/trialMeter.mjs (tested there); this
// pins where it sits, what it is made of and what stands down for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURFACES } from '../../lib/funnel/funnelCatalog.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(dirname, '../..');
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');
const card = read('components/trial/TrialMeterToaster.tsx');
const quota = read('components/NativelyQuotaBanner.tsx');
const app = read('App.tsx');

test('it is the quota notice\'s sibling: the same glass pane, corner and slide', () => {
  for (const prop of ['placement="bottom-right"', 'modal={false}', 'keepPictures={false}', 'radius={18}']) {
    assert.ok(card.includes(prop), `card: ${prop}`);
    assert.ok(quota.includes(prop), `quota notice: ${prop}`);
  }
  assert.match(card, /cardClassName=\{`lg-notice\$\{/);
  assert.match(quota, /cardClassName="lg-notice /);
  assert.ok(card.includes("import '../../ui-components/LiquidGlassButton.css'"));
});

test('it is smaller than the quota notice and sits under the corner\'s passing notices', () => {
  const width = Number(card.match(/wrapClassName="w-\[(\d+)px\]"/)[1]);
  const quotaWidth = Number(quota.match(/wrapClassName="w-\[(\d+)px\]"/)[1]);
  assert.ok(width < quotaWidth, `${width} < ${quotaWidth}`);
  const z = Number(card.match(/zIndex=\{(\d+)\}/)[1]);
  assert.ok(z < Number(quota.match(/zIndex=\{(\d+)\}/)[1]));
});

test('low is amber, used up is red, and neither is a stripe down the side', () => {
  assert.ok(card.includes("' lg-notice-alert'") && card.includes("' lg-notice-warn'"));
  assert.ok(card.includes('data-tone={row.tone}'));
  assert.ok(!/border-l-|borderLeft/.test(card));
});

test('the bar is Liquid Glass, and the filled part sits exactly on its track in both themes', () => {
  // Evin, 2026-10-10: "the progress line in light mode is not aligned", then,
  // of a flat strip, "why not liquid glass". The Settings meter
  // (.natively-meter-*) draws its light-theme track with a white lip INSIDE the
  // bottom edge, so the groove is seen a pixel shorter than the fill that sits
  // in it. This card keeps the glass (a sheen, a top rim, the bloom) and draws
  // the lip under the strip instead.
  const css = read('components/trial/TrialMeterToaster.css');
  assert.ok(card.includes("import './TrialMeterToaster.css'"));
  assert.ok(!card.includes('natively-meter-'), 'not the Settings meter, whose lip is inside the groove');
  assert.ok(card.includes('className="trial-meter-track"') && card.includes('className="trial-meter-fill"'));
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (sel) => rules.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.[\]'=]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  const dark = block('.trial-meter-track'), light = block("[data-theme='light'] .trial-meter-track");
  const height = Number(dark.match(/height:\s*(\d+)px/)?.[1]);
  assert.ok(height >= 4, `${height}px: under 4px the sheen can only be a line (index.css, the meter's own note)`);
  assert.match(dark, /overflow:\s*visible/, 'a clipped track deletes the bloom');
  for (const [name, rule] of [['dark', dark], ['light', light]]) {
    assert.match(rule, /inset 0 1px/, `${name}: the groove's upper wall`);
    assert.ok(!/inset 0 -1px/.test(rule), `${name}: no lip inside the groove`);
    assert.match(rule, /(?:^|,)\s*0 1px 0 rgba\(255, 255, 255/m, `${name}: the lip is under the strip`);
  }
  const fill = block('.trial-meter-fill');
  assert.match(fill, /height:\s*100%/);
  assert.match(fill, /linear-gradient\(180deg, rgba\(255, 255, 255/, 'the sheen on the top face');
  assert.match(fill, /var\(--trial-meter-hue\)/);
  assert.match(fill, /0 0 \d+px -?\d*px var\(--trial-meter-hue\)/, 'the bloom');
  assert.ok(!block("[data-theme='light'] .trial-meter-fill").includes('var(--trial-meter-hue)'), 'no bloom on a light pane');
  for (const tone of ['low', 'out']) assert.ok(block(`.trial-meter-fill[data-tone='${tone}']`).includes('--trial-meter-hue'), tone);
});

test('motion: what moves on the card, and what deliberately does not', () => {
  // Evin, 2026-10-10: "add animations for ... toasters in the launcher app".
  // The card's slide is GenieModal's (genieMotion.mjs SLIDE). This is what
  // moves INSIDE it, on the transitions.dev token scale.
  const css = read('components/trial/TrialMeterToaster.css');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // The bars fill once the card has landed: a keyframe with a delay, held at
  // empty until it starts. The card's children are mounted on every open
  // (GenieModal renders nothing while closed), so it plays on every arrival.
  assert.match(rules, /@keyframes trial-meter-fill-in\s*\{\s*from\s*\{\s*width:\s*0/);
  assert.match(rules, /animation:\s*trial-meter-fill-in 500ms cubic-bezier\(0\.22, 1, 0\.36, 1\) \d+ms backwards/);
  // A value that changes (every 30 s at most) swaps in place; the hue of a bar
  // that turns amber or red crosses over, which needs a registered colour.
  assert.ok(card.includes('<SwapText swapKey={formatMeter(row)}>{formatMeter(row)}</SwapText>'));
  assert.match(rules, /@property --trial-meter-hue\s*\{[^}]*syntax:\s*'<color>'/);
  assert.match(rules, /--trial-meter-hue 250ms ease-in-out/);
  // The clock redraws every second, so it only ever changes colour.
  const clock = card.slice(card.indexOf('const TrialClock'), card.indexOf('export interface TrialMeterToasterProps'));
  assert.ok(!clock.includes('SwapText'), 'a swap every second would never rest');
  // "See plans" opens like an accordion (#21): the card grows instead of jumping.
  assert.match(rules, /\.trial-meter-more\s*\{[^}]*grid-template-rows:\s*0fr/);
  assert.match(rules, /\.trial-meter-more\[data-open='true'\]\s*\{[^}]*grid-template-rows:\s*1fr/);
  assert.ok(card.includes("tabIndex={view.tone !== 'ok' ? 0 : -1}"), 'a folded link is not a tab stop');
  assert.ok(card.includes("aria-hidden={view.tone === 'ok'}"));
  // The icon pops again when the clock turns amber; the close sinks while held.
  assert.ok(card.includes("key={view.timeLow ? 'low' : 'ok'}"));
  assert.match(rules, /\.trial-meter-close:active svg\s*\{[^}]*scale\(0\.82\)/);
  // House rules: no `transition: all`, entrances are not replayed by a
  // re-render, and reduced motion switches every one of them off.
  assert.ok(!/transition:\s*all\b/.test(rules));
  const guard = rules.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/);
  assert.ok(guard, 'the file ends with a reduced-motion guard');
  for (const sel of ['.trial-meter-fill', '.trial-meter-more', '.trial-meter-more-inner', '.trial-meter-icon svg', '.trial-meter-close svg', '.trial-meter-card']) {
    assert.ok(guard[1].includes(sel), `reduced motion covers ${sel}`);
  }
  assert.match(guard[1], /animation:\s*none\s*!important/);
});

test('the numbers are formatted by the usage rows\' formatter, not a second one', () => {
  assert.ok(card.includes('formatMeter(row)'));
  assert.ok(!/toLocaleString|Math\.round|toFixed/.test(card), 'no rounding of its own');
  assert.ok(card.includes('...TRIAL_FALLBACK_LIMITS, ...trial.limits'), 'server limits win over the fallback');
});

test('only the clock redraws every second', () => {
  const clock = card.slice(card.indexOf('const TrialClock'), card.indexOf('export interface TrialMeterToasterProps'));
  assert.ok(clock.includes('setInterval(tick'));
  assert.ok(clock.includes('role="timer"'), 'a timer, so a screen reader is not read every second');
  const rest = card.slice(card.indexOf('export const TrialMeterToaster'));
  assert.ok(rest.includes('setPhase(timePhase(expiresMs))'), 'the card itself re-renders on a phase change only');
  assert.ok(!/setNow\(/.test(rest));
});

test('See plans appears once something is running out, and a close is remembered by tone', () => {
  assert.ok(card.includes("data-open={view.tone !== 'ok'}"));
  assert.ok(card.includes('setClosedAt(view.tone)'));
  assert.ok(card.includes('shouldShowTrialMeter(live.tone, closedAt)'));
});

test('the launcher mounts it on Home only, from the trial it already holds', () => {
  const mount = app.match(/<TrialMeterToaster[\s\S]*?\/>/);
  assert.ok(mount, 'App mounts the card');
  assert.ok(mount[0].includes('trial={activeTrial}'));
  assert.ok(mount[0].includes('ready={isAppReady && !showTrialExpiredModal}'), 'not over Settings, a manager, the welcome or Trial ended');
  assert.ok(mount[0].includes("openSettingsExclusive('plans')"));
  const line = app.slice(app.lastIndexOf('\n', mount.index), mount.index + mount[0].length);
  assert.ok(/isLauncherWindow \|\| isDefault/.test(line), 'never in the overlay or another window');
  assert.ok(line.includes('!isolateGlobalSurfaces'));
});

test('review fix: the card waits until the launcher is in front of someone', () => {
  // A trial that starts with a meeting reaches the launcher while it is hidden
  // behind that meeting. The card opened there, played its arrival to nobody
  // and reported itself shown for every automatic trial.
  assert.ok(card.includes("document.visibilityState === 'visible'"));
  assert.ok(card.includes("document.addEventListener('visibilitychange'"));
  assert.ok(card.includes('window.electronAPI?.onMeetingStateChanged?.('));
  assert.ok(card.includes('if (!ready || !onScreen) { setSettled(false); return; }'));
  assert.match(card, /\}, \[ready, onScreen\]\);/);
  // The trial's length caps the clock, as in the overlay.
  assert.ok(card.includes('const capMs = trial?.limits?.duration_ms;') && card.includes('capMs={clockCapMs}'));
});

test('second review: the card is reported shown once per trial, and only to a window in use', () => {
  // The on-screen gate closes the card for every meeting, and the report was
  // re-armed on every close: three short meetings, three "shown". And the
  // launcher's Page Visibility is always 'visible' (backgroundThrottling is
  // off, WindowHelper.ts), so a hidden launcher looked on screen.
  assert.ok(card.includes('const reportedFor = useRef<number | null>(null);'));
  assert.ok(card.includes('if (!open || reportedFor.current === expiresMs || !document.hasFocus()) return;'));
  assert.ok(card.includes("window.addEventListener('focus', report);"));
  assert.ok(!card.includes('if (!open) shownRef.current = false;'));
});

test('the quota notice stands down for a trial: one card for one set of numbers', () => {
  assert.match(quota, /result\.plan === 'trial'/);
  const at = quota.indexOf("result.plan === 'trial'");
  assert.ok(at < quota.indexOf('const candidates'), 'before any bucket is weighed');
});

test('its telemetry surface exists on both sides', () => {
  assert.ok(SURFACES.includes('trial_meter'));
  assert.ok(card.includes("surface: 'trial_meter'"));
  const server = fs.readFileSync(path.resolve(SRC, '../natively-api/lib/funnelCatalog.js'), 'utf8');
  assert.ok(server.includes("'trial_meter'"), 'the server would reject the batch otherwise');
});
