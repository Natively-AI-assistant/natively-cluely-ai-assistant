export interface EnumeratedInputDevice {
  id: string;
  name: string;
}

export type InputDeviceResolution =
  | { status: 'default' }
  | { status: 'matched'; id: string; name: string; tier: 0 | 1 | 2 }
  | { status: 'missing'; available: string[] };

export const INTERNAL_CAPTURE_DEVICE_NAMES: readonly string[];

export function normalizeDeviceName(value: string | null | undefined): string;

export function isInternalCaptureDevice(idOrName: string | null | undefined): boolean;

export function filterSelectableInputDevices<T extends EnumeratedInputDevice>(
  devices: T[] | null | undefined,
): T[];

export function resolveRequestedInputDevice(
  requestedId: string | null | undefined,
  devices: EnumeratedInputDevice[] | null | undefined,
): InputDeviceResolution;
