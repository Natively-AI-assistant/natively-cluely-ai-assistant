// ── Window-swap choreography, renderer half ─────────────────────────────────
//
// The main process owns WHEN each surface moves (electron/WindowHelper.ts,
// "WINDOWS MEETING-SWAP CHOREOGRAPHY"); this file owns HOW it looks. The split
// is deliberate: native window opacity and bounds are driven from a Node timer,
// which is not vsync-locked, so anything the user actually watches move belongs
// in the DOM where the compositor runs it. The main process keeps setOpacity
// binary — it is a content-protection shield, not an effect.
//
// Both installers are no-ops off Windows. macOS is untouched by design: it has
// no opacity shield to hide a pre-entrance state behind, and it presents a
// hidden window's last composited frame on show(), so arming an invisible
// state there risks a flash that cannot be verified from a Windows machine.
// The CSS is gated the same way (html[data-platform="win32"] in index.css), so
// this is belt-and-braces rather than the only gate.
//
// Nothing here touches React. These attributes live on <html> and drive #root,
// which exists from parse time — a component effect would arrive after the
// first painted frame, which is the exact frame that has to be right.

const OVERLAY_ATTR = 'data-overlay-enter';
const LAUNCHER_ATTR = 'data-launcher-transition';

// KEEP IN SYNC with src/index.css. Pinned by
// electron/services/__tests__/WindowsMeetingSwapChoreography2026_08_26.test.mjs.
const OVERLAY_ENTER_MS = 300;
const LAUNCHER_RECEDE_MS = 260;

// The return direction (Stop meeting). Mirrors of the two above; the main
// process owns the authoritative values (WindowHelper.OVERLAY_EXIT_MS /
// LAUNCHER_ENTER_MS) and arms the deferred overlay hide off the first of them,
// so a mismatch here means a window vanishing mid-fade.
const OVERLAY_EXIT_MS = 260;
const LAUNCHER_ENTER_MS = 300;

// If 'play' never arrives, the overlay is parked at opacity 0 with nothing on
// screen — so the watchdog is a correctness backstop, not a nicety, and it is
// short on purpose. The real arm→play gap is the main process's 60 ms shield
// plus a sub-millisecond IPC hop; 150 ms is a wide margin over that and a far
// softer failure than staring at an empty overlay.
const PLAY_WATCHDOG_MS = 150;

// After the recede the launcher window is hidden, so this timer's own reset is
// invisible — it exists so the DOM converges on rest even if BOTH restore
// sends are lost. Firing it while the launcher is somehow still visible is
// also the correct outcome: that only happens on a start that never completed.
const RECEDE_SELF_HEAL_MS = LAUNCHER_RECEDE_MS + 500;

// Same backstop for the overlay's departure. The group's windows are hidden by
// the time this could fire, so its own reset is invisible; it exists so a
// dropped 'rest' cannot leave the group parked at opacity 0 for a later show
// that arms nothing (every switchToOverlay does arm, so this is belt-and-
// braces rather than the only guard).
const EXIT_SELF_HEAL_MS = OVERLAY_EXIT_MS + 500;

const isWindows = (): boolean =>
  document.documentElement.getAttribute('data-platform') === 'win32';

/**
 * Overlay group (shell + pill + toggle) — BOTH directions of the swap.
 *
 * Arrival (meeting start): arms an invisible pre-entrance state while the
 * window is still behind the shield, then plays it the moment the shield lifts.
 *
 * Departure (meeting stop): plays the group out, on top of the launcher rising
 * underneath it. Named `installOverlayEntrance` for continuity with the call
 * site in src/main.tsx; it has owned the exit since the Stop swap stopped being
 * a hard cut.
 */
export function installOverlayEntrance(): void {
  if (!isWindows()) return;
  const root = document.documentElement;
  let watchdog: number | undefined;
  let cleanup: number | undefined;
  let exitSelfHeal: number | undefined;

  const rest = () => {
    window.clearTimeout(watchdog);
    window.clearTimeout(cleanup);
    // Removing the attribute rather than leaving it at "entering" drops the
    // transform, the transition and the will-change together. A lingering
    // transform on #root would keep it a containing block for every
    // position:fixed descendant (dropdowns, toasts) for the rest of the
    // meeting, and would quietly animate any future opacity change.
    root.removeAttribute(OVERLAY_ATTR);
  };

  const arm = () => {
    window.clearTimeout(cleanup);
    // A Start inside the previous Stop's exit window arrives with the group
    // still 'leaving'. Setting 'armed' over it is the correct handoff — same
    // property, same starting point — but the exit's self-heal must not
    // survive to strip the armed attribute out from under the entrance.
    window.clearTimeout(exitSelfHeal);
    root.setAttribute(OVERLAY_ATTR, 'armed');
    // Force the armed state through style recalc NOW. If an arm and a play
    // ever land in the same task, Chromium would coalesce them into a single
    // computed-style change and run no transition at all — the overlay would
    // simply pop in. Reading a layout property makes the armed value the
    // transition's real starting point.
    void root.offsetWidth;
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(play, PLAY_WATCHDOG_MS);
  };

  const play = () => {
    window.clearTimeout(watchdog);
    // Only armed → entering. A stray play at rest must not restart the
    // animation on an overlay the user is already looking at.
    if (root.getAttribute(OVERLAY_ATTR) !== 'armed') return;
    root.setAttribute(OVERLAY_ATTR, 'entering');
    cleanup = window.setTimeout(rest, OVERLAY_ENTER_MS + 80);
  };

  // Departure. The overlay group is the ALWAYS-ON-TOP half of the swap, so
  // unlike the entrance — which is armed behind an opacity shield and is
  // invisible until it plays — this is watched from its very first frame, on
  // top of the launcher rising underneath it. It is the visible half of the
  // cross-fade, not a courtesy fade on something already gone.
  const leave = () => {
    window.clearTimeout(watchdog);
    window.clearTimeout(cleanup);
    window.clearTimeout(exitSelfHeal);
    exitSelfHeal = window.setTimeout(restAfterExit, EXIT_SELF_HEAL_MS);
    // Cancel an entrance still in flight rather than layering a departure on
    // top of it: a Start immediately followed by a Stop would otherwise run
    // both transitions on the same property at once and land wherever the
    // compositor happened to blend them.
    root.setAttribute(OVERLAY_ATTR, 'leaving');
  };

  // Snap back to rest with no transition. Sent by the main process only after
  // the group's windows are hidden, so this is never seen — it exists so the
  // NEXT show does not start from opacity 0. Deliberately not folded into
  // rest(): that one clears timers this path has no business touching.
  const restAfterExit = () => {
    window.clearTimeout(exitSelfHeal);
    if (root.getAttribute(OVERLAY_ATTR) !== 'leaving') return;
    root.removeAttribute(OVERLAY_ATTR);
  };

  window.electronAPI?.onOverlayTransition?.((phase) => {
    if (phase === 'arm') arm();
    else if (phase === 'exit') leave();
    else if (phase === 'rest') restAfterExit();
    else play();
  });

  // Second arming route. Not redundancy for a dropped message — the watchdog
  // covers that — but for a BUSY renderer. main.ts sends 'session-reset' to
  // the overlay before the swap begins, and the overlay's own handler for it
  // unmounts the previous meeting's whole React tree, which can hold the main
  // thread long enough that switchToOverlay's arm queues behind it. This
  // listener is registered here, before React mounts, so it runs FIRST in that
  // same dispatch and the pre-entrance state is committed ahead of the
  // teardown rather than behind it.
  //
  // It does not have to survive until the swap: on a slow start the watchdog
  // will have played it back to rest long before, and switchToOverlay's arm
  // re-arms from scratch. Both orderings are correct; this one is just the
  // cheapest insurance against the one moment the renderer is guaranteed busy.
  window.electronAPI?.onSessionReset?.(() => {
    if (root.getAttribute(OVERLAY_ATTR) === 'entering') return;
    arm();
  });
}

/**
 * Launcher — BOTH directions of the swap.
 *
 * Departure (meeting start): recedes (scale + fade) so the window can be hidden
 * out from under a surface that is already there, instead of cut at full
 * opacity.
 *
 * Arrival (meeting stop): arms and plays its own entrance behind the launcher's
 * opacity shield, mirroring the overlay's. Named `installLauncherRecede` for
 * continuity with the call site in src/main.tsx.
 */
export function installLauncherRecede(): void {
  if (!isWindows()) return;
  const root = document.documentElement;
  let selfHeal: number | undefined;

  const restore = () => {
    window.clearTimeout(selfHeal);
    // Do NOT clobber an entrance. Both directions share this one attribute, and
    // 'restore' is not always the last word: hideLauncherAfterOverlayHandoff()
    // sends one after its deferred hide, up to 260ms late. On a Stop→Start→Stop
    // inside that window it can land AFTER the next switchToLauncher has already
    // armed the arrival — stripping 'arriving' out from under it, so enter()
    // early-returns on its own guard and the launcher appears with no animation
    // at all. Silent, and on exactly the fast cadence this choreography is for.
    //
    // Bailing is correct rather than merely safe: an entrance in flight means
    // some later call already took ownership of this attribute, and the recede
    // that queued this restore is by then two swaps stale.
    const current = root.getAttribute(LAUNCHER_ATTR);
    if (current === 'arriving' || current === 'entering') return;
    // Instantaneous by construction: the CSS puts a transition ONLY on the
    // receding state, so dropping the attribute snaps back in one frame. That
    // matters because the restore usually lands while the window is hidden or
    // one frame before it is shown — an animated un-recede would be visible
    // as a zoom-in on a launcher that is supposed to have been sitting there
    // all along.
    root.removeAttribute(LAUNCHER_ATTR);
  };

  const recede = () => {
    root.setAttribute(LAUNCHER_ATTR, 'receding');
    window.clearTimeout(selfHeal);
    selfHeal = window.setTimeout(restore, RECEDE_SELF_HEAL_MS);
  };

  // ── Arrival (Stop meeting) ────────────────────────────────────────────────
  // The launcher's own entrance, which only exists on the way back. Same
  // arm-behind-the-shield/play-on-the-lift shape as the overlay's, and it
  // needs the same forced style recalc for the same reason: an arm and an
  // enter landing in one task would be coalesced into a single computed-style
  // change and run no transition at all.
  let enterWatchdog: number | undefined;
  let enterCleanup: number | undefined;

  const settle = () => {
    window.clearTimeout(enterWatchdog);
    window.clearTimeout(enterCleanup);
    // Removed, not parked at "entering" — a lingering transform on body would
    // keep it a containing block for every position:fixed descendant for the
    // rest of the session, and would quietly animate any later opacity change.
    root.removeAttribute(LAUNCHER_ATTR);
  };

  const armEnter = () => {
    window.clearTimeout(selfHeal);
    window.clearTimeout(enterCleanup);
    window.clearTimeout(enterWatchdog);
    root.setAttribute(LAUNCHER_ATTR, 'arriving');
    void root.offsetWidth;
    window.clearTimeout(enterWatchdog);
    // Same correctness backstop as the overlay's: if 'enter' never arrives the
    // launcher is parked invisible with nothing else on screen, so the
    // watchdog is not a nicety. Sized the same way — the real arm→enter gap is
    // the main process's 60ms shield plus an IPC hop.
    enterWatchdog = window.setTimeout(enter, PLAY_WATCHDOG_MS);
  };

  const enter = () => {
    window.clearTimeout(enterWatchdog);
    // Only arriving → entering. A stray enter at rest must not replay the
    // animation on a launcher the user is already looking at.
    if (root.getAttribute(LAUNCHER_ATTR) !== 'arriving') return;
    root.setAttribute(LAUNCHER_ATTR, 'entering');
    enterCleanup = window.setTimeout(settle, LAUNCHER_ENTER_MS + 80);
  };

  window.electronAPI?.onLauncherTransition?.((phase) => {
    if (phase === 'recede') recede();
    else if (phase === 'arm') armEnter();
    else if (phase === 'enter') enter();
    else restore();
  });
}
