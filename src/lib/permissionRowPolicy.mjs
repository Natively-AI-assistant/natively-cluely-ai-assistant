// src/lib/permissionRowPolicy.mjs
//
// How ONE row of the permissions card presents itself, derived purely from the
// status the main process actually reported. Two defects motivated pulling this
// out of PermissionsToaster.tsx:
//
//   1. The card wrote permission state it had never observed. Clicking a granted
//      row set a local 'denied' although nothing was revoked, and clicking a
//      denied Screen Recording row set 'granted' the instant System Settings
//      opened — before the user had granted anything. The card then rendered its
//      own fiction until the next status refresh contradicted it.
//   2. Every sub-label was written for macOS. A Windows user with the mic
//      toggle off was told to visit "System Settings -> Privacy & Security",
//      a panel that does not exist on Windows. CLAUDE.md forbids showing one
//      platform's troubleshooting on the other.
//
// Keeping the decision here means BOTH platform branches are exercised by tests
// without mutating process.platform (CLAUDE.md, "Testing requirements").
//
// The row NEVER decides that a permission is granted. Only `permissions:check`
// does. A row's action opens a panel or raises a consent prompt; the real status
// arrives later through the card's window-focus refresh.

import { classifyMicStatus, windowsMicBlocker } from './micPermissionPolicy.mjs';

/**
 * 'loading' is a renderer-only pseudo-status meaning "we have not heard back
 * from permissions:check yet". It is NOT one of Electron's values, so it must
 * be handled before anything reaches classifyMicStatus — which would otherwise
 * read it as a plain non-granted status and offer a consent prompt for a
 * permission whose state is still unknown.
 * @typedef {'granted'|'denied'|'not-determined'|'restricted'|'unknown'|'loading'} RowStatus
 */

/**
 * @typedef {object} RowPresentation
 * @property {'granted'|'pending'|'action'|'blocked'} tone
 *   Drives colour and iconography. 'action' is the only tone that is clickable.
 * @property {boolean} actionable  Whether the row responds to a click at all.
 * @property {string}  sublabel    The second line, already platform-correct.
 * @property {string|null} actionLabel  Trailing pill text, null when inert.
 * @property {'none'|'wait'|'request'|'settings'|'policy'|'unsupported'} remedy
 *   What clicking the row should DO. The component switches on this rather than
 *   re-deriving intent from the status string.
 */

const CHECKING = {
  tone: 'pending',
  actionable: false,
  sublabel: 'Checking…',
  actionLabel: null,
  remedy: 'wait',
};

const GRANTED = {
  tone: 'granted',
  actionable: false,
  sublabel: 'Access granted',
  actionLabel: null,
  remedy: 'none',
};

/**
 * Administrator/MDM policy. The privacy panel cannot fix this, so offering
 * "Open Settings" would send the user down a dead end — the same reasoning
 * micPermissionPolicy's 'policy' remedy already encodes.
 */
const BLOCKED = {
  tone: 'blocked',
  actionable: false,
  sublabel: 'Blocked by your organisation',
  actionLabel: null,
  remedy: 'policy',
};

/**
 * Screen Recording. A permission on macOS only: Windows has no per-app
 * screen-capture gate (permissions:check hardcodes 'granted' there and says
 * so), so off darwin the row has nothing to ask for. The Windows card still
 * draws it, as a row that is already allowed, so the card reads the same on
 * both platforms; it never becomes something to do.
 *
 * @param {string|undefined|null} platform
 * @param {RowStatus|string|undefined|null} status
 * @returns {RowPresentation}
 */
function describeScreenRow(platform, status) {
  if (platform !== 'darwin') {
    return {
      tone: 'granted',
      actionable: false,
      sublabel: 'Already allowed',
      actionLabel: null,
      remedy: 'unsupported',
    };
  }

  if (status === 'loading') return CHECKING;
  if (status === 'granted') return GRANTED;
  if (status === 'restricted') return BLOCKED;

  // macOS reads the Screen Recording grant at process launch, so re-enabling it
  // in System Settings does NOT reach the running app — a previously-denied user
  // must relaunch. This hint is load-bearing; it is the difference between the
  // user thinking the app is broken and the user restarting it.
  if (status === 'denied') {
    return {
      tone: 'action',
      actionable: true,
      sublabel: 'Re-enable in Settings, then restart',
      actionLabel: 'Open Settings',
      remedy: 'settings',
    };
  }

  // 'not-determined' | 'unknown' | anything unexpected. There is no
  // askForMediaAccess('screen') on macOS, so the privacy panel is the only
  // route even for a first-time grant.
  return {
    tone: 'action',
    actionable: true,
    sublabel: 'Required to capture meeting content',
    actionLabel: 'Open Settings',
    remedy: 'settings',
  };
}

/**
 * The Windows microphone row's line: what is off, in the words of the page
 * "Open Settings" lands on, so the row and the guide beside it agree.
 *
 * Each is short enough for one line beside the guide: the Windows card is the
 * split card, and a wrapped line made it taller than the macOS one.
 *
 * @param {RowStatus|string|undefined|null} status
 * @returns {string}
 */
function windowsMicLine(status) {
  switch (windowsMicBlocker(status)) {
    case 'device':
      // The page's first switch is called "Microphone access".
      return 'Microphone access is turned off';
    case 'apps':
      // "Let apps access…" or "Let desktop apps access…": the status does not
      // say which, and this is true of either.
      return 'Turned off for apps';
    default:
      return 'Turn on in privacy settings';
  }
}

/**
 * Microphone. Defers the platform decision to classifyMicStatus so this module
 * and the IPC handler can never disagree about what is reachable where.
 *
 * @param {string|undefined|null} platform
 * @param {RowStatus|string|undefined|null} status
 * @returns {RowPresentation}
 */
function describeMicRow(platform, status) {
  if (status === 'loading') return CHECKING;

  const plan = classifyMicStatus(platform, status);
  if (plan.usable) return GRANTED;

  switch (plan.remedy) {
    case 'request':
      // macOS can still raise the consent prompt. "Grant" rather than "Open
      // Settings" because no panel is involved.
      return {
        tone: 'action',
        actionable: true,
        sublabel: 'Required for speech transcription',
        actionLabel: 'Grant',
        remedy: 'request',
      };

    case 'policy':
      return BLOCKED;

    default:
      // 'settings'. The panel differs per platform and so must the wording:
      // naming macOS's System Settings on Windows sends the user somewhere
      // that does not exist.
      return {
        tone: 'action',
        actionable: true,
        sublabel:
          platform === 'darwin'
            ? 'Re-enable in Settings'
            : platform === 'win32'
            ? windowsMicLine(status)
            : 'Turn on in privacy settings',
        actionLabel: 'Open Settings',
        remedy: 'settings',
      };
  }
}

/**
 * @param {string|undefined|null} platform  process.platform, injected.
 * @param {'screen'|'microphone'} kind
 * @param {RowStatus|string|undefined|null} status
 * @returns {RowPresentation}
 */
export function describePermRow(platform, kind, status) {
  return kind === 'screen'
    ? describeScreenRow(platform, status)
    : describeMicRow(platform, status);
}

/**
 * Whether the card's completion state has been reached. Mirrors the per-row
 * verdict so the "All set" screen can never disagree with a row still showing
 * an action — the bug that made the old `allGranted` unsafe to render.
 *
 * A row blocked by policy counts as resolved: the user cannot act on it, so
 * holding the card open forever would trap them with no way forward.
 *
 * @param {string|undefined|null} platform
 * @param {{ microphone: RowStatus|string, screen: RowStatus|string }} statuses
 * @returns {boolean}
 */
export function allPermissionsResolved(platform, statuses) {
  const rows = [describePermRow(platform, 'microphone', statuses.microphone)];
  if (platform === 'darwin') {
    rows.push(describePermRow(platform, 'screen', statuses.screen));
  }
  return rows.every((r) => r.tone === 'granted' || r.tone === 'blocked');
}
