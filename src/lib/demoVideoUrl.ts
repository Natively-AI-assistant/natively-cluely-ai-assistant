// The demo film's address, alone so main can read it too (the first-run guide
// opens it at its first meeting: electron/ipcHandlers.ts) without pulling in
// the renderer's openDemoVideo (src/lib/demoVideo.ts).
export const DEMO_VIDEO_URL = 'https://youtu.be/Ha_ZiwG5Kwc';

/**
 * How the guide opens the film without the user asking (shell.openExternal's
 * options). The user's call and the overlay stay in front: the film is heard,
 * not watched (Evin, 2026-11-15: "play ... in background").
 *  - macOS: the browser opens it without coming to the front (activate: false).
 *  - Windows: openExternal has no such option; the browser comes forward, and
 *    the overlay, always on top, stays above it.
 * Anything else opens it plainly.
 */
export function demoFilmOpenOptions(platform: string): { activate?: boolean } {
  switch (platform) {
    case 'darwin':
      return { activate: false };
    case 'win32':
      return {};
    default:
      return {};
  }
}

/** How long the first guide meeting may stay silent before the overlay asks
 *  the user to press play (a browser that blocked the film's autoplay). */
export const DEMO_FILM_QUIET_MS = 8_000;
