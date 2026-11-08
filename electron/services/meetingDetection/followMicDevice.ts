/**
 * Follow the meeting app's microphone (Granola's follow-meeting-app-mic-device,
 * off by default). When a call app (Zoom, Teams, a browser in a call) is
 * capturing from a particular input device, Natively can capture from the same
 * one, so a headset the user picked in Zoom is the headset Natively records,
 * without them setting it twice.
 *
 * This is the decision only, pure and testable. The device each app uses comes
 * from the native reader (meeting_signals MicUser.device_name, macOS 14+; null
 * elsewhere, where this does nothing). Switching Natively's own capture is the
 * caller's job (main.reconfigureAudio); nothing here touches another app.
 *
 * Platform-neutral: the platform is passed in, and app identity is the shared
 * meetingApps table. On Windows, where device_name is always null, every
 * function here returns null and the feature is inert.
 */
import { appOfProcess, isSelf, type ProcessRef, type SelfIdentity } from './meetingApps';

export interface MicUserDevice extends ProcessRef {
    /** The input device this process captures from, by name; napi camel-cases device_name. */
    deviceName?: string | null;
}

const FOLLOWABLE = new Set(['meeting', 'messaging', 'browser']);

/**
 * The input device (by name) the call app on the mic is using, or null when no
 * followable app reports one. A meeting app wins over a chat app or a browser;
 * among equals, the first reported.
 */
export function meetingAppInputDevice(platform: string, micUsers: MicUserDevice[] | null, self: SelfIdentity): string | null {
    const users = (micUsers ?? []).filter((u) => !isSelf(platform, u, self));
    const named = users
        .map((u) => ({ kind: appOfProcess(platform, u)?.kind, device: typeof u.deviceName === 'string' ? u.deviceName.trim() : '' }))
        .filter((u) => u.kind && FOLLOWABLE.has(u.kind) && u.device);
    if (named.length === 0) return null;
    return (named.find((u) => u.kind === 'meeting') ?? named[0]).device;
}

/**
 * The device Natively should switch its capture to, or null to leave it alone.
 * Only when the feature is on and the user has not pinned a device of their own
 * (a pinned choice always wins); never a switch to the device already in use.
 */
export function deviceToFollow(opts: {
    enabled: boolean;
    userPinned: boolean;
    currentDeviceId: string | null | undefined;
    target: string | null;
}): string | null {
    if (!opts.enabled || opts.userPinned || !opts.target) return null;
    const current = (opts.currentDeviceId ?? '').trim();
    if (current && current.toLowerCase() === opts.target.toLowerCase()) return null;
    return opts.target;
}
