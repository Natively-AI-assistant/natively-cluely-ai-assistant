/**
 * Cross-platform permission and capture failure messages.
 * macOS-only variants use the `mac-` prefix; call sites must gate on darwin.
 */

import {
  isLinuxSystemAudioErrorCode,
  LINUX_SYSTEM_AUDIO_ERROR_CODES,
  type LinuxSystemAudioErrorCode,
  resolveLinuxSystemAudioErrorCode,
} from './linuxSystemAudioErrors';

export type PermissionReason =
  | 'screen-recording-denied'
  | 'mac-screen-recording-revoked-rebuild'
  | 'mac-mic-denied'
  | 'mic-denied'
  | 'mac-mic-zero-fill'
  | 'mic-zero-fill'
  | 'mac-same-device-input-output'
  | 'system-audio-stuck'
  | 'linux-audio-server-missing'
  | 'linux-session-unsupported'
  | 'linux-shortcut-conflict';

export function formatPermissionMessage(
  reason: PermissionReason,
  extra?: { device?: string; accelerator?: string },
): string {
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  switch (reason) {
    case 'screen-recording-denied':
      if (isMac) {
        return 'Screen Recording permission denied. Interviewer audio will not be captured. Enable in System Settings → Privacy & Security → Screen Recording, then restart the app.';
      }
      if (isLinux) {
        return 'System audio capture is unavailable. Ensure PulseAudio or PipeWire (pipewire-pulse) is running, then restart the meeting.';
      }
      return 'System audio capture is unavailable. Interviewer audio will not be captured. Check your audio device routing in Settings and restart the meeting.';

    case 'mac-screen-recording-revoked-rebuild':
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return 'System audio is being captured but every sample is silent. This usually means macOS Screen Recording permission needs to be re-granted to this build of Natively. Open System Settings → Privacy & Security → Screen Recording, toggle Natively off and back on, then restart the app. (If you recently rebuilt or updated, the previous grant may not apply.)';

    case 'mac-mic-denied':
      if (!isMac) return formatPermissionMessage('mic-denied');
      return 'Microphone access denied. Please allow microphone access in System Settings → Privacy & Security → Microphone, then restart Natively.';

    case 'mic-denied':
      if (isMac) return formatPermissionMessage('mac-mic-denied');
      if (isLinux) {
        return 'Microphone access denied. Allow microphone access when prompted, or check your desktop sound settings, then restart Natively.';
      }
      return 'Microphone access denied. Please allow microphone access in Settings → Privacy → Microphone, then restart Natively.';

    case 'mac-mic-zero-fill':
      if (!isMac) return formatPermissionMessage('mic-zero-fill');
      return 'Microphone is producing silent audio. Check that the device is unmuted and that macOS Microphone permission is granted to Natively in System Settings → Privacy & Security → Microphone.';

    case 'mic-zero-fill':
      if (isMac) return formatPermissionMessage('mac-mic-zero-fill');
      if (isLinux) {
        return 'Microphone is producing silent audio. Check that the device is unmuted and that Natively has microphone access in your desktop environment.';
      }
      return 'Microphone is producing silent audio. Check that the device is unmuted and that Natively has microphone access in Settings → Privacy → Microphone.';

    case 'mac-same-device-input-output':
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return `Silent capture detected — input and output are the same device (${extra?.device ?? 'unknown'}). macOS cannot tap a device while it is also the active microphone. Switch input to built-in mic or output to built-in speakers.`;

    case 'system-audio-stuck':
      if (isLinux) {
        return 'No audio detected on system output for 8s. Confirm media is playing on your default output and that PulseAudio/PipeWire is running (e.g. systemctl --user status pipewire-pulse), then restart the meeting.';
      }
      return 'No audio detected on system output for 8s. If your meeting app is using a different output device (Bluetooth headset, virtual cable, second monitor), switch it to your default output, or restart the meeting after switching.';

    case 'linux-audio-server-missing':
      return 'PulseAudio or PipeWire is not available. Install and start pipewire-pulse or pulseaudio (e.g. sudo apt install pipewire-pulse), then restart Natively.';

    case 'linux-session-unsupported':
      return 'System audio capture is unavailable on this Linux session. Log out and choose an X11 (Xorg) login session, then restart Natively.';

    case 'linux-shortcut-conflict':
      return `Global shortcut ${extra?.accelerator ?? ''} could not be registered — another app or your window manager may already use it. Rebind the shortcut in Natively settings or release the conflicting binding.`;
  }
}

/** Map a native/JS system-audio error code to user-facing copy on Linux. */
export function mapLinuxSystemAudioError(code: LinuxSystemAudioErrorCode): string {
  switch (code) {
    case LINUX_SYSTEM_AUDIO_ERROR_CODES.PULSE_NOT_AVAILABLE:
    case LINUX_SYSTEM_AUDIO_ERROR_CODES.INIT_TIMEOUT:
    case LINUX_SYSTEM_AUDIO_ERROR_CODES.STREAM_CONNECT_FAILED:
    case LINUX_SYSTEM_AUDIO_ERROR_CODES.UNSUPPORTED_PLATFORM:
    case LINUX_SYSTEM_AUDIO_ERROR_CODES.NATIVE_MODULE_NOT_LOADED:
      return formatPermissionMessage('linux-audio-server-missing');
    case LINUX_SYSTEM_AUDIO_ERROR_CODES.CAPTURE_ALREADY_RUNNING:
      return 'System audio capture encountered an internal error. Please stop and restart the meeting.';
    case LINUX_SYSTEM_AUDIO_ERROR_CODES.CONSUMER_MISSING:
    case LINUX_SYSTEM_AUDIO_ERROR_CODES.CAPTURE_THREAD_FAILED:
      return formatPermissionMessage('system-audio-stuck');
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

/** Resolve structured code from an error and return surfaced user-facing text. */
export function surfaceLinuxSystemAudioError(err: unknown): Error {
  const code = resolveLinuxSystemAudioErrorCode(err);
  if (code) {
    return new Error(mapLinuxSystemAudioError(code));
  }
  if (typeof err === 'string') {
    return new Error(err);
  }
  if (err instanceof Error) {
    return err;
  }
  return new Error(String(err));
}

export {
  isLinuxSystemAudioErrorCode,
  LINUX_SYSTEM_AUDIO_ERROR_CODES,
  resolveLinuxSystemAudioErrorCode,
  type LinuxSystemAudioErrorCode,
};
