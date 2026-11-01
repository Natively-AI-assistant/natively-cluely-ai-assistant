// What meetings open (electron/utils/meetingSurface.ts), chosen in two places
// of the launcher window: the Start Natively button's menu and the switcher at
// the top of Settings › Overlay. Both use this hook, and a choice made in one
// is told to the other with a window event, so neither shows a stale choice.
import { useEffect, useState } from 'react';
import { AppWindow, NotebookPen } from 'lucide-react';

export type MeetingSurface = 'overlay' | 'notepad';

export const MEETING_SURFACES: { id: MeetingSurface; label: string; hint: string; Icon: typeof AppWindow }[] = [
    { id: 'overlay', label: 'Natively overlay', hint: 'Answers and help on top of your call', Icon: AppWindow },
    { id: 'notepad', label: 'Natively notepad', hint: 'Notes and transcript on the side', Icon: NotebookPen },
];

const CHANGED = 'natively:meeting-surface-changed';

/**
 * What meetings open, saved in main and read at every meeting start. Shown
 * first, then saved; a refused write puts the choice back. Null until read.
 */
export function useMeetingSurface(): [MeetingSurface | null, (next: MeetingSurface) => void] {
    const [surface, setSurface] = useState<MeetingSurface | null>(null);
    useEffect(() => {
        let live = true;
        window.electronAPI?.getMeetingSurface?.()
            .then((value) => { if (live) setSurface(value === 'notepad' ? 'notepad' : 'overlay'); })
            .catch(() => { if (live) setSurface('overlay'); });
        const onChanged = (e: Event) => setSurface((e as CustomEvent<MeetingSurface>).detail);
        window.addEventListener(CHANGED, onChanged);
        return () => { live = false; window.removeEventListener(CHANGED, onChanged); };
    }, []);
    const choose = (next: MeetingSurface) => {
        const was = surface;
        if (was === null || was === next) return;
        const tell = (value: MeetingSurface) => window.dispatchEvent(new CustomEvent(CHANGED, { detail: value }));
        tell(next);
        window.electronAPI?.setMeetingSurface?.(next)
            .then((r) => { if (!r?.success) tell(was); })
            .catch(() => tell(was));
    };
    return [surface, choose];
}
