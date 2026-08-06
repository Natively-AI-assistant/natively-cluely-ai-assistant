import { getTransportPreset, TRANSPORT_PRESETS, USB_INTERVIEW_HOST_HINT } from '../transportPresets';

describe('transportPresets', () => {
  it('includes USB, LAN, and Tailscale', () => {
    expect(TRANSPORT_PRESETS.map((p) => p.id)).toEqual(['usb', 'lan', 'tailscale']);
  });

  it('USB preset points at tether host hint, not localhost', () => {
    const usb = getTransportPreset('usb');
    expect(usb.hostHint).toBe(USB_INTERVIEW_HOST_HINT);
    expect(usb.hostHint).not.toBe('127.0.0.1');
    expect(usb.help.toLowerCase()).toContain('personal hotspot');
    expect(usb.help.toLowerCase()).toContain('not localhost');
  });

  it('Tailscale remains available for on-the-go', () => {
    const ts = getTransportPreset('tailscale');
    expect(ts.help.toLowerCase()).toContain('on-the-go');
  });
});
