/**
 * What the dictation notices say, per OS. The paste keys are the platform's
 * own (⌘V on macOS, Ctrl+V on Windows): Natively never pastes, the user does.
 */

export const DICTATION_KEYBIND_ID = 'dictation:toggle';
/** Free on both OSes among Natively's defaults (KeybindManager.DEFAULT_KEYBINDS); D for dictate. */
export const DICTATION_DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+D';
/** A press starts; the next press, or this limit, stops. */
export const DICTATION_MAX_MS = 120_000;

export type DictationNoticeKind =
    | 'recording'
    | 'copied'
    | 'nothing-heard'
    | 'meeting-running'
    | 'no-provider'
    | 'mic-failed'
    | 'transcribe-failed'
    | 'busy';

export interface DictationNotice {
    title: string;
    body: string;
}

/** The paste keys the user presses, as the OS writes them. */
export function pasteKeys(platform: string): string {
    switch (platform) {
        case 'darwin': return '⌘V';
        case 'win32': return 'Ctrl+V';
        // Linux is not a shipped target; its paste key is Ctrl+V too.
        default: return 'Ctrl+V';
    }
}

/** An Electron accelerator as the OS writes it: ⌘⇧D on macOS, Ctrl+Shift+D on Windows. */
export function acceleratorLabel(accelerator: string, platform: string): string {
    const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean);
    if (platform === 'darwin') {
        const mac: Record<string, string> = {
            commandorcontrol: '⌘', cmdorctrl: '⌘', command: '⌘', cmd: '⌘', control: '⌃', ctrl: '⌃',
            shift: '⇧', alt: '⌥', option: '⌥', super: '⌘', meta: '⌘',
        };
        return parts.map((p) => mac[p.toLowerCase()] ?? p.toUpperCase()).join('');
    }
    const win: Record<string, string> = {
        commandorcontrol: 'Ctrl', cmdorctrl: 'Ctrl', control: 'Ctrl', ctrl: 'Ctrl',
        shift: 'Shift', alt: 'Alt', option: 'Alt', super: 'Win', meta: 'Win', command: 'Win', cmd: 'Win',
    };
    return parts.map((p) => win[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p)).join('+');
}

export function dictationNotice(kind: DictationNoticeKind, platform: string, accelerator: string = DICTATION_DEFAULT_ACCELERATOR): DictationNotice {
    const keys = accelerator ? acceleratorLabel(accelerator, platform) : '';
    switch (kind) {
        case 'recording':
            return { title: 'Listening', body: keys ? `Press ${keys} again when you're done.` : 'Press the dictation shortcut again when you\'re done.' };
        case 'copied':
            return { title: `Copied, paste with ${pasteKeys(platform)}`, body: 'Your dictation is on the clipboard.' };
        case 'nothing-heard':
            return { title: 'Nothing to copy', body: 'No speech was heard. Check your microphone in Settings › Audio.' };
        case 'meeting-running':
            return { title: 'Dictation is off during a meeting', body: 'Natively is using your microphone for the meeting. Try again after it ends.' };
        case 'no-provider':
            return { title: 'Dictation needs a speech provider', body: 'Choose one in Settings › Audio.' };
        case 'mic-failed':
            return { title: 'Couldn\'t use your microphone', body: 'Check the microphone in Settings › Audio and that Natively may use it.' };
        case 'transcribe-failed':
            return { title: 'Couldn\'t transcribe that', body: 'Your speech provider didn\'t answer. Check it in Settings › Audio.' };
        case 'busy':
            return { title: 'Still working on the last one', body: 'Your text will be on the clipboard in a moment.' };
    }
}
