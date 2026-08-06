import type { PairingConfig } from './types';

/** Build Phone Mirror phone-token WebSocket URL. */
export function buildPhoneMirrorWsUrl(config: PairingConfig): string {
  const host = config.host.trim();
  const port = String(config.port).trim();
  const token = config.phoneToken.trim();
  if (!host) throw new Error('Host is required');
  if (!port) throw new Error('Port is required');
  if (!token) throw new Error('Phone token is required');
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error('Port must be an integer 1–65535');
  }
  return `ws://${host}:${portNum}/ws?t=${encodeURIComponent(token)}`;
}

/** Parse a desktop pairing URL like http://192.168.1.10:4123/?t=TOKEN */
export function parsePairingUrl(raw: string): Partial<PairingConfig> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
    const url = new URL(withScheme);
    const token = url.searchParams.get('t') || '';
    const host = url.hostname;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (!host) return null;
    return {
      host,
      port,
      phoneToken: token,
    };
  } catch {
    return null;
  }
}
