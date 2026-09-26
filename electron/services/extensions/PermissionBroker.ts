/**
 * Mediates every filesystem and network request an extension makes.
 *
 * This module is a PURE DECISION FUNCTION: it takes a grant and a request and
 * returns allow/deny plus a reason. It performs no I/O and touches no globals,
 * so both platform branches are exercisable from one machine. Phase 2 wires the
 * enforcement points (the broker-mediated shims in the extension host) to it;
 * the decision logic does not change when that lands.
 *
 * Two invariants:
 *   1. Deny by default. Every path through `decide` that is not an explicit
 *      allow returns a denial, and an unknown request kind denies.
 *   2. Every denial is returned with a reason so the host can log it.
 *
 * SCOPE, stated plainly: this is defence in depth against a sloppy extension,
 * not a security boundary against a hostile one. An extension granted
 * `process.spawn` can run a declared binary and that binary is outside this
 * broker's reach. That is exactly why install requires a trust prompt showing
 * the requested permissions, and why `network.remote` and `filesystem.workspace`
 * additionally warn.
 */

import * as path from 'path';
import {
  isExtensionPermission,
  type ExtensionPermission,
} from './types';

// ---------------------------------------------------------------------------
// Requests and decisions
// ---------------------------------------------------------------------------

export type PermissionRequest =
  | { kind: 'filesystem.read'; path: string }
  | { kind: 'filesystem.write'; path: string }
  | { kind: 'network.connect'; host: string; port: number }
  | { kind: 'process.spawn'; binary: string };

export interface PermissionGrant {
  extensionId: string;
  /** Permissions declared in the manifest AND accepted by the user at install. */
  granted: readonly ExtensionPermission[];
  /** Absolute path to this extension's own model directory. */
  modelDir: string;
  /** Hosts allowed under `network.remote`. Ignored without that permission. */
  allowedHosts?: readonly string[];
  /** Binaries allowed under `process.spawn`. Ignored without that permission. */
  allowedBinaries?: readonly string[];
  /**
   * Absolute workspace path the user granted FOR THIS SESSION under
   * `filesystem.workspace`. Absent means the session grant was never given,
   * and workspace reads are denied even if the permission is in the manifest.
   */
  workspaceDir?: string;
}

export type PermissionDecision =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string };

const deny = (reason: string): PermissionDecision => ({ allowed: false, reason });
const allow = (reason: string): PermissionDecision => ({ allowed: true, reason });

// ---------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------

export interface PermissionBroker {
  decide(grant: PermissionGrant, request: PermissionRequest): PermissionDecision;
}

/**
 * Platform is a PARAMETER, not a `process.platform` read, so a single test run
 * can exercise the win32 and darwin containment rules. Filesystem case
 * sensitivity is the only thing that actually differs.
 */
export function createPermissionBroker(platform: NodeJS.Platform): PermissionBroker {
  const caseInsensitive = platform === 'win32' || platform === 'darwin';

  // Path math must follow the TARGET platform, not the one this code happens to
  // be running on. `path` is `path.win32` on Windows and `path.posix`
  // elsewhere, so selecting the namespace explicitly makes the broker behave
  // identically in production AND makes the win32 containment rules verifiable
  // from macOS. Using the ambient `path` here silently treated "C:\\models\\x"
  // as a single filename on posix, and every containment check passed.
  const p = platform === 'win32' ? path.win32 : path.posix;

  function contains(baseDir: string, target: string): boolean {
    // Reject before resolving: a NUL byte truncates the path in some syscalls,
    // so a containment check on the JS string would not describe what the OS
    // actually opens.
    if (target.includes('\0') || baseDir.includes('\0')) return false;

    const base = p.resolve(baseDir);
    const resolved = p.resolve(base, target);

    const a = caseInsensitive ? base.toLowerCase() : base;
    const b = caseInsensitive ? resolved.toLowerCase() : resolved;

    if (a === b) return true;

    const rel = p.relative(a, b);
    // Escapes the base (`..`), or resolves onto a different root/drive
    // (`path.relative` returns an absolute path across win32 drive letters).
    if (rel === '' ) return true;
    if (rel.startsWith('..')) return false;
    if (p.isAbsolute(rel)) return false;
    return true;
  }

  function has(grant: PermissionGrant, permission: ExtensionPermission): boolean {
    return grant.granted.includes(permission);
  }

  return {
    decide(grant, request): PermissionDecision {
      // A grant carrying a permission string outside the closed set is a
      // corrupted or hand-edited registry entry. Refuse the whole grant rather
      // than ignoring the unknown entry and honouring the rest.
      for (const p of grant.granted) {
        if (!isExtensionPermission(p)) {
          return deny(`grant contains an unknown permission "${String(p)}"`);
        }
      }

      switch (request.kind) {
        case 'filesystem.read':
        case 'filesystem.write': {
          const write = request.kind === 'filesystem.write';

          if (has(grant, 'filesystem.models') && contains(grant.modelDir, request.path)) {
            return allow(`filesystem.models: inside ${grant.extensionId}'s model directory`);
          }

          // Workspace is READ-ONLY, and only for the session-granted directory.
          if (!write && has(grant, 'filesystem.workspace')) {
            if (!grant.workspaceDir) {
              return deny('filesystem.workspace: no workspace directory granted this session');
            }
            if (contains(grant.workspaceDir, request.path)) {
              return allow('filesystem.workspace: read inside the session-granted workspace');
            }
            return deny('filesystem.workspace: path is outside the session-granted workspace');
          }
          if (write && has(grant, 'filesystem.workspace')) {
            return deny('filesystem.workspace grants read-only access; writes are never permitted');
          }

          return deny(
            has(grant, 'filesystem.models')
              ? `path is outside ${grant.extensionId}'s model directory`
              : 'no filesystem permission granted',
          );
        }

        case 'network.connect': {
          if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65535) {
            return deny(`invalid port ${String(request.port)}`);
          }

          if (isLoopback(request.host)) {
            return has(grant, 'network.localhost')
              ? allow('network.localhost: loopback address')
              : deny('loopback connection requires "network.localhost"');
          }

          if (!has(grant, 'network.remote')) {
            return deny('remote connection requires "network.remote"');
          }
          // Belt and braces: the manifest schema already refuses to validate a
          // `network.remote` manifest with an empty allowlist, but a grant can
          // also come from the registry file on disk.
          const hosts = grant.allowedHosts ?? [];
          if (hosts.length === 0) {
            return deny('network.remote granted with an empty host allowlist');
          }
          if (!hostAllowed(request.host, hosts)) {
            return deny(`host "${request.host}" is not in the manifest allowlist`);
          }
          return allow('network.remote: host is in the manifest allowlist');
        }

        case 'process.spawn': {
          if (!has(grant, 'process.spawn')) {
            return deny('spawning a process requires "process.spawn"');
          }
          const binaries = grant.allowedBinaries ?? [];
          if (binaries.length === 0) {
            return deny('process.spawn granted with an empty binary allowlist');
          }
          if (!binaryAllowed(request.binary, binaries, caseInsensitive)) {
            return deny(`binary "${request.binary}" is not in the manifest allowlist`);
          }
          return allow('process.spawn: binary is in the manifest allowlist');
        }

        default: {
          // Exhaustiveness: a new request kind that forgets a case lands here
          // and is DENIED, and the never-assignment makes it a compile error.
          const exhaustive: never = request;
          return deny(`unknown request kind ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Host / binary matching
// ---------------------------------------------------------------------------

export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  // The whole 127.0.0.0/8 block, not just 127.0.0.1.
  return /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/.test(h);
}

/**
 * Exact host match, or a single leading-wildcard label (`*.example.com`).
 * A bare `*` is NOT a wildcard for everything — an allowlist that allows
 * everything is not an allowlist.
 */
function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.trim().toLowerCase();
  for (const raw of allowed) {
    const entry = raw.trim().toLowerCase();
    if (!entry || entry === '*') continue;
    if (entry === h) return true;
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".example.com"
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    }
  }
  return false;
}

/**
 * Compares the basename, with the Windows executable extension tolerated, so a
 * manifest declaring `llama-server` matches `llama-server.exe` on win32 without
 * the manifest needing a platform branch.
 */
function binaryAllowed(
  binary: string,
  allowed: readonly string[],
  caseInsensitive: boolean,
): boolean {
  const norm = (s: string): string => {
    const base = path.basename(s.trim().replace(/\\/g, '/'));
    const stripped = base.replace(/\.(exe|cmd|bat|com)$/i, '');
    return caseInsensitive ? stripped.toLowerCase() : stripped;
  };
  const target = norm(binary);
  if (!target) return false;
  return allowed.some((a) => norm(a) === target);
}
