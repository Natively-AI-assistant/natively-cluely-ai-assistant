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

export function OverlayPillWindow() {
  const state = useOverlayUiState();
  const appearance = useOverlayAuxAppearance(state);
  const rootRef = useRef<HTMLDivElement>(null);
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
