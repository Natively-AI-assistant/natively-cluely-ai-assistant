import { app, safeStorage, shell } from 'electron';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { meetingIdRefsIn, meetingLinksIn, meetingRefOf } from './meetingDetection/meetingLinks';
import { cleanEventDescription } from './calendar/calendarSessionMatch';
import { describeOAuthError, renderOAuthCallbackPage, type OAuthCallbackOutcome } from './oauth/callbackPage';
import type { CalendarEvent, CalendarEventProvider, CalendarSourceId, CalendarSourceStatus } from './calendar/providers/types';
import { CalendarSourceError } from './calendar/providers/types';
import { calendarSourcesFor, createCalendarProviders } from './calendar/providers/registry';
import { mergeCalendarEvents } from './calendar/providers/mergeEvents';

export type { CalendarAttendee, CalendarEvent, CalendarSourceId, CalendarSourceStatus } from './calendar/providers/types';

/*
  Google OAuth client for calendar sync — a "Desktop app" client, used with
  Google's installed-app flow: a loopback redirect on 127.0.0.1, PKCE, and the
  token endpoint called from the app itself.

  The client ID is COMMITTED, not read from .env, because a packaged build never
  loads .env (main.ts gates dotenv on !app.isPackaged). Reading it from the
  environment is why every released build shipped without a client ID.

  The secret is BAKED IN at build time instead (esbuild `define`, see
  scripts/lib/calendar-client-secret.cjs). Google refuses this client's token
  requests without it ("client_secret is missing"), and it is not confidential
  for a Desktop client: Google documents that an installed app cannot keep one,
  and PKCE is what protects the code, since a stolen authorization code is useless
  without the code_verifier only this process holds. It stays out of the public
  repo only because GitHub's secret scanning would flag it. package-app.js
  refuses to package an installer whose build lacks it.

  Until 2026-09-26 the exchange and refresh were proxied through natively-api.
  Since 2026-08-02 that proxy requires a paid x-natively-key, which this app
  never sent, so every connect failed with `exchange_failed status=401
  auth_required`. Calendar sync is for every user, so it no longer depends on
  natively-api at all.

  GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET override both at
  runtime in development.
*/
const DEFAULT_CALENDAR_CLIENT_ID = '814531619520-80ib40f38i5vdeg0j8kk81r0usojrt9a.apps.googleusercontent.com';
const DEFAULT_CALENDAR_CLIENT_SECRET = process.env.NATIVELY_BAKED_CALENDAR_CLIENT_SECRET || '';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const ACCEPTED_EVENT_SCOPES = new Set([
    EVENTS_SCOPE,
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar',
]);
/*
  Each scope has a use, which is what Google's verification checks:
    openid + userinfo.email + userinfo.profile  the id_token that names the
                                  connected account ("Connected as …")
    calendar.events.readonly      the events themselves
    calendar.calendarlist.readonly which calendars the user has ticked in
                                  Google Calendar, so their events sync too
  calendar.readonly is not requested: it would also grant every calendar's
  settings and sharing. Nor is calendar.calendars.readonly: a calendar-list
  entry already carries the name, description and time zone it would add.
*/
const SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    EVENTS_SCOPE,
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
/** Bounds the per-calendar requests one sync makes. */
const MAX_SYNCED_CALENDARS = 20;
const TOKEN_PATH = path.join(app.getPath('userData'), 'calendar_tokens.enc');

/** Token-endpoint errors that mean the stored grant is dead and reconnecting is the only fix. */
const DEAD_GRANT_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client', 'deleted_client']);

export function calendarOAuthClient(): { id: string; secret: string } {
    return {
        id: process.env.GOOGLE_CALENDAR_CLIENT_ID || DEFAULT_CALENDAR_CLIENT_ID,
        secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || DEFAULT_CALENDAR_CLIENT_SECRET,
    };
}

function base64Url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The account an id_token names. The signature is not checked: the token comes
 * straight from Google's token endpoint over TLS, which OpenID Connect accepts
 * in place of signature validation, and it only labels the account in Settings.
 */
function identityFromIdToken(idToken: unknown): { email?: string; name?: string } {
    if (typeof idToken !== 'string') return {};
    try {
        const claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
        return {
            email: typeof claims.email === 'string' ? claims.email : undefined,
            name: typeof claims.name === 'string' ? claims.name : undefined,
        };
    } catch {
        return {};
    }
}

/**
 * Google's reason for a failed Calendar API call, for the log. A bare 403 reads
 * the same whether the Calendar API is disabled in the Cloud project
 * (accessNotConfigured) or the user refused a permission
 * (insufficientPermissions), and only one of those is fixed by the user.
 */
async function googleErrorReason(response: Response): Promise<string> {
    const body = await response.json().catch(() => null) as any;
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
    const message = body?.error?.message || '';
    return [reason, message].filter(Boolean).join(': ');
}

/**
 * An attendee's Gravatar: the SHA-256 of their trimmed, lowercased email, as
 * docs.gravatar.com specifies. `d=404` makes a missing one fail, so the card
 * keeps its initials. Only the hash leaves the app, never the address. The
 * Calendar API itself has no attendee photos.
 */
function gravatarUrl(email: string): string {
    const hash = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    return `https://gravatar.com/avatar/${hash}?s=64&d=404`;
}

/** A conferencing add-on's video join URLs (Meet, Zoom for Google Calendar, Teams). */
function conferenceVideoUris(item: any): string[] {
    const points = Array.isArray(item?.conferenceData?.entryPoints) ? item.conferenceData.entryPoints : [];
    return points
        .filter((p: any) => p?.entryPointType === 'video' && typeof p.uri === 'string')
        .map((p: any) => p.uri as string);
}

/**
 * The fields the meeting notes read from an event (CalendarEvent.recurringEventId,
 * organizer, description, timeZone); each omitted when Google sent nothing usable.
 */
function eventNotesFields(item: any): Pick<CalendarEvent, 'recurringEventId' | 'organizer' | 'description' | 'timeZone'> {
    const out: Pick<CalendarEvent, 'recurringEventId' | 'organizer' | 'description' | 'timeZone'> = {};
    if (typeof item?.recurringEventId === 'string' && item.recurringEventId) out.recurringEventId = item.recurringEventId.slice(0, 256);
    const org = item?.organizer;
    if (org && typeof org === 'object' && (typeof org.email === 'string' || typeof org.displayName === 'string')) {
        out.organizer = {
            ...(typeof org.email === 'string' && org.email ? { email: org.email.slice(0, 200) } : {}),
            ...(typeof org.displayName === 'string' && org.displayName ? { name: org.displayName.slice(0, 120) } : {}),
            ...(org.self === true ? { self: true } : {}),
        };
    }
    const description = cleanEventDescription(item?.description);
    if (description) out.description = description;
    const tz = item?.start?.timeZone;
    if (typeof tz === 'string' && tz && tz.length <= 64) out.timeZone = tz;
    return out;
}

/**
 * Every meeting an event's links join, as keys (CalendarEvent.meetingKeys):
 * hangoutLink, video entry points, then URLs in the location and description.
 * Omitted when there are none.
 */
function meetingKeysField(item: any): { meetingKeys?: string[] } {
    const keys = new Set<string>();
    for (const uri of [item?.hangoutLink, ...conferenceVideoUris(item)]) {
        const ref = typeof uri === 'string' ? meetingRefOf(uri) : null;
        if (ref) keys.add(ref.key);
    }
    for (const text of [item?.location, item?.description]) {
        if (typeof text === 'string') for (const l of meetingLinksIn(text)) keys.add(l.ref.key);
    }
    // A Teams invite's "Meeting ID", which is what the Teams app shows in the call.
    for (const text of [item?.location, item?.description]) {
        if (typeof text === 'string') for (const ref of meetingIdRefsIn(text)) keys.add(ref.key);
    }
    return keys.size > 0 ? { meetingKeys: [...keys].slice(0, 8) } : {};
}

class TokenEndpointError extends Error {
    constructor(public readonly status: number, public readonly code: string, public readonly description?: string) {
        super(`${code}${description ? `: ${description}` : ''} (HTTP ${status})`);
    }
}

/**
 * A connect failure whose message is written for the person signing in. The
 * callback page and the calendar card in Settings both show it as it is; what
 * went wrong underneath is its `cause`, for the log.
 */
class CalendarConnectError extends Error { }

/**
 * The reason given for a failed exchange, on the loopback callback page and in
 * Settings. Only sentences written for people reach either: Natively's own, or
 * Google's. Anything else ("fetch failed", "invalid_client … (HTTP 400)")
 * stays in the log.
 */
function oauthCallbackErrorReason(err: unknown): string {
    if (err instanceof CalendarConnectError) return err.message;
    if (err instanceof TokenEndpointError) {
        if (err.code === 'invalid_grant') {
            return 'Google didn’t accept the sign-in code. It may have expired.';
        }
        // Google answered: its own sentence when it sent one. A bare code
        // ("unauthorized_client") or status is for the log, and the connection is not at fault.
        return err.description?.slice(0, 300) || 'Google couldn’t finish the sign-in. Try again in a minute.';
    }
    // No answer from Google at all: offline, or the request timed out.
    return 'Natively couldn’t finish signing in. Check your connection and try again.';
}

/** POSTs a form to Google's token endpoint and returns the JSON body, or throws TokenEndpointError. */
async function postTokenEndpoint(form: Record<string, string>): Promise<any> {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({} as any));
    if (!response.ok) {
        // A Google front end that is down answers { error: { code, message, status } },
        // not the OAuth pair of strings, so neither field is trusted to be one.
        const code = typeof body?.error === 'string' && body.error ? body.error : 'token_request_failed';
        const description = [body?.error_description, body?.error?.message].find((d) => typeof d === 'string' && d.trim());
        throw new TokenEndpointError(response.status, code, description?.trim());
    }
    // A 200 with no token in it (a proxy's own page, an empty body) is a failure
    // too: connecting on it leaves a calendar that looks connected and never syncs.
    if (typeof body?.access_token !== 'string' || !body.access_token) {
        throw new TokenEndpointError(response.status, 'token_request_failed');
    }
    return body;
}

export interface SyncedCalendar {
    id: string;
    name: string;
    primary: boolean;
    /** Google Calendar's colour for it, e.g. "#9fe1e7". */
    color?: string;
}

export class CalendarManager extends EventEmitter {
    private static instance: CalendarManager;
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private expiryDate: number | null = null;
    private isConnected: boolean = false;
    private accountEmail: string | null = null;
    private accountName: string | null = null;
    private updateInterval: NodeJS.Timeout | null = null;

    private constructor() {
        super();
        // Tokens loaded in init() to ensure safeStorage is ready
    }

    public static getInstance(): CalendarManager {
        if (!CalendarManager.instance) {
            CalendarManager.instance = new CalendarManager();
        }
        return CalendarManager.instance;
    }

    /** `platform` picks the other sources (calendar/providers/registry.ts); a test passes its own. */
    public init(platform: NodeJS.Platform = process.platform) {
        this.loadTokens();
        this.initSources(platform);
    }

    // =========================================================================
    // Auth Flow
    // =========================================================================

    public async startAuthFlow(): Promise<void> {
        const client = calendarOAuthClient();
        // Refuse to start without a client ID — otherwise we'd open a Google
        // page that says "OAuth client not found", the user never hits the
        // callback, and the loopback server below leaks.
        if (!client.id) {
            throw new Error('Calendar sync is not configured in this build (no Google OAuth client ID).');
        }

        // PKCE: only this process knows the verifier, so a code intercepted on
        // the way back is useless to anyone else. `state` ties the callback to
        // this attempt.
        const codeVerifier = base64Url(crypto.randomBytes(32));
        const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
        const state = base64Url(crypto.randomBytes(16));

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                try { server.close(); } catch { }
                clearTimeout(timeout);
                fn();
            };
            let redirectUri = '';

            const server = http.createServer(async (req, res) => {
                const qs = new URL(req.url || '/', 'http://127.0.0.1').searchParams;
                const code = qs.get('code');
                const error = qs.get('error');
                // Anything else (a favicon request, a stray probe) is not the redirect.
                if (!code && !error) {
                    res.statusCode = 404;
                    res.end();
                    return;
                }
                const respond = (outcome: OAuthCallbackOutcome) => {
                    const page = renderOAuthCallbackPage('calendar', outcome, process.platform);
                    res.writeHead(200, page.headers);
                    res.end(page.body);
                };
                if (qs.get('state') !== state) {
                    respond({ kind: 'error', reason: 'This response belongs to a different sign-in attempt.' });
                    finish(() => reject(new Error('Calendar sign-in returned an unexpected state. Please try again.')));
                    return;
                }
                if (error) {
                    const reason = describeOAuthError(error, qs.get('error_description'));
                    respond({ kind: 'error', reason });
                    finish(() => reject(new CalendarConnectError(reason, { cause: new Error(error) })));
                    return;
                }
                try {
                    await this.exchangeCodeForToken(code!, codeVerifier, redirectUri);
                    respond({ kind: 'connected' });
                    finish(() => resolve());
                } catch (err) {
                    const reason = oauthCallbackErrorReason(err);
                    respond({ kind: 'error', reason });
                    finish(() => reject(err instanceof CalendarConnectError ? err : new CalendarConnectError(reason, { cause: err })));
                }
            });

            // 5-minute hard timeout — if the user never completes consent, free the port.
            const timeout = setTimeout(() => {
                finish(() => reject(new CalendarConnectError('Sign-in wasn’t finished within five minutes. Connect again.')));
            }, 5 * 60 * 1000);

            // 127.0.0.1, not every interface: the callback carries an auth code
            // and must not be reachable from the network, and binding every
            // interface raises the Windows Defender Firewall prompt. Port 0 lets
            // the OS pick a free port; a Desktop client accepts any loopback port,
            // so a fixed one only adds the chance of colliding with another app.
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (!address || typeof address === 'string') {
                    finish(() => reject(new Error('Calendar sign-in could not open a local callback port.')));
                    return;
                }
                redirectUri = `http://127.0.0.1:${address.port}`;
                shell.openExternal(this.getAuthUrl(client.id, redirectUri, codeChallenge, state));
            });

            server.on('error', (err) => {
                finish(() => reject(new CalendarConnectError('Calendar sign-in could not open a local callback port.', { cause: err })));
            });
        });
    }

    public async disconnect(): Promise<void> {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiryDate = null;
        this.isConnected = false;
        this.accountEmail = null;
        this.accountName = null;
        this.forgetSource('google');
        this.lastCalendars = null;

        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }

        this.emitConnectionChanged();
    }

    /**
     * Whether any calendar is connected, and the account that names the user:
     * Google's when Google is connected (exactly as before other sources
     * existed), else the first other source that has an account (Outlook).
     * The notes, follow-up signatures and speaker names read the name; the
     * address splits an invite into colleagues and the other side.
     */
    public getConnectionStatus(): { connected: boolean; email?: string; name?: string } {
        if (this.isConnected) {
            return {
                connected: true,
                ...(this.accountEmail ? { email: this.accountEmail } : {}),
                ...(this.accountName ? { name: this.accountName } : {}),
            };
        }
        const others = this.providers.filter((p) => p.isConnected());
        if (others.length === 0) return { connected: false };
        const identity = others.map((p) => p.identity?.()).find((i) => i && (i.email || i.name));
        return {
            connected: true,
            ...(identity?.email ? { email: identity.email } : {}),
            ...(identity?.name ? { name: identity.name } : {}),
        };
    }

    private getAuthUrl(clientId: string, redirectUri: string, codeChallenge: string, state: string): string {
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: SCOPES.join(' '),
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state,
            access_type: 'offline', // For refresh token
            prompt: 'consent' // Force prompts to ensure we get refresh token
        });
        return `${AUTH_URL}?${params.toString()}`;
    }

    private async exchangeCodeForToken(code: string, codeVerifier: string, redirectUri: string) {
        const client = calendarOAuthClient();
        try {
            const data = await postTokenEndpoint({
                grant_type: 'authorization_code',
                code,
                code_verifier: codeVerifier,
                // Must match the authorize request exactly, port included.
                redirect_uri: redirectUri,
                client_id: client.id,
                ...(client.secret ? { client_secret: client.secret } : {}),
            });
            // Google's consent screen lets people untick individual permissions.
            // (The message is sized for the calendar card: longer wraps past its 198px.)
            // Without event access there is nothing to sync, so refuse the grant
            // rather than connect to a calendar that always looks empty. The other
            // scopes are optional: no calendar list means the primary calendar
            // only, no identity means "Connected as User".
            const granted = typeof data.scope === 'string' ? data.scope.split(' ') : null;
            if (granted && !granted.some((scope: string) => ACCEPTED_EVENT_SCOPES.has(scope))) {
                throw new CalendarConnectError('Natively needs access to your calendar events. Connect again and allow it.');
            }
            this.handleTokenResponse(data);
        } catch (error) {
            console.error('[CalendarManager] Token exchange failed:', error);
            throw error;
        }
    }

    // =========================================================================
    // Refresh Logic (NEW)
    // =========================================================================

    /** True when Google answered: a failed fetch keeps the last list, which is not "up to date". */
    public async refreshState(): Promise<boolean> {
        console.log('[CalendarManager] Refreshing state (Reality Reconciliation)...');

        // 1. Reset Soft Heuristics
        // Clear existing reminder timeouts to prevent double scheduling or stale alerts
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        // 2. Calendar Re-sync & Temporal Re-evaluation
        const landedBefore = this.fetchesLanded;
        if (this.anyConnected()) {
            // Force fetch will also re-schedule reminders based on NEW time
            await this.getUpcomingEvents(true);
        } else {
            console.log('[CalendarManager] Calendar not connected, skipping fetch.');
        }

        // 3. Emit update to UI
        // We emit 'updated' so the frontend knows to re-fetch via getUpcomingEvents
        // or we could push the data. usually ipcHandlers just call getUpcomingEvents.
        this.emit('events-updated');
        return this.anyConnected() && this.fetchesLanded !== landedBefore;
    }

    private handleTokenResponse(data: any) {
        this.accessToken = data.access_token;
        if (data.refresh_token) {
            this.refreshToken = data.refresh_token; // Only returned on first consent
        }
        this.expiryDate = Date.now() + (data.expires_in * 1000);
        // A refresh may or may not carry a new id_token; keep the account we have.
        const identity = identityFromIdToken(data.id_token);
        if (identity.email) this.accountEmail = identity.email;
        if (identity.name) this.accountName = identity.name;
        this.isConnected = true;
        // A save that fails (a locked file, a full disk) is not a failed sign-in:
        // the tokens work from memory, and the next refresh saves again. Without
        // this the page said "couldn't sign in" over a calendar that was connected.
        try {
            this.saveTokens();
        } catch (error) {
            console.error('[CalendarManager] Could not save the calendar tokens; connected for this session:', error);
        }
        this.emitConnectionChanged();

        // Initial fetch
        this.fetchUpcomingEvents();
    }

    private async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        const client = calendarOAuthClient();
        try {
            const data = await postTokenEndpoint({
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken,
                client_id: client.id,
                ...(client.secret ? { client_secret: client.secret } : {}),
            });
            this.handleTokenResponse(data);
        } catch (error) {
            console.error('[CalendarManager] Token refresh failed:', error);
            // Only a dead grant (revoked, expired, or issued to another client)
            // ends the connection. A network or server failure keeps the tokens,
            // or an offline laptop would lose its calendar on the next refresh.
            if (error instanceof TokenEndpointError && DEAD_GRANT_ERRORS.has(error.code)) {
                this.disconnect();
            }
        }
    }

    // =========================================================================
    // Token Storage (Encrypted)
    // =========================================================================

    private saveTokens() {
        if (!safeStorage.isEncryptionAvailable()) {
            console.warn('[CalendarManager] Encryption not available, skipping token save');
            return;
        }

        const data = JSON.stringify({
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiryDate: this.expiryDate,
            email: this.accountEmail,
            name: this.accountName,
        });

        const encrypted = safeStorage.encryptString(data);
        const tmpPath = TOKEN_PATH + '.tmp';
        fs.writeFileSync(tmpPath, encrypted);
        fs.renameSync(tmpPath, TOKEN_PATH);
    }

    private loadTokens() {
        if (!fs.existsSync(TOKEN_PATH)) return;

        try {
            if (!safeStorage.isEncryptionAvailable()) return;

            const encrypted = fs.readFileSync(TOKEN_PATH);
            const decrypted = safeStorage.decryptString(encrypted);
            const data = JSON.parse(decrypted);

            this.accessToken = data.accessToken;
            this.refreshToken = data.refreshToken;
            this.expiryDate = data.expiryDate;
            this.accountEmail = typeof data.email === 'string' ? data.email : null;
            this.accountName = typeof data.name === 'string' ? data.name : null;

            if (this.accessToken && this.refreshToken) {
                this.isConnected = true;
                // Check expiry
                if (this.expiryDate && Date.now() >= this.expiryDate) {
                    this.refreshAccessToken();
                }
            }
        } catch (error) {
            console.error('[CalendarManager] Failed to load tokens:', error);
        }
    }

    // =========================================================================
    // Reminders
    // =========================================================================

    private reminderTimeouts: NodeJS.Timeout[] = [];
    // Injected by main.ts (Undetectable mode). Asked when a reminder fires.
    private notificationSuppressed: () => boolean = () => false;

    public setNotificationSuppressor(isSuppressed: () => boolean): void {
        this.notificationSuppressed = isSuppressed;
    }

    /** Occurrences (event id + start) already reminded: a re-plan never repeats one. */
    private remindedOccurrences = new Set<string>();

    /** The events the reminders were last scheduled for, so a new lead time re-plans them. */
    private reminderEvents: CalendarEvent[] = [];

    /** Settings › Calendar's reminder lead time (1, 2 or 5 minutes; unset = 2). */
    private reminderLeadMinutes(): number {
        try {
            const { reminderMinutes } = require('./meetingDetection/meetingOffer');
            const { SettingsManager } = require('./SettingsManager');
            return reminderMinutes(SettingsManager.getInstance().get('calendarReminderMinutes'));
        } catch {
            return 2;
        }
    }

    /** The lead time changed: the same events, new reminder times. */
    public rescheduleReminders(): void {
        this.scheduleReminders(this.reminderEvents);
    }

    private scheduleReminders(events: CalendarEvent[]) {
        // Clear existing
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];
        this.reminderEvents = events;

        const now = Date.now();
        const leadMinutes = this.reminderLeadMinutes();
        const { planReminders, pruneReminded, reminderKey } = require('./meetingDetection/meetingOffer');
        pruneReminded(this.remindedOccurrences, now);

        // The chosen lead before each start (2 minutes unless changed), within
        // the next 24h, skipping occurrences already reminded.
        for (const { event, delayMs } of planReminders(events, now, leadMinutes, this.remindedOccurrences) as Array<{ event: CalendarEvent; delayMs: number }>) {
            const timeout = setTimeout(() => {
                this.remindedOccurrences.add(reminderKey(event));
                this.showNotification(event, leadMinutes);
            }, delayMs);
            this.reminderTimeouts.push(timeout);
        }
    }

    /** The last reminder shown, kept referenced so its buttons still work. */
    private reminderNotification: unknown = null;

    private showNotification(event: CalendarEvent, leadMinutes: number = 2) {
        // A system notification is its own OS window (and it chimes), outside
        // the content protection Undetectable mode relies on, so it would show
        // in a screen share. The launcher's calendar card still counts down.
        if (this.notificationSuppressed()) {
            console.log('[CalendarManager] Reminder skipped: Undetectable is on');
            return;
        }
        const { Notification } = require('electron');
        // A recurring meeting recalls its last instance (recurringMeetings.ts,
        // stored notes only, no model call); otherwise the usual question.
        let lastTime: string | null = null;
        try {
            const { lastTimeNotificationLine } = require('./meeting/recurringMeetings');
            lastTime = lastTimeNotificationLine(event);
        } catch { /* a recap never blocks the reminder */ }
        let lead = leadMinutes === 1 ? '1 minute' : `${leadMinutes} minutes`;
        try { lead = require('./meetingDetection/meetingOffer').reminderLeadText(leadMinutes); } catch { /* the plain wording above */ }
        const notif = new Notification({
            title: 'Meeting starting soon',
            body: lastTime ? `"${event.title}" starts in ${lead}.\n${lastTime}` : `"${event.title}" starts in ${lead}. Start Natively?`,
            actions: [
                { type: 'button', text: 'Start Meeting' },
                { type: 'button', text: 'Dismiss' },
                // A "running late" note for the people on it, drafted in the
                // launcher for the user to send (services/assist; never sent here).
                ...(Array.isArray(event.attendees) && event.attendees.length > 0 ? [{ type: 'button' as const, text: 'Running late' }] : []),
            ],
            // Not silent: the OS's default sound. (`sound` names a macOS sound
            // file; `true` was never a valid value.)
        });
        // Electron drops a Notification nothing references; keep the latest.
        this.reminderNotification = notif;

        // Electron 43: the index is `details.actionIndex`; the positional one is deprecated.
        notif.on('action', (details: any, legacyIndex?: number) => {
            const index = typeof details?.actionIndex === 'number' ? details.actionIndex : legacyIndex;
            if (index === 2) {
                this.emit('reminder-draft-requested', event);
                return;
            }
            if (index === 0) {
                // Start Meeting
                // We need to tell the main process to open window and start meeting
                // Ideally we emit an event that AppState listens to
                this.emit('start-meeting-requested', event);
            }
        });

        notif.on('click', () => {
            // Just open window
            this.emit('open-requested');
        });

        notif.show();
    }

    // =========================================================================
    // Fetch Logic
    // =========================================================================

    // The last list a fetch returned whole, and when. A session start matches
    // against this at once (calendarSessionMatch.ts) instead of waiting on
    // Google; the Launcher and Settings refetch it every minute anyway.
    // Every source's events merged (mergeEvents.ts); lastBySource keeps each
    // source's own last list, so one that fails keeps its last week.
    private lastEvents: CalendarEvent[] = [];
    private lastEventsAt = 0;
    private lastBySource = new Map<CalendarSourceId, CalendarEvent[]>();
    /** Fetches a source answered; refreshState compares it (two can share a Date.now()). */
    private fetchesLanded = 0;

    public async getUpcomingEvents(force: boolean = false): Promise<CalendarEvent[]> {
        if (!this.anyConnected()) return [];

        const now = Date.now();
        const results = await this.fetchFromSources(now, now + 7 * 24 * 60 * 60 * 1000);
        let landed = false;
        for (const [source, events] of results) {
            this.lastRefresh.set(source, { at: now, ok: !!events });
            if (events) {
                this.lastBySource.set(source, events);
                landed = true;
            }
        }
        if (landed) {
            this.lastEvents = this.mergedLastEvents();
            this.lastEventsAt = now;
            this.fetchesLanded++;
        }
        // Reminders for what the sources that answered returned.
        this.scheduleReminders(mergeCalendarEvents(
            [...results].filter(([, events]) => !!events).map(([source, events]) => ({ source, events: events! })),
        ));
        // A failed fetch (offline, Google timing out) is not an empty week: the
        // Launcher and Settings keep showing the last list, less what has ended.
        const anyFailed = [...results.values()].some((events) => !events);
        if (!landed || anyFailed) return this.lastEvents.filter((ev) => new Date(ev.endTime).getTime() > now);
        return this.lastEvents;
    }

    /** The last fetched list if it is no older than `maxAgeMs`, else null. */
    public getCachedEvents(maxAgeMs: number): CalendarEvent[] | null {
        if (!this.anyConnected() || this.lastEventsAt === 0) return null;
        return Date.now() - this.lastEventsAt <= maxAgeMs ? this.lastEvents : null;
    }

    /**
     * Events overlapping [fromMs, toMs], past ones included (a meeting's notes
     * offering which event it was). Schedules no reminders: this is not the
     * upcoming list.
     */
    public async getEventsBetween(fromMs: number, toMs: number): Promise<CalendarEvent[]> {
        if (!this.anyConnected()) return [];
        const results = await this.fetchFromSources(fromMs, toMs);
        return mergeCalendarEvents([...results].map(([source, events]) => ({ source, events: events ?? [] })));
    }

    /** Google's events overlapping [fromMs, toMs]; null when the fetch failed outright. */
    private async fetchGoogle(fromMs: number, toMs: number): Promise<CalendarEvent[] | null> {
        if (!this.isConnected || !this.accessToken) return [];
        // Check expiry
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }
        return this.fetchEventsInternal(fromMs, toMs);
    }

    /** Each connected source's events (null for one that failed), in parallel. */
    private async fetchFromSources(fromMs: number, toMs: number): Promise<Map<CalendarSourceId, CalendarEvent[] | null>> {
        const jobs: Array<Promise<[CalendarSourceId, CalendarEvent[] | null]>> = [];
        if (this.isConnected) jobs.push(this.fetchGoogle(fromMs, toMs).then((events) => ['google', events]));
        for (const provider of this.providers) {
            if (!provider.isConnected()) continue;
            jobs.push(provider.fetchEvents(fromMs, toMs)
                .catch((error) => {
                    console.error(`[CalendarManager] ${provider.id} fetch failed:`, error?.message ?? error);
                    return null;
                })
                .then((events) => [provider.id, events]));
        }
        const results = new Map(await Promise.all(jobs));
        // A source that disconnected during its own fetch (a revoked grant) has nothing to add.
        for (const source of [...results.keys()]) {
            if (!this.sourceConnected(source)) results.delete(source);
        }
        return results;
    }

    /** Events overlapping [fromMs, toMs]; null when the fetch failed outright. */
    private async fetchEventsInternal(fromMs: number, toMs: number): Promise<CalendarEvent[] | null> {
        if (!this.accessToken) return [];

        try {
            const params = new URLSearchParams({
                // timeMin bounds an event's END: one still running is included.
                timeMin: new Date(fromMs).toISOString(),
                timeMax: new Date(toMs).toISOString(),
                singleEvents: 'true',
                orderBy: 'startTime',
                maxResults: '50',
            });
            const calendarIds = await this.syncedCalendarIds();
            let failed = 0;
            const perCalendar = await Promise.all(calendarIds.map(async (calendarId) => {
                const response = await fetch(
                    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
                    {
                        headers: { Authorization: `Bearer ${this.accessToken}` },
                        signal: AbortSignal.timeout(15_000),
                    }
                ).catch((error) => {
                    console.error(`[CalendarManager] Google Calendar fetch failed for one calendar:`, error);
                    return null;
                });
                if (!response?.ok) {
                    if (response) console.error(`[CalendarManager] Google Calendar fetch failed: HTTP ${response.status} ${await googleErrorReason(response)}`);
                    failed++;
                    return [];
                }
                const data = await response.json() as any;
                return (data.items || []) as any[];
            }));
            // Nothing came back at all (offline, say): that is a failed fetch,
            // not an empty week, so callers keep what they had.
            if (failed === calendarIds.length) return null;

            // A meeting you were invited to on two calendars is one meeting.
            // Recurring instances share an iCalUID, so the start time is part of
            // the key. Primary comes first, so its copy is the one kept.
            const seen = new Set<string>();
            const items = perCalendar.flat().filter((item: any) => {
                const key = `${item.iCalUID || item.id}|${item.start?.dateTime ?? item.start?.date ?? ''}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            console.log(`[CalendarManager] Google returned ${items.length} raw items across ${calendarIds.length} calendar(s)`);

            const filtered = items
                .filter((item: any) => {
                    // Filter: >= 5 mins, no all-day
                    if (!item.start?.dateTime || !item.end?.dateTime) return false; // All-day events have .date instead of .dateTime

                    const start = new Date(item.start.dateTime).getTime();
                    const end = new Date(item.end.dateTime).getTime();
                    const durationMins = (end - start) / 60000;

                    return durationMins >= 5;
                });

            console.log(`[CalendarManager] After filtering (timed, >=5min): ${filtered.length} events`);

            return filtered
                .map((item: any) => ({
                    id: item.id,
                    title: item.summary || '(No Title)',
                    startTime: item.start.dateTime,
                    endTime: item.end.dateTime,
                    link: this.resolveMeetingLink(item),
                    ...meetingKeysField(item),
                    source: 'google' as const,
                    // Everyone on it, to a sane cap: they are a follow-up's recipients
                    // (the Launcher shows two faces and counts the rest).
                    attendees: Array.isArray(item.attendees)
                        ? item.attendees
                            .filter((a: any) => !a.self && !a.resource && a.email)
                            .slice(0, 50)
                            .map((a: any) => ({
                                email: a.email,
                                name: a.displayName,
                                photoUrl: gravatarUrl(a.email),
                                response: a.responseStatus,
                            }))
                        : undefined,
                    selfResponse: Array.isArray(item.attendees)
                        ? item.attendees.find((a: any) => a.self)?.responseStatus
                        : undefined,
                    // For the meeting notes (2026-10-15): which series this is (Google
                    // sends recurringEventId on every instance, singleEvents or not),
                    // who sent it, what it says it is for, and its time zone.
                    ...eventNotesFields(item),
                    // The same invite in Outlook, Apple Calendar or a calendar link is merged by it.
                    ...(typeof item.iCalUID === 'string' && item.iCalUID ? { iCalUID: item.iCalUID.slice(0, 300) } : {}),
                }))
                // Each calendar comes back in order; the merge does not.
                .sort((a: CalendarEvent, b: CalendarEvent) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

        } catch (error) {
            console.error('[CalendarManager] Failed to fetch events:', error);
            return null;
        }
    }

    /**
     * The calendars whose events sync, for Settings: the ones ticked in Google
     * Calendar, primary first. Without calendar-list access that is the
     * primary calendar alone.
     */
    public async getSyncedCalendars(): Promise<SyncedCalendar[]> {
        if (!this.isConnected || !this.accessToken) return [];
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }
        const entries = await this.syncedCalendarEntries();
        // The request itself failed (offline): the last list, not "primary only".
        if (entries === null && this.lastCalendars) return this.lastCalendars;
        const calendars: SyncedCalendar[] = !entries?.length
            ? [{ id: 'primary', name: this.accountEmail || 'Primary calendar', primary: true }]
            : entries.map((c) => ({
                id: c.id,
                name: c.summaryOverride || c.summary || c.id,
                primary: !!c.primary,
                ...(typeof c.backgroundColor === 'string' ? { color: c.backgroundColor } : {}),
            }));
        if (entries !== null) this.lastCalendars = calendars;
        return calendars;
    }

    /** The last calendar list Google answered, for when a request fails outright. */
    private lastCalendars: SyncedCalendar[] | null = null;

    private async syncedCalendarIds(): Promise<string[]> {
        const entries = await this.syncedCalendarEntries();
        return entries?.length ? entries.map((c) => c.id as string) : ['primary'];
    }

    /**
     * Calendar-list entries for the calendars ticked in Google Calendar,
     * primary first. Empty when the list is unavailable, e.g. the
     * calendar-list permission was unticked at consent; callers then use the
     * primary calendar alone. Null when the request failed outright (offline).
     */
    private async syncedCalendarEntries(): Promise<any[] | null> {
        try {
            const response = await fetch(`${CALENDAR_API}/users/me/calendarList?minAccessRole=reader`, {
                headers: { Authorization: `Bearer ${this.accessToken}` },
                signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) {
                console.warn(`[CalendarManager] Calendar list unavailable (HTTP ${response.status} ${await googleErrorReason(response)}); syncing the primary calendar only`);
                return [];
            }
            const data = await response.json() as any;
            return ((data.items || []) as any[])
                .filter((c) => !c.deleted && (c.primary || c.selected))
                .sort((a, b) => Number(!!b.primary) - Number(!!a.primary))
                .slice(0, MAX_SYNCED_CALENDARS);
        } catch (error) {
            console.warn('[CalendarManager] Calendar list request failed; syncing the primary calendar only:', error);
            return null;
        }
    }

    // Intelligent Link Extraction: the Join button's target.
    private resolveMeetingLink(item: any): string | undefined {
        // 1. Google Meet's own link.
        if (item.hangoutLink) return item.hangoutLink;
        // 2. A conferencing add-on's video entry point (Zoom and Teams for Google
        //    Calendar put their join link here, not in the description).
        const video = conferenceVideoUris(item)[0];
        if (video) return video;
        // 3. A join link typed into the location, then one in the description.
        const inText = meetingLinksIn(typeof item.location === 'string' ? item.location : '')[0]
            ?? meetingLinksIn(typeof item.description === 'string' ? item.description : '')[0];
        if (inText) return inText.url;
        // 4. Any other provider link (a Zoom registration page still joins).
        if (!item.description) return undefined;

        return this.extractMeetingLink(item.description);
    }

    private extractMeetingLink(description: string): string | undefined {
        // Regex for common meeting providers
        // Matches zoom.us, zoomgov.com, teams.microsoft.com, teams.live.com, teams.cloud.microsoft, meet.google.com, webex.com
        const providerRegex = /(https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|teams\.cloud\.microsoft|meet\.google\.com|webex\.com)\/[^\s<>"']+)/gi;

        const matches = description.match(providerRegex);
        if (matches && matches.length > 0) {
            // Deduplicate
            const unique = [...new Set(matches)];
            // Return the first valid provider link
            return unique[0];
        }

        // Fallback: Generic URL (less strict, but riskier)
        // const genericUrlRegex = /(https?:\/\/[^\s<>"']+)/g;
        // ... avoided to prevent picking up random links like "docs.google.com"

        return undefined;
    }

    // =========================================================================
    // Calendar sources (2026-10-15): Google above, Outlook, Apple Calendar and a
    // calendar link (calendar/providers). Every one maps into CalendarEvent, so
    // the lists above merge them and nothing downstream knows the difference.
    // =========================================================================

    private providers: CalendarEventProvider[] = [];
    private sourceIds: CalendarSourceId[] = ['google'];
    private lastRefresh = new Map<CalendarSourceId, { at: number; ok: boolean }>();

    private initSources(platform: NodeJS.Platform): void {
        this.sourceIds = calendarSourcesFor(platform);
        try {
            this.providers = createCalendarProviders(platform, {
                userDataDir: app.getPath('userData'),
                safeStorage,
                openExternal: (url: string) => shell.openExternal(url),
                // Looked up per call, like Google's own requests.
                fetch: ((input: any, init?: any) => globalThis.fetch(input, init)) as typeof fetch,
                now: () => Date.now(),
                onConnectionChanged: () => this.onSourceConnectionChanged(),
                knownSelfEmails: () => this.knownSelfEmails(),
            }, {
                // The native module only loads once Apple Calendar is used.
                loadEventKit: () => {
                    const { loadNativeModule } = require('../audio/nativeModuleLoader');
                    return loadNativeModule();
                },
            });
            for (const provider of this.providers) {
                try {
                    provider.init();
                } catch (error) {
                    console.error(`[CalendarManager] ${provider.id} could not load its saved state:`, error);
                }
            }
        } catch (error) {
            console.error('[CalendarManager] Calendar sources other than Google are unavailable:', error);
            this.providers = [];
        }
    }

    private anyConnected(): boolean {
        return this.isConnected || this.providers.some((p) => p.isConnected());
    }

    private sourceConnected(source: CalendarSourceId): boolean {
        if (source === 'google') return this.isConnected;
        return !!this.providers.find((p) => p.id === source)?.isConnected();
    }

    /** Every connected source's last list, merged. */
    private mergedLastEvents(): CalendarEvent[] {
        return mergeCalendarEvents(
            [...this.lastBySource]
                .filter(([source]) => this.sourceConnected(source))
                .map(([source, events]) => ({ source, events })),
        );
    }

    /** A source went away: its events leave the lists at once. */
    private forgetSource(source: CalendarSourceId): void {
        this.lastBySource.delete(source);
        this.lastRefresh.delete(source);
        this.lastEvents = this.mergedLastEvents();
        if (!this.anyConnected() || this.lastBySource.size === 0) {
            this.lastEvents = [];
            this.lastEventsAt = 0;
        }
    }

    /** Announces whether ANY calendar is connected (the Launcher and Settings follow it). */
    private emitConnectionChanged(): void {
        this.emit('connection-changed', this.getConnectionStatus().connected);
    }

    private onSourceConnectionChanged(): void {
        for (const provider of this.providers) {
            if (!provider.isConnected() && this.lastBySource.has(provider.id)) this.forgetSource(provider.id);
        }
        this.emitConnectionChanged();
        // A newly connected source shows in the lists without waiting a minute.
        if (this.anyConnected()) void this.getUpcomingEvents(true).catch(() => {});
    }

    /** The user's own addresses across sources: "you" in a calendar link's or Apple Calendar's attendee list. */
    private knownSelfEmails(): string[] {
        const out: string[] = [];
        if (this.isConnected && this.accountEmail) out.push(this.accountEmail);
        for (const provider of this.providers) {
            const email = provider.isConnected() ? provider.identity?.()?.email : undefined;
            if (email) out.push(email);
        }
        return out;
    }

    /** Each source this platform offers, for Settings › Calendar, in its order. */
    public getSourceStatuses(): CalendarSourceStatus[] {
        return this.sourceIds.map((id): CalendarSourceStatus => {
            const lastRefresh = this.lastRefresh.get(id);
            if (id === 'google') {
                const base: CalendarSourceStatus = this.isConnected
                    ? {
                        id,
                        state: 'connected',
                        ...(this.accountName || this.accountEmail ? { account: (this.accountName || this.accountEmail)! } : {}),
                        ...(this.accountName && this.accountEmail ? { detail: this.accountEmail } : {}),
                    }
                    : { id, state: 'disconnected' };
                return lastRefresh && this.isConnected ? { ...base, lastRefresh } : base;
            }
            const provider = this.providers.find((p) => p.id === id);
            if (!provider) return { id, state: 'unconfigured' };
            const status = provider.status();
            return lastRefresh && status.state === 'connected' ? { ...status, lastRefresh } : status;
        });
    }

    /**
     * Connects one source. Google goes through its own flow (startAuthFlow).
     * Returns the sentence to show when it did not connect, else null.
     */
    public async connectSource(id: CalendarSourceId, input?: unknown): Promise<string | null> {
        if (!this.sourceIds.includes(id)) return 'This calendar isn’t available on this computer.';
        try {
            if (id === 'google') {
                await this.startAuthFlow();
                return null;
            }
            const provider = this.providers.find((p) => p.id === id);
            if (!provider) return 'This calendar isn’t available on this computer.';
            await provider.connect(input);
            return null;
        } catch (error: any) {
            console.error(`[CalendarManager] ${id} connect failed:`, error?.cause ?? error?.message ?? error);
            // Only sentences written for people reach Settings.
            if (error instanceof CalendarSourceError || error instanceof CalendarConnectError) return error.message;
            return 'Natively couldn’t connect this calendar. Try again in a minute.';
        }
    }

    public async disconnectSource(id: CalendarSourceId): Promise<void> {
        if (id === 'google') {
            await this.disconnect();
            return;
        }
        const provider = this.providers.find((p) => p.id === id);
        if (!provider) return;
        await provider.disconnect();
        this.forgetSource(id);
    }

    // Background fetcher could go here if needed
    public async fetchUpcomingEvents() {
        // wrapper to just cache or trigger updates
        return this.getUpcomingEvents();
    }
}
