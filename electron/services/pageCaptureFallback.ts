/**
 * Page-capture → screenshot fallback notices.
 *
 * The Cmd/Ctrl+Shift+Y hotkey (`general:capture-dom`) asks the companion
 * browser extension for the active tab's page context and silently falls back
 * to a screenshot when that fails. The fallback itself is by design — but the
 * WHY used to live only in the main-process console, so from the overlay the
 * hotkey just looked broken ("Screenshot attached" instead of page context).
 *
 * This module is the single source of truth for turning the machine reasons
 * that flow back over the capture channel (PhoneMirrorService.requestDomCapture
 * and the extension's capture-ack `error` field — see
 * natively-browser/src/service-worker.ts handleCaptureDom) into one
 * user-actionable notice, delivered to the overlay on
 * PAGE_CAPTURE_FALLBACK_CHANNEL. Pure and Electron-free so it is testable and
 * shared verbatim by main (sender) and preload (listener) on both platforms.
 */

/** IPC channel main → overlay renderer. Shared by main.ts and preload.ts. */
export const PAGE_CAPTURE_FALLBACK_CHANNEL = 'page-capture-fallback';

/**
 * Sent the moment the ⌘/Ctrl+Y capture hotkey starts working, before the
 * extension round-trip. Lets the overlay treat a fast follow-up ⌘Enter as
 * "wait briefly for the in-flight capture" instead of racing past it — the
 * whole point of the one-motion ⌘Y→Enter flow (2026-08-19).
 */
export const PAGE_CAPTURE_STARTED_CHANNEL = 'page-capture-started';

export type PageCaptureFallbackKind =
  | 'not-connected'
  | 'needs-host-permission'
  | 'timeout'
  | 'no-tab'
  | 'error';

export interface PageCaptureFallbackNotice {
  kind: PageCaptureFallbackKind;
  /** Short pill label shown in the overlay status row. */
  label: string;
  /** Fuller actionable explanation (pill tooltip). */
  detail: string;
  /** The raw machine reason, for logs/diagnostics. */
  reason: string;
}

/**
 * The extension reports an ungranted host as the outcome kind
 * `needs-host-permission`; Chrome's raw error wording can still surface from
 * older extension builds or unexpected paths, so match both.
 */
const NEEDS_HOST_RE =
  /needs-host-permission|must request permission to access this host|Cannot access contents of|Missing host permission/i;

/** Map a DOM-capture failure reason to the user-facing fallback notice. */
export function describePageCaptureFallback(rawReason: unknown): PageCaptureFallbackNotice {
  const reason = String(rawReason ?? '').trim() || 'unknown';

  if (/no-extension|extension not connected|not running/i.test(reason)) {
    return {
      kind: 'not-connected',
      label: 'Screenshot instead — extension not connected',
      detail:
        'The browser extension is not connected, so a screenshot was attached instead of page context. ' +
        'Pair it in Settings → Sync → Browser Extension, then press the capture hotkey again.',
      reason,
    };
  }

  if (NEEDS_HOST_RE.test(reason)) {
    return {
      kind: 'needs-host-permission',
      label: 'Screenshot instead — grant this site',
      detail:
        'The extension is connected but your browser has not granted it access to this site, so a screenshot was attached instead. ' +
        'Click the Natively extension icon on that tab (it shows a "!" badge) and press Capture once to grant this site — or press "Allow on all sites" there once and the hotkey will capture every site from then on.',
      reason,
    };
  }

  if (/timeout/i.test(reason)) {
    return {
      kind: 'timeout',
      label: 'Screenshot instead — browser timed out',
      detail:
        'The browser extension did not respond in time, so a screenshot was attached instead of page context. ' +
        'If this keeps happening, reopen the browser or re-pair the extension in Settings → Sync.',
      reason,
    };
  }

  if (/No active tab|Cannot capture browser\/internal pages/i.test(reason)) {
    return {
      kind: 'no-tab',
      label: 'Screenshot instead — no capturable tab',
      detail:
        'No capturable browser tab was found (browser-internal pages cannot be read), so a screenshot was attached instead.',
      reason,
    };
  }

  return {
    kind: 'error',
    label: 'Screenshot instead — page capture failed',
    detail: `Page capture failed (${reason}), so a screenshot was attached instead.`,
    reason,
  };
}

/**
 * Both legs failed: the page capture AND the screenshot fallback. The regular
 * notices all assert "a screenshot was attached instead", which would be a lie
 * here — this one says nothing was captured and names the actionable causes.
 */
export function describeDoubleCaptureFailure(
  domReason: unknown,
  screenshotError: unknown,
  /**
   * The USER's platform, injected rather than read here so this module stays
   * pure/Electron-free and both branches are testable from either OS (repo
   * CLAUDE.md: "Platform detection should be injectable where practical").
   * Callers pass `process.platform`.
   */
  platform: NodeJS.Platform,
): PageCaptureFallbackNotice {
  const base = describePageCaptureFallback(domReason);
  const shot = String(
    (screenshotError as { message?: unknown } | null)?.message ?? screenshotError ?? 'unknown',
  ).trim() || 'unknown';
  return {
    kind: 'error',
    label: 'Capture failed — nothing was attached',
    detail:
      `Neither capture worked. Page context: ${base.reason}. Screenshot: ${shot}. ` +
      (base.kind === 'needs-host-permission'
        ? 'Click the Natively extension icon on that tab and capture once to grant this site. '
        : base.kind === 'not-connected'
          ? 'Pair the browser extension in Settings → Sync → Browser Extension. '
          : '') +
      screenshotPermissionHint(platform),
    reason: base.reason,
  };
}

/**
 * Platform-correct closing hint for a failed SCREENSHOT leg (code review
 * 2026-08-19). This sentence used to name macOS Screen Recording
 * unconditionally, which sent Windows users to a System Settings pane that
 * does not exist and hid the causes that actually apply there — a direct
 * violation of the repo rule "Do not display macOS-specific troubleshooting on
 * Windows or Windows-specific troubleshooting on macOS".
 *
 * Windows has no Screen Recording consent prompt for desktop capture; when a
 * capture fails there it is normally a protected/DRM window, a graphics-driver
 * or remote-session limitation, or security software blocking the capture.
 */
function screenshotPermissionHint(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return 'Screenshots additionally require Screen Recording permission (System Settings → Privacy & Security → Screen Recording).';
  }
  if (platform === 'win32') {
    return 'Screenshots can also fail when the target window blocks capture (protected/DRM content), in a remote-desktop session, or when security software blocks screen capture — try capturing a different window.';
  }
  return 'Screenshots can also fail when the target window blocks screen capture.';
}
