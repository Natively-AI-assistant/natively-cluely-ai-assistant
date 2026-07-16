export function shouldSkipDeviceAvailabilityCheck(
  kind: 'input' | 'output',
  id: string,
): boolean {
  if (kind !== 'output' || id === 'sck') return false;

  // Stale CoreAudio Bluetooth route IDs can hang native enumeration after the
  // device disconnects. Human-readable device names (including AirPods) must
  // still be checked so a connected, explicitly selected device is preserved.
  return /^[0-9a-f]{2}(?:-[0-9a-f]{2}){5}:output$/i.test(id);
}
