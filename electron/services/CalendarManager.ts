import { app, safeStorage, shell } from 'electron';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { meetingLinksIn, meetingRefOf } from './meetingDetection/meetingLinks';
import { describeOAuthError, renderOAuthCallbackPage, type OAuthCallbackOutcome } from './oauth/callbackPage';

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

function calendarOAuthClient(): { id: string; secret: string } {
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
    return keys.size > 0 ? { meetingKeys: [...keys].slice(0, 8) } : {};
}

class TokenEndpointError extends Error {
    constructor(public readonly status: number, public readonly code: string, description?: string) {
        super(`${code}${description ? `: ${description}` : ''} (HTTP ${status})`);
    }
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
        throw new TokenEndpointError(response.status, body.error || 'token_request_failed', body.error_description);
    }
    return body;
}

export interface CalendarAttendee {
    email: string;
    name?: string;
    photoUrl?: string;
    response?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

export interface CalendarEvent {
    id: string;
    title: string;
    startTime: string; // ISO
    endTime: string; // ISO
    link?: string;
    source: 'google';
    attendees?: CalendarAttendee[];
    /** The user's own RSVP (their attendee entry is dropped from `attendees`). */
    selfResponse?: CalendarAttendee['response'];
    /**
     * Every meeting its links join (meetingDetection/meetingLinks.ts keys, no
     * passwords): the Meet link, a Zoom or Teams add-on's entry point, and any
     * join URL in the location or description. A session whose meeting tab has
     * one of these IS this event (calendarSessionMatch.ts).
     */
    meetingKeys?: string[];
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

    public init() {
        this.loadTokens();
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
                    respond({ kind: 'error', reason: describeOAuthError(error, qs.get('error_description')) });
                    finish(() => reject(new Error(error)));
                    return;
                }
                try {
                    await this.exchangeCodeForToken(code!, codeVerifier, redirectUri);
                    respond({ kind: 'connected' });
                    finish(() => resolve());
                } catch (err) {
                    respond({ kind: 'error', reason: 'Google didn’t accept the sign-in code. It may have expired.' });
                    finish(() => reject(err));
                }
            });

            // 5-minute hard timeout — if the user never completes consent, free the port.
            const timeout = setTimeout(() => {
                finish(() => reject(new Error('Calendar auth timed out — port released.')));
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
                finish(() => reject(err));
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
        this.lastEvents = [];
        this.lastEventsAt = 0;
        this.lastCalendars = null;

        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }

        this.emit('connection-changed', false);
    }

    public getConnectionStatus(): { connected: boolean; email?: string; name?: string } {
        return {
            connected: this.isConnected,
            ...(this.isConnected && this.accountEmail ? { email: this.accountEmail } : {}),
            ...(this.isConnected && this.accountName ? { name: this.accountName } : {}),
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
            if (granted && !granted.includes(EVENTS_SCOPE)) {
                throw new Error('Natively needs access to your calendar events. Connect again and allow it.');
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
        if (this.isConnected) {
            // Force fetch will also re-schedule reminders based on NEW time
            await this.getUpcomingEvents(true);
        } else {
            console.log('[CalendarManager] Calendar not connected, skipping fetch.');
        }

        // 3. Emit update to UI
        // We emit 'updated' so the frontend knows to re-fetch via getUpcomingEvents
        // or we could push the data. usually ipcHandlers just call getUpcomingEvents.
        this.emit('events-updated');
        return this.isConnected && this.fetchesLanded !== landedBefore;
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
        this.saveTokens();
        this.emit('connection-changed', true);

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

    private scheduleReminders(events: CalendarEvent[]) {
        // Clear existing
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        const now = Date.now();

        events.forEach(event => {
            const startStr = event.startTime;
            if (!startStr) return;

            const startTime = new Date(startStr).getTime();
            // Reminder time: 2 minutes before
            const reminderTime = startTime - (2 * 60 * 1000);

            if (reminderTime > now) {
                const delay = reminderTime - now;
                // Only schedule if within next 24h (which fetch already limits)
                if (delay < 24 * 60 * 60 * 1000) {
                    const timeout = setTimeout(() => {
                        this.showNotification(event);
                    }, delay);
                    this.reminderTimeouts.push(timeout);
                }
            }
        });
    }

    /** The last reminder shown, kept referenced so its buttons still work. */
    private reminderNotification: unknown = null;

    private showNotification(event: CalendarEvent) {
        // A system notification is its own OS window (and it chimes), outside
        // the content protection Undetectable mode relies on, so it would show
        // in a screen share. The launcher's calendar card still counts down.
        if (this.notificationSuppressed()) {
            console.log('[CalendarManager] Reminder skipped: Undetectable is on');
            return;
        }
        const { Notification } = require('electron');
        const notif = new Notification({
            title: 'Meeting starting soon',
            body: `"${event.title}" starts in 2 minutes. Start Natively?`,
            actions: [
                { type: 'button', text: 'Start Meeting' },
                { type: 'button', text: 'Dismiss' }
            ],
            // Not silent: the OS's default sound. (`sound` names a macOS sound
            // file; `true` was never a valid value.)
        });
        // Electron drops a Notification nothing references; keep the latest.
        this.reminderNotification = notif;

        // Electron 43: the index is `details.actionIndex`; the positional one is deprecated.
        notif.on('action', (details: any, legacyIndex?: number) => {
            const index = typeof details?.actionIndex === 'number' ? details.actionIndex : legacyIndex;
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
    private lastEvents: CalendarEvent[] = [];
    private lastEventsAt = 0;
    /** Fetches Google answered; refreshState compares it (two can share a Date.now()). */
    private fetchesLanded = 0;

    public async getUpcomingEvents(force: boolean = false): Promise<CalendarEvent[]> {
        if (!this.isConnected || !this.accessToken) return [];

        // Check expiry
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }

        const now = Date.now();
        const events = await this.fetchEventsInternal(now, now + 7 * 24 * 60 * 60 * 1000);
        if (events) {
            this.lastEvents = events;
            this.lastEventsAt = now;
            this.fetchesLanded++;
        }
        this.scheduleReminders(events ?? []);
        // A failed fetch (offline, Google timing out) is not an empty week: the
        // Launcher and Settings keep showing the last list, less what has ended.
        if (!events) return this.lastEvents.filter((ev) => new Date(ev.endTime).getTime() > now);
        return events;
    }

    /** The last fetched list if it is no older than `maxAgeMs`, else null. */
    public getCachedEvents(maxAgeMs: number): CalendarEvent[] | null {
        if (!this.isConnected || this.lastEventsAt === 0) return null;
        return Date.now() - this.lastEventsAt <= maxAgeMs ? this.lastEvents : null;
    }

    /**
     * Events overlapping [fromMs, toMs], past ones included (a meeting's notes
     * offering which event it was). Schedules no reminders: this is not the
     * upcoming list.
     */
    public async getEventsBetween(fromMs: number, toMs: number): Promise<CalendarEvent[]> {
        if (!this.isConnected || !this.accessToken) return [];
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }
        return (await this.fetchEventsInternal(fromMs, toMs)) ?? [];
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

    // Background fetcher could go here if needed
    public async fetchUpcomingEvents() {
        // wrapper to just cache or trigger updates
        return this.getUpcomingEvents();
    }
}
