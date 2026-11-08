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

/**
 * meeting    a call app: holding the microphone is a call.
 * messaging  a chat app that also calls (WhatsApp, Slack, Discord…): holding
 *            the microphone is a call too, but a voice note holds it as well,
 *            so the detector waits longer before announcing one
 *            (MeetingDetector's messagingConfirmMs).
 * browser    a call only with a meeting in it (a meeting tab or window title).
 */
export type AppKind = 'meeting' | 'messaging' | 'browser';

export interface ProcessRef {
    pid?: number;
    bundleId?: string;
    path?: string;
}

export interface KnownApp {
    name: string;
    kind: AppKind;
    mac: {
        /** Bundle id prefixes, lowercased; a helper's id extends its app's (us.zoom.ZoomHybridConf). */
        bundlePrefixes: string[];
        /** The outermost .app in the path, lowercased: every helper inside counts as the app. */
        apps: string[];
        paths?: string[];
        /** Lowercased substrings of a bundle id (a browser's installed web app: …app.<id>). */
        bundleContains?: string[];
    };
    win: {
        /** Executable file names, lowercased; helpers list theirs here too and count as the app. */
        exes: string[];
        /** Packaged app family-name prefixes, lowercased. */
        packages: string[];
        /** Lowercased path fragments, for an app whose exe name is too generic to match alone. */
        pathIncludes?: string[];
    };
}

const noWin = { exes: [] as string[], packages: [] as string[] };

// UNVERIFIED IDENTITIES (2026-09-27, list widened 2026-10-15): only a stand-in
// named zoom.us.app was seen live here. The other bundle ids, exe names and
// package families come from the apps' published packages. To verify one,
// join a real call in it with the mic on, run the native getMicUsers() and
// getVisibleWindows(), and compare. Browsers too: Chrome's audio runs in a
// helper (…Chrome.helper, inside Google Chrome.app); that path has not been
// seen live with the mic on. Windows needs its own run: ConsentStore entries
// and exe paths.
//
// Order matters: the first entry that matches wins, so call apps come before
// browsers (Google Meet's installed web app carries Chrome's bundle prefix) and
// a narrower prefix before a wider one (Dia before Arc's company.thebrowser.).
export const KNOWN_APPS: KnownApp[] = [
    // ── Call apps ──
    {
        name: 'Zoom',
        kind: 'meeting',
        // us.zoom.xos and its helpers (us.zoom.ZoomHybridConf, us.zoom.ZoomPhone…).
        mac: { bundlePrefixes: ['us.zoom.'], apps: ['zoom.us.app', 'zoom workplace.app'] },
        // Zoom Workplace's helper processes count as Zoom.
        win: { exes: ['zoom.exe', 'zoomworkplace.exe', 'cpthost.exe', 'aomhost64.exe', 'zwebview2agent.exe', 'zoomwebviewhost.exe'], packages: [] },
    },
    {
        name: 'Microsoft Teams',
        kind: 'meeting',
        // New Teams (com.microsoft.teams2, its modulehost helper) and classic.
        mac: { bundlePrefixes: ['com.microsoft.teams'], apps: ['microsoft teams.app', 'microsoft teams (work or school).app', 'microsoft teams classic.app', 'microsoft teams (work preview).app'] },
        // New Teams is ms-teams.exe (packaged MSTeams_…), classic is Teams.exe.
        win: { exes: ['ms-teams.exe', 'teams.exe', 'msteamsvdi.exe'], packages: ['msteams_', 'microsoftteams_'] },
    },
    {
        name: 'Webex',
        kind: 'meeting',
        mac: { bundlePrefixes: ['cisco-systems.spark', 'com.webex.', 'com.cisco.webex'], apps: ['webex.app', 'cisco webex meetings.app', 'webex meetings.app'] },
        win: { exes: ['ciscocollabhost.exe', 'webex.exe', 'atmgr.exe', 'webexmta.exe', 'ptoneclk.exe'], packages: [] },
    },
    {
        // Meet installed as an app from Chrome, Edge or Dia: a shim bundle named
        // after the browser plus the web app's id. In a browser tab it is found
        // by its tab or title instead.
        name: 'Google Meet',
        kind: 'meeting',
        mac: { bundlePrefixes: [], apps: ['google meet.app'], bundleContains: ['.app.kjgfgldnnfoeklkmfkjfagphfepbbdan'] },
        win: noWin,
    },
    { name: 'GoTo Meeting', kind: 'meeting', mac: { bundlePrefixes: ['com.logmein.gotomeeting', 'com.logmein.goto'], apps: ['gotomeeting.app', 'goto meeting.app', 'goto.app'] }, win: { exes: ['g2mcomm.exe', 'g2mstart.exe', 'g2mlauncher.exe', 'gotomeeting.exe', 'goto.exe'], packages: [] } },
    { name: 'BlueJeans', kind: 'meeting', mac: { bundlePrefixes: ['com.bluejeansnet.'], apps: ['bluejeans.app'] }, win: { exes: ['bluejeans.exe'], packages: [] } },
    { name: 'RingCentral', kind: 'meeting', mac: { bundlePrefixes: ['com.ringcentral.', 'com.glip.'], apps: ['ringcentral.app', 'ringcentral meetings.app', 'ringcentral video.app'] }, win: { exes: ['ringcentral.exe', 'ringcentralmeetings.exe', 'ringcentralvideo.exe'], packages: [] } },
    { name: 'Whereby', kind: 'meeting', mac: { bundlePrefixes: ['com.whereby.'], apps: ['whereby.app'] }, win: { exes: ['whereby.exe'], packages: [] } },
    { name: 'Around', kind: 'meeting', mac: { bundlePrefixes: ['co.teamport.around'], apps: ['around.app'] }, win: { exes: ['around.exe'], packages: [] } },
    { name: 'Gather', kind: 'meeting', mac: { bundlePrefixes: ['com.gather.gather'], apps: ['gather.app', 'gather v2.app'] }, win: { exes: ['gather.exe', 'gatherv2.exe'], packages: [] } },
    { name: 'Tuple', kind: 'meeting', mac: { bundlePrefixes: ['app.tuple.'], apps: ['tuple.app'] }, win: { exes: ['tuple.exe'], packages: [] } },
    { name: 'Pop', kind: 'meeting', mac: { bundlePrefixes: ['com.pop.pop'], apps: ['pop.app'] }, win: { exes: ['pop.exe'], packages: [] } },
    { name: 'Amazon Chime', kind: 'meeting', mac: { bundlePrefixes: ['com.amazon.amazon-chime'], apps: ['amazon chime.app'] }, win: { exes: ['chime.exe'], packages: [] } },
    { name: 'Skype', kind: 'meeting', mac: { bundlePrefixes: ['com.skype.skype'], apps: ['skype.app'] }, win: { exes: ['skype.exe'], packages: ['microsoft.skypeapp_'] } },
    { name: 'Lark', kind: 'meeting', mac: { bundlePrefixes: ['com.larksuite.', 'com.bytedance.lark', 'com.electron.lark'], apps: ['lark.app', 'feishu.app'] }, win: { exes: ['lark.exe', 'feishu.exe'], packages: [] } },
    { name: 'DingTalk', kind: 'meeting', mac: { bundlePrefixes: ['com.alibaba.dingtalkmac'], apps: ['dingtalk.app'] }, win: { exes: ['dingtalk.exe'], packages: [] } },
    { name: 'Tencent Meeting', kind: 'meeting', mac: { bundlePrefixes: ['com.tencent.meeting', 'com.tencent.tencentmeeting', 'com.tencent.voov'], apps: ['tencentmeeting.app', 'tencent meeting.app', 'voov meeting.app', 'voovmeeting.app'] }, win: { exes: ['wemeetapp.exe', 'voovmeetingapp.exe'], packages: [] } },
    { name: 'Zoho Meeting', kind: 'meeting', mac: { bundlePrefixes: ['com.zoho.meeting'], apps: ['zoho meeting.app'] }, win: { exes: ['zohomeeting.exe'], packages: [] } },
    { name: 'Jitsi Meet', kind: 'meeting', mac: { bundlePrefixes: ['org.jitsi.jitsi-meet'], apps: ['jitsi meet.app'] }, win: { exes: ['jitsi meet.exe'], packages: [] } },
    { name: 'Dialpad', kind: 'meeting', mac: { bundlePrefixes: ['com.electron.dialpad', 'com.dialpad.'], apps: ['dialpad.app', 'dialpad meetings.app'] }, win: { exes: ['dialpad.exe', 'dialpadmeetings.exe'], packages: [] } },
    { name: '8x8 Work', kind: 'meeting', mac: { bundlePrefixes: ['com.electron.8x8---virtual-office'], apps: ['8x8 work.app'] }, win: { exes: ['8x8 work.exe'], packages: [] } },
    { name: 'Aircall', kind: 'meeting', mac: { bundlePrefixes: ['io.aircall.'], apps: ['aircall.app', 'aircall workspace.app'] }, win: { exes: ['aircall.exe', 'aircall workspace.exe'], packages: [] } },
    // FaceTime's audio runs in avconferenced, which has no bundle.
    { name: 'FaceTime', kind: 'meeting', mac: { bundlePrefixes: ['com.apple.facetime'], apps: ['facetime.app'], paths: ['/usr/libexec/avconferenced'] }, win: noWin },

    // ── Chat apps that also call: count only while they hold the microphone ──
    { name: 'Slack', kind: 'messaging', mac: { bundlePrefixes: ['com.tinyspeck.slackmacgap'], apps: ['slack.app'] }, win: { exes: ['slack.exe'], packages: ['91750d7e.slack_'] } },
    { name: 'Discord', kind: 'messaging', mac: { bundlePrefixes: ['com.hnc.discord'], apps: ['discord.app'] }, win: { exes: ['discord.exe'], packages: [] } },
    { name: 'WhatsApp', kind: 'messaging', mac: { bundlePrefixes: ['net.whatsapp.whatsapp', 'desktop.whatsapp'], apps: ['whatsapp.app'] }, win: { exes: ['whatsapp.exe', 'whatsapp.root.exe'], packages: ['5319275a.whatsappdesktop_'] } },
    { name: 'Telegram', kind: 'messaging', mac: { bundlePrefixes: ['ru.keepcoder.telegram', 'org.telegram.desktop'], apps: ['telegram.app', 'telegram desktop.app'] }, win: { exes: ['telegram.exe'], packages: ['telegrammessengerllp.telegramdesktop_'] } },
    { name: 'Signal', kind: 'messaging', mac: { bundlePrefixes: ['org.whispersystems.signal-desktop'], apps: ['signal.app'] }, win: { exes: ['signal.exe'], packages: [] } },
    { name: 'Element', kind: 'messaging', mac: { bundlePrefixes: ['im.riot.app'], apps: ['element.app'] }, win: { exes: ['element.exe'], packages: [] } },
    { name: 'Messenger', kind: 'messaging', mac: { bundlePrefixes: ['com.facebook.archon'], apps: ['messenger.app'] }, win: { exes: ['messenger.exe'], packages: ['facebook.messenger_'] } },

    // ── Browsers: a call only with a meeting tab or a meeting window title ──
    { name: 'Google Chrome', kind: 'browser', mac: { bundlePrefixes: ['com.google.chrome'], apps: ['google chrome.app', 'google chrome beta.app', 'google chrome dev.app', 'google chrome canary.app'] }, win: { exes: ['chrome.exe'], packages: [] } },
    { name: 'Microsoft Edge', kind: 'browser', mac: { bundlePrefixes: ['com.microsoft.edgemac'], apps: ['microsoft edge.app', 'microsoft edge beta.app', 'microsoft edge dev.app', 'microsoft edge canary.app'] }, win: { exes: ['msedge.exe'], packages: [] } },
    // Dia shares Arc's company.thebrowser. prefix, so it comes first.
    { name: 'Dia', kind: 'browser', mac: { bundlePrefixes: ['company.thebrowser.dia'], apps: ['dia.app'] }, win: { exes: ['dia.exe'], packages: [] } },
    { name: 'Arc', kind: 'browser', mac: { bundlePrefixes: ['company.thebrowser.'], apps: ['arc.app'] }, win: { exes: ['arc.exe'], packages: ['thebrowsercompany.arc_'] } },
    { name: 'Brave', kind: 'browser', mac: { bundlePrefixes: ['com.brave.browser'], apps: ['brave browser.app', 'brave browser beta.app', 'brave browser nightly.app'] }, win: { exes: ['brave.exe'], packages: [] } },
    { name: 'Firefox', kind: 'browser', mac: { bundlePrefixes: ['org.mozilla.firefox', 'org.mozilla.nightly'], apps: ['firefox.app', 'firefox nightly.app', 'firefox developer edition.app'] }, win: { exes: ['firefox.exe'], packages: [] } },
    // Safari captures in WebKit's GPU process, shared by every WebKit app; as a
    // browser it still needs a meeting tab or title before it counts.
    { name: 'Safari', kind: 'browser', mac: { bundlePrefixes: ['com.apple.safari', 'com.apple.webkit.gpu'], apps: ['safari.app', 'safari technology preview.app'] }, win: noWin },
    { name: 'Vivaldi', kind: 'browser', mac: { bundlePrefixes: ['com.vivaldi.vivaldi'], apps: ['vivaldi.app'] }, win: { exes: ['vivaldi.exe'], packages: [] } },
    { name: 'Opera', kind: 'browser', mac: { bundlePrefixes: ['com.operasoftware.opera'], apps: ['opera.app', 'opera gx.app', 'opera one.app'] }, win: { exes: ['opera.exe', 'opera_gx.exe'], packages: [] } },
    { name: 'Comet', kind: 'browser', mac: { bundlePrefixes: ['ai.perplexity.comet'], apps: ['comet.app'] }, win: { exes: ['comet.exe'], packages: [] } },
    { name: 'ChatGPT Atlas', kind: 'browser', mac: { bundlePrefixes: ['com.openai.atlas'], apps: ['chatgpt atlas.app'] }, win: noWin },
    { name: 'Zen', kind: 'browser', mac: { bundlePrefixes: ['app.zen-browser.zen'], apps: ['zen.app', 'zen browser.app'] }, win: { exes: ['zen.exe'], packages: [] } },
    { name: 'Orion', kind: 'browser', mac: { bundlePrefixes: ['com.kagi.kagimacos'], apps: ['orion.app', 'orion rc.app'] }, win: noWin },
    // Chromium on Windows is chrome.exe as well, so it reads as Google Chrome there.
    { name: 'Chromium', kind: 'browser', mac: { bundlePrefixes: ['org.chromium.chromium'], apps: ['chromium.app'] }, win: noWin },
    // Yandex's exe is plain browser.exe: matched by its install folder.
    { name: 'Yandex Browser', kind: 'browser', mac: { bundlePrefixes: ['ru.yandex.desktop.yandex-browser'], apps: ['yandex.app'] }, win: { exes: [], packages: [], pathIncludes: ['\\yandex\\yandexbrowser\\'] } },
    { name: 'Sidekick', kind: 'browser', mac: { bundlePrefixes: ['com.pushplaylabs.sidekick'], apps: ['sidekick.app'] }, win: { exes: ['sidekick.exe'], packages: [] } },
    { name: 'Island', kind: 'browser', mac: { bundlePrefixes: ['io.island.island'], apps: ['island.app'] }, win: { exes: ['island.exe'], packages: [] } },
    { name: 'Helium', kind: 'browser', mac: { bundlePrefixes: ['net.imput.helium'], apps: ['helium.app'] }, win: { exes: ['helium.exe'], packages: [] } },
    { name: 'Thorium', kind: 'browser', mac: { bundlePrefixes: ['org.chromium.thorium'], apps: ['thorium.app'] }, win: { exes: ['thorium.exe'], packages: [] } },
    { name: 'Waterfox', kind: 'browser', mac: { bundlePrefixes: ['net.waterfox.waterfox'], apps: ['waterfox.app'] }, win: { exes: ['waterfox.exe'], packages: [] } },
    { name: 'LibreWolf', kind: 'browser', mac: { bundlePrefixes: ['io.gitlab.librewolf-community'], apps: ['librewolf.app'] }, win: { exes: ['librewolf.exe'], packages: [] } },
    { name: 'Floorp', kind: 'browser', mac: { bundlePrefixes: ['one.ablaze.floorp'], apps: ['floorp.app'] }, win: { exes: ['floorp.exe'], packages: [] } },
    { name: 'DuckDuckGo', kind: 'browser', mac: { bundlePrefixes: ['com.duckduckgo.macos.browser'], apps: ['duckduckgo.app'] }, win: { exes: [], packages: ['duckduckgo.desktopbrowser_'] } },
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
            || (bundle && k.mac.bundleContains?.some((p) => bundle.includes(p)))
            || (app && k.mac.apps.includes(app))
            || (proc.path && k.mac.paths?.includes(proc.path))) ?? null;
    }
    if (platform === 'win32') {
        const exe = exeName(proc.path);
        const lowerPath = proc.path?.toLowerCase();
        return KNOWN_APPS.find((k) =>
            (exe && k.win.exes.includes(exe))
            || (lowerPath && k.win.pathIncludes?.some((p) => lowerPath.includes(p)))
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
