import { platform } from 'os';

const isMac = platform() === 'darwin';

/**
 * Pretty-print an Electron accelerator for chip labels (matches renderer acceleratorToKeys style).
 */
export function formatAcceleratorDisplay(accelerator: string): string {
    if (!accelerator || !accelerator.trim()) return '';
    const parts = accelerator.split('+').map((p) => p.trim());
    const out: string[] = [];
    for (const part of parts) {
        const low = part.toLowerCase();
        switch (low) {
            case 'commandorcontrol':
            case 'cmd':
            case 'command':
            case 'meta':
                out.push(isMac ? '⌘' : 'Ctrl');
                break;
            case 'control':
            case 'ctrl':
                out.push(isMac ? '⌃' : 'Ctrl');
                break;
            case 'alt':
            case 'option':
                out.push(isMac ? '⌥' : 'Alt');
                break;
            case 'shift':
                out.push(isMac ? '⇧' : 'Shift');
                break;
            case 'up':
                out.push('↑');
                break;
            case 'down':
                out.push('↓');
                break;
            case 'left':
                out.push('←');
                break;
            case 'right':
                out.push('→');
                break;
            default:
                out.push(part.length === 1 ? part.toUpperCase() : part);
        }
    }
    return out.join(isMac ? '' : '+');
}
