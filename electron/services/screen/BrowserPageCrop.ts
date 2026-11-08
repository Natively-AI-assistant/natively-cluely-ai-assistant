// BrowserPageCrop.ts
//
// The page-area crop behind #647's refusal-triggered retry (2026-10-25).
//
// A full-screen Ctrl+H capture sends the model everything on screen: the
// page AND the browser chrome around it — window title, tab strip, address
// bar, and every background tab (issue #647's refusal was preceded by a
// background "HackerRank Test Login" tab). Cropping the capture to the
// browser's page area removes exactly that strip: the model still sees the
// whole page, only the browser's own furniture goes.
//
// The crop is BEST-EFFORT and is only used as a RETRY (see ipcHandlers'
// generate-what-to-say): the first answer always goes out with the original
// capture, and a crop is attempted only when that answer came back as an
// assessment refusal. Nothing here ever modifies the user's original image.
//
// How it works, one layer per section:
//
//   1. Window enumeration (platform): which OS windows are on screen and
//      which of them belong to a browser. macOS enumerates System Events
//      via osascript; Windows walks Get-Process MainWindowTitle +
//      GetWindowRect via a one-shot PowerShell. Linux has no
//      implementation yet (crop is skipped, the retry degrades to the
//      banner alone). Both are point/DIP coordinates, matching Electron's
//      screen/Display coordinate space.
//   2. Window selection (pure): of the browser windows found, the one that
//      covers the most of the captured display.
//   3. Pixel mapping (pure): OS window/DIP space → captured-image pixel
//      space. The capture is of a display at some scale factor; the same
//      mapping ScreenshotHelper's crop math uses (size ratio, never an
//      assumed density) turns the window rectangle into image pixels.
//   4. Chrome subtraction (pure): the browser's own top strip — title bar,
//      tab strip, address bar — is trimmed from the top edge, clamped to a
//      fraction of the window so a bad estimate can never eat the page.
//
// Everything below the first section is pure and unit-tested; the shell
// commands are thin and only glue.

import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Run a program with argv arguments — no shell. Scripts passed as a single
 * argument arrive byte-for-byte (newlines, quotes and all); JSON.stringify
 * quoting through exec() does not (its \n escapes are kept as literal
 * backslash-n inside sh's double quotes and the script reaches osascript
 * mangled — found live, 2026-10-25).
 */
const shellRun = (cmd: string, args: string[], timeoutMs = 10000): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout: String(stdout), stderr: String(stderr) })));
  });

/**
 * Window-enumeration timeouts. These run exactly once per refusal retry, on
 * a path that already carries an LLM round-trip, so generous is cheap. The
 * macOS osascript walks EVERY application process's windows and takes ~3.5s
 * on an M-series machine (measured 2026-10-25) — a 2s timeout killed it
 * every time and made the retry silently degrade to banner-only.
 */
const ENUM_TIMEOUT_DARWIN_MS = 8000;
const ENUM_TIMEOUT_WINDOWS_MS = 10000;

/** A window as the OS reports it: screen DIP/point coordinates. */
export interface OSWindow {
  /** Owning application or process name, e.g. "Google Chrome". */
  app: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** OS process / app names that are browsers, for crop purposes. */
const BROWSER_APP_NAMES = [
  'google chrome',
  'chrome',
  'microsoft edge',
  'msedge',
  'brave browser',
  'brave',
  'arc',
  'vivaldi',
  'opera',
  'chromium',
  'firefox',
  'safari',
];

export function isBrowserAppName(name: string): boolean {
  const n = String(name || '').trim().toLowerCase();
  if (n.includes('devtools')) return false;
  return BROWSER_APP_NAMES.some((b) => n === b || n.startsWith(`${b} `) || n.startsWith(`${b}.`) || n.startsWith(`${b}-`));
}

/**
 * Estimated height of the browser's own furniture ABOVE the page content:
 * window title bar + tab strip + address bar, in DIPs (points), never
 * pixels. Real measurements vary by browser version and OS, which is why
 * this is only a DEFAULT: the subtraction in computePageCrop clamps it to a
 * fraction of the window, and the whole crop is a retry, never the first
 * answer. Measured 2026-10-25: Chrome-family ~96pt on macOS (title 28 +
 * tabs 33 + address 35 at default UI scale), ~87px on Windows (tab strip +
 * address bar; the OS title bar is included in the rectangle), Safari
 * ~104pt on macOS. Default 100 keeps one knob for the family.
 */
export function browserChromeTopPx(platform: NodeJS.Platform): number {
  return platform === 'darwin' ? 100 : 87;
}

/** The largest chrome subtraction we will ever take from the window top. */
export const MAX_CHROME_FRACTION = 0.25;

export function intersectionArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = right - left;
  const height = bottom - top;
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Of the browser windows on screen, the one that covers the most of
 `displayBounds`. Absent a per-window z-order (none of our enumeration paths
 * gives it), area overlap is the honest tiebreaker: the browser the user is
 * reading from is overwhelmingly the biggest browser rectangle on the
 * display the answer was captured from.
 */
export function pickBrowserWindow(windows: OSWindow[], displayBounds: { x: number; y: number; width: number; height: number }): OSWindow | null {
  let best: OSWindow | null = null;
  let bestArea = 0;
  for (const w of windows) {
    const area = intersectionArea(w, displayBounds);
    if (area > bestArea) {
      best = w;
      bestArea = area;
    }
  }
  return bestArea > 0 ? best : null;
}

/**
 * Window/DIP rectangle → captured-image pixel rectangle, with the browser's
 * top chrome trimmed off. `imageWidth/Height` are the CAPTURE's pixel size
 * and `displayBounds` the captured display's DIP bounds, so the scale is
 * derived (ratio), never assumed — the same invariant
 ScreenshotHelper's crop math holds: Electron makes no promise that a
 * display thumbnail is 1× versus native pixels.
 *
 * Null when the mapping degenerates (window entirely off the display, a
 * non-positive scale, or a subtraction that would leave too little to read).
 */
export function computePageCrop(
  window: { x: number; y: number; width: number; height: number },
  displayBounds: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
  chromeTopPx: number,
  platform: NodeJS.Platform = process.platform,
): PageCrop | null {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !(displayBounds.width > 0) || !(displayBounds.height > 0)) return null;
  const scaleX = imageWidth / displayBounds.width;
  const scaleY = imageHeight / displayBounds.height;
  // A sane capture is the display at some density. Beyond MAX_THUMBNAIL_RATIO
  // (mirror of ScreenshotHelper's guard) the mapping is garbage.
  if (!(scaleX > 0) || !(scaleY > 0)) return null;
  if (scaleX / scaleY > 10 || scaleY / scaleX > 10) return null;

  const intersectLeft = Math.max(window.x, displayBounds.x);
  const intersectTop = Math.max(window.y, displayBounds.y);
  const intersectRight = Math.min(window.x + window.width, displayBounds.x + displayBounds.width);
  const intersectBottom = Math.min(window.y + window.height, displayBounds.y + displayBounds.height);
  if (intersectRight - intersectLeft <= 0 || intersectBottom - intersectTop <= 0) return null;

  const left = Math.round((intersectLeft - displayBounds.x) * scaleX);
  const top = Math.round((intersectTop - displayBounds.y) * scaleY);
  const width = Math.round((intersectRight - intersectLeft) * scaleX);
  const height = Math.round((intersectBottom - intersectTop) * scaleY);
  if (width < 16 || height < 16) return null;

  // Trim the browser's own furniture from the top — never more than a
  // fraction of the window, so a bad estimate cannot eat the page.
  const maxTrim = Math.floor(height * MAX_CHROME_FRACTION);
  const trim = Math.min(Math.round(browserChromeTopPx(platform) * scaleY), maxTrim);
  const croppedTop = top + trim;
  const croppedHeight = height - trim;
  if (croppedWidthBad(width, croppedHeight)) return null;

  return { left, top: croppedTop, width, height: croppedHeight };
}

// (Kept as its own tiny predicate purely so the guard above reads as a
// sentence; the threshold is 8px after the trim, small but not nothing.)
function croppedWidthBad(_width: number, _height: number): boolean {
  return _height < 8;
}

/** A display as the platform enumerators convert against: DIP bounds + scale. */
export interface CropDisplay {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

/**
 * Enumerate the on-screen browser windows, in screen DIP/point coordinates.
 * Never throws to the caller: a platform we cannot script returns [], and
 * the retry degrades to the "take a selective screenshot" banner alone.
 *
 * `displays` carries each display's bounds (DIP) and scaleFactor so the
 * Windows path — whose enumeration is in PHYSICAL pixels — can convert.
 */
export async function detectBrowserWindows(
  displays: Array<{ x: number; y: number; width: number; height: number; scaleFactor: number }>,
  platform: NodeJS.Platform = process.platform,
): Promise<OSWindow[]> {
  try {
    if (platform === 'darwin') return await detectBrowserWindowsDarwin();
    if (platform === 'win32') return await detectBrowserWindowsWindows(displays);
    return [];
  } catch {
    return [];
  }
}

/**
 * macOS: one osascript over System Events. Emits one "app|x|y|w|h" line per
 * browser window; process names are matched with the same predicate as the
 * pure layer above. AppleScript gives points, which is what Electron's
 * screen module also uses — no conversion needed.
 */
async function detectBrowserWindowsDarwin(): Promise<OSWindow[]> {
  const script = `
tell application "System Events"
  set out to ""
  repeat with p in (application processes)
    try
      repeat with w in (windows of p)
        try
          set pr to name of p
          if pr is in {"Google Chrome", "Chrome", "Microsoft Edge", "Brave Browser", "Arc", "Vivaldi", "Opera", "Chromium", "Firefox", "Safari"} then
            set {px, py} to (position of w)
            set {sw, sh} to (size of w)
            set out to out & pr & "|" & px & "|" & py & "|" & sw & "|" & sh & linefeed
          end if
        end try
      end repeat
    end try
  end repeat
  return out
end tell`;
  const { stdout } = await shellRun('osascript', ['-e', script], ENUM_TIMEOUT_DARWIN_MS);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseWindowLine)
    .filter((w): w is OSWindow => w !== null && isBrowserAppName(w.app));
}

/**
 * Windows: one PowerShell over Get-Process (window titles) + Win32
 * GetWindowRect on each main window handle. GetWindowRect gives PHYSICAL
 * pixels, so each window is converted to DIP by the scale of the display
 * it covers the most of (physicalBounds = DIP bounds × scaleFactor, the
 * mapping Electron's screen module uses on Windows). The script travels
 * base64-encoded (-EncodedCommand): it is multiline and full of quotes, and
 * no amount of shell-quoting it survives the cmd → powershell boundary
 * intact.
 */
async function detectBrowserWindowsWindows(displays: Array<{ x: number; y: number; width: number; height: number; scaleFactor: number }>): Promise<OSWindow[]> {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRect {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object {
  $rect = New-Object WinRect+RECT
  if ([WinRect]::GetWindowRect($_.MainWindowHandle, [ref]$rect)) {
    "$($_.ProcessName)|$($rect.Left)|$($rect.Top)|$($rect.Right - $rect.Left)|$($rect.Bottom - $rect.Top)"
  }
}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await shellRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], ENUM_TIMEOUT_WINDOWS_MS);
  return (stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const w = parseWindowLine(line);
      if (!w || !isBrowserAppName(w.app)) return null;
      // Physical → DIP: the display this window covers the most of, by its
      // physical bounds (DIP bounds × scaleFactor).
      let bestScale: number | null = null;
      let bestArea = 0;
      for (const d of displays) {
        const physical = {
          x: d.x * d.scaleFactor,
          y: d.y * d.scaleFactor,
          width: d.width * d.scaleFactor,
          height: d.height * d.scaleFactor,
        };
        const area = intersectionArea(w, physical);
        if (area > bestArea) {
          bestScale = d.scaleFactor;
          bestArea = area;
        }
      }
      if (bestScale == null) return null;
      return {
        app: w.app,
        x: w.x / bestScale,
        y: w.y / bestScale,
        width: w.width / bestScale,
        height: w.height / bestScale,
      };
    })
    .filter((w) => w !== null) as OSWindow[]);
}

function parseWindowLine(line: string): OSWindow | null {
  const [app, ...nums] = line.split('|');
  if (nums.length !== 4) return null;
  const [x, y, width, height] = nums.map((n) => Number(n));
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  return { app, x, y, width, height };
}

/**
 * Crop the capture to the browser's page area, writing `outPath`. Of all the
 * browser windows on all `displays`, the one that covers the most of
 * one display wins — the caller (the retry in ipcHandlers) does not know
 * which display a capture came from, only the displays. Returns the
 * crop rectangle (image pixel space) on success, null when no usable browser
 * window was found or the crop would be degenerate.
 */
export async function cropToBrowserPageArea(
  imagePath: string,
  outPath: string,
  displays: Array<CropDisplay>,
  platform: NodeJS.Platform = process.platform,
): Promise<PageCrop | null> {
  if (displays.length === 0) return null;
  const windows = await detectBrowserWindows(displays, platform);
  if (windows.length === 0) return null;

  let bestDisplay: { x: number; y: number; width: number; height: number } | null = null;
  let bestWindow: OSWindow | null = null;
  let bestArea = 0;
  for (const display of displays) {
    const window = pickBrowserWindow(windows, display);
    if (!window) continue;
    const area = intersectionArea(window, display);
    if (area > bestArea) {
      bestDisplay = display;
      bestWindow = window;
      bestArea = area;
    }
  }
  if (!bestDisplay || !bestWindow) return null;

  const image = sharp(imagePath);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) return null;

  const crop = computePageCrop(bestWindow, bestDisplay, metadata.width, metadata.height, browserChromeTopPx(platform), platform);
  if (!crop) return null;

  await sharp(imagePath)
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .png()
    .toFile(outPath);
  // Prove the file exists and is non-trivial before promising it to a retry.
  const stat = await fsp.stat(outPath);
  if (stat.size < 1024) throw new Error(`Suspiciously small crop: ${outPath} (${stat.size} bytes)`);
  return crop;
}

/** `<dir>/<name>-page<ext>` sibling path for a cropped retry image. */
export function croppedImagePathFor(imagePath: string): string {
  const dir = path.dirname(imagePath);
  const ext = path.extname(imagePath) || '.png';
  const base = path.basename(imagePath, ext);
  return path.join(dir, `${base}-page${ext}`);
}
