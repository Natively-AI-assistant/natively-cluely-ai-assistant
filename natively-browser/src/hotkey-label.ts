/**
 * The modifier key of Natively's page hotkeys, as this keyboard prints it.
 *
 * The desktop binds CommandOrControl+Y (capture) and CommandOrControl+Enter
 * (ask), which Electron reads as Command on a Mac and Ctrl everywhere else, so
 * the popup's keycaps say ⌘ on macOS and Ctrl on Windows (and on Linux or
 * ChromeOS, where the same accelerator is Ctrl too).
 */
export type ModifierKeyLabel = '⌘' | 'Ctrl';

/** `platform` is what Chrome reports: "macOS" / "Windows", or "MacIntel" / "Win32". */
export function modifierKeyLabel(platform: string | undefined): ModifierKeyLabel {
  return /mac/i.test(platform ?? '') ? '⌘' : 'Ctrl';
}

/** The browser's platform string: User-Agent Client Hints first, then the legacy field. */
export function browserPlatform(nav: { userAgentData?: { platform?: string }; platform?: string }): string {
  return nav.userAgentData?.platform || nav.platform || '';
}
