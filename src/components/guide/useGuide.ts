// First-run guide, renderer side: follow the state main keeps
// (electron/ipcHandlers.ts guide:get / guide:dispatch / guide:changed) and
// report what this window saw. Rules live in src/lib/onboarding/firstRunGuide.mjs.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuideEvent, GuideState } from '../../lib/onboarding/firstRunGuide.mjs';
import { GUIDE_DONE_HOLD_MS, guideStopLockLeft } from '../../lib/onboarding/firstRunGuide.mjs';
import { useT } from '../../i18n';
import { guideKeys } from '../../lib/onboarding/guideKeys.mjs';
import { isMac, isWindows } from '../../utils/platformUtils';

export type { GuideEvent, GuideState, GuideStepId } from '../../lib/onboarding/firstRunGuide.mjs';

const DONE_MS = GUIDE_DONE_HOLD_MS;
/** The leaving beat at the end of the hold (guide.css: --g-close). */
const LEAVE_MS = 160;

/** Count of guides in this document mid-leave: <html data-guide-leaving> while any is. */
let leavingCount = 0;
function markLeaving(on: boolean): void {
  leavingCount = Math.max(0, leavingCount + (on ? 1 : -1));
  if (leavingCount > 0) document.documentElement.setAttribute('data-guide-leaving', '');
  else document.documentElement.removeAttribute('data-guide-leaving');
}

/** Report an event to main. Safe to call from any window, any number of times. */
export function dispatchGuide(event: GuideEvent): void {
  window.electronAPI?.guideDispatch?.(event)?.catch?.(() => {});
}

/**
 * The guide as this window should draw it. When the step moves on, the step
 * that was just finished stays on screen for a second marked done (`justDone`),
 * leaves (the last 160 ms, <html data-guide-leaving>: guide.css), then the next
 * one shows. A skip leaves at once, with no "Done".
 */
export function useGuide(): { state: GuideState | null; justDone: boolean; dispatch: (e: GuideEvent) => void } {
  const [shown, setShown] = useState<GuideState | null>(null);
  const [justDone, setJustDone] = useState(false);
  const shownRef = useRef<GuideState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaving = useRef(false);

  const setLeaving = useCallback((on: boolean) => {
    if (leaving.current === on) return;
    leaving.current = on;
    markLeaving(on);
  }, []);

  const accept = useCallback((next: GuideState | null | undefined) => {
    if (!next) return;
    const prev = shownRef.current;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    const advanced = !!prev && prev.status === 'active' && (next.step !== prev.step || next.status !== 'active');
    const show = () => {
      timer.current = null;
      shownRef.current = next;
      setShown(next);
      setJustDone(false);
      setLeaving(false);
    };
    if (advanced && next.status === 'skipped') {
      // Skipped: nothing was done, so no tick; it just gets out of the way.
      setLeaving(true);
      timer.current = setTimeout(show, LEAVE_MS);
      return;
    }
    if (advanced) {
      // Hold the finished step marked done, let it leave, then show where the guide went.
      setJustDone(true);
      leaveTimer.current = setTimeout(() => { leaveTimer.current = null; setLeaving(true); }, DONE_MS - LEAVE_MS);
      timer.current = setTimeout(show, DONE_MS);
      return;
    }
    show();
  }, [setLeaving]);

  useEffect(() => {
    let alive = true;
    window.electronAPI?.guideGet?.().then((s) => { if (alive) accept(s); }).catch(() => {});
    const off = window.electronAPI?.onGuideChanged?.((s) => accept(s));
    return () => {
      alive = false;
      off?.();
      if (timer.current) clearTimeout(timer.current);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      setLeaving(false);
    };
  }, [accept, setLeaving]);

  return { state: shown, justDone, dispatch: dispatchGuide };
}

/** The guide is running and on one of these steps. */
/**
 * The first guide meeting's Stop lock, for a Stop button to show (main
 * refuses the Stop itself: ipcHandlers end-meeting). Read straight from the
 * broadcasts, not through useGuide's done hold, so the button locks the moment
 * the meeting starts. `seconds` is 0 when Stop works.
 */
export function useGuideStopLock(): { seconds: number; label: string } {
  const tr = useT();
  const [until, setUntil] = useState<GuideState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    window.electronAPI?.guideGet?.().then((s) => { if (alive && s) setUntil(s); }).catch(() => {});
    const off = window.electronAPI?.onGuideChanged?.((s) => { if (s) { setUntil(s); setNow(Date.now()); } });
    return () => { alive = false; off?.(); };
  }, []);
  const left = guideStopLockLeft(until, now);
  useEffect(() => {
    if (left <= 0) return;
    // Wakes on each whole second left, then once more to unlock.
    const t = setTimeout(() => setNow(Date.now()), (left % 1000) || 1000);
    return () => clearTimeout(t);
  }, [left]);
  const seconds = Math.ceil(left / 1000);
  return { seconds, label: seconds > 0 ? tr('Stop unlocks in {n} s').replace('{n}', String(seconds)) : '' };
}

export function guideOn(state: GuideState | null, ...steps: GuideState['step'][]): boolean {
  return !!state && state.status === 'active' && steps.includes(state.step);
}

const PLATFORM = isMac ? 'darwin' : isWindows ? 'win32' : 'linux';

/** Keycaps for a keybind id, from the user's real bindings (⌘ on macOS, Ctrl on Windows). */
export function useGuideKeys(enabled: boolean): (id: string) => string[] {
  const [bindings, setBindings] = useState<{ id: string; accelerator: string }[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    window.electronAPI?.getKeybinds?.().then((list) => { if (alive) setBindings(list ?? null); }).catch(() => {});
    const off = window.electronAPI?.onKeybindsUpdate?.((list) => setBindings(list ?? null));
    return () => { alive = false; off?.(); };
  }, [enabled]);
  return useCallback((id: string) => guideKeys(bindings, id, PLATFORM), [bindings]);
}

/** How long layout is followed frame by frame after something moved. */
const FOLLOW_MS = 600;
/** The slow check while nothing seems to move (a control can still appear). */
const IDLE_CHECK_MS = 1000;

/**
 * Calls `tick` now, then every frame only while the page may be moving: for
 * FOLLOW_MS after a DOM change, a resize, a scroll or a CSS transition or
 * animation starting or ending, and once a second otherwise. The tip, its
 * arrow and the lit ring used to read layout every frame for as long as the
 * guide ran (three loops at once on the launcher); this spends frames only
 * where something moves. The guide's own data-guide-lit is not watched, so
 * lighting a control never wakes it.
 */
function followLayout(tick: () => void): () => void {
  let raf = 0;
  let until = 0;
  const frame = () => {
    raf = 0;
    tick();
    if (performance.now() < until) raf = requestAnimationFrame(frame);
  };
  const burst = () => {
    until = performance.now() + FOLLOW_MS;
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const mo = new MutationObserver(burst);
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-expanded', 'data-state'],
  });
  const events = ['resize', 'scroll', 'transitionrun', 'transitionend', 'animationstart', 'animationend'] as const;
  events.forEach((e) => window.addEventListener(e, burst, true));
  const idle = setInterval(tick, IDLE_CHECK_MS);
  tick();
  burst();
  return () => {
    if (raf) cancelAnimationFrame(raf);
    mo.disconnect();
    events.forEach((e) => window.removeEventListener(e, burst, true));
    clearInterval(idle);
  };
}

/** The first visible match of `selector`, or null. */
function firstVisible(selector: string): Element | null {
  return [...document.querySelectorAll(selector)].find((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;
}

/**
 * Light up the real control: `data-guide-lit` on the first visible match of
 * `selector`, and on nothing else. Followed as the page changes, because the
 * control can mount, move or re-render under the guide. null clears it.
 */
export function useGuideLit(selector: string | null): void {
  useEffect(() => {
    const clear = (keep?: Element | null) => {
      document.querySelectorAll('[data-guide-lit]').forEach((el) => { if (el !== keep) el.removeAttribute('data-guide-lit'); });
    };
    if (!selector) { clear(); return; }
    const stop = followLayout(() => {
      const el = firstVisible(selector);
      clear(el);
      if (el && !el.hasAttribute('data-guide-lit')) el.setAttribute('data-guide-lit', '');
    });
    return () => { stop(); clear(); };
  }, [selector]);
}

/** The anchor's box, followed as the page changes; null while it is not on screen. */
export function useAnchorRect(selector: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selector) { setRect(null); return; }
    let last = '';
    return followLayout(() => {
      const el = firstVisible(selector);
      let r = el ? el.getBoundingClientRect() : null;
      // Covered (Settings or a dialog over it): no anchor, so no card pointing
      // at something the user cannot see. The guide's own card does not count.
      if (el && r) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && !el.contains(hit) && !hit.closest('[data-guide-card]')) r = null;
      }
      const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
      if (key !== last) { last = key; setRect(r); }
    });
  }, [selector]);
  return rect;
}
