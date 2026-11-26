// Show / Hide from the phone (#667).
//
// The phone asks for a state (shown or hidden), never a bare toggle. Both
// platforms show and hide through the same path as Toggle Visibility
// (Cmd+B on macOS, Ctrl+B on Windows), which is a toggle, so the desktop
// turns the asked-for state into "toggle" or "nothing to do". That keeps a
// double tap or a stale phone label from flipping the window back.
//
// Platform-independent: no OS calls here. The toggle itself is
// AppState.toggleMainWindow, shared by both platforms.

/** How long one toggle toward a state is given to land (the overlay collapses for 400 ms first). */
export const REMOTE_VISIBILITY_SETTLE_MS = 1500;

/**
 * A screenshot hides the windows for a moment and brings them back. The phone
 * hears only a state that lasts longer than this, so its button does not
 * flicker to Show and back on every capture.
 */
export const VISIBILITY_RELAY_DELAY_MS = 300;

export interface RemoteVisibilityRequest {
  visible: boolean;
  at: number;
}

export type RemoteVisibilityDecision = 'toggle' | 'none';

/**
 * `target` is what the phone asked for, `current` what the main window is now,
 * `last` the previous request that toggled. A second request for the same
 * state while the first is still landing does nothing: the overlay is still
 * visible during its 400 ms collapse, and toggling again would bring it back.
 */
export function decideRemoteVisibility(
  target: boolean,
  current: boolean,
  last: RemoteVisibilityRequest | null,
  now: number,
): RemoteVisibilityDecision {
  if (target === current) return 'none';
  if (last && last.visible === target && now - last.at >= 0 && now - last.at < REMOTE_VISIBILITY_SETTLE_MS) {
    return 'none';
  }
  return 'toggle';
}

/** What the controller reads off WindowHelper. */
export interface VisibilitySource {
  isVisible(): boolean;
  getCurrentWindowMode(): 'launcher' | 'overlay';
  isOverlayExpanded(): boolean;
}

/**
 * Natively as the user sees it. In overlay mode Toggle Visibility collapses
 * the overlay and hides its window 400 ms later; from the collapse it is
 * gone. Reading the window alone, a Hide tapped in those 400 ms (after
 * Cmd/Ctrl+B on the computer) toggled again and brought the overlay back.
 */
export function isShownToUser(source: VisibilitySource): boolean {
  if (!source.isVisible()) return false;
  return source.getCurrentWindowMode() === 'launcher' || source.isOverlayExpanded();
}

export interface PhoneVisibilityControllerOptions {
  source: VisibilitySource;
  /** The Toggle Visibility path (main: revealAfterMirrorHide + toggleMainWindow). */
  toggle: () => void;
  /**
   * To the phones: PhoneMirrorService.setDesktopVisible. `replyTo` names the
   * phone requests the frame settles (sent even when nothing changed).
   */
  publish: (visible: boolean, force: boolean, replyTo?: string[]) => void;
  now?: () => number;
  relayDelayMs?: number;
  timers?: VisibilityRelayTimers;
}

/**
 * Show / Hide from the phone, end to end: reports what the user sees (held
 * VISIBILITY_RELAY_DELAY_MS) and turns a phone's request into a toggle or
 * nothing. Main wires it to WindowHelper and PhoneMirrorService.
 *
 * Every request with an id is answered exactly once: in the first frame
 * that reports the asked-for state, or after REMOTE_VISIBILITY_SETTLE_MS with
 * the state as it is (someone pressed Cmd/Ctrl+B on the computer meanwhile
 * and it went the other way). The phone stops waiting on the answer, not on
 * the state it hoped for. A request that waits out a screenshot adds at most
 * one more REMOTE_VISIBILITY_SETTLE_MS, so every answer comes within
 * 2 × REMOTE_VISIBILITY_SETTLE_MS, under the phone's 4 s.
 */
export function createPhoneVisibilityController(opts: PhoneVisibilityControllerOptions): {
  /** WindowHelper.onVisibilityChange fired. */
  windowChanged: () => void;
  /** Report the current state now (startup). */
  start: () => void;
  /** A phone asked for `visible`; `id` is answered in a later frame's replyTo. Deferred during a hold. */
  request: (visible: boolean, id?: string) => RemoteVisibilityDecision | 'deferred';
  /**
   * A screenshot capture hides the windows for its whole length (80 ms plus
   * the capture, seconds when it fails, as long as the user takes to draw a
   * crop) and restores them. Between holdStart and holdEnd the phones hear
   * nothing, and a tap waits until the windows are back, so Show never puts
   * Natively into the screenshot. A tap that has waited
   * REMOTE_VISIBILITY_SETTLE_MS is dropped and answered with the state the
   * capture will restore: nothing happens seconds after the phone gave up.
   * Not for the presentation-mirror hide (#630): that one is real, the
   * phones see it.
   */
  holdStart: () => void;
  holdEnd: () => void;
  dispose: () => void;
} {
  const now = opts.now ?? Date.now;
  const timers = opts.timers ?? {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const read = () => isShownToUser(opts.source);
  // Requests still owed an answer.
  const owed = new Map<string, { target: boolean; timer: unknown }>();
  const settle = (which: (target: boolean) => boolean): string[] => {
    const ids: string[] = [];
    for (const [id, o] of owed) {
      if (!which(o.target)) continue;
      timers.clearTimeout(o.timer);
      owed.delete(id);
      ids.push(id);
    }
    return ids;
  };
  const relay = createVisibilityRelay(
    read,
    (v) => {
      const ids = settle((target) => target === v);
      opts.publish(v, false, ids.length ? ids : undefined);
    },
    opts.relayDelayMs,
    timers,
  );
  let holds = 0;
  // What the user had when the hold began: what the capture restores.
  let heldState = false;
  // Requests that came during a hold, run once it ends (or dropped, see holdStart).
  type Waiting = { target: boolean; id?: string; timer: unknown };
  let waiting: Waiting[] = [];
  const owe = (id: string, target: boolean) => {
    const prior = owed.get(id);
    if (prior) timers.clearTimeout(prior.timer);
    owed.set(id, {
      target,
      timer: timers.setTimeout(() => {
        if (!owed.delete(id)) return;
        // During a capture the windows are hidden only for it: answer with
        // what it restores, not with the hide.
        opts.publish(holds > 0 ? heldState : read(), false, [id]);
      }, REMOTE_VISIBILITY_SETTLE_MS),
    });
  };
  // The toggle a repeat must not undo. Cleared once it has landed, so a tap
  // after something else reversed it (Cmd/Ctrl+B, the tray) toggles again.
  let last: RemoteVisibilityRequest | null = null;
  const handle = (target: boolean, id?: string): RemoteVisibilityDecision => {
    const at = now();
    const current = read();
    const decision = decideRemoteVisibility(target, current, last, at);
    if (decision === 'toggle') {
      last = { visible: target, at };
      if (id) owe(id, target);
      opts.toggle();
    } else if (target === current) {
      // Already so: answer now.
      opts.publish(current, true, id ? [id] : undefined);
    } else if (id) {
      // A toggle toward it is landing: answered with it.
      owe(id, target);
    }
    return decision;
  };
  return {
    windowChanged: () => {
      if (holds > 0) return;
      if (last && read() === last.visible) last = null;
      relay.changed();
    },
    start: () => relay.flush(),
    request(target, id) {
      if (holds > 0) {
        const w: Waiting = { target, id, timer: null };
        w.timer = timers.setTimeout(() => {
          const i = waiting.indexOf(w);
          if (i < 0) return;
          waiting.splice(i, 1);
          if (id) opts.publish(heldState, true, [id]);
        }, REMOTE_VISIBILITY_SETTLE_MS);
        waiting.push(w);
        return 'deferred';
      }
      return handle(target, id);
    },
    holdStart: () => {
      if (holds === 0) heldState = read();
      holds += 1;
      relay.dispose();
    },
    holdEnd: () => {
      if (holds === 0) return;
      holds -= 1;
      if (holds > 0) return;
      // Report whatever the restore left (nothing new when it is as before),
      // then the taps that waited, in order.
      relay.changed();
      const queued = waiting;
      waiting = [];
      for (const w of queued) {
        timers.clearTimeout(w.timer);
        handle(w.target, w.id);
      }
    },
    dispose: () => {
      relay.dispose();
      for (const o of owed.values()) timers.clearTimeout(o.timer);
      owed.clear();
      for (const w of waiting) timers.clearTimeout(w.timer);
      waiting = [];
    },
  };
}

export interface VisibilityRelayTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/**
 * Passes the main window's visibility on once it has held for `delayMs`.
 * `read` is asked at that moment, so a hide that was undone in between sends
 * nothing new. `flush` sends the current state at once (a phone asked for the
 * state it already has, and waits for an answer).
 */
export function createVisibilityRelay(
  read: () => boolean,
  publish: (visible: boolean) => void,
  delayMs: number = VISIBILITY_RELAY_DELAY_MS,
  timers: VisibilityRelayTimers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): { changed: () => void; flush: () => void; dispose: () => void } {
  let pending: unknown = null;
  const send = () => {
    pending = null;
    publish(read());
  };
  return {
    changed() {
      if (pending !== null) timers.clearTimeout(pending);
      pending = timers.setTimeout(send, delayMs);
    },
    flush() {
      if (pending !== null) timers.clearTimeout(pending);
      send();
    },
    dispose() {
      if (pending !== null) timers.clearTimeout(pending);
      pending = null;
    },
  };
}
