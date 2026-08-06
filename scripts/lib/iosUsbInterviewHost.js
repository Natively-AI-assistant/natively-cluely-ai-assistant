'use strict';

/**
 * Detect likely Mac IPv4 addresses for iOS USB interview pairing
 * (Personal Hotspot tether / Internet Sharing bridge).
 *
 * Pure helpers — injectable `networkInterfaces` for tests.
 */

/** Classic Apple Personal Hotspot USB/Wi‑Fi client range (Mac often .2). */
const HOTSPOT_PREFIX = '172.20.10.';

/** Common Mac Internet Sharing → iPhone USB bridge. */
const INTERNET_SHARING_PREFIXES = ['192.168.2.', '192.168.3.'];

const DEFAULT_PORT = 4123;

/** @typedef {{ name: string, address: string, family: string|number, internal: boolean }} NetIfaceAddr */

/**
 * @param {string} address
 * @returns {boolean}
 */
function isHotspotUsbAddress(address) {
  if (!address || typeof address !== 'string') return false;
  if (!address.startsWith(HOTSPOT_PREFIX)) return false;
  const last = Number(address.slice(HOTSPOT_PREFIX.length));
  return Number.isInteger(last) && last >= 1 && last <= 14;
}

/**
 * @param {string} address
 * @returns {boolean}
 */
function isInternetSharingBridgeAddress(address) {
  if (!address || typeof address !== 'string') return false;
  return INTERNET_SHARING_PREFIXES.some((p) => address.startsWith(p));
}

/**
 * @param {string} ifaceName
 * @returns {boolean}
 */
function isBridgeIface(ifaceName) {
  return typeof ifaceName === 'string' && /^bridge\d+$/i.test(ifaceName);
}

/**
 * Rank candidates: Personal Hotspot first, then Internet Sharing (often on bridge*).
 * Do not treat arbitrary bridge IPs (e.g. Parallels 192.168.64.x) as USB.
 * @param {{ iface: string, address: string, kind: string }} a
 * @param {{ iface: string, address: string, kind: string }} b
 */
function compareCandidates(a, b) {
  const rank = (c) => {
    if (c.kind === 'personal-hotspot') return 0;
    if (c.kind === 'internet-sharing') return 1;
    return 9;
  };
  const d = rank(a) - rank(b);
  if (d !== 0) return d;
  // Prefer bridge* when both are internet-sharing (Mac Sharing → iPhone USB).
  if (a.kind === 'internet-sharing' && b.kind === 'internet-sharing') {
    const aBridge = isBridgeIface(a.iface) ? 0 : 1;
    const bBridge = isBridgeIface(b.iface) ? 0 : 1;
    if (aBridge !== bBridge) return aBridge - bBridge;
  }
  return a.address.localeCompare(b.address, 'en');
}

/**
 * @param {Record<string, NetIfaceAddr[]|undefined>} [interfaces]
 * @returns {Array<{ iface: string, address: string, kind: string }>}
 */
function findUsbInterviewHosts(interfaces) {
  const ifaces = interfaces || require('node:os').networkInterfaces();
  /** @type {Array<{ iface: string, address: string, kind: string }>} */
  const out = [];

  for (const [name, addrs] of Object.entries(ifaces || {})) {
    if (!Array.isArray(addrs)) continue;
    for (const addr of addrs) {
      if (!addr || addr.internal) continue;
      const family = addr.family;
      const isV4 = family === 'IPv4' || family === 4;
      if (!isV4) continue;
      const address = addr.address;
      if (isHotspotUsbAddress(address)) {
        out.push({ iface: name, address, kind: 'personal-hotspot' });
        continue;
      }
      // Internet Sharing → iPhone USB often lands on bridge100 as 192.168.2.1.
      // Ignore other bridge addresses (VM hypervisors, etc.).
      if (isInternetSharingBridgeAddress(address)) {
        out.push({ iface: name, address, kind: 'internet-sharing' });
      }
    }
  }

  out.sort(compareCandidates);
  return out;
}

/**
 * @param {Array<{ iface: string, address: string, kind: string }>} candidates
 * @returns {string|null}
 */
function pickSuggestedHost(candidates) {
  if (!candidates || candidates.length === 0) return null;
  return candidates[0].address;
}

/**
 * Default host shown in RN Pairing USB tip when helper has not run yet.
 * Override with helper output when the Mac's tether IP differs.
 */
const PAIRING_USB_HOST_HINT = '172.20.10.2';

/**
 * @param {object} opts
 * @param {string} [opts.platform]
 * @param {Array<{ iface: string, address: string, kind: string }>} [opts.candidates]
 * @param {number|string} [opts.port]
 * @returns {{
 *   platform: string,
 *   supported: boolean,
 *   port: number,
 *   suggestedHost: string|null,
 *   hostHint: string,
 *   candidates: Array<{ iface: string, address: string, kind: string }>,
 *   windowsGap: boolean,
 *   message: string,
 * }}
 */
function buildReport(opts = {}) {
  const platform = opts.platform || process.platform;
  const port = Number(opts.port) > 0 ? Number(opts.port) : DEFAULT_PORT;
  const candidates = Array.isArray(opts.candidates)
    ? opts.candidates
    : findUsbInterviewHosts(opts.interfaces);
  const suggestedHost = pickSuggestedHost(candidates);
  const windowsGap = platform === 'win32';

  if (windowsGap) {
    return {
      platform,
      supported: false,
      port,
      suggestedHost: null,
      hostHint: PAIRING_USB_HOST_HINT,
      candidates: [],
      windowsGap: true,
      message:
        'Windows USB interview path is not verified in this ticket. Use Tailscale or LAN for Windows desks, or run the Mac Personal Hotspot USB path on a Mac.',
    };
  }

  if (platform !== 'darwin') {
    return {
      platform,
      supported: false,
      port,
      suggestedHost: null,
      hostHint: PAIRING_USB_HOST_HINT,
      candidates: [],
      windowsGap: false,
      message: `Unsupported platform for iOS USB interview helper: ${platform}. Documented path is macOS + iPhone Personal Hotspot over USB.`,
    };
  }

  if (!suggestedHost) {
    return {
      platform,
      supported: true,
      port,
      suggestedHost: null,
      hostHint: PAIRING_USB_HOST_HINT,
      candidates,
      windowsGap: false,
      message:
        'No USB/tether IPv4 detected yet. Plug in the iPhone, enable Personal Hotspot, then re-run. Pairing tip host is usually 172.20.10.2.',
    };
  }

  return {
    platform,
    supported: true,
    port,
    suggestedHost,
    hostHint: PAIRING_USB_HOST_HINT,
    candidates,
    windowsGap: false,
    message: `Suggested Phone Mirror host for RN Pairing: ${suggestedHost} (port ${port}).`,
  };
}

module.exports = {
  DEFAULT_PORT,
  PAIRING_USB_HOST_HINT,
  HOTSPOT_PREFIX,
  isHotspotUsbAddress,
  isInternetSharingBridgeAddress,
  isBridgeIface,
  findUsbInterviewHosts,
  pickSuggestedHost,
  buildReport,
};
