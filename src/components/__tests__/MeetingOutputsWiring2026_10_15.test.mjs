// Granola parity round 2, outputs (2026-10-15): source-level wiring checks that
// need no build. Settings has a Connections tab in its nav order, nav and
// panel; the meeting page mounts the Share menu beside Copy; and the preload
// bridge and the main-process handlers agree on every outputs channel, so a
// renamed channel cannot leave a button that silently does nothing.
//
// Run: node --test src/components/__tests__/MeetingOutputsWiring2026_10_15.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('Settings: connections sits between audio and help in SETTINGS_NAV_ORDER, with a nav button and a panel', () => {
    const src = read('src/components/SettingsOverlay.tsx');
    const order = src.match(/const SETTINGS_NAV_ORDER = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
    assert.ok(order.indexOf('connections') > order.indexOf('audio'));
    assert.ok(order.indexOf('connections') < order.indexOf('help'));
    assert.match(src, /onClick=\{\(\) => setActiveTab\('connections'\)\}/);
    assert.match(src, /\{activeTab === 'connections' && <ConnectionsSettings \/>\}/);
});

test('meeting page: the Share menu is mounted next to Copy', () => {
    const src = read('src/components/MeetingDetails.tsx');
    assert.match(src, /import \{ ShareMenu \} from '\.\/meeting\/ShareMenu';/);
    assert.match(src, /<ShareMenu\s+meetingId=\{meeting\.id\}/);
});

test('preload and main agree on every outputs channel', () => {
    const preload = new Set([...read('electron/preload.ts').matchAll(/ipcRenderer\.invoke\('(outputs:[a-z-]+)'/g)].map((m) => m[1]));
    const main = new Set([...read('electron/services/outputs/outputsIpc.ts').matchAll(/safeHandle\('(outputs:[a-z-]+)'/g)].map((m) => m[1]));
    assert.ok(preload.size >= 20);
    assert.deepEqual([...preload].sort(), [...main].sort());
});

test('opening the Share menu reads connection status only; sends happen from a Send button', () => {
    const src = read('src/components/meeting/ShareMenu.tsx');
    const openMenu = src.match(/const openMenu = \([^)]*\) => \{([\s\S]*?)\n    \};/)[1];
    assert.ok(!/send(Slack|Notion|Crm)|export(Pdf|Html)/.test(openMenu));
    // One Send each; Notion's second call is the explicit "Start over with a new page".
    const count = (fn) => (src.match(new RegExp(`api\\(\\)\\?\\.${fn}\\(`, 'g')) || []).length;
    assert.equal(count('sendSlack'), 1);
    assert.equal(count('sendCrm'), 1);
    assert.equal(count('sendNotion'), 2);
    assert.equal((src.match(/sendNotion\(meetingId, \{ includeTranscript, startOver: true \}\)/g) || []).length, 1);
});

test('Salesforce is wired end to end as a fourth CRM (parity round 3)', () => {
    // Type: part of the CRM union.
    assert.match(read('src/types/meetingOutputs.ts'), /export type CrmService = [^;]*'salesforce'/);
    // Sender: label, instance-URL guard, SOQL lookup and Task send.
    const crm = read('electron/services/outputs/crm.ts');
    assert.match(crm, /CRM_LABELS[^=]*=\s*\{[^}]*salesforce: 'Salesforce'/);
    assert.match(crm, /export function normaliseSalesforceInstanceUrl/);
    assert.match(crm, /FROM Contact WHERE Email/);
    assert.match(crm, /\/sobjects\/Task/);
    // Main: a recognised token service and CRM.
    const ipc = read('electron/services/outputs/outputsIpc.ts');
    assert.match(ipc, /TOKEN_SERVICES = \[[^\]]*'salesforce'/);
    assert.match(ipc, /isCrm[^=]*=.*'salesforce'/);
    // UI: a Settings row and a place in the Share menu's CRM picker.
    // Every CRM has a page on Settings › Connectors; its top is the shared TokenServicePanel.
    assert.match(read('src/components/settings/connectors/catalog.ts'), /key: 'salesforce'/);
    assert.match(read('src/components/settings/ConnectionsSettings.tsx'), /<TokenServicePanel\s+service=\{svc\}/);
    const share = read('src/components/meeting/ShareMenu.tsx');
    assert.match(share, /CRM_NAMES[^=]*=\s*\{[^}]*salesforce: 'Salesforce'/);
    assert.match(share, /'hubspot', 'attio', 'affinity', 'salesforce'/);
});

test('Connectors: the MCP card is Granola\'s layout, with a setup for every app main writes one for', () => {
    const pane = read('src/components/settings/ConnectionsSettings.tsx');
    const card = read('src/components/settings/connectors/McpCard.tsx');
    // The pane hands the card the status; the card owns the switch and the setups.
    assert.match(pane, /<McpCard mcp=\{status\.mcp\} onStatus=/);
    assert.doesNotMatch(pane, /McpRow/);
    assert.match(card, /setMcpEnabled\(!mcp\.enabled\)/);
    assert.match(card, /resetMcpToken\(\)/);
    // Every snippet main returns has a tab, and no tab points at a missing snippet.
    const types = read('src/types/meetingOutputs.ts');
    const keys = types.match(/snippets\?: \{([^}]*)\}/)[1].match(/(\w+): string/g).map((s) => s.split(':')[0]).sort();
    const tabs = [...card.matchAll(/\{ id: '(\w+)', label: /g)].map((m) => m[1]).sort();
    assert.deepEqual(tabs, keys);
    // Claude, OpenAI and code tiles stack at rest and spread on hover, as Granola's do.
    assert.match(card, /claude\.svg\?raw/);
    assert.match(card, /openai\.svg\?raw/);
    // Granola's stack: they overlap at rest, each later tile on top (no z-index
    // reversing the row), and spread apart on hover, each one step further.
    assert.equal((card.match(/-ml-2 /g) || []).length, 2);
    assert.doesNotMatch(card, /<Tile className="z-/);
    assert.match(card, /group-hover:translate-x-3/);
    assert.match(card, /group-hover:translate-x-6/);
    // A new token cuts off every connected app, so it takes a second press.
    assert.match(card, /Disconnect every app\?/);
});

test("Connectors: built from Settings' own cards and rows, no display serif", () => {
    const parts = read('src/components/settings/connectors/parts.tsx');
    const pane = read('src/components/settings/ConnectionsSettings.tsx');
    const gmail = read('src/components/settings/connectors/GmailPanel.tsx');
    const mcp = read('src/components/settings/connectors/McpCard.tsx');
    const css = read('src/index.css');
    for (const [name, src] of [['parts', parts], ['pane', pane], ['gmail', gmail], ['mcp', mcp]]) {
        assert.doesNotMatch(src, /font-plex-serif/, `${name} still uses the display serif`);
    }
    // The list: General's small-capitals label over each group, one Audio card of
    // rows per category; a row is General's 40px tile, the bold name, what is
    // connected (with the dot) or what it does, a chevron.
    assert.match(pane, /CONNECTOR_GROUPS\.map\(\(g\) =>/);
    assert.match(pane, /<GroupLabel>\{t\(g\.label\)\}<\/GroupLabel>\s*<Group>\s*\{CONNECTOR_CATALOG\.filter\(\(e\) => e\.group === g\.id\)\.map\(\(e\) => \(\s*<NavRow/);
    assert.match(pane, /value=\{rowStatus\(e\.key\)\}/);
    assert.match(pane, /description=\{t\(e\.description\)\}/);
    assert.match(parts, /export const NavRow[\s\S]*?<Tile>\{icon\}<\/Tile>[\s\S]*?text-sm font-bold text-text-primary[\s\S]*?<ChevronRight/);
    // Settings' own material: Audio's card, General's tile, no System Settings group.
    assert.match(parts, /export const Group[\s\S]*?\$\{SETTINGS_CARD\} divide-y divide-border-subtle/);
    assert.match(parts, /export const Tile[\s\S]*?'h-10 w-10'[\s\S]*?rounded-lg border border-border-subtle bg-bg-item-surface/);
    assert.match(parts, /export const SectionHeading[\s\S]*?text-lg font-bold text-text-primary/);
    assert.doesNotMatch(css, /\.cx-group|\.cx-app-icon|\.cx-glyph-icon/);
    assert.match(css, /\.cx-row \{ transition: background-color 150ms ease-out; \}/);
    assert.match(parts, /export const LiveDot[^\n]*rounded-full bg-emerald-500/);
    assert.doesNotMatch(parts, /LiquidGlassBadge/);
    // Every button is a Liquid Glass pill: the one action in the Usage question's
    // lavender (re-tinted for dark beside the meeting notes' send), the rest clear.
    assert.match(parts, /variant="lavender"\s+className=\{LAVENDER_PILL\}/);
    assert.match(parts, /export const LAVENDER_PILL = 'lg-sm lg-lav-tinted shrink-0';/);
    assert.match(css, /\.lg-button\.lg-lavender:is\(\.mn-fu-send, \.lg-lav-tinted\) \{/);
    assert.match(parts, /<LiquidGlassButton variant="clear" className=\{`lg-sm/);
    // .lg-clear inherits its ink, so the colour sits on a display:contents wrapper.
    assert.match(parts, /<span className=\{`contents \$\{tone \? tones\.text\[tone\] : 'text-text-primary'\}`\}>/);
    assert.match(parts, /iconOnly \? '!w-\[30px\] !px-0'/);
    assert.match(mcp, /variant="lavender"/);
    for (const f of ['ConnectionsSettings.tsx', 'connectors/GmailPanel.tsx', 'connectors/WebhooksPanel.tsx', 'connectors/AutoSendSection.tsx', 'connectors/McpCard.tsx', 'connectors/common.tsx']) {
        assert.doesNotMatch(read(`src/components/settings/${f}`), /SETTINGS_BTN|QUIET_BTN|variant="action"/, `${f} still has a non-glass button`);
    }
    assert.doesNotMatch(parts + mcp, /GLASS_PILL/);
    // A page's setting, as Audio's sections: the bold heading and its grey line, then the card.
    assert.match(parts, /<SectionHeading title=\{t\(title\)\} subtitle=\{subtitle\} \/>\s*<Group>\{children\}<\/Group>/);
    // The MCP card sits in the same filled card as the rest of the page.
    assert.match(mcp, /<div className=\{`\$\{SETTINGS_CARD\} group p-5`\}>/);
    assert.doesNotMatch(parts + mcp, /CONNECTOR_CARD/);
    assert.match(read('src/components/settings/connectors/catalog.ts'), /\{ id: 'workspace', label: 'Email and workspace' \}/);
});

test("Connectors: the Gmail page keeps Granola's sections (account card, Includes, How Gmail is used)", () => {
    const gmail = read('src/components/settings/connectors/GmailPanel.tsx');
    const pane = read('src/components/settings/ConnectionsSettings.tsx');
    assert.match(gmail, /<DisconnectButton confirmLabel=\{t\('Disconnect Gmail\?'\)\}/);
    assert.match(gmail, /<ConnectPill label=\{t\('Connect Gmail'\)\} external/);
    assert.equal((gmail.match(/<FeatureCard\b/g) || []).length, 2);
    // Includes is read, not worked in: its lines sit on the page, no card, no 40px tiles.
    assert.match(gmail, /<PlainSection title="Includes">/);
    assert.doesNotMatch(gmail, /<DetailSection title="Includes">/);
    assert.match(gmail, /<UsageList title="How Gmail is used"/);
    // The briefs switch lives on its row; Gmail's page has no How it works group.
    assert.match(gmail, /setGmailBriefsEnabled\(!status\.briefsEnabled\)/);
    assert.match(pane, /steps: page === 'gmail' \? undefined : entry\.howItWorks/);
    assert.match(pane, /\{pageInfo\.steps && <HowItWorks lines=\{pageInfo\.steps\} \/>\}/);
});

test('Connectors: every page opens on the same heading and account card', () => {
    const parts = read('src/components/settings/connectors/parts.tsx');
    const css = read('src/index.css');
    const pane = read('src/components/settings/ConnectionsSettings.tsx');
    const hooks = read('src/components/settings/connectors/WebhooksPanel.tsx');
    // The connector's name and line as the section heading, then a card whose row is the connection: mark, dot, words, pills.
    assert.match(parts, /export const ActionArea/);
    assert.match(parts, /\{page && <SectionHeading title=\{t\(page\.title\)\} subtitle=\{t\(page\.description\)\} \/>\}/);
    assert.match(parts, /\{page && <Tile>\{page\.mark\}<\/Tile>\}/);
    // How it works, Includes and How Gmail is used are read, not worked in: dot lines on Plans' row
    // columns (a dot alone in the 40px column, no numbers, no icons, no tiles), no card, no stagger.
    assert.match(parts, /export const PlainSection[\s\S]*?<SectionHeading title=\{t\(title\)\} \/>\s*<ul>\{children\}<\/ul>/);
    assert.match(parts, /export const DotRow[\s\S]*?<span aria-hidden className="flex h-5 w-10 shrink-0 items-center justify-center text-text-secondary">\s*<span className="h-1\.5 w-1\.5 rounded-full bg-current" \/>/);
    for (const name of ['HowItWorks', 'UsageList', 'FeatureCard']) {
        assert.match(parts, new RegExp(`export const ${name}[\\s\\S]*?<DotRow`), `${name} is not built from DotRow`);
    }
    assert.doesNotMatch(parts, /SmallTile|\{i \+ 1\}<\/span>\s*<span className="min-w-0 text-sm/);
    assert.doesNotMatch(read('src/components/settings/connectors/GmailPanel.tsx'), /icon: <|icon=\{<(Send|FileText)/);
    assert.doesNotMatch(css, /\.cx-step/);
    assert.match(parts, /export const FOLD = 'border-t border-border-subtle px-4 py-4';/);
    assert.match(parts, /state === 'on' \? <LiveDot \/> : state === 'busy' \? <Loader2/);
    assert.match(pane, /<ConnectorPageContext\.Provider value=\{pageInfo\}>/);
    // Token services and Slack sit on it; Connect says the service's name, with the browser arrow when it signs in there.
    assert.match(pane, /<ConnectPill label=\{t\(`Connect \$\{meta\.title\}`\)\} external/);
    assert.match(pane, /confirmLabel=\{t\(`Disconnect \$\{meta\.title\}\?`\)\}/);
    assert.match(pane, /<ConnectPill label=\{t\('Connect Slack'\)\} external/);
    assert.match(pane, /<DetailSection title="Where pages go">/);
    // Zapier and Webhooks add from the row; Zapier also opens Zapier's editor in the browser.
    assert.match(hooks, /<ConnectPill\s+label=\{zapier \? t\('Add a Zap'\) : t\('Add webhook'\)\}/);
    assert.match(hooks, /openExternal\?\.\('https:\/\/zapier\.com\/editor'\)/);
    // Automation shows only once there is something to send to.
    assert.match(read('src/components/settings/connectors/AutoSendSection.tsx'), /if \(!connected && !mine\.length\) return null;/);
});

test('Connectors: Salesforce, HubSpot and Pipedrive always offer the pasted token beside browser sign-in', () => {
    const pane = read('src/components/settings/ConnectionsSettings.tsx');
    assert.match(pane, /TOKEN_ALWAYS_OFFERED: ReadonlySet<string> = new Set\(\['salesforce', 'hubspot', 'pipedrive'\]\)/);
    // A clear "Paste a token" pill opens the token form: always for these three, after a failed sign-in for the rest.
    assert.match(pane, /const offerToken = useBrowser && !open && \(TOKEN_ALWAYS_OFFERED\.has\(service\) \|\| signIn\.failed\);/);
    assert.match(pane, /\) : offerToken \? \(\s*<GlassPill onClick=\{\(\) => \{ signIn\.clearFlash\(\); setOpen\(true\); \}\}[^\n]*>\s*\{t\('Paste a token'\)\}\s*<\/GlassPill>/);
});
