import { useEffect, useMemo, useRef, useState } from 'react';
import TopPill from './ui/TopPill';
import ResizeToggle from './ui/ResizeToggle';
import { getGlassOverlayAppearance, getOverlayAppearance } from '../lib/overlayAppearance';

// ── Overlay auxiliary window roots ──────────────────────────────────────────
// The TopPill and the resize toggle each live in their OWN tiny BrowserWindow
// (hug-at-rest phase 2): the main overlay window is exactly the shell card, so
// its rectangle contains no transparent-but-interactive region, and these two
// pieces of floating chrome get pixel-sized windows of their own. The main
// process (WindowHelper.createOverlayAuxWindows) owns geometry and visibility;
// these roots own rendering and user actions.
//
// State flows one way: the overlay renderer broadcasts OverlayUiState over
// 'overlay-ui-state' (relayed + cached by the main process, replayed on
// (re)load); user actions flow back over 'overlay-ui-action' to the overlay
// renderer, which invokes the exact same handlers the inline components used.

export interface OverlayUiState {
  /** Vertical show/hide (Cmd+B) — mirrors NativelyInterface's isExpanded. */
  expanded?: boolean;
  /** Whether the shell is at its wide width — drives the toggle's icon. */
  shellWide?: boolean;
  /** messages.length > 0 — main-process side gates toggle-window visibility. */
  hasContent?: boolean;
  overlayOpacity?: number;
  themeMode?: 'light' | 'dark';
  interfaceTheme?: 'default' | 'liquid-glass' | 'modern';
}

const DEFAULT_STATE: Required<Omit<OverlayUiState, 'hasContent'>> & OverlayUiState = {
  expanded: true,
  shellWide: false,
  overlayOpacity: 1,
  themeMode: 'dark',
  interfaceTheme: 'default',
};

function useOverlayUiState(): OverlayUiState {
  const [state, setState] = useState<OverlayUiState>(DEFAULT_STATE);
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onOverlayUiState?.((next) =>
      setState((prev) => ({ ...prev, ...(next as OverlayUiState) })),
    );
    return () => unsubscribe?.();
  }, []);
  return state;
}

function useOverlayAuxAppearance(state: OverlayUiState) {
  const { interfaceTheme, overlayOpacity, themeMode } = state;
  return useMemo(
    () =>
      interfaceTheme === 'liquid-glass'
        ? getGlassOverlayAppearance()
        : getOverlayAppearance(overlayOpacity ?? 1, themeMode === 'light' ? 'light' : 'dark'),
    [interfaceTheme, overlayOpacity, themeMode],
  );
}

const sendAction = (type: string) => {
  window.electronAPI?.sendOverlayUiAction?.({ type }).catch(() => {});
};

// Clicking the pill or toggle counts as "outside the dropdowns" — dismiss any
// open settings/model-selector popover, exactly like a click on the overlay
// body would (these are separate windows, so the overlay's own mousedown
// handler can't see clicks here).
function useDismissPopoversOnMouseDown() {
  useEffect(() => {
    const onMouseDown = () => {
      window.electronAPI?.dismissOverlayPopovers?.().catch(() => {});
    };
    window.addEventListener('mousedown', onMouseDown, true);
    return () => window.removeEventListener('mousedown', onMouseDown, true);
  }, []);
}

// ── Managed group drag (macOS + Windows) ────────────────────────────────────
// The pill does NOT use an OS drag region on either desktop platform. Pointer
// deltas go to main, which moves the whole group. Same mechanism, two reasons:
//   • macOS: the pill is an AppKit CHILD of the shell. Propagation is
//     parent→child only, so a natively-dragged child moves ALONE and tears the
//     group apart — the exact artifact welding exists to remove. Dragging the
//     PARENT makes AppKit carry pill and toggle in the same transaction.
//   • Windows: there is no weld, but `-webkit-app-region: drag` enters the
//     modal move loop, which owns the message pump while you drag — the
//     follower window's moves are serviced around it rather than at refresh
//     rate. Moving every window ourselves from one tick bypasses that loop.
//
// The renderer sends the pointer's TOTAL offset from where the drag started —
// never a per-frame delta. Main anchors on the shell's origin at drag start and
// clamps each target into the work area; with deltas a clamped frame would
// silently drop movement and the window would jump when the pointer came back.
// Screen coordinates stay correct even though the window moves underneath the
// pointer. Sends are coalesced to one per frame, and pointer capture keeps the
// stream alive when the cursor leaves the ~200px pill window mid-drag (without
// it the drag dies the moment you move fast).
function useManagedGroupDrag(rootRef: React.RefObject<HTMLDivElement | null>): boolean {
  const [managed, setManaged] = useState(false);

  useEffect(() => {
    let alive = true;
    window.electronAPI
      ?.isOverlayGroupDragManaged?.()
      .then((v) => {
        if (alive) setManaged(!!v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!managed || !el) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let pending: { dx: number; dy: number } | null = null;
    let frame = 0;

    const flush = () => {
      frame = 0;
      const next = pending;
      pending = null;
      if (!next) return;
      window.electronAPI?.sendOverlayGroupDrag?.({ ...next, phase: 'move' }).catch(() => {});
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Never begin a drag from a control — the pill's buttons (logo, expand,
      // end-meeting) must keep behaving as buttons.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('button, a, input, select, textarea, [role="button"]')) return;
      dragging = true;
      startX = e.screenX;
      startY = e.screenY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Capture is an optimisation; the listeners still work without it.
      }
      // Anchor main on the shell's current origin before any movement lands.
      window.electronAPI?.sendOverlayGroupDrag?.({ phase: 'start' }).catch(() => {});
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      // TOTAL offset from the drag's start, not the step since the last event.
      pending = { dx: e.screenX - startX, dy: e.screenY - startY };
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // Already released (pointercancel) — nothing to undo.
      }
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      flush();
      // Settle: release the anchor and re-assert exact geometry.
      window.electronAPI?.sendOverlayGroupDrag?.({ phase: 'end' }).catch(() => {});
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [managed, rootRef]);

  return managed;
}

export function OverlayPillWindow() {
  const state = useOverlayUiState();
  const appearance = useOverlayAuxAppearance(state);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragManaged = useManagedGroupDrag(rootRef);
  useDismissPopoversOnMouseDown();

  // Report the pill's w-fit size so the main process can size + re-center the
  // OS window (same 'update-content-dimensions' channel every window uses;
  // routed to setPillWindowSize by sender id).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (width > 0 && height > 0) {
        window.electronAPI?.updateContentDimensions({ width, height }).catch?.(() => {});
      }
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      data-interface-theme={state.interfaceTheme ?? 'default'}
      // Drives the CSS that turns OFF the OS drag region inside this window —
      // see useManagedGroupDrag for why neither platform may drag the pill
      // window itself.
      data-overlay-group-drag-managed={dragManaged ? 'true' : undefined}
      className="w-fit h-fit bg-transparent select-none"
      style={{
        ['--overlay-opacity' as '--overlay-opacity']: String(state.overlayOpacity ?? 1),
      } as React.CSSProperties}
    >
      {/* Mirrors the old in-window behavior: on Cmd+B collapse the pill fades
          with the shell; the OS window itself hides when the overlay window
          hides (main-process visibility mirroring). */}
      <div
        style={{
          opacity: state.expanded === false ? 0 : 1,
          pointerEvents: state.expanded === false ? 'none' : 'auto',
          transition: 'opacity 0.22s cubic-bezier(0.32, 0, 0.67, 0)',
        }}
      >
        <TopPill
          expanded={state.expanded !== false}
          onToggle={() => sendAction('toggle-expand')}
          onQuit={() => sendAction('end-meeting')}
          appearance={appearance}
          onLogoClick={() => window.electronAPI?.setWindowMode?.('launcher')}
        />
      </div>
    </div>
  );
}

export function OverlayToggleWindow() {
  const state = useOverlayUiState();
  const appearance = useOverlayAuxAppearance(state);
  const themeAttr = state.interfaceTheme ?? 'default';
  useDismissPopoversOnMouseDown();

  // The 28px button centered in the TOGGLE_WINDOW_SIZE (36px) window: 4px of
  // margin on every side absorbs the hover scale (×1.06) without clipping.
  return (
    <div
      data-interface-theme={themeAttr}
      className="w-full h-full bg-transparent select-none"
      style={{
        ['--overlay-opacity' as '--overlay-opacity']: String(state.overlayOpacity ?? 1),
      } as React.CSSProperties}
    >
      <ResizeToggle
        expanded={!!state.shellWide}
        onToggle={() => sendAction('toggle-width')}
        appearance={appearance}
        interfaceTheme={themeAttr === 'default' ? undefined : themeAttr}
        topOffset={4}
        rightOffset={4}
      />
    </div>
  );
}
