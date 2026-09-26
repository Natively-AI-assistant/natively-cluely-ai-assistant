import { app, safeStorage, shell } from 'electron';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

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
                if (qs.get('state') !== state) {
                    res.end('Authentication failed! You can close this window.');
                    finish(() => reject(new Error('Calendar sign-in returned an unexpected state. Please try again.')));
                    return;
                }
                if (error) {
                    res.end('Authentication failed! You can close this window.');
                    finish(() => reject(new Error(error)));
                    return;
                }
                try {
                    await this.exchangeCodeForToken(code!, codeVerifier, redirectUri);
                    res.end('Authentication successful! You can close this window and return to Natively.');
                    finish(() => resolve());
                } catch (err) {
                    res.end('Authentication failed! You can close this window.');
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

    public async refreshState(): Promise<void> {
        console.log('[CalendarManager] Refreshing state (Reality Reconciliation)...');

        // 1. Reset Soft Heuristics
        // Clear existing reminder timeouts to prevent double scheduling or stale alerts
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        // 2. Calendar Re-sync & Temporal Re-evaluation
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

    private showNotification(event: CalendarEvent) {
        const { Notification } = require('electron');
        const notif = new Notification({
            title: 'Meeting starting soon',
            body: `"${event.title}" starts in 2 minutes. Start Natively?`,
            actions: [
                { type: 'button', text: 'Start Meeting' },
                { type: 'button', text: 'Dismiss' }
            ],
            sound: true
        });

        notif.on('action', (event_unused: any, index: number) => {
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

    public async getUpcomingEvents(force: boolean = false): Promise<CalendarEvent[]> {
        if (!this.isConnected || !this.accessToken) return [];

        // Check expiry
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }

        const events = await this.fetchEventsInternal();
        this.scheduleReminders(events);
        return events;
    }

    private async fetchEventsInternal(): Promise<CalendarEvent[]> {
        if (!this.accessToken) return [];

        const now = new Date();
        const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        try {
            const params = new URLSearchParams({
                timeMin: now.toISOString(),
                timeMax: horizon.toISOString(),
                singleEvents: 'true',
                orderBy: 'startTime',
                maxResults: '50',
            });
            const calendarIds = await this.syncedCalendarIds();
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
                    return [];
                }
                const data = await response.json() as any;
                return (data.items || []) as any[];
            }));

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
            console.log(`[CalendarManager] Google returned ${items.length} raw items in next 7 days across ${calendarIds.length} calendar(s)`);

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
                    source: 'google' as const,
                    attendees: Array.isArray(item.attendees)
                        ? item.attendees
                            .filter((a: any) => !a.self && !a.resource && a.email)
                            .slice(0, 8)
                            .map((a: any) => ({
                                email: a.email,
                                name: a.displayName,
                                response: a.responseStatus,
                            }))
                        : undefined,
                }))
                // Each calendar comes back in order; the merge does not.
                .sort((a: CalendarEvent, b: CalendarEvent) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

        } catch (error) {
            console.error('[CalendarManager] Failed to fetch events:', error);
            return [];
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
        if (!entries.length) return [{ id: 'primary', name: this.accountEmail || 'Primary calendar', primary: true }];
        return entries.map((c) => ({
            id: c.id,
            name: c.summaryOverride || c.summary || c.id,
            primary: !!c.primary,
            ...(typeof c.backgroundColor === 'string' ? { color: c.backgroundColor } : {}),
        }));
    }

    private async syncedCalendarIds(): Promise<string[]> {
        const entries = await this.syncedCalendarEntries();
        return entries.length ? entries.map((c) => c.id as string) : ['primary'];
    }

    /**
     * Calendar-list entries for the calendars ticked in Google Calendar,
     * primary first. Empty when the list is unavailable, e.g. the
     * calendar-list permission was unticked at consent; callers then use the
     * primary calendar alone.
     */
    private async syncedCalendarEntries(): Promise<any[]> {
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
            return [];
        }
    }

    // Intelligent Link Extraction
    private resolveMeetingLink(item: any): string | undefined {
        // 1. Prefer explicit Hangout link (Google Meet) if valid
        if (item.hangoutLink) return item.hangoutLink;

        // 2. Parse description for other providers
        if (!item.description) return undefined;

        return this.extractMeetingLink(item.description);
    }

    private extractMeetingLink(description: string): string | undefined {
        // Regex for common meeting providers
        // Matches zoom.us, teams.microsoft.com, meet.google.com, webex.com
        const providerRegex = /(https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)\/[^\s<>"']+)/gi;

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
