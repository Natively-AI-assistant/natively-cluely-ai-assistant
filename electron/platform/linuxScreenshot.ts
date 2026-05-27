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
