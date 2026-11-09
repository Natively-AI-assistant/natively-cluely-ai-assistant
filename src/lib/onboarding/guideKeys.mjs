// src/lib/onboarding/guideKeys.mjs
//
// Keycaps for the first-run guide: the user's own binding for an action, drawn
// for their platform (⌘ on macOS, Ctrl on Windows) by acceleratorToKeys. The
// defaults mirror electron/services/KeybindManager.ts for the three actions the
// guide teaches, for the moment before the bindings have loaded.
import { acceleratorToKeys } from './shortcutKeys.mjs';

export const GUIDE_KEY_DEFAULTS = Object.freeze({
  'chat:whatToAnswer': 'CommandOrControl+1',
  'general:take-screenshot': 'CommandOrControl+H',
  'general:selective-screenshot': 'CommandOrControl+Shift+H',
});

/**
 * @param {{ id: string, accelerator: string }[] | null | undefined} keybinds  from electronAPI.getKeybinds()
 * @param {string} id        keybind id, e.g. 'chat:whatToAnswer'
 * @param {string} platform  process.platform
 * @returns {string[]}
 */
export function guideKeys(keybinds, id, platform) {
  const bound = Array.isArray(keybinds) ? keybinds.find((k) => k && k.id === id)?.accelerator : undefined;
  const accelerator = bound || GUIDE_KEY_DEFAULTS[id] || '';
  return acceleratorToKeys(accelerator, platform);
}
