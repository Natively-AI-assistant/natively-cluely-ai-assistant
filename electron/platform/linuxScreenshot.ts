import path from 'node:path';

/** Install hint when no Linux screenshot CLI is available. */
export const LINUX_SCREENSHOT_INSTALL_HINT =
  'Install a screenshot tool: sudo apt install scrot  OR  sudo apt install gnome-screenshot  OR  sudo apt install imagemagick';

/**
 * Defense-in-depth guard: screenshot shell commands must only run for paths
 * under the app's userData directory.
 */
export function assertScreenshotPathWithinUserData(
  outputPath: string,
  userDataDir: string,
): void {
  const resolvedOutput = path.resolve(outputPath);
  const resolvedUserData = path.resolve(userDataDir);
  const userDataPrefix = resolvedUserData.endsWith(path.sep)
    ? resolvedUserData
    : `${resolvedUserData}${path.sep}`;

  if (
    resolvedOutput !== resolvedUserData &&
    !resolvedOutput.startsWith(userDataPrefix)
  ) {
    throw new Error(
      `[ScreenshotHelper] Refusing shell command for path outside userData: ${outputPath}`,
    );
  }
}

/** Marker the shared-desktop launcher writes (nested display, e.g. ":1") while it runs. */
export const SHARED_DESKTOP_DISPLAY_MARKER = path.join(
  process.env.HOME ?? '',
  '.local/share/shared-desktop/display',
);

export interface CaptureDisplayDeps {
  env: Record<string, string | undefined>;
  /** Marker file contents, or null when there is no marker. */
  readMarker: () => string | null;
  /** True when the X display's socket exists (the server is up). */
  displayIsUp: (display: string) => boolean;
}

/**
 * Which X display Linux screenshots capture. null = Natively's own display.
 *
 * NATIVELY_CAPTURE_DISPLAY wins (an invalid value throws — it is an explicit
 * instruction). Otherwise the shared-desktop marker is used while its display
 * is up; a stale marker (display gone, e.g. after a crash) is ignored with a
 * warning so screenshots keep working on the real desktop.
 */
export function resolveLinuxCaptureDisplay(deps: CaptureDisplayDeps): string | null {
  const isDisplay = (v: string) => /^:\d+$/.test(v);

  const explicit = deps.env.NATIVELY_CAPTURE_DISPLAY?.trim();
  if (explicit) {
    if (!isDisplay(explicit)) {
      throw new Error(`[ScreenshotHelper] NATIVELY_CAPTURE_DISPLAY must look like ":1", got "${explicit}"`);
    }
    return explicit;
  }

  const marker = deps.readMarker()?.trim();
  if (!marker) return null;
  if (!isDisplay(marker)) {
    console.warn(`[ScreenshotHelper] Ignoring malformed shared-desktop marker: "${marker}"`);
    return null;
  }
  if (!deps.displayIsUp(marker)) {
    console.warn(`[ScreenshotHelper] Shared-desktop marker points at ${marker}, which is not running — capturing own display.`);
    return null;
  }
  return marker;
}

/** Shell command capturing an explicit X display (validated ":N"). */
export function buildDisplayScreenshotCommand(display: string, safePath: string, interactive: boolean): string {
  if (!/^:\d+$/.test(display)) throw new Error(`[ScreenshotHelper] Invalid X display: ${display}`);
  // gnome-screenshot is skipped: it asks the desktop shell, which captures the host display.
  return interactive
    ? `DISPLAY=${display} scrot -s "${safePath}" 2>/dev/null || import -display ${display} "${safePath}"`
    : `import -display ${display} -window root "${safePath}" 2>/dev/null || DISPLAY=${display} scrot "${safePath}"`;
}
