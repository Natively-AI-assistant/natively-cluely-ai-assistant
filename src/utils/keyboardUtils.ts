/**
 * Converts an Electron Accelerator string to an array of keys for the frontend.
 * Example: "CommandOrControl+Shift+Space" -> ["Meta", "Shift", "Space"]
 */
const isMacPlatform = () => {
    if (typeof navigator === 'undefined') {
        return false;
    }

    return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
};

export function acceleratorToKeys(accelerator: string): string[] {
    if (!accelerator) return [];

    const parts = accelerator.split('+');
    return parts.map(part => {
        switch (part.toLowerCase()) {
            case 'commandorcontrol':
                return isMacPlatform() ? '⌘' : '⌃';
            case 'cmd':
            case 'command':
            case 'meta':
                return '⌘';
            case 'control':
            case 'ctrl':
                return '⌃';
            case 'alt':
            case 'option':
                return '⌥';
            case 'shift':
                return '⇧';
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
                modifiers.push('Control');
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
                mainKey = key.toUpperCase();
        }
    });

    // Electron expects modifiers first
    return [...modifiers, mainKey].filter(Boolean).join('+');
}
