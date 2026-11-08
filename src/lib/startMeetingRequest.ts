// Starting a meeting from a renderer (2026-11-02): the saved audio devices
// (meetingAudioRequest.mjs) and the retention setting, the same for the
// launcher's Start and for Resume on a saved meeting (meeting page or notepad).
import { meetingAudioRequest } from './meetingAudioRequest.mjs';
import { isInternalCaptureDevice } from '../../electron/audio/audioDeviceSelection.mjs';
import { isMac } from '../utils/platformUtils';

const read = (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
};

/** The audio devices saved in this renderer, as the start request carries them. */
export function savedMeetingAudio(): { inputDeviceId: string | null; outputDeviceId: string | null } {
    const savedInput = read('preferredInputDeviceId');
    const r = meetingAudioRequest({
        savedInput,
        savedOutput: read('preferredOutputDeviceId'),
        experimentalSck: read('useExperimentalSckBackend') === 'true',
        isMac,
        isInternal: isInternalCaptureDevice,
    });
    if (r.discardSavedInput) {
        // Self-heal a poisoned preference: Natively's own tap aggregate is not a microphone.
        console.warn(`[Meeting] Discarding saved input device "${savedInput}" — it is one of Natively's own capture devices, not a microphone.`);
        try { localStorage.removeItem('preferredInputDeviceId'); } catch { /* read-only storage */ }
    }
    if (r.backend === 'sck') console.log('[Meeting] Using ScreenCaptureKit backend (Experimental).');
    else if (r.backend === 'coreaudio') console.log('[Meeting] Using CoreAudio backend (Default).');
    return { inputDeviceId: r.inputDeviceId, outputDeviceId: r.outputDeviceId };
}

export type ResumeMeetingResult = { success: boolean; error?: string; code?: string };

/** Resume (meetingResume.ts): recording again into the saved meeting `meetingId`. */
export async function resumeSavedMeeting(meetingId: string): Promise<ResumeMeetingResult> {
    const api = window.electronAPI;
    if (!api?.resumeMeeting) return { success: false, code: 'unavailable' };
    const retention = await api.getMeetingRetention?.().catch(() => 'forever');
    return api.resumeMeeting(meetingId, { audio: savedMeetingAudio(), doNotPersist: retention === 'never' });
}
