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
  | 'error'
  // The page text arrived but some formulas had no text (drawn only as SVG).
  | 'formulas';

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
        'The browser extension is not connected, so a screenshot was attached instead. ' +
        'Pair it in Settings → Companion → Browser Extension.',
      reason,
    };
  }

  if (NEEDS_HOST_RE.test(reason)) {
    return {
      kind: 'needs-host-permission',
      label: 'Screenshot instead — grant this site',
      detail:
        'The extension has no access to this site, so a screenshot was attached instead. ' +
        'Click the Natively extension icon on that tab to grant it.',
      reason,
    };
  }

  if (/timeout/i.test(reason)) {
    return {
      kind: 'timeout',
      label: 'Screenshot instead — browser timed out',
      detail:
        'The browser extension did not respond in time, so a screenshot was attached instead. ' +
        'If it keeps happening, re-pair it in Settings → Companion.',
      reason,
    };
  }

  if (/No active tab|Cannot capture browser\/internal pages/i.test(reason)) {
    return {
      kind: 'no-tab',
      label: 'Screenshot instead — no capturable tab',
      detail:
        'No capturable browser tab was found, so a screenshot was attached instead.',
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
 * What the browser extension writes in the page text in place of a formula
 * that has no text on the page. Same string as UNREADABLE_FORMULA in
 * natively-browser/src/math-text.ts (a separate package, so not importable).
 */
export const UNREADABLE_FORMULA_MARKER = '[formula not captured]';

/**
 * Marks formula N of the image the extension drew for the formulas with no
 * text. Same as FORMULA_IN_IMAGE_RE in natively-browser/src/math-text.ts.
 */
export const FORMULA_IN_IMAGE_RE = /\[formula (\d+), see image\]/;

/** Whether page text has a formula that only an image can carry. */
export function hasFormulaMarker(text: string | undefined): boolean {
  return typeof text === 'string' && (text.includes(UNREADABLE_FORMULA_MARKER) || FORMULA_IN_IMAGE_RE.test(text));
}

/**
 * The extension sent its own image of the page's formulas with the text;
 * `unreadable` more had no text and are not in it.
 */
export function describeFormulaImage(unreadable: number): PageCaptureFallbackNotice {
  const n = Math.max(0, Math.floor(Number(unreadable) || 0));
  const missing =
    n === 0
      ? ''
      : n === 1
        ? ' 1 more could not be captured; take a screenshot of it before answering.'
        : ` ${n} more could not be captured; take a screenshot of them before answering.`;
  return {
    kind: 'formulas',
    label: n ? 'Page attached + some formulas as image' : 'Page attached + formulas as image',
    detail: `Formulas this page draws as pictures were attached as an image with the page text.${missing}`,
    reason: `formula-image:${n}`,
  };
}

/**
 * The page capture succeeded but `count` formulas on it had no text (issue
 * #645: HackerRank draws them as bare SVG paths). Unlike the notices above,
 * the page text is attached either way; `screenshot` says what happened to
 * the screenshot for the formulas: attached, failed, or not taken (a capture
 * from the extension popup, whose screenshot would show the popup).
 */
export function describeUnreadableFormulas(
  count: number,
  screenshot: 'attached' | 'failed' | 'not-taken' = 'attached',
  /** The user's platform, for the failed-screenshot hint. Callers pass `process.platform`. */
  platform?: NodeJS.Platform,
): PageCaptureFallbackNotice {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const what = n === 1 ? '1 formula on this page is' : `${n} formulas on this page are`;
  const reason = `unreadable-formulas:${n}`;
  if (screenshot === 'attached') {
    return {
      kind: 'formulas',
      label: 'Page attached + screenshot for formulas',
      detail: `${what} drawn as pictures with no text, so a screenshot was attached with the page text.`,
      reason,
    };
  }
  return {
    kind: 'formulas',
    label: 'Page attached — formulas missing',
    detail:
      screenshot === 'failed'
        ? `${what} drawn as pictures with no text, and the screenshot for them failed. ` +
          `${screenshotPermissionHint(platform)} Take a screenshot of the formulas before answering.`
        : `${what} drawn as pictures with no text. Take a screenshot of the formulas before answering.`,
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
      `Page context: ${base.reason}. Screenshot: ${shot}. ` +
      (base.kind === 'needs-host-permission'
        ? 'Click the Natively extension icon on that tab to grant this site. '
        : base.kind === 'not-connected'
          ? 'Pair the extension in Settings → Companion → Browser Extension. '
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
function screenshotPermissionHint(platform: NodeJS.Platform | undefined): string {
  if (platform === 'darwin') {
    return 'Screenshots need Screen Recording permission.';
  }
  if (platform === 'win32') {
    return 'Protected (DRM) windows block screenshots.';
  }
  return 'The target window may block screenshots.';
}
