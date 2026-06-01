// intelligence-eval-real-ui/helpers/launch-natively.ts
// Launches the REAL Natively Electron app via Playwright's _electron API — the
// same `dist-electron/electron/main.js` the shipped app runs. No renderer mock,
// no backend stub. The ONLY test seam is stubbing the OS-native file-open dialog
// (dialog.showOpenDialog) so the real resume/JD upload IPC can be driven from a
// fixture path — Playwright cannot click a native OS picker, and stubbing only
// the picker (not the upload/extraction pipeline) is standard Electron testing,
// not a UI bypass.

import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../../');

export interface LaunchedApp {
  app: ElectronApplication;
  settingsWindow: () => Promise<Page>;
  overlayWindow: () => Promise<Page>;
  launcherWindow: () => Promise<Page>;
  /** Set "already onboarded" localStorage flags + reload so the launcher mounts. */
  seedCleanState: (win: Page) => Promise<void>;
  /** Stub dialog.showOpenDialog to return this absolute path on the next call. */
  primeFileDialog: (absPath: string) => Promise<void>;
  close: () => Promise<void>;
}

export function requireApiKey(): string {
  const key = process.env.NATIVELY_TEST_API_KEY?.trim() || '';
  if (!key) {
    throw new Error(
      'NATIVELY_TEST_API_KEY is not set. The real UI eval will not fabricate results.\n' +
      '  export NATIVELY_TEST_API_KEY="<your-test-key>" and rerun.'
    );
  }
  return key;
}

export async function launchNatively(opts: { userDataDir?: string; recordVideoDir?: string } = {}): Promise<LaunchedApp> {
  const key = requireApiKey();
  const mainJs = path.join(REPO_ROOT, 'dist-electron/electron/main.js');
  if (!fs.existsSync(mainJs)) {
    throw new Error(`Built main not found at ${mainJs}. Run \`node scripts/build-electron.js\` first.`);
  }

  // Isolated userData dir → (a) clean test state, (b) a per-eval single-instance
  // lock so we never collide with the user's already-running Natively (its lock
  // is keyed on userData). Without this, electron.launch fails with
  // "Another instance is already running" — a real constraint discovered in the
  // vertical-slice probe.
  const userDataDir = opts.userDataDir
    || fs.mkdtempSync(path.join(os.tmpdir(), 'natively-ui-eval-'));

  // NOTE: Playwright's _electron.launch() does NOT support `recordVideo` —
  // passing it causes the launcher to hang silently. Video capture via
  // Playwright requires browser contexts, not Electron. Artifacts are captured
  // via screenshots instead; screen recordings can be added via OS-level tools.
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NATIVELY_TEST_API_KEY: key,
      NATIVELY_UI_EVAL: '1',
    },
    timeout: 30000,
  });

  // Window accessors by route query (?window=settings / ?window=overlay).
  const windowByRoute = async (route: string, timeoutMs = 20000): Promise<Page> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const w of app.windows()) {
        if (w.url().includes(`window=${route}`)) return w;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`window=${route} did not appear within ${timeoutMs}ms (open: ${app.windows().map(w => w.url()).join(', ')})`);
  };

  // Prevent silent Node.js exit when Electron closes — without a listener,
  // EventEmitter throws the 'close' event as an uncaught exception. Also
  // catch any 'error' events on the underlying process to prevent crashes.
  app.on('close', () => { process.stdout.write('[launch] Electron app closed\n'); });
  try { app.process().on('error', (e: any) => { process.stdout.write(`[launch] Electron process error: ${e?.message || String(e)}\n`); }); } catch { /* */ }
  try { app.process().on('exit', (code: number) => { process.stdout.write(`[launch] Electron process exited with code ${code}\n`); }); } catch { /* */ }

  return {
    app,
    settingsWindow: () => windowByRoute('settings'),
    overlayWindow: () => windowByRoute('overlay'),
    launcherWindow: () => windowByRoute('launcher'),
    seedCleanState: async (win: Page) => {
      // Set all "already seen" localStorage flags so the launcher mounts without
      // onboarding modals blocking the UI. Keys discovered by reading src/:
      //   natively_seen_startup_v1         — StartupScreen gate
      //   natively_seen_profile_onboarding_v1 — profile onboarding toaster
      //   natively_seen_modes_onboarding_v5   — modes onboarding toaster (note: v5)
      //   natively_perms_shown_v1             — PermissionsToaster (blocks all clicks)
      await win.evaluate(() => {
        try {
          localStorage.setItem('natively_seen_startup_v1', 'true');
          localStorage.setItem('natively_seen_profile_onboarding_v1', 'true');
          localStorage.setItem('natively_seen_modes_onboarding_v5', 'true');
          localStorage.setItem('natively_perms_shown_v1', '1');
        } catch { /* */ }
      }).catch(() => {});
      // Mark the SupportToaster (donation toast, z-[9999]) as shown so it does
      // not appear ~10s after launch and intercept pointer events. This uses the
      // real preload bridge — the same call the dismiss button makes.
      await win.evaluate(async () => {
        try {
          const api: any = (window as any).electronAPI;
          if (api?.markDonationToastShown) await api.markDonationToastShown();
        } catch { /* */ }
      }).catch(() => {});
      // Pre-seed the premium cache so the Profile Intelligence component mounts
      // with `isPremium: true` immediately (the async licenseGetDetails call may
      // lose to the button click otherwise, opening the upgrade modal instead of
      // uploading). PI_PREMIUM_CACHE_KEY = 'pi:isPremium'. The cache is
      // intentionally persistent — we just wrote a real license, so this is
      // correct, not a bypass.
      await win.evaluate(async () => {
        try {
          const api: any = (window as any).electronAPI;
          const details = await api?.licenseGetDetails?.();
          if (details?.isPremium) {
            localStorage.setItem('pi:isPremium', '1');
            localStorage.setItem('pi:plan', details.plan || 'ultra');
          }
        } catch { /* */ }
      }).catch(() => {});
      await win.reload().catch(() => {});
      await win.waitForTimeout(1800); // extra time for React to mount fully
    },
    primeFileDialog: async (absPath: string) => {
      // Stub the next dialog.showOpenDialog in the MAIN process to return absPath.
      await app.evaluate(async ({ dialog }, p) => {
        const orig = dialog.showOpenDialog.bind(dialog);
        // @ts-ignore — one-shot override; restores itself after firing.
        dialog.showOpenDialog = async (...args: any[]) => {
          // @ts-ignore
          dialog.showOpenDialog = orig;
          return { canceled: false, filePaths: [p] };
        };
      }, absPath);
    },
    close: async () => { await app.close().catch(() => {}); },
  };
}
