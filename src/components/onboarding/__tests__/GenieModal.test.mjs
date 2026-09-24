/**
 * GenieModal.test.mjs
 *
 * Every launcher popup (Settings, the Modes / Profile Intelligence manager,
 * Update, Review, the trial and support cards) opens and closes with the same
 * macOS genie as the browser-extension toaster, through GenieModal.
 *
 *   1. The presence latch (geniePresence.mjs) and the compositor track
 *      (genieMotion.mjs) are pure, so they are EXECUTED here, not read.
 *   2. The wiring is asserted on source text, because this runner has no JSX
 *      renderer. Those checks catch a popup that drifts back to its own
 *      animation, not a broken genie; the live check is the dev:agent drive.
 *
 * Run: node --test src/components/onboarding/__tests__/GenieModal.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../..');
const read = rel => readFileSync(resolve(SRC, rel), 'utf8');
const code = rel => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*?\/\/[^\n]*$/gm, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

const { presenceInitial, presenceReducer, presenceEventFor } = await import('../geniePresence.mjs');
const genieMod = await import('../genieMotion.mjs');
const { genieTrack, genieBands, genieBandRows, genieEdges, SLOT_INSET } = genieMod;

// ─── Presence (executed) ────────────────────────────────────────

/**
 * Drives the latch the way GenieModal's effect does: after every change,
 * apply whatever the host's `open` asks for. `closeLands` stands in for the
 * genie finishing. Returns the states it passed through.
 */
function drive(steps) {
  let state = presenceInitial(false);
  let open = false;
  const seen = [];
  const settle = () => {
    for (let i = 0; i < 4; i++) {
      const e = presenceEventFor(state, open);
      if (!e) return;
      state = presenceReducer(state, e);
      seen.push(`${e}:${state.mounted ? (state.closing ? 'closing' : 'shown') : 'gone'}`);
    }
    throw new Error('presence did not settle');
  };
  for (const step of steps) {
    if (step === 'closeLands') {
      state = presenceReducer(state, 'closed');
      seen.push(`closed:${state.mounted ? 'mounted' : 'gone'}`);
    } else {
      open = step === 'open';
    }
    settle();
  }
  return { state, seen };
}

test('presence: open mounts, close keeps the card until the genie lands', () => {
  const { state, seen } = drive(['open', 'close']);
  assert.deepEqual(seen, ['open:shown', 'close:closing']);
  assert.deepEqual(state, { mounted: true, closing: true }, 'still in the DOM while it drains away');
  assert.deepEqual(drive(['open', 'close', 'closeLands']).state, { mounted: false, closing: false });
});

test('presence: a card that starts open pours out on mount', () => {
  assert.deepEqual(presenceInitial(true), { mounted: true, closing: false });
  assert.equal(presenceEventFor(presenceInitial(true), true), null);
});

test('presence: re-opened mid-close, it finishes the close and then pours out afresh', () => {
  const { state, seen } = drive(['open', 'close', 'open']);
  assert.deepEqual(state, { mounted: true, closing: true }, 'never jumps back mid-funnel');
  assert.deepEqual(seen, ['open:shown', 'close:closing']);
  const after = drive(['open', 'close', 'open', 'closeLands']);
  assert.deepEqual(after.state, { mounted: true, closing: false });
  assert.deepEqual(after.seen.slice(-2), ['closed:gone', 'open:shown']);
});

test('presence: one close per open, however often the host says so', () => {
  let s = presenceReducer(presenceInitial(true), 'close');
  assert.equal(presenceReducer(s, 'close'), s);
  assert.equal(presenceEventFor(s, false), null, 'no second close request while closing');
  assert.deepEqual(presenceReducer(presenceInitial(false), 'close'), presenceInitial(false));
  assert.deepEqual(presenceReducer(presenceInitial(false), 'closed'), presenceInitial(false));
});

// ─── The compositor track (executed) ────────────────────────────

const GEOM = { top: 100, bottom: 700, width: 820, slotY: 800 - SLOT_INSET };
const ROWS = genieBandRows(600, 24);
const easeOut = t => 1 - (1 - t) ** 3;

test('track: every held frame is exactly the genie at that moment', () => {
  const tr = genieTrack(1, 0, easeOut, 550, GEOM, ROWS);
  tr.offsets.forEach((t, i) => {
    const p = 1 + (0 - 1) * easeOut(t);
    const want = genieBands(p, GEOM, ROWS);
    want.forEach((m, b) => assert.equal(tr.bands[b][i], m, `band ${b} at offset ${t}`));
  });
});

test('track: at least 120 frames a second, from the first moment to the last', () => {
  for (const ms of [450, 550, 700]) {
    const tr = genieTrack(1, 0, easeOut, ms, GEOM, ROWS);
    assert.ok(tr.offsets.length >= Math.ceil(ms / 1000 * 120) + 1, `${ms} ms -> ${tr.offsets.length} frames`);
    assert.equal(tr.offsets[0], 0);
    assert.equal(tr.offsets.at(-1), 1);
    for (let i = 1; i < tr.offsets.length; i++) assert.ok(tr.offsets[i] > tr.offsets[i - 1]);
  }
});

test('track: a close picked up mid-open starts where the card is, and ends in the slot, gone', () => {
  const tr = genieTrack(0.4, 1, t => t, 450, GEOM, ROWS);
  genieBands(0.4, GEOM, ROWS).forEach((m, b) => assert.equal(tr.bands[b][0], m));
  assert.equal(tr.layerOpacity.at(-1), 0, 'landed and gone');
  assert.equal(tr.shadowOpacity.at(-1), 0, 'the shadow went before the silhouette changed');
});

test('a close never mistakes its own first frames for rest', () => {
  // Its eased progress sits under 0.001 at first; treated as rest, those frames
  // threw away the bands the close had just cut and cut them again (~100 ms).
  assert.ok(hook.includes('const settling = !runRef.current || runRef.current.to === 0;'));
  assert.ok(hook.includes('if ((p <= 0.001 && settling) || !geom) {'));
});

test('the compositor blends dense samples on one clock, eased along a gentle Bezier', () => {
  // Held samples (steps) made a 60 Hz display advance one sample some frames
  // and three others; a strong ease-out crammed the pour into a few frames
  // (the top edge jumped 166 px in one frame).
  assert.ok(hook.includes('values.map((v, i) => ({ ...key(v), offset: track.offsets[i] }));'));
  assert.ok(!hook.includes("easing: 'steps(1, end)'"));
  assert.ok(hook.includes('const GENIE_EASE = [0.33, 0, 0.67, 1]'));
  assert.ok(hook.includes('const GENIE_OPEN  = { duration: 0.65, ease: GENIE_EASE };'));
  assert.ok(hook.includes('const GENIE_CLOSE = { duration: 0.6, ease: GENIE_EASE };'));
  assert.ok(hook.includes('anims.forEach(a => { a.startTime = run.start; });'), 'every band on one clock');
  assert.ok(/requestAnimationFrame\(\(\) => \{\s*if \(runRef\.current !== run \|\| trackRef\.current !== anims\) return;\s*run\.start = timelineNow\(\);\s*run\.anchored = true;/.test(hook),
    'the run is timed from the first frame that renders, so a busy mount cannot make it start part-way through');
  assert.ok(/const composited = rows !== null && trackRef\.current\.length > 0;/.test(hook));
  assert.ok(/if \(!composited\) \{\s*layer\.style\.opacity/.test(hook), 'no main-thread writes while the compositor draws');
  assert.ok(hook.includes('const from = visibleProgress();'), 'a close mid-open starts from what the eye sees');
});

test('track: on the eased clock no genie frame moves the card more than about 60 px at 60 Hz', () => {
  // The Modes card in the launcher. The clock's Bezier, solved the way CSS does.
  const bez = (x1, y1, x2, y2) => x => {
    const bx = t => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
    const by = t => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; }
    return by((lo + hi) / 2);
  };
  const ease = bez(0.33, 0, 0.67, 1);
  const geom = { top: 100, bottom: 700, width: 820, slotY: 794 };
  for (const [ms, from, to, limit] of [[650, 1, 0, 60], [600, 0, 1, 62]]) {
    const frames = Math.round(ms / 1000 * 60);
    let prev = null, worst = 0;
    for (let i = 0; i <= frames; i++) {
      const p = from + (to - from) * ease(i / frames);
      const { top } = genieEdges(p, geom);
      if (prev !== null) worst = Math.max(worst, Math.abs(top - prev));
      prev = top;
    }
    assert.ok(worst <= limit, `${ms} ms: top edge moves ${worst.toFixed(0)} px in one frame`);
  }
});

test('funnel sides: a cubic Bezier with vertical ends and macOS-length handles', () => {
  const { genieSide, SIDE_HANDLE } = genieMod;
  assert.ok(SIDE_HANDLE > 1 / 3, 'longer than smoothstep\'s thirds');
  assert.equal(genieSide(0), 0); assert.equal(genieSide(1), 1);
  assert.ok(Math.abs(genieSide(0.5) - 0.5) < 1e-6, 'symmetric');
  // Vertical at both ends: barely moves in the first and last 5 %.
  assert.ok(genieSide(0.05) < 0.02 && genieSide(0.95) > 0.98);
  // Deeper S than smoothstep: holds its width further, then necks in faster.
  const smooth = u => u * u * (3 - 2 * u);
  assert.ok(genieSide(0.25) < smooth(0.25), 'holds its width further down');
  let prev = 0;
  for (let u = 0.01; u <= 1; u += 0.01) { const k = genieSide(u); assert.ok(k >= prev - 1e-9, 'monotone'); prev = k; }
});
test('GenieModal: the dim and the card are siblings, so the card never fades with the dim', () => {
  const backdrop = modal.slice(modal.indexOf('<motion.div'), modal.indexOf('/>', modal.indexOf('<motion.div')));
  assert.ok(backdrop.includes('opacity: scrim,'), 'the dim fades');
  assert.ok(!backdrop.includes('ref={wrapRef}'), 'and holds nothing');
  assert.ok(/position: 'fixed', inset: 0, zIndex,\s*display: 'flex', alignItems: 'center', justifyContent: 'center',\s*padding, pointerEvents: 'none',/.test(modal),
    'the card rides its own click-through layer');
});

// ─── The hook, for heavy cards (source) ─────────────────────────

const hook = code('components/onboarding/useGenieCard.ts');
const modal = code('components/ui/GenieModal.tsx');


test('hook: copies keep the card\'s height and scroll position', () => {
  assert.ok(hook.includes('height:${height}px;'), 'an h-full card would otherwise take the band\'s height');
  assert.ok(hook.includes('const scrolled = scrolledElements(card);'));
  assert.ok(/layer\.replaceChildren\(frag\);[\s\S]*el\.scrollTop = top;/.test(hook),
    'scroll offsets are applied after the copies are in the document');
});

test('hook: the real card is hidden with opacity as well as visibility mid-genie', () => {
  const bands = hook.slice(hook.indexOf('if (rows) {'), hook.indexOf('const transforms = genieBands'));
  assert.ok(bands.includes("card.style.visibility = 'hidden';"));
  assert.ok(bands.includes("card.style.opacity = '0';"), 'a descendant with visibility: visible shows through a hidden parent');
});

test('hook: a close released by the backstop cannot mark the next open as done', () => {
  assert.ok(hook.includes('Promise.all([a, b]).then(() => { if (!live) return; setDone(true); finishClose(); });'));
  assert.ok(hook.includes('cleanup = () => { live = false; clearTimeout(t); a.stop(); b.stop(); stopTrack(); runRef.current = null; };'));
});

// ─── GenieModal (source) ────────────────────────────────────────

test('GenieModal: content is frozen while the card drains away', () => {
  assert.ok(modal.includes('if (open) frozen.current = children;'));
  assert.ok(modal.includes('const content = open ? children : frozen.current;'));
});

test('GenieModal: onClosed reports after the genie, or at once on a hand-over', () => {
  assert.ok(modal.includes("const landed = () => { dispatch('closed'); onClosedRef.current?.(); };"));
  assert.ok(modal.includes('if (closeInstantlyRef.current) landed();'));
  assert.ok(modal.includes('else closeThen(landed);'));
});

test('GenieModal: the card sits in a measured, untransformed wrap, with the bands beside it', () => {
  assert.ok(/<div\s+ref=\{wrapRef\}/.test(modal));
  assert.ok(/ref=\{bandsRef\}\s*aria-hidden\s*inert/.test(modal));
  assert.ok(modal.includes("...(closing ? { pointerEvents: 'none' } : null)"),
    'clicks pass through while it closes; otherwise the host class decides (Settings\' opacity preview)');
  assert.ok(!/boxShadow: shadow,\s*\.\.\.cardStyle/.test(modal),
    'the card\'s resting shadow is the host\'s: an inline one is wiped by Settings\' opacity preview');
});

// ─── Every popup goes through it (source) ───────────────────────

const POPUPS = {
  'App.tsx': 'Modes / Profile Intelligence manager',
  'components/SettingsOverlay.tsx': 'Settings',
  'components/UpdateModal.tsx': 'Update',
  'components/ReviewModal.tsx': 'Review',
  'components/SupportToaster.tsx': 'Support',
  'components/trial/TrialPromoToaster.tsx': 'Trial promo',
  'components/trial/FreeTrialModal.tsx': 'Trial ended',
};

for (const [file, name] of Object.entries(POPUPS)) {
  test(`${name} opens and closes with the genie`, () => {
    const src = code(file);
    assert.ok(src.includes('<GenieModal'), `${file} renders GenieModal`);
  });
}

// Premium is an optional submodule; its popups are checked when it is present.
const PREMIUM = ['PremiumPromoToaster', 'ProfileFeatureToaster', 'JDAwarenessToaster',
  'MaxUltraUpgradeToaster', 'NativelyApiPromoToaster', 'PremiumUpgradeModal'];
for (const name of PREMIUM) {
  const rel = `../premium/src/${name}.tsx`;
  test(`${name} (premium) opens and closes with the genie`, { skip: !existsSync(resolve(SRC, rel)) && 'premium not checked out' }, () => {
    const src = code(rel);
    assert.ok(src.includes('<GenieModal'));
    assert.ok(!src.includes('<AnimatePresence>'), 'no second, framer-driven entrance for the card');
  });
}

test('onboarding toasters resume once a closing Settings / manager card has gone', () => {
  const app = code('App.tsx');
  assert.ok(app.includes("const t = setTimeout(() => emitOrchestratorEvent({ type: 'launcher:mounted' }), GENIE_CLOSE_MS);"));
  assert.ok(/if \(!surfaceWasOpenRef\.current\) \{\s*emitOrchestratorEvent\(\{ type: 'launcher:mounted' \}\);/.test(app),
    'first mount is not delayed');
});

test('after activation, Profile opens once the upgrade card has gone', () => {
  assert.ok(code('App.tsx').includes('}, GENIE_CLOSE_MS);'));
});

test('popups the host unmounts on dismiss report from onClosed, not before the genie', () => {
  for (const file of ['components/SupportToaster.tsx', 'components/trial/TrialPromoToaster.tsx',
    'components/ReviewModal.tsx', 'components/trial/FreeTrialModal.tsx']) {
    assert.ok(code(file).includes('onClosed='), file);
  }
  const host = code('components/onboarding/OrchestratedToasterHost.tsx');
  const trial = host.slice(host.indexOf('<TrialPromoToaster'), host.indexOf("case 'quiet_window'"));
  assert.ok(!trial.includes("onDismiss('trial_promo')()"), 'the trial toaster reports its own dismiss');
});

test('Update stays mounted so its close can play', () => {
  assert.ok(!/if \(!isVisible\) return null;/.test(code('components/UpdateBanner.tsx')));
});

test('Settings and the manager hand over without two genies at once', () => {
  assert.ok(code('App.tsx').includes('closeInstantly={isSettingsOpen}'));
  assert.ok(code('App.tsx').includes('closeInstantly={isManagerOpen}'));
  assert.ok(code('components/SettingsOverlay.tsx').includes('closeInstantly={closeInstantly}'));
});

test('Settings\' panel inherits visibility, so the genie can hide the real card', () => {
  assert.ok(code('components/SettingsOverlay.tsx').includes("style={{ visibility: isPreviewingOpacity ? 'hidden' : undefined }}"));
});

test('the manager traps Tab on the card itself, and takes focus once it has poured out', () => {
  const app = code('App.tsx');
  assert.ok(app.includes('onKeyDown: handleManagerKeyDown,'));
  assert.ok(app.includes('onOpened={() => managerDialogRef.current?.focus()}'));
});

// ─── The macOS way: one picture, warped (source) ────────────────

const snaps = code('components/onboarding/genieSnapshots.ts');
const mainSnaps = read('../electron/genieSnapshots.ts');
const ipc = read('../electron/ipcHandlers.ts');

test('pictures: the capture reads the calling window\'s own compositor, never the screen', () => {
  assert.ok(ipc.includes("safeHandle('genie-snapshot:capture', async (event, rect) => {"));
  assert.ok(ipc.includes('captureGenieSnapshot(event.sender, rect)'));
  assert.ok(mainSnaps.includes('await sender.capturePage({'));
  assert.ok(!/desktopCapturer|getDisplayMedia/.test(mainSnaps), 'no OS screen capture: content protection would blank it');
});

test('pictures on disk are encrypted, per app version, and pruned', () => {
  assert.ok(mainSnaps.includes("safeStorage.encryptString(png.toString('base64'))"));
  assert.ok(mainSnaps.includes('if (!encrypted()) return true;'), 'without an OS keyring nothing is written');
  assert.ok(mainSnaps.includes("path.join(root(), app.getVersion()"));
  assert.ok(ipc.includes('void pruneOldGenieSnapshots();'));
  assert.ok(/createHash\('sha256'\)\.update\(key\)/.test(mainSnaps), 'a key never becomes a path');
});

test('pictures of Profile Intelligence go when the résumé or JD does', () => {
  const del = ipc.slice(ipc.indexOf("safeHandle('profile:delete',"), ipc.indexOf("safeHandle('profile:get-profile'"));
  assert.ok(del.includes("clearGenieSnapshots('profile')"));
  const jd = ipc.slice(ipc.indexOf("safeHandle('profile:delete-jd',"), ipc.indexOf("safeHandle('profile:delete-jd',") + 1400);
  assert.ok(jd.includes("clearGenieSnapshots('profile')"));
});

test('pictures: never of a card that is loading, covered or mid-landing', () => {
  assert.ok(snaps.includes(`const LOADING = '[aria-busy="true"], [role="progressbar"], .animate-spin, .animate-pulse';`));
  assert.ok(snaps.includes('return isUncovered(card);'));
  assert.ok(modal.includes('const bandsBusy = (genieRef.current?.bandsRef.current?.childElementCount ?? 0) > 0;'),
    'not while the landing picture is still over the card');
  assert.ok(/keepOnCloseRef\.current = card && !pausedRef\.current && landedRef\.current && isSettled\(card\)/.test(modal),
    'the close decides whether to keep its picture while the card can still be hit-tested');
});

test('pictures: the open pours out the view it lands on', () => {
  assert.ok(modal.includes('const view = openingViewRef.current ?? rememberedView(cardKey) ?? viewOf(card);'));
  const settings = code('components/SettingsOverlay.tsx');
  assert.ok(settings.includes('openingView={initialTab}'), 'Settings switches tab in an effect, after the genie picks');
  assert.ok(settings.includes('data-genie-view={activeTab}'));
  assert.ok(settings.includes('snapshotPaused={isPreviewingOpacity}'));
  const app = code('App.tsx');
  assert.ok(app.includes("openingView={(activeManagerPanel ?? lastManagerPanelRef.current) === 'profile' ? 'identity' : undefined}"));
  const profile = code('components/ProfileIntelligenceSettings.tsx');
  assert.ok(profile.includes('data-genie-view={activeSection}'));
  assert.ok(profile.includes('aria-busy={!statusLoaded || profileUploading || jdUploading}'));
});

test('pictures: a close pours away a fresh one; a picture open hands over without a pop', () => {
  assert.ok(hook.includes('const shot = source.forClose().catch(() => null);'));
  assert.ok(hook.includes('Promise.race([shot, late])'), 'it never waits on a capture for long');
  assert.ok(hook.includes('if (landedOn && imageRef.current) holdLanding(imageRef.current);'));
  assert.ok(hook.includes('const ready = (snapshotsRef.current?.settled() ?? true) && now - changedAt >= LANDING_QUIET_MS;'),
    'the picture stays until the live card has loaded AND stopped changing (Modes brings its rows in one by one)');
  assert.ok(hook.includes('if (snap?.transient) snap.bitmap.close();'), 'a picture taken for one close is let go');
});

test('pictures: the Modes manager says when it is loading and which mode it shows', { skip: !existsSync(resolve(SRC, '../premium/src/ModesSettings.tsx')) && 'premium not checked out' }, () => {
  const modes = code('../premium/src/ModesSettings.tsx');
  assert.ok(modes.includes('aria-busy={!modesLoaded || uploading}'));
  assert.ok(modes.includes('data-genie-view={selectedId ?? undefined}'));
});

test('pictures: no picture means the outline genie on the real card, never live copies', () => {
  // Live copies replaying a loading card into each other were the Modes stutter
  // and the GPU tile-memory exhaustion.
  assert.ok(hook.includes('if (snapshotsRef.current && !imageRef.current) bandsFailedRef.current = true;'));
  assert.ok(hook.includes('run(!snap);'), 'a close whose capture did not arrive pours away as the outline');
  assert.ok(hook.includes('bandsFailedRef.current = outlineOnly;'));
});

test('pictures: an unchanged card closes at once on its last picture', () => {
  assert.ok(modal.includes('if (last && !changedSinceShotRef.current && last.key === keyOf(viewOf(card))) return last.snap;'));
  assert.ok(modal.includes("if (records.some(r => r.type !== 'attributes' || (r.target !== card && r.attributeName !== 'style'))) changed();"),
    'a hover recolouring a row inline is not a change (it re-photographed Modes every second)');
});

test('pictures: never of a card scrolled away from its top, and no focus ring round the card', () => {
  assert.ok(modal.includes('if (isScrolled(card)) return;'));
  assert.ok(/isSettled\(card\) && !isScrolled\(card\)/.test(modal));
  assert.ok(snaps.includes("a.playState === 'running' && (a.effect as KeyframeEffect | null)?.getTiming?.().iterations !== Infinity"),
    'a row still fading in is not settled');
  assert.ok(modal.includes("outline: 'none',"), 'Escape drew a focus ring round the whole card as it began to close');
});

test('live copies (the onboarding toasters) carry no ids, test ids or form-control names', () => {
  for (const x of [
    "copy.removeAttribute('id');",
    "copy.removeAttribute('data-testid');",
    "copy.querySelectorAll<HTMLElement>('[name]').forEach(el => el.removeAttribute('name'));",
  ]) assert.ok(hook.includes(x), x);
});

test('the popups no longer cut live copies at all', () => {
  assert.ok(!/genieMirror|genieBandBudget|budget: true/.test(hook + modal), 'mirror and band budget are gone');
  assert.ok(!existsSync(resolve(SRC, 'components/onboarding/genieMirror.ts')));
});

test('pictures never go through an image URL: the launcher CSP blocks blob: images', () => {
  // index.html: img-src 'self' data: https:. A blob: picture decoded in the
  // CSP-less harness and failed every capture in the app.
  const html = read('../index.html');
  assert.ok(/img-src 'self' data: https:/.test(html));
  assert.ok(!/createObjectURL|revokeObjectURL|url\("\$\{/.test(snaps + hook), 'no blob or url() pictures');
  assert.ok(snaps.includes("const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));"));
  assert.ok(hook.includes("band.appendChild(pictureSlice(snap, r0, h, height, radius));"), 'strips are canvases');
  const harness = read('../genieHarness.html');
  assert.ok(harness.includes('Content-Security-Policy'), 'the harness meets the same rules as the app');
});
