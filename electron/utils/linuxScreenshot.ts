/**
 * Linux screenshot backends, tried in order until one writes the file.
 * macOS and Windows capture through Electron's desktopCapturer instead
 * (ScreenshotHelper.captureWithDesktopCapturer); Linux has no reliable
 * equivalent (Wayland portals prompt, X11 grabs are blocked in some sessions),
 * so it shells out to whichever tool the desktop ships. Commands are argv
 * arrays run without a shell. Pure + injectable so it tests on any OS.
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';

export type CaptureCommand = readonly [cmd: string, ...args: string[]];

export function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.XDG_SESSION_TYPE === 'wayland' || (!!env.WAYLAND_DISPLAY && env.XDG_SESSION_TYPE !== 'x11');
}

/** Ordered candidates. A Wayland session leads with the tools that work there. */
export function linuxCaptureCommands(out: string, interactive: boolean, wayland: boolean): CaptureCommand[] {
  const spectacle: CaptureCommand = interactive
    ? ['spectacle', '-b', '-n', '-r', '-o', out]
    : ['spectacle', '-b', '-n', '-f', '-o', out];
  const gnome: CaptureCommand = interactive ? ['gnome-screenshot', '-a', '-f', out] : ['gnome-screenshot', '-f', out];
  // grim (wlroots/Sway/Hyprland) is full-screen only here: a region needs slurp piped in, so interactive skips it.
  const grim: CaptureCommand = ['grim', out];
  const x11: CaptureCommand[] = [
    interactive ? ['scrot', '-s', out] : ['scrot', out],
    interactive ? ['maim', '-s', out] : ['maim', out],
    interactive ? ['import', out] : ['import', '-window', 'root', out],
  ];
  return wayland
    ? [...(interactive ? [] : [grim]), spectacle, gnome, ...x11]
    : [spectacle, gnome, ...x11];
}

export type RunCommand = (cmd: CaptureCommand) => Promise<void>;

const defaultRun: RunCommand = ([cmd, ...args]) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout: 120_000 }, (err) => (err ? reject(err) : resolve())));

const wrote = (p: string) => {
  try { return fs.statSync(p).size > 0; } catch { return false; }
};

/** Runs candidates until one leaves a non-empty file at `out`; throws if none did. */
export async function captureLinuxScreenshot(
  out: string,
  interactive: boolean,
  opts: { wayland?: boolean; run?: RunCommand; exists?: (p: string) => boolean } = {},
): Promise<void> {
  const run = opts.run ?? defaultRun;
  const exists = opts.exists ?? wrote;
  const failures: string[] = [];
  for (const c of linuxCaptureCommands(out, interactive, opts.wayland ?? isWaylandSession())) {
    try {
      await run(c);
      if (exists(out)) return;
      failures.push(`${c[0]}: no file written`);
    } catch (e) {
      failures.push(`${c[0]}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not installed' : (e as Error).message}`);
    }
  }
  throw new Error(`No screenshot tool worked (${failures.join('; ')}). Install one of: grim, spectacle, gnome-screenshot, scrot, maim.`);
}
