/**
 * GenieModal.test.mjs
 *
 * Every launcher popup (Settings, the Modes / Profile Intelligence manager,
 * Update, Review, the trial and support cards, and the notices in the
 * bottom-right corner) opens and closes with the same macOS genie as the
 * browser-extension toaster, through GenieModal.
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
  assert.equal(tr.shadowOpacity.at(-1), 0, 'the shadow is gone by the time the card is in the slot');
});

// The stand-in is a rectangle, and a box-shadow is cut off at its element's
// edge, so wherever the card has pinched in from that rectangle the shadow
// draws the rectangle's outline around it: the finished card's border, there
// before the card is. `1 - stretch` kept it at 86 % a tenth of a second into
// a close, with the Settings card already 50 px in on each side.
test('track: the shadow never outlines a card that has already pinched in', () => {
  const { genieHalfWidthAt } = genieMod;
  const shapes = {
    'centred, wide': { top: 100, bottom: 700, width: 820, slotY: 800 - SLOT_INSET },
    'centred, narrow': { top: 250, bottom: 550, width: 320, slotY: 800 - SLOT_INSET },
    'bottom-right notice': { top: 636, bottom: 776, width: 320, slotY: 800 - SLOT_INSET },
    'tall, in a short window': { top: 40, bottom: 560, width: 900, slotY: 600 - SLOT_INSET },
  };
  // How far in the silhouette is at its bottom edge, where it pinches most.
  const pinch = (p, geom) => geom.width / 2 - genieHalfWidthAt(p, geom, genieEdges(p, geom).bottom);
  const worst = [];
  for (const [name, geom] of Object.entries(shapes)) {
    const rows = genieBandRows(Math.round(geom.bottom - geom.top), 24);
    for (const [from, to] of [[1, 0], [0, 1], [0.4, 1]]) {
      for (const ease of [t => t, easeOut]) {
        const tr = genieTrack(from, to, ease, 600, geom, rows);
        tr.offsets.forEach((t, i) => {
          const p = from + (to - from) * ease(t);
          const shown = tr.shadowOpacity[i] * pinch(p, geom);
          if (shown > 2) worst.push(`${name} ${from}->${to} t=${t.toFixed(3)}: opacity ${tr.shadowOpacity[i].toFixed(2)} x ${pinch(p, geom).toFixed(1)} px`);
        });
      }
    }
  }
  assert.deepEqual(worst.slice(0, 5), [], `${worst.length} frames outline a pinched card`);
});

test('track: the shadow is whole at rest, and the outline genie fades it the same way', () => {
  const open = genieTrack(1, 0, easeOut, 600, GEOM, ROWS);
  assert.equal(open.shadowOpacity.at(-1), 1, 'the card lands with its whole shadow, for the class one to take over');
  assert.equal(open.shadowOpacity[0], 0);
  assert.ok(hook.includes('shadow.style.opacity = String(genieShadowOpacity(p, geom));'),
    'the main-thread outline genie uses the same fade as the compositor track');
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
  assert.ok(/position: 'fixed', inset: 0, zIndex,\s*display: 'flex',\s*alignItems: placement === 'bottom-right' \? 'flex-end' : 'center',\s*justifyContent: placement === 'bottom-right' \? 'flex-end' : 'center',\s*padding, pointerEvents: 'none',/.test(modal),
    'the card rides its own click-through layer, centred unless it is a corner notice');
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
  'components/NativelyQuotaBanner.tsx': 'Quota notice',
  'components/HindsightStatusBanner.tsx': 'Long-term memory notice',
  'components/ProviderChangeNotice.tsx': 'Provider change / re-index notice',
};

for (const [file, name] of Object.entries(POPUPS)) {
  test(`${name} opens and closes with the genie`, () => {
    const src = code(file);
    assert.ok(src.includes('<GenieModal'), `${file} renders GenieModal`);
  });
}

// Premium is an optional submodule; its popups are checked when it is present.
const PREMIUM = ['ProfileFeatureToaster', 'JDAwarenessToaster',
  'MaxUltraUpgradeToaster', 'NativelyApiPromoToaster'];
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
  assert.ok(/keepOnCloseRef\.current = card && keepRef\.current && !pausedRef\.current && landedRef\.current && isSettled\(card\)/.test(modal),
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
  assert.ok(modal.includes('if (keepRef.current && last && !changedSinceShotRef.current && last.key === keyOf(viewOf(card))) return last.snap;'));
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

// ─── Notices in the corner ──────────────────────────────────────

test('corner notice: pours straight down into a slot under itself, gently, and is gone in it', () => {
  const { genieHalfWidthAt, SLOT_WIDTH } = genieMod;
  // The quota card: 320 x 170, 24 px in from the corner of an 800 px window.
  const geom = { top: 800 - 24 - 170, bottom: 800 - 24, width: 320, slotY: 800 - SLOT_INSET };
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const track = genieTrack(0, 1, ease, 600, geom, genieBandRows(170, 22));
  assert.equal(track.layerOpacity.at(-1), 0, 'gone in the slot');
  // The funnel is the card's own column: never wider than the card, and at
  // the slot exactly the slot's width, however close the card sits to it.
  for (const p of [0.2, 0.45, 0.7, 1]) {
    for (let y = geom.top; y <= geom.slotY; y += 4) {
      assert.ok(genieHalfWidthAt(p, geom, y) <= geom.width / 2 + 1e-9, `p ${p}, y ${y}`);
    }
  }
  assert.ok(Math.abs(genieHalfWidthAt(1, geom, geom.slotY) - SLOT_WIDTH / 2) < 1e-9);
  let prev = null, worst = 0;
  for (let i = 0; i <= 36; i++) {
    const { top } = genieEdges(ease(i / 36), geom);
    if (prev !== null) worst = Math.max(worst, Math.abs(top - prev));
    prev = top;
  }
  assert.ok(worst <= 60, `top edge moves ${worst.toFixed(0)} px in one 60 Hz frame`);
});

test('GenieModal: a notice has no dim, so the app stays usable around it', () => {
  assert.ok(/\{modal && \(\s*<motion\.div\s+id=\{backdropId\}/.test(modal), 'the dim is only a modal\'s');
  assert.ok(modal.includes("snapshotKey, openingView, snapshotPaused = false, keepPictures = true, modal = true, placement = 'center',"),
    'a modal, centred, keeping pictures, unless the host says otherwise');
});

test('the corner notices go through GenieModal as notices, and stay mounted so the close can play', () => {
  const quota = code('components/NativelyQuotaBanner.tsx');
  assert.ok(!/if \(!visible\) return null;/.test(quota), 'no early return before the genie');
  const hind = code('components/HindsightStatusBanner.tsx');
  const floating = hind.slice(hind.indexOf("if (variant === 'floating-card') {"));
  assert.ok(hind.indexOf("if (variant === 'floating-card') {") < hind.indexOf("if (!status || status.state === 'ready' || dismissed) return null;"),
    'the floating card is decided before the early returns');
  assert.ok(floating.includes("cardProps={{ role: 'status', 'aria-live': 'polite', 'data-genie-view': view }}"), 'still announced politely');
  const app = code('App.tsx');
  const notice = code('components/ProviderChangeNotice.tsx');
  assert.ok(/<ProviderChangeNotice\s+open=\{isDefault && \(!!incompatibleWarning \|\| !!reindexShown\)\}\s+warning=\{incompatibleWarning\}\s+progress=\{reindexShown\}/.test(app),
    'warning and re-index are one card');
  for (const [src, where] of [[quota, 'quota'], [floating, 'hindsight'], [notice, 'provider change']]) {
    assert.ok(src.includes('modal={false}') && src.includes('placement="bottom-right"'), `${where}: a notice in the corner`);
  }
  assert.ok(!/<AnimatePresence>\s*\{(incompatibleWarning|reindexProgress) && isDefault/.test(app), 'no framer entrance left for either');
  // Re-index turns the warning into progress in place: the card does not close in between.
  assert.ok(app.includes('setReindexPending(incompatibleWarning?.count ?? 0);\n      setIncompatibleWarning(null);'));
});

// ─── Pictures: only of what the next open shows ─────────────────

test('pictures: a card whose content is new each time keeps none', () => {
  assert.ok(/forOpen: \(\) => \{\s*const card = genieRef\.current\?\.cardRef\.current;\s*if \(!card \|\| !keepRef\.current\) return null;/.test(modal), 'no picture to open with');
  assert.ok(modal.includes('keepOnCloseRef.current = card && keepRef.current &&'), 'none kept at the close');
  assert.ok(modal.includes('if (!open || !shown || !keepPictures || !genieEnabled) return;'), 'none taken while open (nor with the genie turned off in Settings)');
  assert.ok(modal.includes('if (keepRef.current && last && !changedSinceShotRef.current'), 'the close never reuses a picture from before they were turned off');
  assert.ok(code('components/NativelyQuotaBanner.tsx').includes('keepPictures={false}'), 'quota readings');
  assert.ok(code('components/trial/FreeTrialModal.tsx').includes('keepPictures={false}'), 'trial usage');
  assert.ok(code('components/ProviderChangeNotice.tsx').includes('keepPictures={false}'), 'provider change / re-index counts');
});

test('pictures: a card showing one of several things is keyed by which', () => {
  const update = code('components/UpdateModal.tsx');
  assert.ok(update.includes("const genieView = `${displayVersion}|${status}|${instructionsArch ?? ''}`;"));
  assert.ok(update.includes('openingView={genieView}') && update.includes("cardProps={{ 'data-genie-view': genieView }}"));
  assert.ok(update.includes("keepPictures={status === 'idle' || status === 'ready' || status === 'instructions'}"), 'never of a download or an error');
  const hind = code('components/HindsightStatusBanner.tsx');
  assert.ok(hind.includes("const view = status ? `${status.state}|${hashOf(status.reason ?? '')}` : undefined;"), 'state, and the reason hashed');
});

test('pictures: a card that opens reset keeps only its untouched picture', () => {
  assert.ok(code('components/ReviewModal.tsx').includes('keepPictures={step === "review" && rating === 0 && hoverRating === 0 && !text}'));
  // The trial promo is remounted fresh for every showing: a picture of it
  // starting, or of a failed start's error, is never what the next one shows.
  assert.ok(code('components/trial/TrialPromoToaster.tsx').includes('keepPictures={!starting && !error}'));
});

test('pictures (premium): the Natively API card has one picture per variant', { skip: !existsSync(resolve(SRC, '../premium/src/NativelyApiPromoToaster.tsx')) && 'premium not checked out' }, () => {
  // 'new' (no provider keys) and 'existing' share one layout and one size, so
  // without the variant in the key, adding a first key poured out the other copy.
  const nap = code('../premium/src/NativelyApiPromoToaster.tsx');
  assert.ok(nap.includes('openingView={variant ?? undefined}'));
  assert.ok(nap.includes("'data-genie-view': variant ?? undefined,"));
  assert.ok(nap.includes('const visible = isOpen && variant !== null;'), 'the variant is known before the card opens');
});

// ─── Pictures in memory (executed) ──────────────────────────────

// genieSnapshots.ts is TypeScript with no imports; a Node that strips types
// (22.18+, 23.6+) runs it directly. Older ones skip.
let snapsMod = null;
try { snapsMod = await import('../genieSnapshots.ts'); } catch { /* no type stripping */ }

test('pictures in memory: this theme only, newest first, held to a budget, least recently used out', { skip: !snapsMod && 'this Node cannot import .ts' }, async () => {
  // Settings-sized pictures: 896 x 640 at 2x is 9.2 MB decoded, so 7 fit in 64 MiB.
  const W = 896, H = 640, DPR = 2;
  const key = (view, theme = 'dark') => `settings|${view}|${W}x${H}|${theme}|en|${DPR}`;
  const listed = [
    ...Array.from({ length: 10 }, (_, i) => key(`tab${i}`)),   // oldest first
    key('tab0', 'light'),                                       // another theme: never matches now
  ];
  const decoded = [];
  const saved = [];
  globalThis.window = {
    devicePixelRatio: DPR,
    electronAPI: {
      genieSnapshotList: async () => listed,
      genieSnapshotLoad: async k => { decoded.push(k); return new Uint8Array([1]); },
      genieSnapshotCapture: async () => ({ png: new Uint8Array([2]), width: W * DPR, height: H * DPR }),
      genieSnapshotSave: async k => { saved.push(k); return true; },
    },
  };
  globalThis.document = {
    visibilityState: 'visible',
    documentElement: { getAttribute: a => (a === 'data-theme' ? 'dark' : a === 'lang' ? 'en' : null), classList: { contains: () => false } },
  };
  globalThis.createImageBitmap = async () => ({ width: W * DPR, height: H * DPR, close() {} });
  try {
    await snapsMod.warmGenieSnapshots();
    assert.ok(!decoded.includes(key('tab0', 'light')), 'another theme is never decoded');
    assert.deepEqual(decoded, [3, 4, 5, 6, 7, 8, 9].map(i => key(`tab${i}`)), 'the newest seven, the most the budget holds');
    assert.equal(snapsMod.getGenieSnapshot(key('tab2')), null, 'older ones stay on disk');
    // Used: tab3 becomes the most recent. A new capture then evicts tab4, the
    // least recently used, not tab3.
    assert.ok(snapsMod.getGenieSnapshot(key('tab3')));
    const card = { getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) };
    assert.ok(await snapsMod.captureGenieSnapshot(card, key('tab10')));
    assert.deepEqual(saved, [key('tab10')]);
    assert.ok(snapsMod.getGenieSnapshot(key('tab10')), 'the new one is held');
    assert.ok(snapsMod.getGenieSnapshot(key('tab3')), 'the used one stays');
    assert.equal(snapsMod.getGenieSnapshot(key('tab4')), null, 'the least recently used goes');
    // A close's picture is only returned, never held.
    const close = await snapsMod.captureGenieSnapshot(card, null);
    assert.equal(close.transient, true);
  } finally {
    delete globalThis.window; delete globalThis.document; delete globalThis.createImageBitmap;
  }
});

test('the main process lists pictures oldest first, so the renderer can warm the newest', () => {
  const main = read('../electron/genieSnapshots.ts');
  assert.ok(/if \(encrypted\(\)\) for \(const e of await loadIndex\(\)\) keys\.add\(e\.key\);\s*for \(const k of memory\.keys\(\)\) keys\.add\(k\);/.test(main));
  assert.ok(main.includes('others.sort((a, b) => a.savedAt - b.savedAt);'), 'the index is kept in save order');
});

// ─── Follow-ups to the shadow fix (2026-09-25) ──────────────────

test('a close hands over from the real card as the bands appear, not a frame later', () => {
  // Until the clock's first change the card and its shadow stayed up under the
  // stand-in: one frame of both shadows at the start of every close.
  const run = hook.slice(hook.indexOf('const run = (outlineOnly: boolean) => {'), hook.indexOf('const a = animate(genie, 1'));
  assert.ok(run.includes('if (!reduced && rowsRef.current) renderGenie(from);'));
  assert.ok(run.indexOf('renderGenie(from)') > run.indexOf('bandsFailedRef.current = !buildBands();'), 'after the bands are cut');
});

test('a kept picture never holds a hovered control or a focus ring', { skip: !snapsMod && 'no type stripping' }, () => {
  const { showsTransientState } = snapsMod;
  const control = { closest: () => control };
  const plain = { closest: () => null };
  const cardOf = ({ focus = null, hovered = [] } = {}) => {
    const card = {
      querySelector: sel => (sel === ':focus-visible' ? focus : null),
      querySelectorAll: sel => (sel === ':hover' ? hovered : []),
      contains: el => el === control || el === plain,
    };
    return card;
  };
  assert.equal(showsTransientState(cardOf()), false, 'nothing hovered or focused');
  assert.equal(showsTransientState(cardOf({ hovered: [plain] })), false, 'the pointer on plain content');
  assert.equal(showsTransientState(cardOf({ hovered: [plain, control] })), true, 'the pointer on a tab or button');
  assert.equal(showsTransientState(cardOf({ focus: control })), true, 'a keyboard focus ring');
  // The card itself matching (a focusable card) must not block every picture.
  const self = cardOf({ hovered: [plain] });
  plain.closest = () => self;
  assert.equal(showsTransientState(self), false);
  plain.closest = () => null;
  assert.ok(modal.includes('|| !isSettled(card) || showsTransientState(card)) { schedule(400); return; }'), 'the settle loop waits');
  assert.ok(/isSettled\(card\) && !isScrolled\(card\)\s*&& !showsTransientState\(card\)/.test(modal), 'a close keeps no such picture');
});

test('a confirm asked from inside Settings opens above it', () => {
  // At the shared dialog's z-50 it opened behind Settings (GenieModal, 300):
  // invisible, while its modal dim swallowed every click.
  const confirm = code('components/ui/ConfirmDialog.tsx');
  const layer = Number(confirm.match(/const CONFIRM_LAYER = (\d+);/)?.[1]);
  const genieLayer = Number(modal.match(/zIndex = (\d+),/)?.[1]);
  assert.ok(layer > genieLayer, `${layer} > ${genieLayer}`);
  assert.equal((confirm.match(/style=\{\{ zIndex: CONFIRM_LAYER \}\}/g) || []).length, 2, 'the dim and the panel both');
});

// Settings → Advanced → "Genie animation" off: every card falls back to the
// reduced-motion fade, and no picture is decoded ahead of time or taken.
test('the genie setting stands the animation down and stops its pictures', () => {
  const hook = code('components/onboarding/useGenieCard.ts');
  assert.ok(/const reduced = \(useReducedMotion\(\) \?\? false\) \|\| !genieEnabled;/.test(hook), 'off takes the reduced-motion path');
  assert.ok(modal.includes('useEffect(() => { if (genieEnabled) void warmGenieSnapshots(); }, [genieEnabled]);'), 'no pictures decoded ahead of time');
  const settings = code('components/SettingsOverlay.tsx');
  assert.ok(settings.includes("label={t('Genie animation')}") && settings.includes('setGenieAnimationEnabled(!genieAnimationEnabled)'), 'the toggle lives in Settings');
});
