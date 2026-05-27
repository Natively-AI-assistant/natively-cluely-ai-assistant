/**
 * Stable system-audio error codes from native-module (NAPI `Error.message`).
 * Must stay in sync with `native-module/src/speaker/error.rs`.
 */

export const LINUX_SYSTEM_AUDIO_ERROR_CODES = {
  PULSE_NOT_AVAILABLE: 'PULSE_NOT_AVAILABLE',
  INIT_TIMEOUT: 'INIT_TIMEOUT',
  STREAM_CONNECT_FAILED: 'STREAM_CONNECT_FAILED',
  UNSUPPORTED_PLATFORM: 'UNSUPPORTED_PLATFORM',
  CAPTURE_THREAD_FAILED: 'CAPTURE_THREAD_FAILED',
  CONSUMER_MISSING: 'CONSUMER_MISSING',
  CAPTURE_ALREADY_RUNNING: 'CAPTURE_ALREADY_RUNNING',
  /** Emitted from JS when the `.node` binary is missing. */
  NATIVE_MODULE_NOT_LOADED: 'NATIVE_MODULE_NOT_LOADED',
} as const;

export type LinuxSystemAudioErrorCode =
  (typeof LINUX_SYSTEM_AUDIO_ERROR_CODES)[keyof typeof LINUX_SYSTEM_AUDIO_ERROR_CODES];

const ALL_CODES: ReadonlySet<string> = new Set(Object.values(LINUX_SYSTEM_AUDIO_ERROR_CODES));

export function isLinuxSystemAudioErrorCode(value: string): value is LinuxSystemAudioErrorCode {
  return ALL_CODES.has(value);
}

export function resolveLinuxSystemAudioErrorCode(err: unknown): LinuxSystemAudioErrorCode | null {
  if (typeof err === 'string' && isLinuxSystemAudioErrorCode(err)) {
    return err;
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string' && isLinuxSystemAudioErrorCode(message)) {
      return message;
    }
  }
  return null;
}
