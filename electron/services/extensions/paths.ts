/**
 * Every filesystem location the extension system uses, derived in ONE place.
 *
 * The root is `~/.natively/` (chosen deliberately over `app.getPath('userData')`
 * so the tree is user-visible and inspectable outside the app sandbox). It is
 * built with `os.homedir()` + `path.join`, so it resolves correctly on both
 * macOS (`/Users/x/.natively`) and Windows (`C:\Users\x\.natively`) including
 * drive letters, spaces and unicode. No path in this subsystem is ever built by
 * string concatenation, and no platform-specific literal appears anywhere else.
 *
 * `extensionsRoot()` takes an optional override so tests can point the whole
 * subsystem at a temp dir without mutating HOME or `process.platform`.
 */

import * as os from 'os';
import * as path from 'path';

/** Environment variable that relocates the entire tree (tests, power users). */
export const EXTENSIONS_ROOT_ENV = 'NATIVELY_EXTENSIONS_ROOT';

const ROOT_DIR_NAME = '.natively';

/** `~/.natively` — or the env override, if set to a non-empty value. */
export function nativelyHome(overrideRoot?: string): string {
  const override = overrideRoot ?? process.env[EXTENSIONS_ROOT_ENV];
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(os.homedir(), ROOT_DIR_NAME);
}

/** `~/.natively/extensions` — installed extension payloads. */
export function extensionsRoot(overrideRoot?: string): string {
  return path.join(nativelyHome(overrideRoot), 'extensions');
}

/** `~/.natively/extensions/registry.json` — the installed-extension index. */
export function registryFile(overrideRoot?: string): string {
  return path.join(extensionsRoot(overrideRoot), 'registry.json');
}

/** `~/.natively/extensions/<id>` — one extension's unpacked payload. */
export function extensionDir(extensionId: string, overrideRoot?: string): string {
  return path.join(extensionsRoot(overrideRoot), safeSegment(extensionId));
}

/** `~/.natively/models/<id>` — one extension's private model directory. */
export function extensionModelDir(extensionId: string, overrideRoot?: string): string {
  return path.join(nativelyHome(overrideRoot), 'models', safeSegment(extensionId));
}

/** `~/.natively/licenses.json` — the acknowledgement ledger. */
export function licenseLedgerFile(overrideRoot?: string): string {
  return path.join(nativelyHome(overrideRoot), 'licenses.json');
}

/**
 * An extension id is attacker-influenced (it comes from a downloaded manifest),
 * and it is used as a PATH SEGMENT. Reject anything that could escape the
 * parent directory or collide with a Windows reserved device name, rather than
 * sanitising into a silently different directory.
 *
 * The manifest schema applies the same rule at parse time; this is the second
 * gate, at the point of use, because `extensionDir` is also reachable from the
 * registry file on disk, which a previous (or hand-edited) install wrote.
 */
export function safeSegment(id: string): string {
  if (!isSafeExtensionId(id)) {
    throw new Error(`Unsafe extension id for a path segment: ${JSON.stringify(id)}`);
  }
  return id;
}

/** Windows reserved device names — invalid as a directory name on win32. */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Lowercase alphanumerics, `-` and `.` separators, 1..64 chars, must start and
 * end alphanumeric. Rejects `.`, `..`, absolute paths, both separators, drive
 * letters, NUL, and Windows device names.
 */
export function isSafeExtensionId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > 64) return false;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(id)) return false;
  if (id.includes('..')) return false;
  if (WINDOWS_RESERVED.has(id.toLowerCase())) return false;
  return true;
}
