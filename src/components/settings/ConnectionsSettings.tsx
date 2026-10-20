// Settings › Connectors: Gmail, where meeting notes can be sent (Slack, Notion,
// Zapier, webhooks and five CRMs), personal API keys for the local API, and the
// local MCP server that lets AI apps on this computer read meetings. Each
// connector has its own page (src/components/settings/connectors/).
// Follow-ups in the user's own style live in each mode's editor ("Follow-ups in
// your style", above Notes template), not here.
//
// Built from Settings' own parts, so it reads like General and Audio: each
// group of the list is a card of General's rows (the mark in a 40px tile, the
// name, what is connected or what it does, a chevron), and each connector's
// page is Audio's sections, a bold heading over a card (connectors/parts.tsx).
// Tokens are sent to
// the main process once, to be checked and saved in the system keychain; this
// pane only ever reads back whether one is saved.

import React, { useCallback, useEffect, useState } from 'react';
import {
    AlertCircle, KeyRound, Plus, RefreshCw, Search, Trash2,
} from 'lucide-react';
import { useT } from '../../i18n';
import { ConnectorMark } from './ConnectorMark';
import { BusyIcon, FlashNotice, flashOf, type Flash } from './connectors/common';
import { CONNECTOR_CATALOG, CONNECTOR_GROUPS, catalogEntry, type ConnectorKey } from './connectors/catalog';
import { ActionArea, BackLink, ConnectPill, ConnectorPageContext, DetailSection, DisconnectButton, FOLD, Group, GroupLabel, GlassPill, HowItWorks, ListCard, NavRow, ROW, Tile } from './connectors/parts';
import { AutoSendSection } from './connectors/AutoSendSection';
import { WebhooksPanel } from './connectors/WebhooksPanel';
import { GmailPanel } from './connectors/GmailPanel';
import { McpCard } from './connectors/McpCard';
import type { AutoSendDestination, AutoSendRuleInfo, ConnectorsApi, FolderOption, GmailStatus, WebhookEndpointInfo } from '../../types/connectors';
import {
    Collapse, SETTINGS_FIELD_LABEL, SETTINGS_INPUT,
    SettingsFootnote, SettingsMotionReady, SettingsNotice, SettingsSectionHeading,
    useMotionReadyAfter, useSettingsTones,
} from './SettingsRow';
import type {
    ConnectionsStatus, CrmService, EnrichmentService, MeetingOutputsApi, NotionSearchResult, OAuthConnectorService,
} from '../../types/meetingOutputs';

const api = (): MeetingOutputsApi | undefined => window.electronAPI?.meetingOutputs;

/**
 * Connect by signing in with the service's own account, in the browser
 * (Settings › Connectors). Resolves when the browser hands back, the person
 * cancels, or it fails; a failure offers the pasted-token form instead.
 */
function useBrowserConnect(service: OAuthConnectorService, onConnected: () => void) {
    const t = useT();
    const [waiting, setWaiting] = useState(false);
    const [failed, setFailed] = useState(false);
    const [flash, setFlash] = useState<Flash>(null);
    const start = async () => {
        setWaiting(true);
        setFailed(false);
        setFlash(null);
        const res = await api()?.connectWithBrowser(service).catch(() => undefined);
        setWaiting(false);
        if (res?.ok) { setFlash(flashOf(res)); onConnected(); return; }
        // Cancelled: nothing to say.
        if (res && !res.message) return;
        setFailed(true);
        setFlash(flashOf(res, undefined) ?? { tone: 'danger', text: t('Something went wrong. Try again.') });
    };
    const cancel = () => { void api()?.cancelBrowserConnect(); };
    return { waiting, failed, flash, start, cancel, clearFlash: () => { setFlash(null); setFailed(false); } };
}

// ── Token services: Notion and the CRMs ──────────────────────────────────

/**
 * CRMs whose page always offers the pasted token beside browser sign-in, not
 * only after a sign-in fails: Salesforce's sign-in reaches only the org its
 * app lives in until it is packaged, and HubSpot and Pipedrive have no app yet
 * (they open the token form directly until natively-api has their clients).
 */
const TOKEN_ALWAYS_OFFERED: ReadonlySet<string> = new Set(['salesforce', 'hubspot', 'pipedrive']);

const TOKEN_META: Record<'notion' | CrmService | EnrichmentService, { title: string; icon: React.ReactNode; blurb: string; tokenLabel: string; howTo: string }> = {
    notion: {
        title: 'Notion',
        icon: <ConnectorMark id="notion" />,
        blurb: 'Turn meeting notes into Notion pages.',
        tokenLabel: 'Integration token',
        howTo: 'In Notion, open Settings, Connections, Develop or manage integrations, and create an internal integration. Copy its token here, then share the page or database you want notes in with that integration.',
    },
    hubspot: {
        title: 'HubSpot',
        icon: <ConnectorMark id="hubspot" />,
        blurb: 'Add meeting notes to the contacts you met.',
        tokenLabel: 'Private app token',
        howTo: 'In HubSpot, open Settings, Integrations, Private Apps, and create an app with the contacts read and notes write scopes. Copy its access token here.',
    },
    attio: {
        title: 'Attio',
        icon: <ConnectorMark id="attio" />,
        blurb: 'Add meeting notes to the people you met.',
        tokenLabel: 'API key',
        howTo: 'In Attio, open Workspace settings, Developers, and create an access token that can read records and write notes. Copy it here.',
    },
    affinity: {
        title: 'Affinity',
        icon: <ConnectorMark id="affinity" />,
        blurb: 'Add meeting notes to the people you met.',
        tokenLabel: 'API key',
        howTo: 'In Affinity, open Settings, API, and generate an API key. Copy it here.',
    },
    salesforce: {
        title: 'Salesforce',
        icon: <ConnectorMark id="salesforce" />,
        blurb: 'Log meetings on the contacts you met.',
        tokenLabel: 'Access token',
        howTo: 'Paste your Salesforce access token and your instance URL (from the Salesforce CLI, "sf org display", or a connected app). Access tokens expire, so paste a fresh one when logging stops working.',
    },
    pipedrive: {
        title: 'Pipedrive',
        icon: <ConnectorMark id="pipedrive" />,
        blurb: 'Add meeting notes to the people you met.',
        tokenLabel: 'API token',
        howTo: 'In Pipedrive, open your profile menu, Personal preferences, API, and copy your personal API token here.',
    },
    clearbit: {
        title: 'Clearbit',
        icon: <ConnectorMark id="clearbit" />,
        blurb: 'Suggest a title and company for the people you met, looked up by email.',
        tokenLabel: 'API key',
        howTo: 'In Clearbit, open your account settings and copy the secret API key. Natively looks people up only when you press "Look up attendees" on a meeting, and every result is a suggestion you accept on the People page.',
    },
};

/**
 * A token service's page top (Notion, the CRMs, Clearbit): the page's card,
 * with "Connect HubSpot" (and the browser arrow when it signs in there), or
 * "Connected to Acme" with Disconnect and Test connection. The pasted-token
 * form opens inside the card when there is no browser sign-in; with one, a
 * "Paste a token" pill on the right offers it, always for the CRMs in
 * TOKEN_ALWAYS_OFFERED and after a sign-in did not work for the rest.
 * `children` are the page's sections.
 */
const TokenServicePanel: React.FC<{
    service: 'notion' | CrmService | EnrichmentService;
    connected: boolean;
    /** The workspace or account a browser sign-in connected, for "Connected to …". */
    account?: string;
    /** True when Connect signs in with the browser instead of opening the token form. */
    browser?: boolean;
    notice?: React.ReactNode;
    onChanged: () => void;
    children?: React.ReactNode;
}> = ({ service, connected, account, browser, notice, onChanged, children }) => {
    const t = useT();
    const meta = TOKEN_META[service];
    const signIn = useBrowserConnect(service as OAuthConnectorService, onChanged);
    const useBrowser = !!browser && !connected;
    const needsUrl = service === 'salesforce';
    const [open, setOpen] = useState(false);
    const [token, setToken] = useState('');
    const [instanceUrl, setInstanceUrl] = useState('');
    const [busy, setBusy] = useState<'save' | 'test' | null>(null);
    const [flash, setFlash] = useState<Flash>(null);
    const canSave = !!token.trim() && (!needsUrl || !!instanceUrl.trim()) && !busy;

    const save = async () => {
        if (!canSave) return;
        setBusy('save');
        setFlash(null);
        const res = await api()?.saveToken(service, token, needsUrl ? instanceUrl.trim() : undefined).catch(() => undefined);
        setBusy(null);
        setFlash(flashOf(res, `${meta.title} is connected.`));
        if (res?.ok) { setToken(''); setInstanceUrl(''); setOpen(false); onChanged(); }
    };
    const test = async () => {
        setBusy('test');
        setFlash(null);
        const res = await api()?.testConnection(service).catch(() => undefined);
        setBusy(null);
        setFlash(flashOf(res));
    };
    const disconnect = async () => {
        await api()?.disconnect(service).catch(() => undefined);
        setFlash(null);
        signIn.clearFlash();
        onChanged();
    };

    const offerToken = useBrowser && !open && (TOKEN_ALWAYS_OFFERED.has(service) || signIn.failed);
    const state = connected ? 'on' : signIn.waiting ? 'busy' : 'off';
    const title = connected
        ? (account ? `${t('Connected to')} ${account}` : t('Connected'))
        : signIn.waiting ? t(`Waiting for ${meta.title}…`) : t('Not connected');
    const detail = connected ? t('Checked before every send.')
        : signIn.waiting ? t(`Finish signing in to ${meta.title} in your browser.`)
        : useBrowser && !open ? (signIn.failed ? t('Sign-in did not finish.') : t(`Sign in with ${meta.title} in your browser.`))
        : t(`Paste your ${meta.tokenLabel.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())} to connect.`);

    const primary = connected ? (
        <DisconnectButton confirmLabel={t(`Disconnect ${meta.title}?`)} onDisconnect={() => void disconnect()} />
    ) : useBrowser && !open ? (
        <ConnectPill label={t(`Connect ${meta.title}`)} external waiting={signIn.waiting} onClick={() => void signIn.start()} />
    ) : (
        <ConnectPill label={open ? t('Cancel') : t(`Connect ${meta.title}`)} expanded={open} onClick={() => setOpen((v) => !v)} />
    );
    const secondary = signIn.waiting ? (
        <GlassPill onClick={signIn.cancel}>{t('Cancel')}</GlassPill>
    ) : connected ? (
        <GlassPill onClick={() => void test()} disabled={!!busy} icon={<BusyIcon busy={busy === 'test'} icon={<RefreshCw size={14} />} />}>
            {t('Test connection')}
        </GlassPill>
    ) : offerToken ? (
        <GlassPill onClick={() => { signIn.clearFlash(); setOpen(true); }} aria-expanded={false} icon={<KeyRound size={14} />}>
            {t('Paste a token')}
        </GlassPill>
    ) : undefined;

    return (
        <>
            {notice}
            <ActionArea
                state={state}
                title={title}
                titleKey={`${state}:${account ?? ''}`}
                detail={detail}
                secondary={secondary}
                flash={<FlashNotice flash={flash ?? signIn.flash} />}
                below={
                    <>
                        <Collapse open={open && !connected}>
                            <div className={FOLD}>
                                <div className="space-y-3">
                                    <p className="text-xs leading-relaxed text-text-secondary">{t(meta.howTo)}</p>
                                    {needsUrl && (
                                        <label className="block">
                                            <span className={SETTINGS_FIELD_LABEL}>{t('Instance URL')}</span>
                                            <input
                                                type="text"
                                                autoComplete="off"
                                                spellCheck={false}
                                                placeholder="https://yourorg.my.salesforce.com"
                                                className={`${SETTINGS_INPUT} mt-1`}
                                                value={instanceUrl}
                                                onChange={(e) => setInstanceUrl(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void save(); }}
                                            />
                                        </label>
                                    )}
                                    <label className="block">
                                        <span className={SETTINGS_FIELD_LABEL}>{t(meta.tokenLabel)}</span>
                                        <div className="mt-1 flex items-center gap-2">
                                            <input
                                                type="password"
                                                autoComplete="off"
                                                spellCheck={false}
                                                className={SETTINGS_INPUT}
                                                value={token}
                                                onChange={(e) => setToken(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void save(); }}
                                            />
                                            <GlassPill onClick={() => void save()} disabled={!canSave} icon={<BusyIcon busy={busy === 'save'} icon={<KeyRound size={14} />} />}>
                                                {t('Save')}
                                            </GlassPill>
                                        </div>
                                    </label>
                                    <p className="text-xs text-text-tertiary">{t('Natively checks the token before saving it, and keeps it in your system keychain.')}</p>
                                </div>
                            </div>
                        </Collapse>
                    </>
                }
            >
                {primary}
            </ActionArea>
            {children}
        </>
    );
};

/** Where new Notion pages go: search the pages and databases shared with the integration. */
const NotionParentPicker: React.FC<{ current?: { title: string; type: string }; onPicked: () => void }> = ({ current, onPicked }) => {
    const t = useT();
    const [open, setOpen] = useState(!current);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<NotionSearchResult[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState<Flash>(null);

    const search = async () => {
        setBusy(true);
        setFlash(null);
        const res = await api()?.searchNotion(query).catch(() => undefined);
        setBusy(false);
        if (!res?.ok) { setFlash(flashOf(res)); setResults(null); return; }
        setResults(res.results || []);
        if (!res.results?.length) setFlash({ tone: 'warn', text: t('Nothing found. In Notion, share the page or database with your integration, then search again.') });
    };
    useEffect(() => { if (open && results === null) void search(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const pick = async (r: NotionSearchResult) => {
        const res = await api()?.setNotionParent(r).catch(() => undefined);
        if (!res?.ok) { setFlash(flashOf(res)); return; }
        setOpen(false);
        setFlash(null);
        onPicked();
    };

    return (
        <div className="px-4 py-3">
            <div className="flex items-center gap-4">
                <Tile><ConnectorMark id="notion" size={20} /></Tile>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-text-primary">{current ? current.title : t('Nothing picked yet')}</span>
                    <span className="mt-0.5 block text-xs text-text-secondary">
                        {current ? (current.type === 'database' ? t('Database') : t('Page')) : t('Pick where new pages go.')}
                    </span>
                </span>
                <GlassPill onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                    {open ? t('Done') : current ? t('Change') : t('Pick')}
                </GlassPill>
            </div>
            <Collapse open={open}>
                <div className="pt-3">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <input
                                className={SETTINGS_INPUT}
                                placeholder={t('Search pages and databases')}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
                            />
                            <GlassPill onClick={() => void search()} disabled={busy} icon={<BusyIcon busy={busy} icon={<Search size={14} />} />}>
                                {t('Search')}
                            </GlassPill>
                        </div>
                        <FlashNotice flash={flash} />
                        {results && results.length > 0 && (
                            <ul className="max-h-56 overflow-y-auto divide-y divide-border-subtle">
                                {results.map((r) => (
                                    <li key={r.id}>
                                        <button type="button" onClick={() => void pick(r)} className="w-full flex items-center justify-between gap-3 px-2 py-2 text-left text-xs text-text-primary hover:bg-bg-elevated rounded-md transition-colors">
                                            <span className="min-w-0 truncate">{r.title}</span>
                                            <span className="shrink-0 text-text-tertiary">{r.type === 'database' ? t('Database') : t('Page')}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </Collapse>
        </div>
    );
};

// ── Slack ────────────────────────────────────────────────────────────────

/**
 * Slack's page top: the page's card with "Connect Slack" (Slack asks for the
 * channel on its own screen), then, once a channel is in, "Connected" with Add
 * channel. The webhook form opens inside the card when there is no browser
 * sign-in, or from "Paste a webhook" after one did not work. The channels are
 * their own card below.
 */
const SlackPanel: React.FC<{ webhooks: ConnectionsStatus['slack']['webhooks']; browser?: boolean; notice?: React.ReactNode; onChanged: () => void; children?: React.ReactNode }> = ({ webhooks, browser, notice, onChanged, children }) => {
    const t = useT();
    const [open, setOpen] = useState(false);
    // Signing in with Slack adds one channel: Slack asks which on its own screen.
    const signIn = useBrowserConnect('slack', onChanged);
    const useBrowser = !!browser && !open;
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [flash, setFlash] = useState<Flash>(null);
    const n = webhooks.length;

    const add = async () => {
        setBusy('add');
        setFlash(null);
        const res = await api()?.addSlackWebhook(label, url).catch(() => undefined);
        setBusy(null);
        setFlash(flashOf(res, t('Slack channel added.')));
        if (res?.ok) { setLabel(''); setUrl(''); setOpen(false); onChanged(); }
    };
    const test = async (id: string) => {
        setBusy(id);
        setFlash(null);
        const res = await api()?.testSlackWebhook(id).catch(() => undefined);
        setBusy(null);
        setFlash(flashOf(res));
    };
    const remove = async (id: string) => {
        await api()?.removeSlackWebhook(id).catch(() => undefined);
        setFlash(null);
        onChanged();
    };
    const addChannel = () => (useBrowser ? void signIn.start() : setOpen((v) => !v));

    const state = n ? 'on' : signIn.waiting ? 'busy' : 'off';
    const title = n
        ? (n === 1 ? t('Connected · 1 channel') : `${t('Connected')} · ${n} ${t('channels')}`)
        : signIn.waiting ? t('Waiting for Slack…') : t('Not connected');
    const detail = signIn.waiting ? t('Pick a channel in your browser to finish.')
        : n ? t('Notes are posted as a message, after you review it.')
        : useBrowser ? (signIn.failed ? t('Sign-in did not finish.') : t('Sign in with Slack and pick a channel.'))
        : t('Paste an incoming webhook address for a channel.');

    const primary = n ? (
        <GlassPill onClick={addChannel} aria-expanded={useBrowser ? undefined : open} icon={useBrowser || !open ? <Plus size={14} /> : undefined}>
            {!useBrowser && open ? t('Cancel') : t('Add channel')}
        </GlassPill>
    ) : useBrowser ? (
        <ConnectPill label={t('Connect Slack')} external waiting={signIn.waiting} onClick={() => void signIn.start()} />
    ) : (
        <ConnectPill label={open ? t('Cancel') : t('Connect Slack')} expanded={open} onClick={() => setOpen((v) => !v)} />
    );
    const secondary = signIn.waiting ? (
        <GlassPill onClick={signIn.cancel}>{t('Cancel')}</GlassPill>
    ) : !n && useBrowser && signIn.failed ? (
        <GlassPill onClick={() => setOpen(true)} aria-expanded={false} icon={<KeyRound size={14} />}>{t('Paste a webhook')}</GlassPill>
    ) : undefined;

    return (
        <>
            {notice}
            <ActionArea
                state={state}
                title={title}
                titleKey={n ? `on:${n}` : state}
                detail={detail}
                secondary={secondary}
                flash={<FlashNotice flash={flash ?? signIn.flash} />}
                below={
                    <>
                        <Collapse open={open}>
                            <div className={FOLD}>
                                <div className="space-y-3">
                                    <p className="text-xs leading-relaxed text-text-secondary">
                                        {t('In Slack, create an app for your workspace, turn on Incoming Webhooks, and add a webhook for the channel. Paste its address here. Add one per channel.')}
                                    </p>
                                    <label className="block">
                                        <span className={SETTINGS_FIELD_LABEL}>{t('Channel name')}</span>
                                        <input className={`${SETTINGS_INPUT} mt-1`} placeholder="#team-updates" value={label} onChange={(e) => setLabel(e.target.value)} />
                                    </label>
                                    <label className="block">
                                        <span className={SETTINGS_FIELD_LABEL}>{t('Webhook address')}</span>
                                        <input
                                            type="password"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={`${SETTINGS_INPUT} mt-1`}
                                            placeholder="https://hooks.slack.com/services/…"
                                            value={url}
                                            onChange={(e) => setUrl(e.target.value)}
                                        />
                                    </label>
                                    <div className="flex justify-end">
                                        <GlassPill onClick={() => void add()} disabled={!url.trim() || !label.trim() || !!busy} icon={<BusyIcon busy={busy === 'add'} icon={<Plus size={14} />} />}>
                                            {t('Add channel')}
                                        </GlassPill>
                                    </div>
                                    <p className="text-xs text-text-tertiary">{t('Natively checks the webhook without posting anything, and keeps it in your system keychain.')}</p>
                                </div>
                            </div>
                        </Collapse>
                    </>
                }
            >
                {primary}
            </ActionArea>
            {n > 0 && (
                <DetailSection title="Channels">
                    <ListCard inset="tile">
                        {webhooks.map((w) => (
                            <div key={w.id} className={ROW}>
                                <Tile><ConnectorMark id="slack" size={20} /></Tile>
                                <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">{w.label}</span>
                                <GlassPill onClick={() => void test(w.id)} disabled={!!busy} icon={<BusyIcon busy={busy === w.id} icon={<RefreshCw size={14} />} />}>
                                    {t('Test')}
                                </GlassPill>
                                <GlassPill onClick={() => void remove(w.id)} aria-label={`${t('Remove')} ${w.label}`} icon={<Trash2 size={14} />} />
                            </div>
                        ))}
                    </ListCard>
                </DetailSection>
            )}
            {children}
        </>
    );
};

// ── Pane ─────────────────────────────────────────────────────────────────
//
// Laid out like Granola's Connectors (the integrations grouped by what they are
// for, then MCP; each opens its own page), drawn in Settings' own cards and rows.

const capi = (): ConnectorsApi | undefined => window.electronAPI?.connectors;

type ConnectorsData = {
    webhooks: WebhookEndpointInfo[];
    rules: AutoSendRuleInfo[];
    folders: FolderOption[];
    gmail: GmailStatus | null;
    available: boolean;
};

const EMPTY: ConnectorsData = { webhooks: [], rules: [], folders: [], gmail: null, available: false };

async function loadConnectorsData(): Promise<ConnectorsData> {
    const c = capi();
    if (!c) return EMPTY;
    const safe = <T,>(p: Promise<T> | undefined, fallback: T): Promise<T> => (p ? p.catch(() => fallback) : Promise.resolve(fallback));
    const [webhooks, rules, folders, gmail] = await Promise.all([
        safe(c.listWebhooks?.(), [] as WebhookEndpointInfo[]),
        safe(c.listAutoSendRules?.(), [] as AutoSendRuleInfo[]),
        safe(c.listFolders?.(), [] as FolderOption[]),
        safe(c.getGmailStatus?.(), null as GmailStatus | null),
    ]);
    return { webhooks, rules, folders, gmail, available: true };
}

export const ConnectionsSettings: React.FC = () => {
    const t = useT();
    const tones = useSettingsTones();
    const [status, setStatus] = useState<ConnectionsStatus | null>(null);
    const [data, setData] = useState<ConnectorsData>(EMPTY);
    const [page, setPage] = useState<ConnectorKey | null>(null);
    // Which services sign in with the browser; until natively-api answers, the token forms.
    const [browser, setBrowser] = useState<Partial<Record<OAuthConnectorService, boolean>>>({});
    const load = useCallback(async () => {
        const [s, d] = await Promise.all([api()?.getConnections().catch(() => null), loadConnectorsData()]);
        if (s) setStatus(s);
        setData(d);
    }, []);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        let live = true;
        // Optional call: a renderer newer than its preload (dev reload) has no such method.
        void api()?.oauthServices?.().then((b) => { if (live && b) setBrowser(b); }).catch(() => {});
        return () => { live = false; };
    }, []);
    const motionReady = useMotionReadyAfter(!!status);
    if (!status) return null;
    const reload = () => void load();

    const isConnected = (key: ConnectorKey): boolean => {
        switch (key) {
            case 'gmail': return !!data.gmail?.connected;
            case 'slack': return status.slack.webhooks.length > 0;
            case 'zapier': return data.webhooks.some((w) => w.kind === 'zapier');
            case 'webhooks': return data.webhooks.some((w) => w.kind === 'webhook');
            default: return !!status[key]?.connected;
        }
    };
    const rowStatus = (key: ConnectorKey): string | undefined => {
        if (!isConnected(key)) return undefined;
        if (key === 'slack') return status.slack.webhooks.length === 1 ? t('1 channel') : `${status.slack.webhooks.length} ${t('channels')}`;
        if (key === 'zapier' || key === 'webhooks') {
            const n = data.webhooks.filter((w) => w.kind === (key === 'zapier' ? 'zapier' : 'webhook')).length;
            return key === 'zapier' ? (n === 1 ? t('1 Zap') : `${n} ${t('Zaps')}`) : (n === 1 ? t('1 endpoint') : `${n} ${t('endpoints')}`);
        }
        if (key === 'gmail') return data.gmail?.account || t('Connected');
        const s = status[key] as { account?: string } | undefined;
        return s?.account || t('Connected');
    };

    const storageNotice = !status.secureStorage && (
        <SettingsNotice tone={tones.warn} icon={<AlertCircle size={14} />}>
            {t('This computer has no secure storage available, so connections are kept until Natively quits.')}
        </SettingsNotice>
    );

    // ── A connector's page ──
    if (page) {
        const back = () => { setPage(null); reload(); };
        const entry = catalogEntry(page);
        const connected = isConnected(page);
        let body: React.ReactNode;
        if (page === 'gmail') {
            body = <GmailPanel status={data.gmail} onStatus={(g) => setData((d) => ({ ...d, gmail: g }))} onChanged={reload} />;
        } else if (page === 'zapier' || page === 'webhooks') {
            body = <WebhooksPanel kind={page === 'zapier' ? 'zapier' : 'webhook'} endpoints={data.webhooks} folders={data.folders} available={data.available} onChanged={reload} />;
        } else if (page === 'slack') {
            body = (
                <SlackPanel webhooks={status.slack.webhooks} browser={browser.slack} notice={storageNotice} onChanged={reload}>
                    <AutoSendSection
                        destinations={status.slack.webhooks.map((w) => ({ destination: { kind: 'slack', webhookId: w.id } as AutoSendDestination, label: w.label }))}
                        connected={connected}
                        rules={data.rules}
                        folders={data.folders}
                        onChanged={reload}
                    />
                </SlackPanel>
            );
        } else {
            const svc = page as 'notion' | CrmService | 'clearbit';
            const account = svc === 'notion' || svc === 'hubspot' || svc === 'attio' || svc === 'salesforce' || svc === 'pipedrive' ? status[svc].account : undefined;
            const oauth = svc === 'notion' || svc === 'hubspot' || svc === 'attio' || svc === 'salesforce' || svc === 'pipedrive' ? browser[svc] : undefined;
            body = (
                <TokenServicePanel
                    service={svc}
                    connected={connected}
                    account={account}
                    browser={oauth}
                    notice={storageNotice}
                    onChanged={reload}
                >
                    {svc === 'notion' && status.notion.connected && (
                        <DetailSection title="Where pages go">
                            <NotionParentPicker current={status.notion.parent} onPicked={reload} />
                        </DetailSection>
                    )}
                    {svc !== 'clearbit' && (
                        <AutoSendSection
                            destinations={[{
                                destination: svc === 'notion' ? { kind: 'notion' } : { kind: 'crm', service: svc as CrmService },
                                label: entry.title,
                            }]}
                            connected={connected && (svc !== 'notion' || !!status.notion.parent)}
                            rules={data.rules}
                            folders={data.folders}
                            onChanged={reload}
                        />
                    )}
                </TokenServicePanel>
            );
        }
        // Gmail says how it is used in its own group, so its page has no How it works.
        const pageInfo = { mark: <ConnectorMark id={entry.mark} size={20} />, title: entry.title, description: entry.description, steps: page === 'gmail' ? undefined : entry.howItWorks };
        return (
            <SettingsMotionReady.Provider value={motionReady}>
                <ConnectorPageContext.Provider value={pageInfo}>
                    <div className="animated fadeIn" key={page}>
                        <BackLink onBack={back} />
                        {body}
                        {pageInfo.steps && <HowItWorks lines={pageInfo.steps} />}
                        {page !== 'gmail' && page !== 'zapier' && page !== 'webhooks' && (
                            <SettingsFootnote icon={<KeyRound size={14} />}>
                                {t('Tokens and webhook addresses are kept in your system keychain and never shown again.')}
                            </SettingsFootnote>
                        )}
                    </div>
                </ConnectorPageContext.Provider>
            </SettingsMotionReady.Provider>
        );
    }

    // ── The list ──
    return (
        <SettingsMotionReady.Provider value={motionReady}>
            <div className="space-y-6 animated fadeIn" data-settings-stagger>
                <section>
                    <SettingsSectionHeading
                        title={t('Connectors')}
                        subtitle={t('Connect Natively to the tools you use. Meeting notes stay on this computer until you send them, or until a rule you made sends them.')}
                    />
                    {storageNotice}
                </section>

                {CONNECTOR_GROUPS.map((g) => (
                    <section key={g.id}>
                        <GroupLabel>{t(g.label)}</GroupLabel>
                        <Group>
                            {CONNECTOR_CATALOG.filter((e) => e.group === g.id).map((e) => (
                                <NavRow
                                    key={e.key}
                                    icon={<ConnectorMark id={e.mark} size={20} />}
                                    title={t(e.title)}
                                    description={t(e.description)}
                                    value={rowStatus(e.key)}
                                    onOpen={() => setPage(e.key)}
                                />
                            ))}
                        </Group>
                    </section>
                ))}

                <section>
                    <GroupLabel>{t('MCP')}</GroupLabel>
                    <McpCard mcp={status.mcp} onStatus={(mcp) => setStatus((s) => (s ? { ...s, mcp } : s))} />
                </section>
            </div>
        </SettingsMotionReady.Provider>
    );
};

export default ConnectionsSettings;
