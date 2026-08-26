import { loadNativeModule } from './nativeModuleLoader';
import { filterSelectableInputDevices } from './inputDeviceSelection.mjs';

// NativeModule may be null if the Rust binary isn't built yet (new clone without `npm run build:native`).
// All methods below handle this gracefully by returning empty arrays.
const NativeModule: any = loadNativeModule();
const { getInputDevices, getOutputDevices } = NativeModule || {};

export interface AudioDevice {
    id: string;
    name: string;
}

export class AudioDevices {
    public static getInputDevices(): AudioDevice[] {
        if (!getInputDevices) {
            console.warn('[AudioDevices] Native functionality not available');
            return [];
        }
        try {
            // Natively's own system-audio tap is an aggregate device that cpal
            // enumerates as an INPUT while a meeting is capturing (private
            // aggregates are hidden from other processes, not from ours). Left
            // unfiltered it appears in the mic dropdown, gets persisted as
            // preferredInputDeviceId, and then breaks every later meeting —
            // the tap does not exist yet when the mic channel starts. Filtering
            // at this single choke point also keeps the I/O-conflict fallback,
            // the built-in-mic lookup and the last-resort candidate ladder in
            // main.ts from ever selecting it.
            return filterSelectableInputDevices(getInputDevices());
        } catch (e) {
            console.error('[AudioDevices] Failed to get input devices:', e);
            return [];
        }
    }

    public static getOutputDevices(): AudioDevice[] {
        if (!getOutputDevices) {
            console.warn('[AudioDevices] Native functionality not available');
            return [];
        }
        try {
            return getOutputDevices();
        } catch (e) {
            console.error('[AudioDevices] Failed to get output devices:', e);
            return [];
        }
    }
}
