// Meeting detection breadth (2026-10-15): the wider list of call apps, chat
// apps that call, and browsers, read the way each OS names a process. The
// platform is injected, so the macOS and the Windows tables both run here on
// any machine. Identities are from the apps' published packages; the note on
// KNOWN_APPS in meetingApps.ts says how to check one against a real call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = (p) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services', p);
const { appOfProcess, KNOWN_APPS } = require(dist('meetingDetection/meetingApps.js'));
const { detectMeeting } = require(dist('meetingDetection/detectMeeting.js'));
const { MeetingDetector } = require(dist('meetingDetection/MeetingDetector.js'));
const { micAppsOf } = require(dist('meeting/wireMeetingAutoStop.js'));

const MAC_SELF = { pid: 500, execPath: '/Applications/Natively.app/Contents/MacOS/Natively' };
const WIN_SELF = { pid: 500, execPath: 'C:\\Users\\a\\AppData\\Local\\Programs\\Natively\\Natively.exe' };

// [process as macOS reports it, expected app, expected kind]
const MAC = [
    [{ bundleId: 'us.zoom.xos' }, 'Zoom', 'meeting'],
    [{ bundleId: 'us.zoom.ZoomHybridConf', path: '/Applications/zoom.us.app/Contents/Frameworks/ZoomHybridConf.app/Contents/MacOS/ZoomHybridConf' }, 'Zoom', 'meeting'],
    [{ bundleId: 'com.microsoft.teams2' }, 'Microsoft Teams', 'meeting'],
    [{ bundleId: 'com.microsoft.teams2.modulehost' }, 'Microsoft Teams', 'meeting'],
    [{ bundleId: 'Cisco-Systems.Spark' }, 'Webex', 'meeting'],
    [{ bundleId: 'com.cisco.webexmeetingsapp' }, 'Webex', 'meeting'],
    [{ bundleId: 'com.google.Chrome.app.kjgfgldnnfoeklkmfkjfagphfepbbdan' }, 'Google Meet', 'meeting'],
    [{ bundleId: 'company.thebrowser.dia.app.kjgfgldnnfoeklkmfkjfagphfepbbdan' }, 'Google Meet', 'meeting'],
    [{ bundleId: 'com.logmein.GoToMeeting' }, 'GoTo Meeting', 'meeting'],
    [{ bundleId: 'com.bluejeansnet.Blue' }, 'BlueJeans', 'meeting'],
    [{ bundleId: 'com.ringcentral.glip' }, 'RingCentral', 'meeting'],
    [{ path: '/Applications/Whereby.app/Contents/MacOS/Whereby' }, 'Whereby', 'meeting'],
    [{ bundleId: 'co.teamport.around' }, 'Around', 'meeting'],
    [{ bundleId: 'com.gather.GatherV2' }, 'Gather', 'meeting'],
    [{ bundleId: 'app.tuple.app' }, 'Tuple', 'meeting'],
    [{ path: '/Applications/Pop.app/Contents/MacOS/Pop' }, 'Pop', 'meeting'],
    [{ bundleId: 'com.amazon.Amazon-Chime' }, 'Amazon Chime', 'meeting'],
    [{ bundleId: 'com.skype.skype' }, 'Skype', 'meeting'],
    [{ bundleId: 'com.larksuite.larkApp' }, 'Lark', 'meeting'],
    [{ path: '/Applications/Feishu.app/Contents/MacOS/Feishu' }, 'Lark', 'meeting'],
    [{ bundleId: 'com.alibaba.DingTalkMac' }, 'DingTalk', 'meeting'],
    [{ bundleId: 'com.tencent.tencentmeeting' }, 'Tencent Meeting', 'meeting'],
    [{ path: '/Applications/VooV Meeting.app/Contents/MacOS/VooV Meeting' }, 'Tencent Meeting', 'meeting'],
    [{ bundleId: 'com.zoho.meeting' }, 'Zoho Meeting', 'meeting'],
    [{ bundleId: 'org.jitsi.jitsi-meet' }, 'Jitsi Meet', 'meeting'],
    [{ bundleId: 'com.electron.dialpad' }, 'Dialpad', 'meeting'],
    [{ bundleId: 'io.aircall.phone' }, 'Aircall', 'meeting'],
    [{ path: '/usr/libexec/avconferenced' }, 'FaceTime', 'meeting'],
    [{ bundleId: 'com.tinyspeck.slackmacgap.helper' }, 'Slack', 'messaging'],
    [{ bundleId: 'com.hnc.Discord' }, 'Discord', 'messaging'],
    [{ bundleId: 'net.whatsapp.WhatsApp' }, 'WhatsApp', 'messaging'],
    [{ bundleId: 'ru.keepcoder.Telegram' }, 'Telegram', 'messaging'],
    [{ bundleId: 'org.whispersystems.signal-desktop' }, 'Signal', 'messaging'],
    [{ bundleId: 'im.riot.app' }, 'Element', 'messaging'],
    [{ bundleId: 'com.google.Chrome.helper' }, 'Google Chrome', 'browser'],
    [{ bundleId: 'company.thebrowser.Browser' }, 'Arc', 'browser'],
    [{ bundleId: 'company.thebrowser.dia' }, 'Dia', 'browser'],
    [{ bundleId: 'ai.perplexity.comet' }, 'Comet', 'browser'],
    [{ bundleId: 'app.zen-browser.zen' }, 'Zen', 'browser'],
    [{ bundleId: 'com.kagi.kagimacOS' }, 'Orion', 'browser'],
    [{ bundleId: 'org.chromium.Chromium' }, 'Chromium', 'browser'],
    [{ bundleId: 'ru.yandex.desktop.yandex-browser' }, 'Yandex Browser', 'browser'],
    [{ bundleId: 'com.pushplaylabs.sidekick' }, 'Sidekick', 'browser'],
    [{ bundleId: 'io.island.Island' }, 'Island', 'browser'],
    [{ bundleId: 'net.imput.helium' }, 'Helium', 'browser'],
    [{ bundleId: 'com.openai.atlas' }, 'ChatGPT Atlas', 'browser'],
    [{ bundleId: 'com.apple.WebKit.GPU' }, 'Safari', 'browser'],
];

// [process as Windows reports it, expected app, expected kind]
const WIN = [
    [{ path: 'C:\\Users\\a\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe' }, 'Zoom', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Roaming\\Zoom\\bin\\CptHost.exe' }, 'Zoom', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Roaming\\Zoom\\bin\\aomhost64.exe' }, 'Zoom', 'meeting'],
    [{ bundleId: 'MSTeams_8wekyb3d8bbwe' }, 'Microsoft Teams', 'meeting'],
    [{ path: 'C:\\Program Files\\WindowsApps\\MSTeams_24.1.0_x64__8wekyb3d8bbwe\\ms-teams.exe' }, 'Microsoft Teams', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Microsoft\\Teams\\current\\Teams.exe' }, 'Microsoft Teams', 'meeting'],
    [{ path: 'C:\\Program Files\\Cisco Spark\\CiscoCollabHost.exe' }, 'Webex', 'meeting'],
    [{ path: 'C:\\Program Files (x86)\\GoToMeeting\\20000\\g2mcomm.exe' }, 'GoTo Meeting', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Programs\\GoTo\\GoTo.exe' }, 'GoTo Meeting', 'meeting'],
    [{ path: 'C:\\Program Files\\BlueJeans\\BlueJeans.exe' }, 'BlueJeans', 'meeting'],
    [{ path: 'C:\\Program Files\\RingCentral\\RingCentral.exe' }, 'RingCentral', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Programs\\Whereby\\Whereby.exe' }, 'Whereby', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Programs\\Around\\Around.exe' }, 'Around', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Programs\\Gather\\GatherV2.exe' }, 'Gather', 'meeting'],
    [{ path: 'C:\\Program Files\\Tuple\\tuple.exe' }, 'Tuple', 'meeting'],
    [{ path: 'C:\\Program Files\\Pop\\Pop.exe' }, 'Pop', 'meeting'],
    [{ path: 'C:\\Program Files\\Amazon\\Chime\\Chime.exe' }, 'Amazon Chime', 'meeting'],
    [{ bundleId: 'Microsoft.SkypeApp_kzf8qxf38zg5c' }, 'Skype', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Lark\\Lark.exe' }, 'Lark', 'meeting'],
    [{ path: 'C:\\Program Files (x86)\\DingDing\\DingTalk.exe' }, 'DingTalk', 'meeting'],
    [{ path: 'C:\\Program Files\\Tencent\\WeMeet\\wemeetapp.exe' }, 'Tencent Meeting', 'meeting'],
    [{ path: 'C:\\Program Files\\VooV Meeting\\voovmeetingapp.exe' }, 'Tencent Meeting', 'meeting'],
    [{ path: 'C:\\Program Files\\Zoho Meeting\\ZohoMeeting.exe' }, 'Zoho Meeting', 'meeting'],
    [{ path: 'C:\\Program Files\\Jitsi Meet\\Jitsi Meet.exe' }, 'Jitsi Meet', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Programs\\8x8 Work\\8x8 Work.exe' }, '8x8 Work', 'meeting'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\slack\\app-4.41.0\\slack.exe' }, 'Slack', 'messaging'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Discord\\app-1.0.9\\Discord.exe' }, 'Discord', 'messaging'],
    [{ bundleId: '5319275A.WhatsAppDesktop_cv1g1gvanyjgm' }, 'WhatsApp', 'messaging'],
    [{ path: 'C:\\Program Files\\WindowsApps\\5319275A.WhatsAppDesktop_2.24\\WhatsApp.Root.exe' }, 'WhatsApp', 'messaging'],
    [{ path: 'C:\\Users\\a\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe' }, 'Telegram', 'messaging'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Programs\\signal-desktop\\Signal.exe' }, 'Signal', 'messaging'],
    [{ path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }, 'Google Chrome', 'browser'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Perplexity\\Comet\\Application\\comet.exe' }, 'Comet', 'browser'],
    [{ path: 'C:\\Program Files\\Zen Browser\\zen.exe' }, 'Zen', 'browser'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Yandex\\YandexBrowser\\Application\\browser.exe' }, 'Yandex Browser', 'browser'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\Sidekick\\Application\\sidekick.exe' }, 'Sidekick', 'browser'],
    [{ path: 'C:\\Program Files\\Island\\Island\\Application\\Island.exe' }, 'Island', 'browser'],
    [{ path: 'C:\\Users\\a\\AppData\\Local\\imput\\Helium\\Application\\helium.exe' }, 'Helium', 'browser'],
    [{ path: 'C:\\Program Files\\Opera GX\\opera_gx.exe' }, 'Opera', 'browser'],
];

for (const [platform, table] of [['darwin', MAC], ['win32', WIN]]) {
    test(`${platform}: every listed process maps to its app and kind`, () => {
        for (const [proc, name, kind] of table) {
            const app = appOfProcess(platform, proc);
            assert.ok(app, `${JSON.stringify(proc)} is known on ${platform}`);
            assert.equal(app.name, name, JSON.stringify(proc));
            assert.equal(app.kind, kind, `${name} kind`);
        }
    });
}

test('each OS reads only its own identities, and a generic exe needs its install folder', () => {
    assert.equal(appOfProcess('darwin', { path: 'C:\\Program Files\\Tuple\\tuple.exe' }), null);
    assert.equal(appOfProcess('win32', { bundleId: 'net.whatsapp.WhatsApp' }), null);
    assert.equal(appOfProcess('win32', { path: 'C:\\Tools\\browser.exe' }), null, 'browser.exe alone is not Yandex');
    assert.equal(appOfProcess('linux', { bundleId: 'app.tuple.app' }), null);
});

test('the table is well formed: unique names, lowercased identities, every app known on at least one OS', () => {
    const names = KNOWN_APPS.map((k) => k.name);
    assert.equal(new Set(names).size, names.length);
    assert.ok(KNOWN_APPS.length >= 45, `${KNOWN_APPS.length} apps`);
    assert.ok(KNOWN_APPS.filter((k) => k.kind === 'browser').length >= 14, 'at least 14 browsers');
    for (const k of KNOWN_APPS) {
        const ids = [...k.mac.bundlePrefixes, ...k.mac.apps, ...(k.mac.bundleContains ?? []), ...k.win.exes, ...k.win.packages, ...(k.win.pathIncludes ?? [])];
        for (const id of ids) assert.equal(id, id.toLowerCase(), `${k.name}: ${id} lowercased`);
        assert.ok(ids.length > 0 || (k.mac.paths ?? []).length > 0, `${k.name} has identities`);
    }
    // Call apps first, so an installed Meet app (Chrome's prefix) is Meet.
    const firstBrowser = KNOWN_APPS.findIndex((k) => k.kind === 'browser');
    assert.ok(KNOWN_APPS.slice(firstBrowser).every((k) => k.kind === 'browser'));
});

const input = (platform, micUsers, windows = []) => ({
    platform, micUsers, windows: () => windows, live: [], self: platform === 'win32' ? WIN_SELF : MAC_SELF,
});

for (const platform of ['darwin', 'win32']) {
    const proc = (mac, win) => (platform === 'darwin' ? mac : win);
    test(`${platform}: a chat app counts only while it holds the microphone, and after a longer hold`, () => {
        const whatsapp = proc({ bundleId: 'net.whatsapp.WhatsApp' }, { path: 'C:\\x\\WhatsApp.exe' });
        // Running with a window open but not on the mic: no call.
        assert.equal(detectMeeting(input(platform, [], [{ pid: 3, owner: 'WhatsApp', title: 'WhatsApp', path: proc('/Applications/WhatsApp.app/Contents/MacOS/WhatsApp', 'C:\\x\\WhatsApp.exe') }])), null);
        // On the mic: a call, marked as a chat app's.
        assert.deepEqual(detectMeeting(input(platform, [whatsapp])), { id: 'app:WhatsApp', app: 'WhatsApp', via: 'app', messaging: true });
        // A real meeting app wins over a chat app holding the mic at the same time.
        const zoom = proc({ bundleId: 'us.zoom.xos' }, { path: 'C:\\z\\Zoom.exe' });
        assert.equal(detectMeeting(input(platform, [whatsapp, zoom]))?.app, 'Zoom');
        // A browser on the mic with no meeting is still nothing.
        const chrome = proc({ bundleId: 'com.google.Chrome.helper' }, { path: 'C:\\c\\chrome.exe' });
        assert.equal(detectMeeting(input(platform, [chrome])), null);

        // The detector: a voice note (under the longer hold) is never announced.
        let t = 0;
        let signal = null;
        const shown = [];
        const d = new MeetingDetector({ read: () => signal, isMeetingActive: () => false, onDetected: (x) => shown.push(x.id), now: () => t }, { confirmMs: 4000, messagingConfirmMs: 20000 });
        const step = (ms, s) => { t += ms; signal = s; d.tick(); };
        step(0, input(platform, [whatsapp]));
        for (let i = 0; i < 6; i++) step(2000, input(platform, [whatsapp]));
        assert.deepEqual(shown, [], '12 s of a voice note: no prompt');
        step(2000, input(platform, []));
        step(2000, input(platform, [whatsapp]));
        for (let i = 0; i < 9; i++) step(2000, input(platform, [whatsapp]));
        assert.deepEqual(shown, [], 'the gap started the wait over');
        step(2000, input(platform, [whatsapp]));
        assert.deepEqual(shown, ['app:WhatsApp'], 'held 20 s: a call');
        // A meeting app still needs only its short hold.
        const z = new MeetingDetector({ read: () => signal, isMeetingActive: () => false, onDetected: (x) => shown.push(x.id), now: () => t }, { confirmMs: 4000, messagingConfirmMs: 20000 });
        signal = input(platform, [zoom]); z.tick(); t += 4000; z.tick();
        assert.equal(shown.at(-1), 'app:Zoom');
    });

    test(`${platform}: auto-stop reads chat apps and meeting apps ahead of browsers`, () => {
        const list = micAppsOf(platform, [
            proc({ bundleId: 'com.google.Chrome.helper' }, { path: 'C:\\c\\chrome.exe' }),
            proc({ bundleId: 'com.tinyspeck.slackmacgap' }, { path: 'C:\\s\\slack.exe' }),
        ], platform === 'win32' ? WIN_SELF : MAC_SELF);
        assert.deepEqual(list, ['Slack', 'Google Chrome']);
    });
}
