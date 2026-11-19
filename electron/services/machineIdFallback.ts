/**
 * The device id the native module would give, read without it (2026-11-19).
 *
 * WHY. The free trial is bound to the machine by the native module's
 * getHardwareId(): SHA-256 of the `machine-uid` crate's id (native-module/src/
 * license.rs). When that module does not load, the trial refuses to start
 * (F-601: the 'unavailable' sentinel would put every such machine on ONE trial
 * row). Funnel 11-09..19: 23 installs (8 macOS, 12 Windows, 3 Linux) hit that on
 * every start and none ever got a trial, while 15 of them got answers on their
 * own AI, so the rest of the app worked.
 *
 * WHAT. The same id, read the way machine-uid 0.5.4 reads it:
 *   - macOS:   IOPlatformUUID from `ioreg -rd1 -c IOPlatformExpertDevice`
 *   - Windows: HKLM\SOFTWARE\Microsoft\Cryptography MachineGuid (64-bit view)
 *   - Linux:   /var/lib/dbus/machine-id, else /etc/machine-id
 * then SHA-256 hex, so a machine whose native module loads later gets the same
 * id (no second trial). The native code falls back to the host name when the
 * machine id cannot be read; this does NOT: a shared name ("unknown-device", a
 * default Mac name) would put strangers on one trial row, the exact F-601 bug.
 * No id: null, and the trial stays refused.
 *
 * Platform and process access are passed in, so both branches are tested on
 * any machine. Windows: reg.exe is run once, only when the native read failed,
 * with windowsHide and a short timeout, so no console window appears.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type MachineIdSource = 'ioreg' | 'registry' | 'machine_id_file';

export interface MachineIdDeps {
  platform: NodeJS.Platform;
  /** Runs a program with arguments (never a shell); resolves its stdout. */
  execFile(file: string, args: string[], opts: { timeout: number; windowsHide: boolean }): Promise<string>;
  readFile(path: string): Promise<string>;
  env: Record<string, string | undefined>;
}

const TIMEOUT_MS = 3_000;

/** machine-uid's macOS parse: the IOPlatformUUID line, the value after the last '=', quotes and spaces trimmed. */
export function parseIoregPlatformUuid(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    if (!line.includes('IOPlatformUUID')) continue;
    const at = line.lastIndexOf('=');
    const id = (at >= 0 ? line.slice(at + 1) : line).replace(/^[\s"]+|[\s"]+$/g, '');
    return id || null;
  }
  return null;
}

/** `reg query ... /v MachineGuid` prints `    MachineGuid    REG_SZ    <guid>`. */
export function parseRegMachineGuid(stdout: string): string | null {
  const m = stdout.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
  return m ? m[1].trim() : null;
}

export function hashMachineId(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** The raw machine id and where it came from, or null. Never throws. */
export async function readMachineId(d: MachineIdDeps): Promise<{ raw: string; source: MachineIdSource } | null> {
  try {
    switch (d.platform) {
      case 'darwin': {
        const out = await d.execFile('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: TIMEOUT_MS, windowsHide: true });
        const raw = parseIoregPlatformUuid(out);
        return raw ? { raw, source: 'ioreg' } : null;
      }
      case 'win32': {
        // reg.exe from the Windows directory, not whatever 'reg' PATH finds.
        const root = d.env.SystemRoot || d.env.windir;
        if (!root) return null;
        // path.win32 on purpose: the same answer whatever runs the tests.
        const reg = path.win32.join(root, 'System32', 'reg.exe');
        const out = await d.execFile(reg, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { timeout: TIMEOUT_MS, windowsHide: true });
        const raw = parseRegMachineGuid(out);
        return raw ? { raw, source: 'registry' } : null;
      }
      case 'linux': {
        for (const p of ['/var/lib/dbus/machine-id', '/etc/machine-id']) {
          try {
            const raw = (await d.readFile(p)).trim();
            if (raw) return { raw, source: 'machine_id_file' };
          } catch { /* the next file */ }
        }
        return null;
      }
      default:
        // No machine-id source known for this platform: refuse, never guess.
        return null;
    }
  } catch {
    return null;
  }
}

/** The native module's getHardwareId() value, computed without it, or null. */
export async function machineHardwareIdFallback(d: MachineIdDeps): Promise<{ hwid: string; source: MachineIdSource } | null> {
  const id = await readMachineId(d);
  return id ? { hwid: hashMachineId(id.raw), source: id.source } : null;
}

/** The deps for the running process. */
export function liveMachineIdDeps(): MachineIdDeps {
  return {
    platform: process.platform,
    execFile: (file, args, opts) => new Promise((resolve, reject) => {
      execFile(file, args, { ...opts, encoding: 'utf8' }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
    }),
    readFile: (p) => readFile(p, 'utf8'),
    env: process.env,
  };
}
