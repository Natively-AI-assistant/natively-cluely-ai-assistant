// Durable Linux profile selection and one-way migration.
//
// Electron's default Linux userData path is usually ~/.config/natively. That
// path is valid, but it has been easy for source/build cleanup workflows to
// remove or recreate it. Keep the packaged user's profile in the XDG data
// directory instead, and migrate an existing profile before Electron opens
// SQLite, settings, or credential stores.

import fs from 'node:fs';
import path from 'node:path';

const VOLATILE_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  'Crashpad',
  'Session Storage',
  'SharedStorage',
]);

function isVolatileName(name) {
  return VOLATILE_NAMES.has(name) || name.startsWith('Singleton');
}

function uniquePaths(paths) {
  return [...new Set(paths.map((value) => path.resolve(value)))];
}

/**
 * Return the durable profile plan for a packaged Linux app.
 * Test and agent profiles must remain isolated and must never touch a real
 * user's profile during unit tests or UI automation.
 */
export function resolveDurableProfile({
  platform = process.platform,
  packaged = false,
  env = process.env,
  home = env.HOME,
  xdgDataHome = env.XDG_DATA_HOME,
  xdgConfigHome = env.XDG_CONFIG_HOME,
} = {}) {
  if (platform !== 'linux' || !packaged) return null;
  if (String(env.NATIVELY_TEST_USERDATA || '').trim()) return null;
  if (String(env.NATIVELY_AGENT_USER_DATA || '').trim()) return null;

  const homeDir = path.resolve(home || '/');
  const dataRoot = path.resolve(xdgDataHome || path.join(homeDir, '.local', 'share'));
  const configRoot = path.resolve(xdgConfigHome || path.join(homeDir, '.config'));

  return {
    durablePath: path.join(dataRoot, 'natively'),
    legacyPaths: uniquePaths([
      path.join(configRoot, 'natively'),
      path.join(configRoot, 'Natively'),
    ]),
  };
}

function copyIfMissing(source, destination, copied) {
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  copied.push(destination);
}

function copyTreeIfMissing(source, destination, copied) {
  const sourceStat = fs.lstatSync(source);
  if (sourceStat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (isVolatileName(entry.name)) continue;
      copyTreeIfMissing(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        copied,
      );
    }
    return;
  }

  // A zero-byte destination can only be a failed/partial first boot. It is
  // safe to replace it with the non-empty legacy file; every other existing
  // file wins so migration can never overwrite newer user data.
  if (fs.existsSync(destination)) {
    if (path.basename(source) === 'natively.db') {
      const destinationStat = fs.statSync(destination);
      if (destinationStat.size === 0 && sourceStat.size > 0) {
        fs.copyFileSync(source, destination);
        copied.push(destination);
      }
    }
    return;
  }

  copyIfMissing(source, destination, copied);
}

/**
 * Copy only missing durable profile entries from legacy locations.
 * The legacy profile is intentionally retained as a recoverable fallback.
 */
/**
 * @param {{ durablePath: string, legacyPaths?: string[] }} options
 * @returns {{ copied: string[] }}
 */
export function migrateDurableProfile({ durablePath, legacyPaths = [] }) {
  const copied = [];
  fs.mkdirSync(durablePath, { recursive: true });

  for (const legacyPath of uniquePaths(legacyPaths)) {
    if (path.resolve(legacyPath) === path.resolve(durablePath)) continue;
    if (!fs.existsSync(legacyPath) || !fs.statSync(legacyPath).isDirectory()) continue;
    for (const entry of fs.readdirSync(legacyPath, { withFileTypes: true })) {
      if (isVolatileName(entry.name)) continue;
      copyTreeIfMissing(
        path.join(legacyPath, entry.name),
        path.join(durablePath, entry.name),
        copied,
      );
    }
  }

  return { copied };
}

export const durableProfileVolatileNames = Object.freeze([...VOLATILE_NAMES]);
