/**
 * The toolbar icon follows Chrome's theme: the black Natively mark on a light
 * toolbar, the white one on a dark toolbar. Chrome picks no icon by theme for
 * Chrome extensions, and the service worker cannot see the theme, so a hidden
 * offscreen page (theme-watch.ts) watches `prefers-color-scheme` and reports it.
 *
 * The extensions page and the store keep the glass icon (manifest `icons`):
 * a bare white mark would vanish on their white background.
 */

/** The black mark, for a light toolbar. Also the manifest's default. */
export const LIGHT_TOOLBAR_ICON = { 16: 'icons/toolbar-light-16.png', 32: 'icons/toolbar-light-32.png' };
/** The white mark, for a dark toolbar. */
export const DARK_TOOLBAR_ICON = { 16: 'icons/toolbar-dark-16.png', 32: 'icons/toolbar-dark-32.png' };

export const THEME_WATCH_PAGE = 'theme-watch.html';

export function toolbarIconFor(dark: boolean): Record<number, string> {
  return dark ? DARK_TOOLBAR_ICON : LIGHT_TOOLBAR_ICON;
}

type OffscreenApi = Pick<typeof chrome.offscreen, 'createDocument'>;

/**
 * Opens the hidden theme page. Chrome allows one offscreen page per extension,
 * so a second call (every service-worker wake) throws, and that is fine.
 */
export async function openThemeWatch(offscreen: OffscreenApi | undefined): Promise<boolean> {
  if (!offscreen?.createDocument) return false;
  try {
    await offscreen.createDocument({
      url: THEME_WATCH_PAGE,
      reasons: ['MATCH_MEDIA' as chrome.offscreen.Reason],
      justification: "Match the toolbar icon to Chrome's light or dark theme.",
    });
    return true;
  } catch {
    return false; // already open
  }
}
