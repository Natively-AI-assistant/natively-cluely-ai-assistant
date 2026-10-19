export interface EnumeratedInputDevice {
  id: string;
  name: string;
}

export type InputDeviceResolution =
  | { status: 'default' }
  | { status: 'matched'; id: string; name: string; tier: 0 | 1 | 2 }
  | { status: 'missing'; available: string[] }
  | { status: 'unverifiable' };

export const INTERNAL_CAPTURE_DEVICE_NAMES: readonly string[];

export function normalizeDeviceName(value: string | null | undefined): string;

export function isInternalCaptureDevice(idOrName: string | null | undefined): boolean;

export function filterSelectableDevices<T extends EnumeratedInputDevice>(
  devices: T[] | null | undefined,
): T[];

export function resolveRequestedInputDevice(
  requestedId: string | null | undefined,
  devices: EnumeratedInputDevice[] | null | undefined,
): InputDeviceResolution;

export const SYSTEM_AUDIO_INPUT_PREFIX: string;

export function systemAudioOutputDeviceId(opts: {
  isMac: boolean;
  preferredOutput?: string | null;
  useSck?: boolean;
  virtualInputDevice?: string | null;
}): string | null;
