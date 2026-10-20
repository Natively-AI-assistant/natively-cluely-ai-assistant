// IPC for meeting outputs: export (PDF, HTML), Slack, Notion, CRM notes, the
// local MCP server and follow-ups in the user's own style.
//
// Every handler answers only the launcher window (the meeting page and
// Settings live there). Meeting content leaves the computer only from a
// handler the user reached by pressing that destination's Send button; nothing
// here runs in the background except the MCP server, which is off until the
// user turns it on and listens on 127.0.0.1 only.

import { app, BrowserWindow, clipboard, dialog, safeStorage, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { AppState } from '../../main';
import type {
    ConnectionsStatus, CrmMatchPreview, CrmService, EnrichmentService, McpServerStatus, NotionParentInfo, OutputResult, ShareLinkInfo,
} from '../../../src/types/meetingOutputs';
import { ConnectionsStore } from './connectionsStore';
import { STORE_UNREADABLE, ShareLinkStore, ShareLinks, ShareStoreUnreadable, sharePayload } from './shareLink';
import { nativelyApiBase } from '../nativelyApiBase';
import { observeMeetingDeletes } from '../../db/meetingDeleteObservers';
import { buildNotesDocument, type NotesDocument } from './notesDocument';
import { buildNotesHtml } from './htmlExport';
import { NOTES_EXPORT_FILTERS, defaultExportPath, notesFileStem, withExportExtension, type NotesExportFormat } from './exportFiles';
import { ConnectionError, describeConnectionError, errorKindOf } from './httpRequest';
import { connectWithBrowser, currentToken, isOAuthConnector, oauthServices, reconnectMessage, withCurrentToken } from './connectorOAuth';
import { connectorsDelivery, registerConnectorsDeliveryIpc } from './connectorsDeliveryIpc';
import { registerLocalApiIpc, startLocalApiIfKeys, stopLocalApi } from './localApiIpc';
import { registerGmailIpc } from './gmailIpc';
import type { AutoSendDestination } from '../../../src/types/connectors';
import type { OAuthTokenService } from './connectionsStore';
import { checkSlackDraft, composeSlackDraft, isSlackWebhookUrl, postSlackWebhook, slackDraftMessage, testSlackWebhook } from './slack';
import { NotionPartialPages, appendNotionBatches, buildNotionBlocks, createNotionPage, looksLikeNotionToken, normaliseNotionId, notionPageTitle, searchNotion, testNotion } from './notion';
import { CRM_LABELS, CrmSendSession, crmCandidates, crmSendSummary, matchAttendees, normaliseEmail, normaliseSalesforceInstanceUrl, remainingRecords, sendCrmNote, testCrm, uniqueRecords, type CrmRecord } from './crm';
import { ENRICHMENT_LABEL, enrichmentFacts, lookupAttendees, lookupCompany, testEnrichment } from './enrichment';
import { companyDomainForEmail, isFreeMailDomain } from '../organise/people';
import { mcpClientSnippets, mcpUrl, newMcpToken, randomMcpPort, startMcpServer, type MeetingSource, type RunningMcpServer } from './mcpServer';
import { WritingStyleService, migrateLegacyStyleFile, removeModeStyleFile, type StyleModelCall } from './writingStyle';
import { applyFollowUpEdit, currentDraft, followUpSample } from './followUpEdit';
import { safeDiagramFileStem, saveDialogPlacement, uniqueDiagramFileName } from '../diagram/diagramExport';
import { nativePromptsBlocked } from '../stealthPromptGate';

type SafeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => void;

const SERVICE_LABEL: Record<'slack' | 'notion' | CrmService | EnrichmentService, string> = { slack: 'Slack', notion: 'Notion', ...CRM_LABELS, clearbit: ENRICHMENT_LABEL };
const TOKEN_SERVICES = ['notion', 'hubspot', 'attio', 'affinity', 'salesforce', 'pipedrive', 'clearbit'] as const;
type TokenService = typeof TOKEN_SERVICES[number];
const isTokenService = (v: unknown): v is TokenService => typeof v === 'string' && (TOKEN_SERVICES as readonly string[]).includes(v);
const isOAuthTokenService = (v: unknown): v is OAuthTokenService => v === 'notion' || v === 'hubspot' || v === 'attio' || v === 'salesforce' || v === 'pipedrive';
const isCrm = (v: unknown): v is CrmService => v === 'hubspot' || v === 'attio' || v === 'affinity' || v === 'salesforce' || v === 'pipedrive';

// ── Singletons ───────────────────────────────────────────────────────────

let store: ConnectionsStore | null = null;
/** CRM notes written this session, so a retry after a partial failure skips them. */
const crmSession = new CrmSendSession();
/** Notion pages made this session that are missing part of their notes. */
const notionPartials = new NotionPartialPages();
/** Follow-up writing styles, one per mode (writingStyle.ts). */
const styles = new Map<string, WritingStyleService>();
let styleMigrated = false;

export function getConnectionsStore(): ConnectionsStore {
    if (!store) store = new ConnectionsStore({ userDataDir: app.getPath('userData'), safeStorage });
    return store;
}

/** The built-in General mode, which inherits the style kept before styles were per mode. */
function generalModeId(): string | undefined {
    try {
        const { ModesManager } = require('../ModesManager');
        const modes = ModesManager.getInstance().getModes() as Array<{ id: string; name: string; templateType: string; isBuiltin?: boolean }>;
        return (modes.find((m) => m.isBuiltin && m.templateType === 'general')
            ?? modes.find((m) => m.templateType === 'general' && m.name === 'General'))?.id;
    } catch {
        return undefined;
    }
}

/** A mode's follow-up writing style. */
export function getWritingStyleService(modeId: string): WritingStyleService {
    const dir = app.getPath('userData');
    if (!styleMigrated) {
        const general = generalModeId();
        if (general) {
            styleMigrated = true;
            if (migrateLegacyStyleFile(dir, general)) styles.delete(general);
        }
    }
    let svc = styles.get(modeId);
    if (!svc) {
        svc = new WritingStyleService({ dir, modeId });
        styles.set(modeId, svc);
    }
    return svc;
}

/** Drops a deleted mode's writing samples (ModesManager.deleteMode). */
export function forgetWritingStyleForMode(modeId: string): void {
    styles.delete(modeId);
    removeModeStyleFile(app.getPath('userData'), modeId);
}

/** The mode a saved meeting ran under, from its notes; its follow-ups use that mode's style. */
export function meetingStyleModeId(detailedSummary: unknown): string | undefined {
    const id = (detailedSummary as any)?.mode?.selectedModeId;
    // A meeting with no recorded mode (older meetings, chat sessions) counts as
    // General, the mode its notes were written in (the owner's call, 2026-10-19).
    return typeof id === 'string' && id ? id : generalModeId();
}

const isModeId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** The style-profile model call, through the same routing meeting notes use. */
export function styleModelCall(llmHelper: any): StyleModelCall | null {
    if (!llmHelper) return null;
    return async (prompt) => {
        const { generateStructured, NOTE_CALL_TIMEOUT_MS } = require('../meeting/generateStructured');
        const res = await generateStructured({
            schemaName: 'WritingStyleProfile',
            systemPrompt: prompt.systemPrompt,
            jsonShapeHint: prompt.jsonShapeHint,
            userContent: prompt.userContent,
            llmHelper,
            callOpts: { timeoutMs: NOTE_CALL_TIMEOUT_MS },
            validate: (raw: unknown) => (raw && typeof raw === 'object'
                ? { ok: true, data: raw, errors: [], repaired: false }
                : { ok: false, errors: ['not an object'], repaired: false }),
        });
        return res.ok ? res.data : null;
    };
}

// ── Meeting reads ────────────────────────────────────────────────────────

function db(): any {
    const { DatabaseManager } = require('../../db/DatabaseManager');
    return DatabaseManager.getInstance();
}

function selfIdentity(): { name?: string; email?: string } {
    try {
        const { CalendarManager } = require('../CalendarManager');
        const s = CalendarManager.getInstance().getConnectionStatus();
        return s?.connected ? { name: s.name, email: s.email } : {};
    } catch {
        return {};
    }
}

function loadDoc(meetingId: unknown): NotesDocument | null {
    if (typeof meetingId !== 'string' || !meetingId || meetingId.length > 200) return null;
    const m = db().getMeetingDetails(meetingId);
    if (!m) return null;
    return buildNotesDocument(m, { selfName: selfIdentity().name, locale: app.getLocale?.() || 'en-US' });
}

// ── Share links ──────────────────────────────────────────────────────────

/** Pending turn-offs are retried this often while the app runs, and once soon after launch. */
const SHARE_RETRY_MS = 10 * 60 * 1000;
const SHARE_FIRST_RETRY_MS = 20 * 1000;

let cachedInstallId: string | undefined;
function installIdForShare(): string | undefined {
    if (cachedInstallId) return cachedInstallId;
    try {
        cachedInstallId = require('../InstallPingManager').getOrCreateInstallId() || undefined;
    } catch {
        cachedInstallId = undefined;
    }
    return cachedInstallId;
}

/** The key or trial token the chat calls send; the server makes links only for a caller it can verify. */
function callerForShare(): { apiKey?: string; trialToken?: string } {
    try {
        const cm = (require('../CredentialsManager') as typeof import('../CredentialsManager')).CredentialsManager.getInstance();
        return { apiKey: cm.getNativelyApiKey() || undefined, trialToken: cm.getTrialToken() || undefined };
    } catch {
        return {};
    }
}

let shareLinksInstance: ShareLinks | null = null;
function shareLinks(): ShareLinks {
    if (!shareLinksInstance) {
        shareLinksInstance = new ShareLinks(
            new ShareLinkStore(app.getPath('userData')),
            () => ({ apiBase: nativelyApiBase(), installId: installIdForShare(), ...callerForShare() }),
        );
    }
    return shareLinksInstance;
}

let shareRetryTimer: ReturnType<typeof setInterval> | null = null;
/**
 * Wires share links into the app's life: every meeting delete (one meeting,
 * Clear all data, the search index's live row) goes through
 * meetingDeleteObservers, so a deleted meeting's link is turned off wherever
 * the delete came from, and only once the delete has happened. Pending
 * turn-offs are retried soon after launch and every ten minutes.
 */
function startShareLinks(): void {
    if (shareRetryTimer) return;
    observeMeetingDeletes((target) => shareLinks().beginForget(target));
    const run = () => { void shareLinks().retryPending().catch((err) => console.warn('[Outputs] share turn-off retry failed:', err?.message || 'unknown')); };
    setTimeout(run, SHARE_FIRST_RETRY_MS).unref?.();
    shareRetryTimer = setInterval(run, SHARE_RETRY_MS);
    shareRetryTimer.unref?.();
}

const fail = (kind: OutputResult['kind'], service: string): OutputResult => ({ ok: false, kind, message: describeConnectionError(kind, service) });
const NO_MEETING: OutputResult = { ok: false, kind: 'not_found', message: 'This meeting could not be found. It may have been deleted.' };
const NO_NOTES: OutputResult = { ok: false, kind: 'invalid_input', message: 'This meeting has no notes to send yet.' };
const hasNotes = (d: NotesDocument) => d.sections.length > 0 || d.actionItems.length > 0;

/** The read-only view of meetings the MCP server answers from. */
export function databaseMeetingSource(): MeetingSource {
    return {
        listMeetings: (limit) => (db().getRecentMeetings(limit) as any[]).map((m) => ({
            id: m.id,
            title: m.title || '',
            date: m.date,
            duration: m.duration,
            notesText: notesTextOf(m),
        })),
        getMeeting: (id) => db().getMeetingDetails(id),
        searchTranscript: (terms, limit) => db().searchTranscriptLines(terms, limit),
    };
}

function notesTextOf(m: any): string {
    try {
        const d = buildNotesDocument({ ...m, transcript: [] });
        return d.sections.flatMap((s) => [s.heading, s.paragraph || '', ...s.bullets]).concat(d.actionItems.map((a) => a.text)).join('\n');
    } catch {
        return '';
    }
}

// ── Saving files ─────────────────────────────────────────────────────────

async function saveExport(appState: AppState, event: any, doc: NotesDocument, format: NotesExportFormat, bytes: Buffer | string): Promise<OutputResult & { canceled?: boolean; fileName?: string }> {
    const stem = notesFileStem(doc.title, doc.dateIso);
    const downloads = app.getPath('downloads');
    try {
        if (nativePromptsBlocked(() => appState.getUndetectable())) {
            // A save dialog is its own OS window and would show in a screen share. In
            // Undetectable mode the file goes to Downloads under a name that replaces nothing.
            const safeStem = safeDiagramFileStem(stem);
            for (let attempt = 0; ; attempt += 1) {
                const name = uniqueDiagramFileName(safeStem, format, (n) => fs.existsSync(path.join(downloads, n)));
                try {
                    await fs.promises.writeFile(path.join(downloads, name), bytes, { flag: 'wx' });
                    return { ok: true, fileName: name, message: `Saved to Downloads as ${name}.` };
                } catch (err: any) {
                    if (err?.code !== 'EEXIST' || attempt >= 4) throw err;
                }
            }
        }
        const options = {
            title: format === 'pdf' ? 'Export notes as PDF' : 'Share notes as a file',
            defaultPath: defaultExportPath(process.platform, downloads, stem, format),
            filters: [NOTES_EXPORT_FILTERS[format]],
        };
        const placement = saveDialogPlacement(process.platform);
        let owner: BrowserWindow | null = null;
        if (placement === 'own-by-sender') {
            try { const w = BrowserWindow.fromWebContents(event.sender); owner = w && !w.isDestroyed() ? w : null; } catch { owner = null; }
        } else if (placement === 'activate-app') {
            try { app.focus({ steal: true }); } catch { /* the dialog still opens */ }
        }
        const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return { ok: false, canceled: true };
        const target = withExportExtension(process.platform, result.filePath, format);
        await fs.promises.writeFile(target, bytes);
        return { ok: true, fileName: path.basename(target) };
    } catch (err: any) {
        console.warn('[Outputs] export failed:', err?.code || 'write failed');
        return { ok: false, kind: 'unknown', message: err?.code === 'EACCES' || err?.code === 'EPERM'
            ? 'Natively is not allowed to write there. Pick another folder.'
            : 'The file could not be saved. Try another folder.' };
    }
}

// ── MCP lifecycle ────────────────────────────────────────────────────────

let mcpServer: RunningMcpServer | null = null;
let mcpError: string | undefined;
let mcpStarting: Promise<void> | null = null;

function mcpStatus(): McpServerStatus {
    const st = getConnectionsStore();
    // Settings shows the address before the server is ever turned on, as Granola
    // shows its public URL, so a port is picked and kept the first time it is
    // asked for (with the token it is stored under; neither leaves main while
    // off). Turning on then listens there, or moves once if the port was taken.
    if (!st.mcpSettings().port) st.setMcp({ port: randomMcpPort(), ...(st.mcpSettings().token ? {} : { token: newMcpToken() }) });
    const s = st.mcpSettings();
    const running = !!mcpServer;
    const port = mcpServer?.port ?? s.port;
    return {
        enabled: s.enabled,
        running,
        ...(port ? { port, url: mcpUrl(port) } : {}),
        ...(s.token && s.enabled ? { token: s.token } : {}),
        ...(port && s.enabled && s.token ? (() => {
            const { url: _url, ...snippets } = mcpClientSnippets(port, s.token);
            return { snippets };
        })() : {}),
        ...(s.enabled && !running && mcpError ? { error: mcpError } : {}),
    };
}

async function startMcp(): Promise<void> {
    if (mcpServer) return;
    const st = getConnectionsStore();
    let { token, port } = st.mcpSettings();
    if (!token) { token = newMcpToken(); st.setMcp({ token }); }
    const tried = new Set<number>();
    let candidate = port || randomMcpPort();
    for (let attempt = 0; attempt < 6; attempt += 1) {
        tried.add(candidate);
        try {
            mcpServer = await startMcpServer({
                port: candidate,
                token: () => getConnectionsStore().mcpSettings().token || '',
                source: databaseMeetingSource(),
                version: app.getVersion(),
                selfName: () => selfIdentity().name,
            });
            mcpError = undefined;
            if (mcpServer.port !== port) st.setMcp({ port: mcpServer.port });
            console.log('[MCP] Local server listening on loopback');
            return;
        } catch (err: any) {
            if (err?.code !== 'EADDRINUSE' && err?.code !== 'EACCES') {
                mcpError = 'The meeting server could not start. Try turning it off and on again.';
                return;
            }
            do { candidate = randomMcpPort(); } while (tried.has(candidate));
        }
    }
    mcpError = 'No free port was found for the meeting server. Try again in a moment.';
}

async function stopMcp(): Promise<void> {
    const s = mcpServer;
    mcpServer = null;
    if (s) await s.close().catch(() => {});
}

/**
 * At launch: the MCP server back on if the user left it on, and the local API
 * (Personal API keys) if any key is active. Neither starts otherwise.
 */
export function startMcpServerIfEnabled(): void {
    void startLocalApiIfKeys();
    try {
        if (!getConnectionsStore().mcpSettings().enabled) return;
        mcpStarting = startMcp().finally(() => { mcpStarting = null; });
    } catch { /* never blocks launch */ }
}

/** On quit (both systems): drop open connections and stop listening. Never blocks the quit. */
export function stopMcpServerOnQuit(): void {
    void stopMcp();
    void stopLocalApi();
    try { connectorsDelivery.dispose(); } catch { /* never blocks a quit */ }
}

// ── Handlers ─────────────────────────────────────────────────────────────

export function registerOutputsIpc(appState: AppState, safeHandle: SafeHandle): void {
    const fromLauncher = (event: any): boolean => {
        try {
            const w = appState.getWindowHelper().getLauncherWindow();
            return !!w && !w.isDestroyed() && w.webContents === event?.sender;
        } catch {
            return false;
        }
    };
    const guard = <A extends any[]>(fallback: unknown, fn: (event: any, ...args: A) => unknown) =>
        async (event: any, ...args: A): Promise<unknown> => (fromLauncher(event) ? fn(event, ...args) : fallback);
    const FORBIDDEN: OutputResult = { ok: false, kind: 'forbidden', message: 'Not available here.' };
    const MCP_OFF: McpServerStatus = { enabled: false, running: false };
    const llm = () => { try { return appState.processingHelper.getLLMHelper(); } catch { return null; } };

    // Browser sign-in (connectorOAuth.ts) and the tokens it keeps fresh.
    const oauthDeps = () => ({ apiBase: nativelyApiBase(), store: getConnectionsStore() });
    let browserSignIn: AbortController | null = null;
    /** Runs `fn` with the service's token; a signed-in token is renewed when it runs out or is refused. */
    const withToken = async <T>(service: TokenService, fn: (token: string) => Promise<T>): Promise<T> => {
        if (isOAuthTokenService(service)) return withCurrentToken(service, oauthDeps(), fn);
        const token = getConnectionsStore().token(service);
        if (!token) throw new ConnectionError('not_connected');
        return fn(token);
    };
    /** The token now (renewed first if it is about to run out), for calls that report failure in their result. */
    const tokenNow = (service: TokenService): Promise<string | null> => (isOAuthTokenService(service)
        ? currentToken(service, oauthDeps())
        : Promise.resolve(getConnectionsStore().token(service)));
    /** A failure; a refused signed-in token asks to connect again rather than to paste one. */
    const failOn = (err: unknown, service: TokenService): OutputResult => {
        const kind = errorKindOf(err);
        if (kind === 'auth' && isOAuthTokenService(service) && getConnectionsStore().grant(service)) {
            return { ok: false, kind, message: reconnectMessage(service) };
        }
        return fail(kind, SERVICE_LABEL[service]);
    };

    // Export
    safeHandle('outputs:export-pdf', guard(FORBIDDEN, async (event, meetingId: unknown) => {
        const doc = loadDoc(meetingId);
        if (!doc) return NO_MEETING;
        try {
            const { renderHtmlToPdf } = require('./pdfExport');
            const pdf: Buffer = await renderHtmlToPdf(buildNotesHtml(doc, { includeTranscript: false, forPrint: true }));
            return saveExport(appState, event, doc, 'pdf', pdf);
        } catch (err: any) {
            console.warn('[Outputs] PDF render failed:', err?.message || 'unknown');
            return { ok: false, kind: 'unknown', message: 'The PDF could not be made. Try again.' };
        }
    }));

    // Share as link. The notes go to natively-api only when the user presses
    // Create link; the record (link + the token that turns it off) stays here.
    startShareLinks();
    const SHARE_FAILED: OutputResult = { ok: false, kind: 'unknown', message: 'Something went wrong with the share link. Try again.' };
    const shareStoreFailed = (err: unknown): OutputResult => (err instanceof ShareStoreUnreadable
        ? { ok: false, kind: 'storage_unavailable', message: STORE_UNREADABLE }
        : SHARE_FAILED);
    safeHandle('outputs:share-link-get', guard(FORBIDDEN, async (_e, meetingId: unknown): Promise<OutputResult & { link?: ShareLinkInfo }> => {
        if (typeof meetingId !== 'string' || !meetingId) return NO_MEETING;
        try {
            const link = shareLinks().info(meetingId);
            return link ? { ok: true, link } : { ok: true };
        } catch (err) {
            return shareStoreFailed(err);
        }
    }));
    safeHandle('outputs:share-link-create', guard(FORBIDDEN, async (_e, meetingId: unknown, opts: any): Promise<OutputResult & { link?: ShareLinkInfo }> => {
        try {
            const doc = loadDoc(meetingId);
            if (!doc) return NO_MEETING;
            const live = shareLinks().info(doc.meetingId);
            if (live) {
                clipboard.writeText(live.url);
                return { ok: true, link: live };
            }
            if (!hasNotes(doc)) return { ok: false, kind: 'invalid_input', message: 'This meeting has no notes to share yet.' };
            const includeTranscript = opts?.includeTranscript === true;
            const res = await shareLinks().create(doc.meetingId, sharePayload(doc, { includeTranscript }), includeTranscript);
            if (res.ok && res.link) clipboard.writeText(res.link.url);
            else if (res.kind === 'storage_unavailable') console.warn('[Outputs] share record not saved on this computer');
            return res;
        } catch (err) {
            return shareStoreFailed(err);
        }
    }));
    safeHandle('outputs:share-link-revoke', guard(FORBIDDEN, async (_e, meetingId: unknown): Promise<OutputResult> => {
        if (typeof meetingId !== 'string' || !meetingId) return NO_MEETING;
        try {
            return await shareLinks().revoke(meetingId);
        } catch (err) {
            return shareStoreFailed(err);
        }
    }));

    // Connections
    safeHandle('outputs:get-connections', guard(null as unknown as ConnectionsStatus, async (): Promise<ConnectionsStatus> => {
        const st = getConnectionsStore();
        const s = st.read();
        const via = (service: OAuthTokenService) => {
            const g = st.grant(service);
            return g ? { via: 'oauth' as const, ...(g.account ? { account: g.account } : {}) } : {};
        };
        return {
            secureStorage: st.isPersistent(),
            slack: { webhooks: s.slack.webhooks.map(({ id, label }) => ({ id, label })) },
            notion: { connected: !!s.notion?.token, ...(s.notion?.parent ? { parent: s.notion.parent } : {}), ...via('notion') },
            hubspot: { connected: !!s.hubspot?.token, ...via('hubspot') },
            attio: { connected: !!s.attio?.token, ...via('attio') },
            affinity: { connected: !!s.affinity?.token },
            salesforce: { connected: !!s.salesforce?.token, ...(s.salesforce?.instanceUrl ? { instanceUrl: s.salesforce.instanceUrl } : {}), ...via('salesforce') },
            pipedrive: { connected: !!s.pipedrive?.token, ...via('pipedrive') },
            clearbit: { connected: !!s.clearbit?.token },
            mcp: mcpStatus(),
        };
    }));

    safeHandle('outputs:oauth-services', guard({ slack: false, notion: false, hubspot: false, salesforce: false, pipedrive: false, attio: false }, async () => oauthServices({ apiBase: nativelyApiBase() })));
    safeHandle('outputs:oauth-connect', guard(FORBIDDEN, async (_e, service: unknown): Promise<OutputResult> => {
        if (!isOAuthConnector(service)) return { ok: false, kind: 'invalid_input', message: 'Unknown service.' };
        // One sign-in at a time: a second Connect replaces the first, whose port closes.
        browserSignIn?.abort();
        const ctl = new AbortController();
        browserSignIn = ctl;
        try {
            return await connectWithBrowser(service, {
                ...oauthDeps(),
                openExternal: (url: string) => shell.openExternal(url),
                platform: process.platform,
                signal: ctl.signal,
            });
        } finally {
            if (browserSignIn === ctl) browserSignIn = null;
        }
    }));
    safeHandle('outputs:oauth-cancel', guard(undefined, async () => {
        browserSignIn?.abort();
        browserSignIn = null;
    }));

    safeHandle('outputs:slack-add', guard(FORBIDDEN, async (_e, label: unknown, url: unknown) => {
        const u = typeof url === 'string' ? url.trim() : '';
        if (!isSlackWebhookUrl(u)) {
            return { ok: false, kind: 'invalid_input', message: 'That is not a Slack webhook address. It starts with https://hooks.slack.com/services/.' };
        }
        try {
            await testSlackWebhook(u);
        } catch (err) {
            const kind = errorKindOf(err);
            return { ok: false, kind, message: kind === 'not_found'
                ? 'Slack does not recognise this webhook. It may have been removed, or its channel archived. Create a new one in Slack.'
                : describeConnectionError(kind, 'Slack') };
        }
        const webhook = getConnectionsStore().addSlackWebhook(typeof label === 'string' ? label : '', u);
        if (!webhook) return { ok: false, kind: 'invalid_input', message: 'You have added as many Slack channels as Natively keeps. Remove one first.' };
        return { ok: true, webhook, ...(getConnectionsStore().isPersistent() ? {} : { message: describeConnectionError('storage_unavailable', 'Slack') }) };
    }));
    safeHandle('outputs:slack-remove', guard(FORBIDDEN, async (_e, id: unknown) => {
        if (typeof id === 'string') getConnectionsStore().removeSlackWebhook(id);
        return { ok: true };
    }));
    safeHandle('outputs:slack-test', guard(FORBIDDEN, async (_e, id: unknown) => {
        const url = typeof id === 'string' ? getConnectionsStore().slackWebhookUrl(id) : null;
        if (!url) return fail('not_connected', 'Slack');
        try { await testSlackWebhook(url); return { ok: true, message: 'Slack accepts this webhook.' }; } catch (err) {
            const kind = errorKindOf(err);
            return { ok: false, kind, message: kind === 'not_found'
                ? 'Slack no longer recognises this webhook. It may have been removed, or its channel archived.'
                : describeConnectionError(kind, 'Slack') };
        }
    }));

    const testToken = async (service: TokenService, token: string, instanceUrl?: string): Promise<void> => {
        if (service === 'notion') return testNotion({ token });
        if (service === 'clearbit') return testEnrichment({ token });
        return testCrm(service, { token, ...(instanceUrl ? { instanceUrl } : {}) });
    };
    safeHandle('outputs:save-token', guard(FORBIDDEN, async (_e, service: unknown, token: unknown, instanceUrl: unknown) => {
        if (!isTokenService(service)) return { ok: false, kind: 'invalid_input', message: 'Unknown service.' };
        const t = typeof token === 'string' ? token.trim() : '';
        const label = SERVICE_LABEL[service];
        if (!t || t.length > 512 || /\s/.test(t)) return { ok: false, kind: 'invalid_input', message: `Paste the ${label} token on its own, with no spaces.` };
        if (service === 'notion' && !looksLikeNotionToken(t)) {
            return { ok: false, kind: 'invalid_input', message: 'A Notion integration token starts with ntn_ or secret_. Copy it from your integration\'s settings in Notion.' };
        }
        if (service === 'salesforce') {
            const url = normaliseSalesforceInstanceUrl(instanceUrl);
            if (!url) return { ok: false, kind: 'invalid_input', message: 'Paste your Salesforce instance URL too, like https://yourorg.my.salesforce.com.' };
            try { await testToken(service, t, url); } catch (err) { return fail(errorKindOf(err), label); }
            const ok = getConnectionsStore().setSalesforce(t, url);
            return { ok: true, ...(ok ? {} : { message: describeConnectionError('storage_unavailable', label) }) };
        }
        try { await testToken(service, t); } catch (err) { return fail(errorKindOf(err), label); }
        const persisted = getConnectionsStore().setToken(service, t);
        return { ok: true, ...(persisted ? {} : { message: describeConnectionError('storage_unavailable', label) }) };
    }));
    safeHandle('outputs:test', guard(FORBIDDEN, async (_e, service: unknown) => {
        if (!isTokenService(service)) return { ok: false, kind: 'invalid_input', message: 'Unknown service.' };
        const label = SERVICE_LABEL[service];
        if (!getConnectionsStore().token(service)) return fail('not_connected', label);
        const instanceUrl = () => (service === 'salesforce' ? getConnectionsStore().salesforceInstanceUrl() ?? undefined
            : service === 'pipedrive' ? getConnectionsStore().pipedriveInstanceUrl() ?? undefined : undefined);
        try { await withToken(service, (token) => testToken(service, token, instanceUrl())); return { ok: true, message: `${label} is connected.` }; } catch (err) { return failOn(err, service); }
    }));
    safeHandle('outputs:disconnect', guard(FORBIDDEN, async (_e, service: unknown) => {
        if (!isTokenService(service)) return { ok: false, kind: 'invalid_input', message: 'Unknown service.' };
        getConnectionsStore().clear(service);
        return { ok: true };
    }));
    safeHandle('outputs:notion-search', guard(FORBIDDEN, async (_e, query: unknown) => {
        if (!getConnectionsStore().token('notion')) return fail('not_connected', 'Notion');
        try {
            return { ok: true, results: await withToken('notion', (token) => searchNotion(typeof query === 'string' ? query : '', { token })) };
        } catch (err) { return failOn(err, 'notion'); }
    }));
    safeHandle('outputs:notion-set-parent', guard(FORBIDDEN, async (_e, parent: unknown) => {
        const p = parent as Partial<NotionParentInfo> | null;
        const id = normaliseNotionId(p?.id);
        if (!p || (p.type !== 'page' && p.type !== 'database') || !id) return { ok: false, kind: 'invalid_input', message: 'Pick a page or database from the list.' };
        if (!getConnectionsStore().token('notion')) return fail('not_connected', 'Notion');
        getConnectionsStore().setNotionParent({ type: p.type, id, title: typeof p.title === 'string' ? p.title.slice(0, 200) : 'Untitled' });
        return { ok: true };
    }));

    // Slack send
    safeHandle('outputs:slack-compose', guard(FORBIDDEN, async (_e, meetingId: unknown, opts: any) => {
        const doc = loadDoc(meetingId);
        if (!doc) return NO_MEETING;
        if (!hasNotes(doc)) return NO_NOTES;
        return { ok: true, title: doc.title, text: composeSlackDraft(doc, { includeActionItems: opts?.includeActionItems !== false }) };
    }));
    safeHandle('outputs:slack-send', guard(FORBIDDEN, async (_e, payload: any) => {
        const url = typeof payload?.webhookId === 'string' ? getConnectionsStore().slackWebhookUrl(payload.webhookId) : null;
        if (!url) return fail('not_connected', 'Slack');
        const doc = loadDoc(payload?.meetingId);
        if (!doc) return NO_MEETING;
        const text = typeof payload?.text === 'string' ? payload.text : '';
        // Refused, never shortened: the composer shows the same limit as a counter.
        const checked = checkSlackDraft(doc.title, doc.dateLabel, text);
        if (!checked.ok) {
            return { ok: false, kind: checked.reason === 'empty' ? 'invalid_input' : 'too_large', message: slackDraftMessage(checked) };
        }
        try {
            await postSlackWebhook(url, checked.payload);
            return { ok: true };
        } catch (err) {
            const kind = errorKindOf(err);
            return { ok: false, kind, message: kind === 'not_found' || kind === 'forbidden'
                ? 'Slack no longer accepts this webhook. It may have been removed, or its channel archived. Add it again in Settings, Connectors.'
                : kind === 'invalid_input' ? 'Slack could not read this message. Try shortening it.' : describeConnectionError(kind, 'Slack') };
        }
    }));

    // Notion send
    const PARTIAL_PAGE = 'The page was made in Notion, but only part of the notes reached it. Add the rest to that page, or start over with a new page.';
    safeHandle('outputs:notion-send', guard(FORBIDDEN, async (_e, meetingId: unknown, opts: any) => {
        const n = getConnectionsStore().read().notion;
        if (!n?.token) return fail('not_connected', 'Notion');
        if (!n.parent) return { ok: false, kind: 'invalid_input', message: 'Pick where Notion pages go in Settings, Connectors.' };
        const doc = loadDoc(meetingId);
        if (!doc) return NO_MEETING;
        if (!hasNotes(doc)) return NO_NOTES;
        const mid = meetingId as string;
        // Never a second page by accident: a half-made page waits for the user's pick.
        const pending = notionPartials.get(mid);
        if (pending && opts?.startOver !== true) {
            return { ok: false, kind: 'unknown', partial: true, url: pending.url, message: PARTIAL_PAGE };
        }
        notionPartials.clear(mid);
        try {
            const parent = n.parent;
            const res = await withToken('notion', (token) => createNotionPage(
                { parent, title: notionPageTitle(doc), blocks: buildNotionBlocks(doc, { includeTranscript: opts?.includeTranscript === true }) },
                { token },
            ));
            if (res.partial && res.pageId) {
                notionPartials.set(mid, { pageId: res.pageId, url: res.url, remaining: res.remaining || [] });
                return { ok: false, kind: 'unknown', partial: true, url: res.url, message: PARTIAL_PAGE };
            }
            return { ok: true, url: res.url };
        } catch (err) {
            return failOn(err, 'notion');
        }
    }));
    // The rest of a half-made page, appended to that same page.
    safeHandle('outputs:notion-resume', guard(FORBIDDEN, async (_e, meetingId: unknown) => {
        const n = getConnectionsStore().read().notion;
        if (!n?.token) return fail('not_connected', 'Notion');
        const mid = typeof meetingId === 'string' ? meetingId : '';
        const pending = notionPartials.get(mid);
        if (!pending) return { ok: false, kind: 'not_found', message: 'There is nothing left to add to that page. Send the notes again to make a new one.' };
        const remaining = await appendNotionBatches(pending.pageId, pending.remaining, { token: (await tokenNow('notion')) || n.token });
        if (remaining.length) {
            notionPartials.set(mid, { ...pending, remaining });
            return { ok: false, kind: 'unknown', partial: true, url: pending.url, message: 'Notion still did not take the rest of the notes. Try again in a minute, or start over with a new page.' };
        }
        notionPartials.clear(mid);
        return { ok: true, url: pending.url };
    }));

    // Attendee enrichment: opt-in, on this call only, results become People-page suggestions.
    safeHandle('outputs:enrich-attendees', guard(FORBIDDEN, async (_e, meetingId: unknown) => {
        const token = getConnectionsStore().token('clearbit');
        if (!token) return fail('not_connected', ENRICHMENT_LABEL);
        const doc = loadDoc(meetingId);
        if (!doc) return NO_MEETING;
        const candidates = crmCandidates(doc.attendees, [selfIdentity().email || '']);
        if (!candidates.length) return { ok: false, kind: 'invalid_input', message: 'This meeting has no attendee emails to look up. Link it to its calendar event first.' };
        const { organiseStore } = require('../organise/organiseService') as typeof import('../organise/organiseService');
        const store = organiseStore();
        if (!store) return { ok: false, kind: 'unknown', message: 'The People list is not available right now.' };
        const { people, error } = await lookupAttendees(candidates.map((c) => c.email), { token });
        let found = 0;
        let suggested = 0;
        for (const p of people) {
            const facts = enrichmentFacts(p);
            if (!facts.length) continue;
            found++;
            const name = candidates.find((c) => c.email === p.email)?.name || p.name;
            const personId = store.resolvePerson({ email: p.email, ...(name ? { name } : {}) });
            if (!personId) continue;
            for (const f of facts) if (store.addFact(personId, meetingId as string, f.kind, f.value, f.quote)) suggested++;
        }
        // The attendees' companies: a one-paragraph description for the Companies
        // page where it has none yet (never over the user's own text). The user's
        // own domain is left out: those are colleagues, not a company to describe.
        let companies = 0;
        if (!error) {
            const selfDomain = companyDomainForEmail(selfIdentity().email);
            const domains = new Set<string>();
            for (const c of candidates) {
                const d = companyDomainForEmail(c.email);
                if (d && d !== selfDomain && !isFreeMailDomain(d)) domains.add(d);
            }
            for (const domain of [...domains].slice(0, 10)) {
                try {
                    const existing = store.getCompany(domain);
                    if (existing?.description) continue;
                    const co = await lookupCompany(domain, { token });
                    if (co.description && store.updateCompany(domain, { description: co.description, descriptionSource: 'clearbit', ...(co.name && !existing?.name ? { name: co.name } : {}) })) companies++;
                } catch {
                    break; // a company failure never undoes the people already suggested
                }
            }
        }
        const counts = { lookedUp: people.length, found, suggested, companies };
        if (error) return { ok: false, kind: error, message: describeConnectionError(error, ENRICHMENT_LABEL), ...counts };
        const message = suggested
            ? `Found ${found} of ${people.length} people in ${ENRICHMENT_LABEL}. ${suggested} ${suggested === 1 ? 'suggestion is' : 'suggestions are'} waiting on the People page for you to accept.`
            : found
                ? `Found ${found} of ${people.length} people in ${ENRICHMENT_LABEL}; everything it knows is already on their People pages.`
                : `None of the ${people.length} attendees are in ${ENRICHMENT_LABEL}.`;
        return { ok: true, message, ...counts };
    }));

    // CRM
    const crmCandidatesFor = (doc: NotesDocument) => crmCandidates(doc.attendees, [selfIdentity().email || '']);
    // Salesforce calls also need the org host; the other CRMs just need the token.
    const crmOpts = (service: CrmService, token: string): { token: string; instanceUrl?: string } | null => {
        if (service === 'pipedrive') {
            const host = getConnectionsStore().pipedriveInstanceUrl();
            return host ? { token, instanceUrl: host } : { token };
        }
        if (service !== 'salesforce') return { token };
        const instanceUrl = getConnectionsStore().salesforceInstanceUrl();
        return instanceUrl ? { token, instanceUrl } : null;
    };
    safeHandle('outputs:crm-preview', guard({ ok: false, kind: 'forbidden', service: 'hubspot', attendees: [] } as CrmMatchPreview, async (_e, meetingId: unknown, service: unknown): Promise<CrmMatchPreview> => {
        if (!isCrm(service)) return { ok: false, kind: 'invalid_input', message: 'Unknown CRM.', service: 'hubspot', attendees: [] };
        const token = getConnectionsStore().token(service);
        if (!token || !crmOpts(service, token)) return { ...fail('not_connected', CRM_LABELS[service]), service, attendees: [] };
        const doc = loadDoc(meetingId);
        if (!doc) return { ...NO_MEETING, service, attendees: [] };
        const candidates = crmCandidatesFor(doc);
        if (!candidates.length) {
            return { ok: false, kind: 'invalid_input', service, attendees: [], message: 'This meeting has no attendee emails to look up. Link it to its calendar event first.' };
        }
        try {
            const matches = await withToken(service, (t) => matchAttendees(service, candidates, crmOpts(service, t)!));
            return { ok: true, service, attendees: matches.map((m) => ({ email: m.email, ...(m.name ? { name: m.name } : {}), matched: !!m.record, ...(m.record?.name ? { recordName: m.record.name } : {}) })) };
        } catch (err) {
            return { ...failOn(err, service), service, attendees: [] };
        }
    }));
    safeHandle('outputs:crm-send', guard(FORBIDDEN, async (_e, meetingId: unknown, service: unknown, emails: unknown) => {
        if (!isCrm(service)) return { ok: false, kind: 'invalid_input', message: 'Unknown CRM.' };
        const token = getConnectionsStore().token(service);
        if (!token || !crmOpts(service, token)) return fail('not_connected', CRM_LABELS[service]);
        const doc = loadDoc(meetingId);
        if (!doc) return NO_MEETING;
        if (!hasNotes(doc)) return NO_NOTES;
        // Only attendees of this meeting, and looked up again here: the renderer names who, never which record.
        const chosen = new Set((Array.isArray(emails) ? emails : []).map(normaliseEmail).filter(Boolean) as string[]);
        const candidates = crmCandidatesFor(doc).filter((c) => chosen.has(c.email));
        if (!candidates.length) return { ok: false, kind: 'invalid_input', message: 'Pick at least one matched attendee.' };
        const mid = meetingId as string;
        let records: CrmRecord[];
        try {
            const matches = await withToken(service, (t) => matchAttendees(service, candidates, crmOpts(service, t)!));
            // One person, one note: two emails of the same person collapse to one record.
            records = uniqueRecords(matches.map((m) => m.record).filter((r): r is CrmRecord => !!r));
        } catch (err) {
            return failOn(err, service);
        }
        if (!records.length) return { ok: false, kind: 'not_found', message: `${CRM_LABELS[service]} no longer has a record for these attendees.` };
        // A retry after a partial failure writes only the notes not yet written.
        const todo = remainingRecords(records, crmSession.sentFor(mid, service));
        if (!todo.length) return { ok: true, notesCreated: 0, message: `The note is already on everyone you picked in ${CRM_LABELS[service]}.` };
        // The lookup just above renewed a signed-in token if it needed it.
        const opts = crmOpts(service, (await tokenNow(service)) || token);
        if (!opts) return fail('not_connected', CRM_LABELS[service]);
        const outcome = await sendCrmNote(service, doc, todo, opts);
        crmSession.markSent(mid, service, outcome.sentIds);
        const summary = crmSendSummary(service, outcome, todo.length, describeConnectionError);
        return { ok: summary.ok, ...(summary.kind ? { kind: summary.kind } : {}), ...(summary.message ? { message: summary.message } : {}), notesCreated: summary.notesCreated, remaining: summary.remaining };
    }));

    // Automatic sending (autoSend.ts) and webhooks / Zapier (webhooks.ts). The
    // senders are the Share menu's own sends, minus the review step: the user
    // made the rule on the connector's page, which is their say-so for it.
    const autoSendSender = async (destination: AutoSendDestination, meetingId: string): Promise<{ ok: boolean; message?: string; skipped?: boolean }> => {
        const doc = loadDoc(meetingId);
        if (!doc) return { ok: false, message: 'The meeting could not be found.' };
        if (!hasNotes(doc)) return { ok: true, skipped: true };
        const store = getConnectionsStore();
        if (destination.kind === 'slack') {
            const url = store.slackWebhookUrl(destination.webhookId);
            if (!url) return { ok: false, message: 'That Slack channel is no longer connected. Add it again on the Slack page.' };
            const checked = checkSlackDraft(doc.title, doc.dateLabel, composeSlackDraft(doc, { includeActionItems: true }));
            if (!checked.ok) return { ok: false, message: slackDraftMessage(checked) };
            try { await postSlackWebhook(url, checked.payload); return { ok: true }; } catch (err) { return { ok: false, message: describeConnectionError(errorKindOf(err), 'Slack') }; }
        }
        if (destination.kind === 'notion') {
            const n = store.read().notion;
            if (!n?.token) return { ok: false, message: describeConnectionError('not_connected', 'Notion') };
            if (!n.parent) return { ok: false, message: 'Pick where Notion pages go in Settings, Connectors.' };
            const parent = n.parent;
            try {
                const res = await withToken('notion', (token) => createNotionPage(
                    { parent, title: notionPageTitle(doc), blocks: buildNotionBlocks(doc, { includeTranscript: false }) },
                    { token },
                ));
                if (res.partial && res.pageId) {
                    notionPartials.set(meetingId, { pageId: res.pageId, url: res.url, remaining: res.remaining || [] });
                    return { ok: false, message: 'The page was made in Notion, but only part of the notes reached it. Finish it from the meeting’s Share menu.' };
                }
                return { ok: true };
            } catch (err) { return { ok: false, message: failOn(err, 'notion').message }; }
        }
        const service = destination.service;
        if (!isCrm(service)) return { ok: false, message: 'Unknown CRM.' };
        const label = CRM_LABELS[service];
        const token = store.token(service);
        if (!token || !crmOpts(service, token)) return { ok: false, message: describeConnectionError('not_connected', label) };
        const candidates = crmCandidatesFor(doc);
        if (!candidates.length) return { ok: true, skipped: true };
        try {
            const matches = await withToken(service, (t) => matchAttendees(service, candidates, crmOpts(service, t)!));
            const records = uniqueRecords(matches.map((m) => m.record).filter((r): r is CrmRecord => !!r));
            // Nobody from this meeting is in the CRM: nothing to attach the note to.
            if (!records.length) return { ok: true, skipped: true };
            const todo = remainingRecords(records, crmSession.sentFor(meetingId, service));
            if (!todo.length) return { ok: true };
            const opts = crmOpts(service, (await tokenNow(service)) || token);
            if (!opts) return { ok: false, message: describeConnectionError('not_connected', label) };
            const outcome = await sendCrmNote(service, doc, todo, opts);
            crmSession.markSent(meetingId, service, outcome.sentIds);
            const summary = crmSendSummary(service, outcome, todo.length, describeConnectionError);
            return summary.ok ? { ok: true } : { ok: false, message: summary.message };
        } catch (err) {
            return { ok: false, message: failOn(err, service).message };
        }
    };
    registerConnectorsDeliveryIpc({
        safeHandle,
        guard,
        userDataDir: app.getPath('userData'),
        loadDoc,
        foldersOfMeeting: (meetingId: string) => {
            const { organiseStore } = require('../organise/organiseService') as typeof import('../organise/organiseService');
            return organiseStore()?.foldersOfMeeting(meetingId) ?? [];
        },
        listFolders: () => {
            const { organiseStore } = require('../organise/organiseService') as typeof import('../organise/organiseService');
            return (organiseStore()?.listFolders() ?? []).map((f) => ({ id: f.id, name: f.name }));
        },
        autoSendSender,
    });
    // Gmail: briefs read recent threads with attendees; follow-ups send from the user's Gmail on press.
    registerGmailIpc({
        safeHandle,
        guard,
        userDataDir: app.getPath('userData'),
        safeStorage,
        openExternal: (url: string) => shell.openExternal(url),
        platform: process.platform,
        loadFollowUpContext: (meetingId: string) => loadDoc(meetingId),
    });
    // Personal API keys: the local, read-only API over the same meetings the MCP server reads.
    registerLocalApiIpc({
        safeHandle,
        guard,
        userDataDir: app.getPath('userData'),
        safeStorage,
        source: databaseMeetingSource(),
        selfName: () => selfIdentity().name || undefined,
    });

    // MCP
    safeHandle('outputs:mcp-set-enabled', guard(MCP_OFF, async (_e, enabled: unknown) => {
        const on = enabled === true;
        getConnectionsStore().setMcp({ enabled: on, ...(getConnectionsStore().mcpSettings().token ? {} : { token: newMcpToken() }) });
        if (mcpStarting) await mcpStarting;
        if (on) await startMcp(); else await stopMcp();
        return mcpStatus();
    }));
    safeHandle('outputs:mcp-reset-token', guard(MCP_OFF, async () => {
        // The running server reads the token per request, so the old one stops working at once.
        getConnectionsStore().setMcp({ token: newMcpToken() });
        return mcpStatus();
    }));

    // Writing style, per mode: every call names the mode (the Modes Manager's open one).
    const ws = (modeId: string) => getWritingStyleService(modeId);
    const NO_MODE = { ok: false, kind: 'invalid_input', message: 'Pick a mode first.' };
    safeHandle('outputs:style-get', guard(null, async (_e, modeId: unknown) => (isModeId(modeId) ? ws(modeId).status() : null)));
    // The style a meeting's follow-up would use: its mode's, or General's when it has
    // none recorded. The meeting page asks this, so it and the draft never disagree.
    safeHandle('outputs:style-get-for-meeting', guard(null, async (_e, meetingId: unknown) => {
        const m = typeof meetingId === 'string' && meetingId ? db().getMeetingDetailedSummary(meetingId) : null;
        if (!m) return null;
        const modeId = meetingStyleModeId(m.detailedSummary);
        return modeId ? ws(modeId).status() : null;
    }));
    safeHandle('outputs:style-list', guard([], async (_e, modeId: unknown) => (isModeId(modeId) ? ws(modeId).listSamples() : [])));
    safeHandle('outputs:style-add', guard(FORBIDDEN, async (_e, modeId: unknown, text: unknown) => {
        if (!isModeId(modeId)) return NO_MODE;
        const sample = ws(modeId).addSample(typeof text === 'string' ? text : '', 'pasted');
        if (!sample) return { ok: false, kind: 'invalid_input', message: 'Paste a longer piece of your own writing (a few sentences), one you have not added already.' };
        return { ok: true, status: ws(modeId).status() };
    }));
    safeHandle('outputs:style-remove', guard(null, async (_e, modeId: unknown, id: unknown) => {
        if (!isModeId(modeId)) return null;
        if (typeof id === 'string') ws(modeId).removeSample(id);
        return ws(modeId).status();
    }));
    // The old follow-up modal: kept under the mode of the meeting it was written for.
    safeHandle('outputs:style-record-followup', guard(false, async (_e, payload: any) => {
        const finalText = typeof payload?.finalText === 'string' ? payload.finalText : '';
        const draftText = typeof payload?.draftText === 'string' ? payload.draftText : undefined;
        const meetingId = typeof payload?.meetingId === 'string' ? payload.meetingId : '';
        const modeId = meetingId ? meetingStyleModeId(db().getMeetingDetails(meetingId)?.detailedSummary) : undefined;
        return modeId ? ws(modeId).recordFollowUp(finalText, draftText, meetingId) : false;
    }));
    // The follow-up email edited in place on the meeting page. Saved with the meeting;
    // when the user copies or opens it (`used`), an edited body becomes a writing sample.
    safeHandle('outputs:followup-save', guard(FORBIDDEN, async (_e, payload: any) => {
        const meetingId = typeof payload?.meetingId === 'string' ? payload.meetingId : '';
        const m = meetingId ? db().getMeetingDetails(meetingId) : null;
        if (!m) return NO_MEETING;
        const res = applyFollowUpEdit(m.detailedSummary, { subject: payload?.subject, body: payload?.body }, Date.now());
        if (!res.ok) {
            return { ok: false, kind: 'invalid_input', message: res.reason === 'empty' ? 'The email is empty. Write something, or press Regenerate.' : 'This meeting has no follow-up email yet.' };
        }
        if (res.changed && !db().replaceDetailedSummary(meetingId, res.detailed)) {
            return { ok: false, kind: 'unknown', message: 'Your edit could not be saved. Try again.' };
        }
        let recorded = false;
        if (payload?.used === true) {
            const sample = followUpSample(currentDraft(res.detailed));
            const modeId = meetingStyleModeId(m.detailedSummary);
            if (sample && modeId) recorded = ws(modeId).recordFollowUp(sample.finalText, sample.draftText, meetingId);
        }
        return { ok: true, draft: res.draft, recorded };
    }));

    safeHandle('outputs:style-refresh', guard(FORBIDDEN, async (_e, modeId: unknown) => {
        if (!isModeId(modeId)) return NO_MODE;
        const profile = await ws(modeId).derive(styleModelCall(llm()));
        if (!profile) return { ok: false, kind: 'invalid_input', message: 'Add a sample of your writing first.' };
        return { ok: true, status: ws(modeId).status() };
    }));

    // Open a Notion page the user just made (https on notion only).
    safeHandle('outputs:open-notion-page', guard(false, async (_e, url: unknown) => {
        try {
            const u = new URL(String(url));
            if (u.protocol !== 'https:' || !/(^|\.)notion\.(so|site|com)$/.test(u.hostname)) return false;
            await shell.openExternal(u.toString());
            return true;
        } catch {
            return false;
        }
    }));
}
