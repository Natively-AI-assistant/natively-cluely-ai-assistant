import { getModifierSymbol, isMac } from './platformUtils';

/**
 * Converts an Electron Accelerator string to an array of platform-aware keys for the frontend.
 * Modifier symbols adapt to the current platform (e.g. ⌘ on macOS, Ctrl on Windows/Linux).
 */
export function acceleratorToKeys(accelerator: string): string[] {
    if (!accelerator) return [];

    const parts = accelerator.split('+');
    return parts.map(part => {
        switch (part.toLowerCase()) {
            case 'commandorcontrol':
            case 'cmd':
            case 'command':
            case 'meta':
                return getModifierSymbol('commandorcontrol');
            case 'control':
            case 'ctrl':
                // On macOS, explicit 'Ctrl' in an accelerator maps to the ⌃ key.
                // On Win/Linux, Ctrl IS CommandOrControl so show the same Ctrl label.
                return getModifierSymbol('ctrl');
            case 'alt':
            case 'option':
                return getModifierSymbol('alt');
            case 'shift':
                return getModifierSymbol('shift');
            case 'up':
            case 'arrowup':
                return '↑';
            case 'down':
            case 'arrowdown':
                return '↓';
            case 'left':
            case 'arrowleft':
                return '←';
            case 'right':
            case 'arrowright':
                return '→';
            default:
                // Capitalize first letter for consistency
                return part.length === 1 ? part.toUpperCase() : part;
        }
    });
}

/**
 * Named keys keysToAccelerator() below can turn into a valid Electron token.
 *
 * Note the arrow spellings: this set is keyed on raw KeyboardEvent.key values,
 * which is a different vocabulary from the accelerator tokens Electron itself
 * parses ('ArrowUp' here becomes 'Up' there). isRegisterableAccelerator() in
 * electron/services/acceleratorValidation.ts is the authority on the latter and
 * is what actually protects the main process; this is the same rule applied one
 * step earlier, on the input side, so the user never records a dead shortcut.
 */
const NAMED_ACCELERATOR_KEYS = new Set([
    'plus', 'space', 'tab', 'capslock', 'numlock', 'scrolllock',
    'backspace', 'delete', 'insert', 'return', 'enter',
    'home', 'end', 'pageup', 'pagedown', 'escape', 'esc', 'printscreen',
    'volumeup', 'volumedown', 'volumemute',
    'medianexttrack', 'mediaprevioustrack', 'mediastop', 'mediaplaypause',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    'up', 'down', 'left', 'right', '↑', '↓', '←', '→',
    ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
]);

/**
 * Whether `key` (a raw KeyboardEvent.key) is something keysToAccelerator() can
 * turn into an accelerator Electron will accept.
 */
export function isRepresentableKey(key: string): boolean {
    if (!key) return false;
    if (key.length === 1) {
        const code = key.charCodeAt(0);
        return code > 0x20 && code < 0x7f; // printable ASCII only
    }
    return NAMED_ACCELERATOR_KEYS.has(key.toLowerCase());
}

/**
 * Converts an array of keys from the frontend to an Electron Accelerator string.
 * Example: ["Meta", "Shift", "Space"] -> "CommandOrControl+Shift+Space"
 */
export function keysToAccelerator(keys: string[]): string {
    const modifiers: string[] = [];
    let mainKey = '';

    keys.forEach(key => {
        switch (key.toLowerCase()) {
            case 'meta':
            case 'command':
            case 'cmd':
            case '⌘':
                modifiers.push('CommandOrControl');
                break;
            case 'control':
            case 'ctrl':
            case '⌃':
                // On non-Mac treating ⌃ (explicit Ctrl) as CommandOrControl keeps Electron happy.
                // If you need a Mac-only Ctrl binding, use 'Ctrl' directly in accelerator template.
                modifiers.push(isMac ? 'Control' : 'CommandOrControl');
                break;
            case 'alt':
            case 'option':
            case '⌥':
                modifiers.push('Alt');
                break;
            case 'shift':
            case '⇧':
                modifiers.push('Shift');
                break;
            case 'arrowup':
            case 'up':
            case '↑':
                mainKey = 'Up';
                break;
            case 'arrowdown':
            case 'down':
            case '↓':
                mainKey = 'Down';
                break;
            case 'arrowleft':
            case 'left':
            case '←':
                mainKey = 'Left';
                break;
            case 'arrowright':
            case 'right':
            case '→':
                mainKey = 'Right';
                break;
            default:
                // Only keys Electron can convert into an accelerator. A single
                // non-ASCII character (Option+key on a non-US layout produces the
                // composed glyph — "₹" on an Indian layout) makes every
                // globalShortcut call in main THROW rather than fail, which is how
                // a recorded shortcut turned into a main-process crash loop.
                // Dropping it here leaves mainKey empty, so the recorder produces
                // no accelerator and the old binding stands.
                if (isRepresentableKey(key)) mainKey = key.toUpperCase();
        }
    });

    // Electron expects modifiers first
    return [...modifiers, mainKey].filter(Boolean).join('+');
}
