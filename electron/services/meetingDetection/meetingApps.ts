/**
 * Which app a process is, for meeting detection, on each OS.
 *
 * The native signals (native-module/src/meeting_signals.rs) name processes the
 * way the OS does:
 *   macOS    a bundle id (a browser's audio runs in a helper: com.google.Chrome.helper)
 *            and an executable path inside the app (…/Google Chrome.app/…)
 *   Windows  an executable path (C:\Program Files\Zoom\bin\Zoom.exe), or a
 *            packaged app's family name (MSTeams_8wekyb3d8bbwe)
 * so each known app lists its identities per OS. Pure: the platform is passed
 * in, so both branches are tested on any machine.
 */

export type AppKind = 'meeting' | 'browser';

export interface ProcessRef {
    pid?: number;
    bundleId?: string;
    path?: string;
}

export interface KnownApp {
    name: string;
    kind: AppKind;
    mac: { bundlePrefixes: string[]; apps: string[]; paths?: string[] };
    win: { exes: string[]; packages: string[] };
}

// UNVERIFIED IDENTITIES (2026-09-27): only a stand-in named zoom.us.app was
// seen live here. The other bundle ids, exe names and package families come
// from the apps' published packages. To verify one, join a real call in it
// with the mic on, run the native getMicUsers() and getVisibleWindows(), and
// compare. Browsers too: Chrome's audio runs in a helper (…Chrome.helper,
// inside Google Chrome.app); that path has not been seen live with the mic on.
// Windows needs its own run: ConsentStore entries and exe paths.
export const KNOWN_APPS: KnownApp[] = [
    { name: 'Zoom', kind: 'meeting', mac: { bundlePrefixes: ['us.zoom.'], apps: ['zoom.us.app'] }, win: { exes: ['zoom.exe'], packages: [] } },
    {
        name: 'Microsoft Teams',
        kind: 'meeting',
        mac: { bundlePrefixes: ['com.microsoft.teams'], apps: ['microsoft teams.app', 'microsoft teams (work or school).app', 'microsoft teams classic.app'] },
        win: { exes: ['ms-teams.exe', 'teams.exe'], packages: ['msteams_', 'microsoftteams_'] },
    },
    {
        name: 'Webex',
        kind: 'meeting',
        mac: { bundlePrefixes: ['cisco-systems.spark', 'com.webex.', 'com.cisco.webex'], apps: ['webex.app', 'cisco webex meetings.app'] },
        win: { exes: ['ciscocollabhost.exe', 'webex.exe', 'atmgr.exe', 'webexmta.exe'], packages: [] },
    },
    { name: 'Slack', kind: 'meeting', mac: { bundlePrefixes: ['com.tinyspeck.slackmacgap'], apps: ['slack.app'] }, win: { exes: ['slack.exe'], packages: ['91750d7e.slack_'] } },
    { name: 'Discord', kind: 'meeting', mac: { bundlePrefixes: ['com.hnc.discord'], apps: ['discord.app'] }, win: { exes: ['discord.exe'], packages: [] } },
    // FaceTime's audio runs in avconferenced, which has no bundle.
    { name: 'FaceTime', kind: 'meeting', mac: { bundlePrefixes: ['com.apple.facetime'], apps: ['facetime.app'], paths: ['/usr/libexec/avconferenced'] }, win: { exes: [], packages: [] } },
    { name: 'Google Chrome', kind: 'browser', mac: { bundlePrefixes: ['com.google.chrome'], apps: ['google chrome.app', 'google chrome beta.app', 'google chrome canary.app'] }, win: { exes: ['chrome.exe'], packages: [] } },
    { name: 'Microsoft Edge', kind: 'browser', mac: { bundlePrefixes: ['com.microsoft.edgemac'], apps: ['microsoft edge.app'] }, win: { exes: ['msedge.exe'], packages: [] } },
    { name: 'Arc', kind: 'browser', mac: { bundlePrefixes: ['company.thebrowser.'], apps: ['arc.app'] }, win: { exes: ['arc.exe'], packages: ['thebrowsercompany.arc_'] } },
    { name: 'Brave', kind: 'browser', mac: { bundlePrefixes: ['com.brave.browser'], apps: ['brave browser.app'] }, win: { exes: ['brave.exe'], packages: [] } },
    { name: 'Firefox', kind: 'browser', mac: { bundlePrefixes: ['org.mozilla.firefox', 'org.mozilla.nightly'], apps: ['firefox.app', 'firefox nightly.app'] }, win: { exes: ['firefox.exe'], packages: [] } },
    // Safari captures in WebKit's GPU process, shared by every WebKit app; as a
    // browser it still needs a meeting tab or title before it counts.
    { name: 'Safari', kind: 'browser', mac: { bundlePrefixes: ['com.apple.safari', 'com.apple.webkit.gpu'], apps: ['safari.app'] }, win: { exes: [], packages: [] } },
    { name: 'Vivaldi', kind: 'browser', mac: { bundlePrefixes: ['com.vivaldi.vivaldi'], apps: ['vivaldi.app'] }, win: { exes: ['vivaldi.exe'], packages: [] } },
    { name: 'Opera', kind: 'browser', mac: { bundlePrefixes: ['com.operasoftware.opera'], apps: ['opera.app'] }, win: { exes: ['opera.exe'], packages: [] } },
];

/** The outermost `.app` bundle in a macOS path (a helper's path runs through its app's). */
export function outerAppBundle(path: string | undefined): string | null {
    if (!path) return null;
    const m = path.match(/\/([^/]+\.app)(?:\/|$)/i);
    return m ? m[1].toLowerCase() : null;
}

/** The file name of a Windows path, lowercased. */
function exeName(path: string | undefined): string | null {
    if (!path) return null;
    const name = path.split(/[\\/]/).pop();
    return name ? name.toLowerCase() : null;
}

/** The known app this process belongs to, or null. */
export function appOfProcess(platform: string, proc: ProcessRef): KnownApp | null {
    const bundle = proc.bundleId?.toLowerCase();
    if (platform === 'darwin') {
        const app = outerAppBundle(proc.path);
        return KNOWN_APPS.find((k) =>
            (bundle && k.mac.bundlePrefixes.some((p) => bundle.startsWith(p)))
            || (app && k.mac.apps.includes(app))
            || (proc.path && k.mac.paths?.includes(proc.path))) ?? null;
    }
    if (platform === 'win32') {
        const exe = exeName(proc.path);
        return KNOWN_APPS.find((k) =>
            (exe && k.win.exes.includes(exe))
            || (bundle && k.win.packages.some((p) => bundle.startsWith(p)))) ?? null;
    }
    return null;
}

/** This app itself: its own capture must never read as a meeting. */
export interface SelfIdentity {
    pid: number;
    /** process.execPath */
    execPath: string;
}

export function isSelf(platform: string, proc: ProcessRef, self: SelfIdentity): boolean {
    if (proc.pid !== undefined && proc.pid === self.pid) return true;
    if (!proc.path) return false;
    if (platform === 'darwin') {
        // Anything inside our own .app (the main process, helpers).
        const root = self.execPath.match(/^(.*?\.app)(?:\/|$)/i)?.[1];
        return !!root && (proc.path === root || proc.path.startsWith(`${root}/`));
    }
    if (platform === 'win32') return proc.path.toLowerCase() === self.execPath.toLowerCase();
    return false;
}

/**
 * A browser window's title that is a meeting, and which service. Tab titles
 * as the services set them (Meet "Meet – abc-defg-hij", Teams "… | Microsoft
 * Teams"); Windows appends the browser's name, which these ignore.
 */
export function meetingServiceOfTitle(title: string | undefined): string | null {
    if (!title) return null;
    if (/(^|\s)Meet\s[–-]\s|\bGoogle Meet\b/.test(title)) return 'Google Meet';
    if (/\|\s*Microsoft Teams\b/.test(title)) return 'Microsoft Teams';
    if (/\bZoom (Meeting|Webinar)\b/.test(title)) return 'Zoom';
    if (/\bWebex\b/.test(title)) return 'Webex';
    return null;
}

/** A meeting app's window title as a meeting name, when it carries one (Teams does). */
export function meetingNameOfTitle(app: string, title: string | undefined): string | undefined {
    if (!title) return undefined;
    if (app === 'Microsoft Teams') {
        const name = title.replace(/\s*\|\s*Microsoft Teams.*$/, '').replace(/^(Meeting (with|in)|Call with)\s+/i, '').trim();
        return name && !/^(Chat|Calendar|Activity|Teams|Microsoft Teams)$/i.test(name) ? name : undefined;
    }
    return undefined;
}
