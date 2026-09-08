// electron/llm/performance/networkProfile.ts
//
// A stable, LOCAL, non-identifying label for "the network this machine is on
// right now", so that a profile measured on home fibre does not size the
// deadline for the same provider on a phone hotspot.
//
// PRIVACY POSTURE (Phase 24). This is a local performance key, not a location
// signal. Two rules make it one:
//
//   1. Nothing identifying is STORED. The raw inputs (MAC addresses, IPv4
//      addresses) are hashed and truncated; the profile file holds an opaque
//      12-hex label and a coarse interface class, never an address.
//   2. Nothing here is TRANSMITTED. The telemetry emitter deliberately sends
//      the interface CLASS ('wifi' | 'ethernet' | 'other') and not the id — a
//      per-network id leaving the device would be a location beacon, which is
//      exactly the "surveillance system" Phase L rules out.
//
// CROSS-PLATFORM (CLAUDE.md is non-negotiable here). `os.networkInterfaces()`
// exists on both macOS and Windows but says entirely different things on each:
// macOS names interfaces `en0`/`en1`/`utun3`, Windows names them "Wi-Fi",
// "Ethernet", "Local Area Connection* 2". Neither naming can be read by the
// other's rules, so the classifier below has an explicit `darwin` branch and an
// explicit `win32` branch and throws on neither — an unknown platform degrades
// to 'other', which is a valid class that simply carries less information.
//
// The platform and the interface reader are both INJECTED, so a test can
// exercise the Windows branch from macOS and vice versa. Per CLAUDE.md's
// testing section: "Platform detection should be injectable where practical" and
// "Do not mutate process.platform directly."

import { createHash } from 'node:crypto';
import os from 'node:os';

/** Coarse interface class. Safe to transmit; the id is not. */
export type InterfaceClass = 'wifi' | 'ethernet' | 'cellular' | 'loopback' | 'other';

export interface NetworkProfile {
  /** Opaque 12-hex local label. Never leaves the device. */
  id: string;
  /** Coarse class, safe for telemetry. */
  interfaceClass: InterfaceClass;
  /** True when no usable external interface was found (offline / all down). */
  offline: boolean;
}

/** The shape `os.networkInterfaces()` returns, narrowed to what we read. */
export interface RawInterfaceInfo {
  address: string;
  mac: string;
  internal: boolean;
  family: string | number;
}
export type RawInterfaces = Record<string, RawInterfaceInfo[] | undefined>;

export const OFFLINE_NETWORK_PROFILE: NetworkProfile = {
  id: 'offline',
  interfaceClass: 'other',
  offline: true,
};

/**
 * Classify one interface NAME on one platform.
 *
 * Exported so the platform matrix can be tested directly, which is the only way
 * the Windows branch gets exercised from a macOS dev machine.
 */
export function classifyInterfaceName(name: string, platform: NodeJS.Platform): InterfaceClass {
  const n = name.toLowerCase();
  // NO SHARED PREFIX CHECK BEFORE THE PLATFORM BRANCHES. A generic
  // `startsWith('lo')` loopback test looks obviously right and is wrong on
  // Windows, where "Local Area Connection* 12" is a real ETHERNET adapter: it
  // would be classed loopback, skipped by computeNetworkProfile, and a Windows
  // machine whose only adapter is named that way would report OFFLINE and lose
  // its network profile entirely. Caught by the win32 branch of the classifier
  // test, which is the whole reason `platform` is injected rather than read.
  // Every rule below therefore lives inside the branch that owns its naming.
  if (platform === 'darwin') {
    if (n.startsWith('lo')) return 'loopback';
    // macOS: en0 is Wi-Fi on laptops and Ethernet on desktops, which is not
    // decidable from the name alone — 'wifi' is the useful default for a
    // laptop-shaped product, and getting it wrong only mislabels a class, it
    // never merges two different networks (the id is hashed from addresses).
    if (n === 'en0' || n.startsWith('awdl') || n.startsWith('llw')) return 'wifi';
    if (n.startsWith('en')) return 'ethernet';
    if (n.startsWith('bridge') || n.startsWith('ap')) return 'other';
    // iPhone USB / Personal Hotspot over cable surfaces as a `en`/`iPhone` pair;
    // the tethered case is worth its own class because its latency is a phone's.
    if (n.includes('iphone') || n.startsWith('pdp_ip')) return 'cellular';
    if (n.startsWith('utun') || n.startsWith('ipsec') || n.startsWith('gif') || n.startsWith('stf')) return 'other';
    return 'other';
  }

  if (platform === 'win32') {
    // Windows friendly names, including the localised-adjacent forms Windows
    // generates for virtual adapters ("Local Area Connection* 12").
    if (n.includes('wi-fi') || n.includes('wifi') || n.includes('wireless')) return 'wifi';
    if (n.includes('ethernet') || n.includes('local area connection')) return 'ethernet';
    if (n.includes('cellular') || n.includes('mobile broadband')) return 'cellular';
    if (n.includes('loopback')) return 'loopback';
    return 'other';
  }

  return 'other';
}

/**
 * Rank interface classes so a machine on both Wi-Fi and a VPN tunnel picks the
 * one that actually characterises its latency. Higher wins.
 */
const CLASS_RANK: Record<InterfaceClass, number> = {
  ethernet: 4,
  wifi: 3,
  cellular: 2,
  other: 1,
  loopback: 0,
};

/**
 * Reduce an IPv4 address to its /24, or an IPv6 to its /64.
 *
 * The SUBNET rather than the address is deliberate: a DHCP lease change on the
 * same network must not look like a new network (which would discard that
 * network's evidence every few days), while a genuinely different network
 * almost always differs in its prefix.
 */
export function subnetOf(address: string, family: string | number): string {
  const fam = typeof family === 'number' ? (family === 4 ? 'IPv4' : 'IPv6') : String(family);
  if (fam === 'IPv4') {
    const parts = address.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : address;
  }
  const groups = address.split(':');
  return groups.length >= 4 ? `${groups.slice(0, 4).join(':')}::/64` : address;
}

/**
 * Compute the current network profile.
 *
 * `readInterfaces` and `platform` are injected so both platform branches are
 * reachable from either OS in tests.
 */
export function computeNetworkProfile(opts: {
  platform: NodeJS.Platform;
  readInterfaces: () => RawInterfaces;
}): NetworkProfile {
  let raw: RawInterfaces;
  try {
    raw = opts.readInterfaces() ?? {};
  } catch {
    // Never let network detection break a request. An unknown network is a
    // valid state: it falls back to the provider/model tier of the hierarchy.
    return OFFLINE_NETWORK_PROFILE;
  }

  const candidates: Array<{ cls: InterfaceClass; token: string }> = [];
  for (const [name, infos] of Object.entries(raw)) {
    if (!infos) continue;
    const cls = classifyInterfaceName(name, opts.platform);
    if (cls === 'loopback') continue;
    for (const info of infos) {
      if (!info || info.internal) continue;
      if (!info.address) continue;
      // The MAC is the stable part (survives a DHCP change); the subnet is the
      // part that actually changes between networks. Both are hashed together
      // and neither is retained in the clear.
      candidates.push({ cls, token: `${info.mac || ''}|${subnetOf(info.address, info.family)}` });
    }
  }

  if (candidates.length === 0) return OFFLINE_NETWORK_PROFILE;

  candidates.sort((a, b) => CLASS_RANK[b.cls] - CLASS_RANK[a.cls] || a.token.localeCompare(b.token));
  const best = candidates[0];
  // Hash EVERY candidate token, not just the winner: two networks that happen to
  // share a router MAC but differ in everything else must not collide.
  const material = candidates.map((c) => c.token).sort().join('#');
  const id = createHash('sha256').update(material).digest('hex').slice(0, 12);
  return { id, interfaceClass: best.cls, offline: false };
}

/** Production entry point. Wraps the injected form with the real platform + os. */
export function currentNetworkProfile(): NetworkProfile {
  return computeNetworkProfile({
    platform: process.platform,
    readInterfaces: () => os.networkInterfaces() as unknown as RawInterfaces,
  });
}

/**
 * The lookup ladder for a profile key (Phase 9).
 *
 * Most specific first. This is what stops a profile explosion: a machine that
 * moves between five networks has five entries for its ONE provider+model, and
 * a sixth network starts from the provider+model tier rather than from nothing.
 */
export function profileLookupChain(
  providerId: string,
  modelId: string,
  networkProfileId: string,
): string[] {
  return [
    `${providerId}|${modelId}|${networkProfileId}`,
    `${providerId}|${modelId}|*`,
    `${providerId}|*|*`,
  ];
}

export function profileKey(providerId: string, modelId: string, networkProfileId: string): string {
  return `${providerId}|${modelId}|${networkProfileId}`;
}
