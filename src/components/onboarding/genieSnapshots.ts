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

// Decoded pictures in memory, least recently used first. A Settings-sized
// picture is ~9 MB decoded at 2x, and one is taken of every tab or mode a
// card settles on, so memory is held to a budget. A picture that falls out
// stays on disk and is decoded again at the next start-up.
const MEMORY_BUDGET_BYTES = 64 * 1024 * 1024;
const store = new Map<string, GenieSnapshot>();
let warmed: Promise<void> | null = null;

const bytesOf = (snap: GenieSnapshot) => snap.bitmap.width * snap.bitmap.height * 4;

/** What a kept key's picture costs decoded, read off the key. */
function decodedBytesOfKey(key: string): number {
  const parts = key.split('|');
  const size = /^(\d+)x(\d+)$/.exec(parts[2] ?? '');
  const dpr = Number(parts[parts.length - 1]) || 1;
  return size ? Math.round(Number(size[1]) * dpr) * Math.round(Number(size[2]) * dpr) * 4 : Infinity;
}

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
  // A picture replaced or evicted may still be pouring out of the slot: it is
  // left to the garbage collector rather than closed under a running genie.
  store.delete(key);
  store.set(key, snap);
  let total = 0;
  for (const s of store.values()) total += bytesOf(s);
  for (const [k, s] of store) {
    if (total <= MEMORY_BUDGET_BYTES || k === key) break;
    store.delete(k);
    total -= bytesOf(s);
  }
}

/**
 * Bring the kept pictures into memory, decoded, so an open can use one
 * without waiting. Runs once, when the page is idle, and only for pictures
 * taken in the current theme, language and pixel ratio (no other can match
 * a key now), newest first, as many as the memory budget holds.
 */
export function warmGenieSnapshots(): Promise<void> {
  if (warmed) return warmed;
  warmed = new Promise<void>(resolve => {
    const run = async () => {
      const a = api();
      try {
        const env = `|${environment()}`;
        // Listed oldest first (electron/genieSnapshots.ts).
        const listed = ((await a?.genieSnapshotList?.()) ?? []).filter(k => k.endsWith(env));
        const keys: string[] = [];
        let budget = MEMORY_BUDGET_BYTES;
        for (let i = listed.length - 1; i >= 0; i--) {
          const cost = decodedBytesOfKey(listed[i]);
          if (cost > budget) break;
          budget -= cost;
          keys.unshift(listed[i]);
        }
        for (const key of keys) {
          if (store.has(key)) continue;
          const png = await a?.genieSnapshotLoad?.(key);
          const size = /\|(\d+)x(\d+)\|/.exec(key);
          if (!png || !size) continue;
          const snap = await toSnapshot(png, Number(size[1]), Number(size[2]));
          // A capture taken meanwhile is newer: it stays.
          if (snap && !store.has(key)) remember(key, snap);
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
  const snap = store.get(key);
  if (!snap) return null;
  // Used: now the most recent.
  store.delete(key);
  store.set(key, snap);
  return snap;
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

// The controls whose hover or focus a picture would keep. Roles, not every
// focusable element: a scroll pane with tabindex is hovered whenever the
// pointer is over the card at all, and would stop every picture.
const CONTROL = 'button, a[href], input, select, textarea, label, summary, '
  + '[role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"]';

/**
 * Is the card showing something that belongs to this moment, not to the view:
 * a control under the pointer, or a keyboard focus ring? A picture kept then
 * pours out with it on the next open (the Settings tab last pointed at, lit
 * up like a second selected tab) and drops it as the card lands.
 */
export function showsTransientState(card: HTMLElement): boolean {
  if (card.querySelector(':focus-visible')) return true;
  const hovered = card.querySelectorAll(':hover');
  const control = hovered[hovered.length - 1]?.closest(CONTROL);
  return !!control && control !== card && card.contains(control);
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
