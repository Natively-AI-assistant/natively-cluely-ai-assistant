// src/lib/onboarding/shortcutKeys.mjs
//
// Keycaps and key matching for the first-launch shortcut tour, from an Electron
// accelerator ('CommandOrControl+B'). The platform is passed in rather than read
// from the environment, so both branches are tested (CLAUDE.md): macOS shows
// the Command glyph and matches metaKey; Windows (and anything else) shows Ctrl
// and matches ctrlKey.

const MAC = {
  commandorcontrol: '⌘', cmdorctrl: '⌘', command: '⌘', cmd: '⌘', meta: '⌘', super: '⌘',
  control: '⌃', ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧',
};
const OTHER = {
  commandorcontrol: 'Ctrl', cmdorctrl: 'Ctrl', control: 'Ctrl', ctrl: 'Ctrl',
  command: 'Win', cmd: 'Win', meta: 'Win', super: 'Win', alt: 'Alt', option: 'Alt', shift: 'Shift',
};

/**
 * @param {string} accelerator  e.g. 'CommandOrControl+Shift+H'
 * @param {string} platform     process.platform ('darwin' | 'win32' | ...)
 * @returns {string[]}          one entry per keycap, e.g. ['⌘', 'B'] or ['Ctrl', 'B']
 */
export function acceleratorToKeys(accelerator, platform) {
  const names = platform === 'darwin' ? MAC : OTHER;
  return String(accelerator || '')
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => names[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part));
}

/**
 * Whether a keydown matches the accelerator on this platform. Modifiers must
 * match exactly, so Ctrl+Shift+B is not taken for Ctrl+B.
 * @param {{ key: string, code?: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean, shiftKey: boolean }} e
 * @param {string} accelerator
 * @param {string} platform
 * @returns {boolean}
 */
export function matchesAccelerator(e, accelerator, platform) {
  const parts = String(accelerator || '').split('+').map(p => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const mac = platform === 'darwin';
  const want = { ctrl: false, meta: false, alt: false, shift: false };
  for (const m of mods) {
    if (m === 'commandorcontrol' || m === 'cmdorctrl') want[mac ? 'meta' : 'ctrl'] = true;
    else if (m === 'command' || m === 'cmd' || m === 'meta' || m === 'super') want.meta = true;
    else if (m === 'control' || m === 'ctrl') want.ctrl = true;
    else if (m === 'alt' || m === 'option') want.alt = true;
    else if (m === 'shift') want.shift = true;
  }
  if (!!e.ctrlKey !== want.ctrl || !!e.metaKey !== want.meta || !!e.altKey !== want.alt || !!e.shiftKey !== want.shift) {
    return false;
  }
  if (String(e.key || '').toLowerCase() === key) return true;
  // A letter or digit that is not the accelerator's key is a different key
  // (or another layout's); only a transformed character falls through below.
  if (/^[a-z0-9]$/i.test(String(e.key || ''))) return false;
  // e.key is the produced character: Shift+1 gives '!' and mac Option+B gives
  // '∫', neither of which is the key the accelerator names. The physical key
  // (e.code) is what an Electron accelerator means.
  return codeToKey(e.code) === key;
}

/** 'KeyB' -> 'b', 'Digit1' -> '1'; anything else has no letter/digit form. */
function codeToKey(code) {
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(String(code || ''));
  return m ? (m[1] || m[2]).toLowerCase() : null;
}
