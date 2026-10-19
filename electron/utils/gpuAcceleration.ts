// GPU-acceleration kill switch, decision logic. Pure module — no electron
// import: main.ts must decide before app.whenReady() (Chromium latches
// hardware acceleration at GPU-process start), where SettingsManager still
// throws (SettingsManager.getInstance() requires ready), and the unit test
// drives the compiled module under plain node.
//
// Why this exists: patched or legacy GPUs — OpenCore Legacy Patcher machines
// on macOS 12 (Kepler), old Intel drivers, some Windows RDP/driver setups —
// can render a blank or white window or drop the transparent overlay
// entirely. Turning Chromium GPU acceleration off from the next launch is
// the standard remedy, on both platforms.
import fs from 'node:fs';
import path from 'node:path';

/**
 * NATIVELY_DISABLE_GPU wins over the stored setting: '1' forces acceleration
 * off, '0' forces it on (useful to undo a setting that made things worse
 * without editing settings.json by hand). Otherwise the `disableGpuAcceleration`
 * setting decides. A null or malformed settings text reads as "off" — the
 * default stays acceleration on.
 */
export function shouldDisableGpu(env: NodeJS.ProcessEnv, settingsJsonText: string | null): boolean {
  const flag = env.NATIVELY_DISABLE_GPU;
  if (flag === '1') return true;
  if (flag === '0') return false;
  if (!settingsJsonText) return false;
  try {
    return JSON.parse(settingsJsonText).disableGpuAcceleration === true;
  } catch {
    return false;
  }
}

/** Best-effort synchronous read of `<userData>/settings.json`; null when absent or unreadable. */
export function readSettingsTextSync(userDataDir: string): string | null {
  try {
    return fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8');
  } catch {
    return null;
  }
}
