// src/components/onboarding/genieSnapshots.ts
//
// Pictures of popup cards, for the genie to warp.
//
// macOS pours a window into the Dock by bending ONE picture of it; it restores
// the window from the last picture it had. The genie here does the same:
//
//   close   a fresh capture of the card exactly as it is on screen.
//   open    the last picture of the view the card opens into (Settings' tab,
//           Profile Intelligence's section, the Modes manager's current view),
//           taken the last time that view sat settled on screen and kept until
//           the view changes: the user uploads a résumé, changes a setting,
//           switches mode. A card with no picture yet (its first open ever, a
//           new theme or window size) falls back to the live-copy genie once.
//
// A picture is keyed by what decides how the card looks: the card, the view
// it shows (the nearest `data-genie-view` inside it), its size, the theme, the
// language and the screen's pixel ratio. The app version is part of where the
// main process keeps them (electron/genieSnapshots.ts).
//
// "Settled" is strict, because a picture of a loading card would pour out a
// different card from the one that lands: nothing inside may be loading
// (aria-busy, a progress bar, a spinner, a skeleton) or covered by something
// else (a dropdown, a nested dialog, a toast).

export interface GenieSnapshot {
  /**
   * The picture, decoded off the main thread and ready to draw. A bitmap, not
   * an image URL: the launcher's CSP (img-src 'self' data: https:) blocks
   * blob: images, and that silently failed every capture in the app while the
   * CSP-less harness worked. The genie draws it into canvases instead.
   */
  bitmap: ImageBitmap;
  /** Card size in CSS pixels. */
  width: number;
  height: number;
  /** Taken for one close and not kept: its bitmap is released once the close has played. */
  transient?: boolean;
}

type Api = {
  genieSnapshotCapture?: (rect: { x: number; y: number; width: number; height: number }) => Promise<{ png: Uint8Array; width: number; height: number } | null>;
  genieSnapshotSave?: (key: string, png: Uint8Array) => Promise<boolean>;
  genieSnapshotLoad?: (key: string) => Promise<Uint8Array | null>;
  genieSnapshotList?: () => Promise<string[]>;
};

const api = (): Api | undefined => (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);

const store = new Map<string, GenieSnapshot>();
let warmed: Promise<void> | null = null;

/** The view a card is showing: its nearest `data-genie-view`, or 'default'. */
export function viewOf(card: Element): string {
  const own = card.getAttribute('data-genie-view');
  if (own) return own;
  return card.querySelector('[data-genie-view]')?.getAttribute('data-genie-view') || 'default';
}

/** Everything that changes how a card looks, other than its content. */
function environment(): string {
  const html = document.documentElement;
  const theme = html.getAttribute('data-theme') || (html.classList.contains('dark') ? 'dark' : 'light');
  const lang = html.getAttribute('lang') || 'en';
  return `${theme}|${lang}|${window.devicePixelRatio}`;
}

/** The key for `card` showing `view` at `width` x `height` CSS px. */
export function snapshotKey(cardKey: string, view: string, width: number, height: number): string {
  return `${cardKey}|${view}|${Math.round(width)}x${Math.round(height)}|${environment()}`;
}

async function toSnapshot(png: Uint8Array, width: number, height: number): Promise<GenieSnapshot | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
    return { bitmap, width, height };
  } catch {
    return null;
  }
}

function remember(key: string, snap: GenieSnapshot): void {
  // The picture it replaces may still be pouring out of the slot: it is left
  // to the garbage collector rather than closed under a running genie.
  store.set(key, snap);
}

/**
 * Bring the kept pictures into memory, decoded, so an open can use one
 * without waiting. Runs once, when the page is idle.
 */
export function warmGenieSnapshots(): Promise<void> {
  if (warmed) return warmed;
  warmed = new Promise<void>(resolve => {
    const run = async () => {
      const a = api();
      try {
        const keys = (await a?.genieSnapshotList?.()) ?? [];
        for (const key of keys) {
          if (store.has(key)) continue;
          const png = await a?.genieSnapshotLoad?.(key);
          const size = /\|(\d+)x(\d+)\|/.exec(key);
          if (!png || !size) continue;
          const snap = await toSnapshot(png, Number(size[1]), Number(size[2]));
          if (snap && !store.has(key)) store.set(key, snap);
        }
      } catch { /* the cards fall back to the live-copy genie */ }
      resolve();
    };
    const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined;
    if (ric) ric(() => { void run(); }, { timeout: 2000 }); else setTimeout(() => { void run(); }, 300);
  });
  return warmed;
}

/** The kept picture for a key, if there is one and it is decoded. */
export function getGenieSnapshot(key: string): GenieSnapshot | null {
  return store.get(key) ?? null;
}

// What a loading card shows: an explicit aria-busy, a progress bar, a spinner
// or a skeleton. Decorative loops (a glowing border, an aurora) are not
// loading and must not block a picture forever.
const LOADING = '[aria-busy="true"], [role="progressbar"], .animate-spin, .animate-pulse';

/** Is the card ready to be photographed as its opening view? */
export function isSettled(card: HTMLElement): boolean {
  if (document.visibilityState !== 'visible') return false;
  if (card.matches(LOADING) || card.querySelector(LOADING)) return false;
  // Something still arriving: a row fading in, a panel sliding up. (Endless
  // loops are decoration, not arrival: a glowing border would never settle.)
  if (typeof card.getAnimations === 'function') {
    const arriving = card.getAnimations({ subtree: true }).some(a =>
      a.playState === 'running' && (a.effect as KeyframeEffect | null)?.getTiming?.().iterations !== Infinity);
    if (arriving) return false;
  }
  return isUncovered(card);
}

/** Is anything inside the card scrolled away from where it opens (the top)? */
export function isScrolled(card: HTMLElement): boolean {
  const walk = (el: Element): boolean => {
    if (el.scrollTop > 0 || el.scrollLeft > 0) return true;
    for (let i = 0; i < el.children.length; i++) if (walk(el.children[i])) return true;
    return false;
  };
  return walk(card);
}

/** Nothing sits on top of the card: a dropdown, a nested dialog, a toast. */
function isUncovered(card: HTMLElement): boolean {
  const r = card.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false;
  const points: [number, number][] = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
  return points.every(([fx, fy]) => {
    const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
    return !!hit && (hit === card || card.contains(hit));
  });
}

/**
 * Photograph the card as it is on screen. `keep` stores it under `key` for
 * the next open (and on disk, encrypted); without it the picture is only
 * returned, for a close.
 */
export async function captureGenieSnapshot(card: HTMLElement, key: string | null): Promise<GenieSnapshot | null> {
  const capture = api()?.genieSnapshotCapture;
  if (!capture || document.visibilityState !== 'visible') return null;
  const r = card.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  let shot: Awaited<ReturnType<typeof capture>>;
  try { shot = await capture({ x: r.left, y: r.top, width: r.width, height: r.height }); } catch { return null; }
  if (!shot?.png?.length) return null;
  const snap = await toSnapshot(shot.png, r.width, r.height);
  if (!snap) return null;
  if (!key) return { ...snap, transient: true };
  remember(key, snap);
  void api()?.genieSnapshotSave?.(key, shot.png)?.catch?.(() => {});
  return snap;
}
