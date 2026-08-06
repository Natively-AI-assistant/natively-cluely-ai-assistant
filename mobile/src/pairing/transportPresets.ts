/**
 * Pairing transport tips for usb-interview-tailscale-test.
 * USB = interview primary (Personal Hotspot over USB network — not localhost).
 * Tailscale/LAN = on-the-go / same Wi‑Fi test.
 */

export type TransportPresetId = 'usb' | 'lan' | 'tailscale';

export interface TransportPreset {
  id: TransportPresetId;
  label: string;
  /** Suggested host when applying the preset (empty = leave host unchanged). */
  hostHint: string;
  placeholder: string;
  help: string;
}

/** Classic Mac IP when iPhone Personal Hotspot is on over USB. Override via desktop helper. */
export const USB_INTERVIEW_HOST_HINT = '172.20.10.2';

export const TRANSPORT_PRESETS: TransportPreset[] = [
  {
    id: 'usb',
    label: 'USB',
    hostHint: USB_INTERVIEW_HOST_HINT,
    placeholder: '172.20.10.2 (Mac on USB hotspot)',
    help:
      'Interview primary: USB cable + iPhone Personal Hotspot. Host = Mac tether IP (often 172.20.10.2), not localhost. On the Mac run: node scripts/ios-usb-interview-host.mjs — see mobile/docs/USB-INTERVIEW.md. Phone Mirror needs Allow LAN (bind); traffic stays on the cable.',
  },
  {
    id: 'lan',
    label: 'LAN',
    hostHint: '',
    placeholder: '192.168.1.10',
    help: 'Same Wi‑Fi as the desktop. Use the LAN IP from Sync / QR. Fine for desk tests; USB is preferred for real interviews.',
  },
  {
    id: 'tailscale',
    label: 'Tailscale',
    hostHint: '',
    placeholder: '100.x.x.x or MagicDNS',
    help: 'On-the-go testing while away from the desk. Use the desktop Tailscale IP or MagicDNS name. Not the interview-day default.',
  },
];

export function getTransportPreset(id: TransportPresetId): TransportPreset {
  const found = TRANSPORT_PRESETS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`Unknown transport preset: ${id}`);
  }
  return found;
}
