// scripts/devAgentSupport.mjs
//
// The decisions inside scripts/dev-agent.mjs that are worth asserting, kept
// pure and platform-injectable so BOTH branches are exercised on either OS
// (CLAUDE.md, "Testing requirements": a suite that only runs the current
// platform's branch is insufficient for shared code).

/**
 * Ports we must never hand to an agent instance. 9222 is Chrome's own default
 * remote-debugging port and 9229 is Node's inspector; attaching to either means
 * attaching to whatever else on the machine already owns it, which is precisely
 * the cross-session mix-up this launcher exists to stop.
 */
export const RESERVED_PORTS = Object.freeze([9222, 9229]);

/** @param {number} port */
export function isReservedPort(port) {
  return RESERVED_PORTS.includes(port);
}

/**
 * How to take a child process down.
 *
 * A POSIX signal does NOT take down a Windows process tree — the electron and
 * vite children each spawn their own — and CLAUDE.md forbids using signals as
 * the only shutdown mechanism for Windows processes. So win32 gets taskkill
 * with /T (tree) and /F (force); everything else gets SIGTERM.
 *
 * Arguments are returned as an ARRAY, never an interpolated string, so a path
 * or pid can never be re-parsed by a shell.
 *
 * @param {NodeJS.Platform|string} platform
 * @param {number} pid
 * @returns {{ kind: 'signal', signal: string } | { kind: 'spawn', command: string, args: string[] }}
 */
export function killPlan(platform, pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`killPlan: refusing to act on pid ${pid}`);
  }
  if (platform === 'win32') {
    return { kind: 'spawn', command: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] };
  }
  return { kind: 'signal', signal: 'SIGTERM' };
}

/**
 * The renderer dev-server port the main process should use. Mirrors
 * electron/devServerUrl.ts, which is the consumer — both must agree that a
 * junk value falls back rather than pointing every window at port 0.
 *
 * @param {string|undefined|null} raw
 * @param {number} fallback
 */
export function resolveDevPort(raw, fallback = 5180) {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}

/**
 * The Electron command line for an agent instance.
 *
 * `--user-data-dir` is what actually isolates the profile. main.ts also moves
 * userData with app.setPath() from NATIVELY_AGENT_USER_DATA, but that line runs
 * AFTER the bundle's module initialisers, and CredentialsManager captures the
 * credentials.enc path in one of them. Without the switch an agent instance
 * read the developer's real keys, and a key saved from it overwrote them.
 * Chromium applies the switch before any JS runs, and it is the same flag on
 * every platform.
 *
 * Returned as an ARRAY for spawn() without a shell, so a path with spaces stays
 * one argument on Windows and macOS alike.
 *
 * @param {string} root
 * @param {number} cdpPort
 * @param {string} userDataDir
 * @returns {string[]}
 */
export function electronArgs(root, cdpPort, userDataDir) {
  if (!userDataDir) throw new Error('electronArgs: an agent instance needs its own userData dir');
  return [root, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`];
}
