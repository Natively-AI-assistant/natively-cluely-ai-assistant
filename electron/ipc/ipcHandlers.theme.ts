/**
 * Theme handlers extracted from ipcHandlers.ts.
 * Handles theme switching.
 */

import { safeHandle } from './safeHandle';
import { AppState } from '../main';

export function registerThemeHandlers(appState: AppState): void {
  safeHandle("theme:get-mode", () => {
    const tm = appState.getThemeManager();
    return {
      mode: tm.getMode(),
      resolved: tm.getResolvedTheme()
    };
  });

  const VALID_MODES = ['system', 'light', 'dark'] as const;

  safeHandle("theme:set-mode", (_, mode: string) => {
    if (!VALID_MODES.includes(mode as typeof VALID_MODES[number])) {
      throw new Error(`Invalid theme mode: ${mode}. Must be one of: ${VALID_MODES.join(', ')}`);
    }
    appState.getThemeManager().setMode(mode);
    return { success: true };
  });
}