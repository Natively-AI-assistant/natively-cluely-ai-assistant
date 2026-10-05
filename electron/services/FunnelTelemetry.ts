/**
 * Funnel telemetry: the main-process half.
 *
 * What gets recorded and why is in src/lib/funnel/ (the catalogue, the queue,
 * the decisions). This file is only the Electron wiring around them: where the
 * queue and the state live on disk, when the timer runs, and the handful of
 * moments the main process reports for itself.
 *
 * WHO IT REPORTS FOR. Every install, with or without a key — that is the point
 * (see funnelClient.mjs) — and, since 2026-10-01, the PERSON behind it: events
 * carry the device id (the hardware id the app already sends for trials and
 * licences), and requests carry the trial token and Natively key the app
 * holds, from which the server works out the trial and the account.
 *
 * WHEN IT IS OFF
 *   - The user turned telemetry off (settings `telemetryEnabled: false`).
 *   - The build is not packaged. A development or agent launch must never
 *     report to production: `dev:agent` starts on fresh user data every time,
 *     and each launch would read as a new install. Set NATIVELY_FUNNEL_ENDPOINT
 *     to exercise the pipeline in development against a server of your own.
 *   - NATIVELY_FUNNEL_ENABLED=0 (development and terminal launches only; a
 *     packaged app inherits no environment — the server's FUNNEL_EVENTS_ENABLED
 *     is the switch that reaches a shipped fleet, and this queue holds through it).
 *
 * No platform branches: files go through app.getPath('userData') and node:path,
 * and the platform is reported as process.platform says it.
 */

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createFunnelClient, type FunnelClient, type FunnelTrackResult } from '../../src/lib/funnel/funnelClient.mjs';
import {
    normalizeFunnelState, isFirstRun, localDay, daysSince, minutesSince, type FunnelState,
} from '../../src/lib/funnel/funnelState.mjs';
import type { FunnelProps, FunnelEntitlement } from '../../src/lib/funnel/funnelCatalog.mjs';
import { tagCheckoutUrl } from '../../src/lib/funnel/checkoutLinks.mjs';
import { createInstallRegistrar, type InstallRegistrar } from '../../src/lib/funnel/funnelInstall.mjs';
import { getAppSessionId, usageFlagEnabled } from './UsageOutbox';
import { SettingsManager } from './SettingsManager';

const NATIVELY_API_URL = (process.env.NATIVELY_API_URL || 'https://api.natively.software').replace(/\/+$/, '');
const DISPATCH_INTERVAL_MS = 30_000;
// Nothing leaves, and the registration puzzle does not start, until the app
// has been up this long: launch belongs to the user.
const FIRST_TICK_MS = 30_000;
const MAX_STORED_TOKENS = 5;
const QUEUE_FILE = 'funnel_queue.json';
const STATE_FILE = 'funnel_state.json';

/** Who this is: the device, and the credentials the server can identify the account from. */
export interface FunnelIdentity {
    /** The hardware id; undefined when the machine has none. */
    deviceId?: string;
    trialToken?: string;
    /** The Natively API key. Never the trial sentinel. */
    apiKey?: string;
}

/** What the rest of the main process knows about this install right now. */
export interface FunnelSnapshot {
    entitlement: FunnelEntitlement;
    hasOwnAi: boolean;
    hasApiKey: boolean;
    hasPro: boolean;
    meetingAi: 'natively' | 'own' | 'none';
}

interface StoredState extends FunnelState {
    /** True when this install began life with this code: only then is "first" meaningful. */
    newInstall: boolean;
    /** The local day `featuresUsed` belongs to, and the features already reported for it. */
    featuresDay: string;
    featuresUsed: string[];
    /** Registration tokens the server issued, by install id (funnelInstall.mjs). */
    tokens: Record<string, string>;
}

export class FunnelTelemetry {
    private static instance: FunnelTelemetry | null = null;
    private client: FunnelClient | null = null;
    private snapshot: (() => FunnelSnapshot) | null = null;
    private identity: (() => FunnelIdentity) | null = null;
    private registrar: InstallRegistrar | null = null;
    private answersAtMeetingStart = 0;
    private timer: NodeJS.Timeout | null = null;
    private state: StoredState | null = null;
    private meetingStartedAt: number | null = null;
    private meetingWasFirst = false;

    public static getInstance(): FunnelTelemetry {
        if (!FunnelTelemetry.instance) FunnelTelemetry.instance = new FunnelTelemetry();
        return FunnelTelemetry.instance;
    }

    // ── Switches ─────────────────────────────────────────────────────────────

    private devEndpoint(): string | undefined {
        const v = process.env.NATIVELY_FUNNEL_ENDPOINT;
        return v && /^https?:\/\//.test(v) ? v : undefined;
    }

    public isEnabled(): boolean {
        try {
            if (!usageFlagEnabled(process.env.NATIVELY_FUNNEL_ENABLED)) return false;
            if (SettingsManager.getInstance().get('telemetryEnabled') === false) return false;
            return app.isPackaged || !!this.devEndpoint();
        } catch {
            return false;
        }
    }

    // ── Disk ─────────────────────────────────────────────────────────────────

    private file(name: string): string {
        return path.join(app.getPath('userData'), name);
    }

    private readText(name: string): string | null {
        try { return fs.readFileSync(this.file(name), 'utf-8'); } catch { return null; }
    }

    /** Write through a temporary file so a crash mid-write cannot leave half a queue. */
    private writeText(name: string, text: string): boolean {
        const target = this.file(name);
        try {
            const tmp = `${target}.tmp`;
            fs.writeFileSync(tmp, text, 'utf-8');
            fs.renameSync(tmp, target);
            return true;
        } catch {
            // A rename can be refused while another process holds the target
            // (an antivirus scan on Windows). Writing in place is worse than
            // atomic and better than losing the queue.
            try { fs.writeFileSync(target, text, 'utf-8'); return true; } catch { return false; }
        }
    }

    private loadState(): StoredState {
        if (!this.state) {
            let raw: any = null;
            try { raw = JSON.parse(this.readText(STATE_FILE) || 'null'); } catch { raw = null; }
            this.state = {
                ...normalizeFunnelState(raw),
                newInstall: raw?.newInstall === true,
                featuresDay: typeof raw?.featuresDay === 'string' ? raw.featuresDay : '',
                featuresUsed: Array.isArray(raw?.featuresUsed) ? raw.featuresUsed.filter((f: unknown) => typeof f === 'string').slice(0, 50) : [],
                tokens: raw?.tokens && typeof raw.tokens === 'object' && !Array.isArray(raw.tokens)
                    ? Object.fromEntries(Object.entries(raw.tokens).filter(([, v]) => typeof v === 'string').slice(-MAX_STORED_TOKENS)) as Record<string, string>
                    : {},
            };
        }
        return this.state;
    }

    private saveState(): void {
        if (this.state) this.writeText(STATE_FILE, JSON.stringify(this.state));
    }

    /**
     * The install id, read once per process. getOrCreateInstallId hands back a
     * NEW random id on every call when it cannot write the id file (a locked
     * profile, antivirus holding it), and one launch must not look like many
     * installs. UsageOutbox caches it for the same reason.
     */
    private cachedInstallId: string | undefined;
    private installId(): string | undefined {
        if (this.cachedInstallId) return this.cachedInstallId;
        try {
            this.cachedInstallId = require('./InstallPingManager').getOrCreateInstallId() || undefined;
        } catch {
            this.cachedInstallId = undefined;
        }
        return this.cachedInstallId;
    }

    /** When the install id file was created: the nearest thing to an install date. */
    private installCreatedAtMs(): number {
        try {
            // The id file is created on first use. Ask for the id first, so a
            // launch that reaches here before anything else has asked still
            // finds the file it is about to date.
            this.installId();
            const st = fs.statSync(this.file('install_id.txt'));
            return st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
        } catch {
            return NaN;
        }
    }

    // ── Registration ─────────────────────────────────────────────────────────

    /** Where a funnel endpoint's siblings live: `…/funnel` → `…/challenge`, `…/register`. */
    private endpoint(name: 'funnel' | 'challenge' | 'register'): string {
        const dev = this.devEndpoint();
        if (!dev) return `${NATIVELY_API_URL}/v1/telemetry/${name}`;
        return name === 'funnel' ? dev : new URL(name, dev).toString();
    }

    private getRegistrar(): InstallRegistrar {
        if (!this.registrar) {
            this.registrar = createInstallRegistrar({
                fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
                challengeEndpoint: this.endpoint('challenge'),
                registerEndpoint: this.endpoint('register'),
                sha256: (input) => createHash('sha256').update(input).digest(),
                now: () => Date.now(),
                // setImmediate, not a worker thread: the solver gives the main
                // thread back every few milliseconds, and nothing has to be
                // found inside a packaged app on either platform.
                yieldFn: () => new Promise<void>((resolve) => { setImmediate(resolve); }),
                sleep: (ms) => new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); }),
                isEnabled: () => this.isEnabled(),
                // Never during a meeting: it waits, and so do the events.
                shouldPause: () => this.meetingStartedAt !== null,
                loadToken: (installId) => this.loadState().tokens[installId],
                saveToken: (installId, token) => {
                    const st = this.loadState();
                    const kept = Object.entries(st.tokens).filter(([id]) => id !== installId).slice(-(MAX_STORED_TOKENS - 1));
                    st.tokens = Object.fromEntries([...kept, [installId, token]]);
                    this.saveState();
                },
                clearToken: (installId) => {
                    const st = this.loadState();
                    if (installId in st.tokens) { delete st.tokens[installId]; this.saveState(); }
                },
                log: console,
            });
        }
        return this.registrar;
    }

    // ── The queue ────────────────────────────────────────────────────────────

    private getClient(): FunnelClient {
        if (!this.client) {
            this.client = createFunnelClient({
                load: () => this.readText(QUEUE_FILE),
                save: (text) => this.writeText(QUEUE_FILE, text),
                fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
                endpoint: this.endpoint('funnel'),
                ensureInstallToken: (installId) => this.getRegistrar().ensureToken(installId),
                invalidateInstallToken: (installId) => this.getRegistrar().invalidate(installId),
                now: () => Date.now(),
                newId: () => randomUUID(),
                installId: () => this.installId(),
                appVersion: () => app.getVersion(),
                platform: process.platform,
                appSessionId: getAppSessionId(),
                isEnabled: () => this.isEnabled(),
                getEntitlement: () => this.snapshot?.().entitlement,
                deviceId: () => this.identity?.().deviceId,
                getCredentials: () => {
                    const who = this.identity?.();
                    return who ? { trialToken: who.trialToken, apiKey: who.apiKey } : undefined;
                },
                log: console,
            });
        }
        return this.client;
    }

    /** Record one event. Never throws. */
    public track(eventType: string, props?: FunnelProps): FunnelTrackResult {
        try { return this.getClient().track(eventType, props); } catch { return 'error'; }
    }

    /** ipcHandlers hands this in once it can answer; until then events carry no entitlement. */
    public setSnapshotResolver(fn: () => FunnelSnapshot): void {
        this.snapshot = () => {
            try { return fn(); } catch { return { entitlement: 'none', hasOwnAi: false, hasApiKey: false, hasPro: false, meetingAi: 'none' }; }
        };
    }

    /** ipcHandlers hands this in too: the device and the credentials, read fresh each time. */
    public setIdentityResolver(fn: () => FunnelIdentity): void {
        this.identity = () => {
            try { return fn() || {}; } catch { return {}; }
        };
    }

    public start(): void {
        try {
            if (this.timer) return;
            this.timer = setInterval(() => { void this.tick(); }, DISPATCH_INTERVAL_MS);
            this.timer.unref?.();
            // The first tick waits: launch belongs to the user, the resolvers
            // are set when the IPC handlers register, and the first tick may
            // start the one-time registration puzzle.
            const first = setTimeout(() => { void this.tick(); }, FIRST_TICK_MS);
            first.unref?.();
        } catch (e: any) {
            console.warn('[Funnel] start failed:', e?.message || e);
        }
    }

    public stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    public async tick(): Promise<void> {
        try {
            this.reportLifecycle();
            await this.getClient().dispatchOnce();
        } catch (e: any) {
            console.warn('[Funnel] tick failed:', e?.message || e);
        }
    }

    // ── What the main process reports for itself ─────────────────────────────

    /** First run, once; and one snapshot per local calendar day the app is open. */
    private reportLifecycle(): void {
        if (!this.isEnabled()) return;
        const st = this.loadState();
        const createdAt = this.installCreatedAtMs();
        const now = Date.now();
        let changed = false;
        if (!st.firstRunSent) {
            if (isFirstRun({ firstRunSent: false, installCreatedAtMs: createdAt, nowMs: now })) {
                st.newInstall = true;
                this.track('app_first_run');
            }
            // Decided once. An install that upgraded into this code is not new,
            // and must not become "new" on some later launch.
            st.firstRunSent = true;
            changed = true;
        }
        const day = localDay(now);
        if (st.lastActiveDay !== day && this.snapshot) {
            const s = this.snapshot();
            const queued = this.track('app_active_day', {
                days_since_install: daysSince(createdAt, now),
                has_own_ai: s.hasOwnAi,
                has_api_key: s.hasApiKey,
                has_pro: s.hasPro,
                meetings_total: st.meetings,
            });
            if (queued === 'queued') { st.lastActiveDay = day; changed = true; }
        }
        if (changed) this.saveState();
    }

    /**
     * @param answersSoFar how many answers the session log holds as the meeting
     *        starts; the meeting's own count is the difference at the end.
     */
    public meetingStarted(answersSoFar = 0): void {
        try {
            if (!this.isEnabled()) return;
            const st = this.loadState();
            st.meetings += 1;
            this.saveState();
            this.meetingStartedAt = Date.now();
            this.answersAtMeetingStart = Number.isInteger(answersSoFar) && answersSoFar > 0 ? answersSoFar : 0;
            this.meetingWasFirst = st.newInstall && st.meetings === 1;
            this.track('meeting_started', { first: this.meetingWasFirst, ai: this.snapshot?.().meetingAi ?? 'none' });
        } catch { /* never into a meeting */ }
    }

    /** @param answersNow the session log's answer count as the meeting ends. A count, never the answers. */
    public meetingEnded(answersNow?: number): void {
        try {
            if (this.meetingStartedAt === null) return;
            const minutes = minutesSince(this.meetingStartedAt, Date.now()) ?? 0;
            this.meetingStartedAt = null;
            const props: FunnelProps = { minutes, first: this.meetingWasFirst };
            if (Number.isInteger(answersNow)) {
                // The log is cleared when a meeting starts on some paths and not
                // on others; either way the meeting's own count is not negative.
                const n = (answersNow as number) >= this.answersAtMeetingStart
                    ? (answersNow as number) - this.answersAtMeetingStart
                    : (answersNow as number);
                props.answers = Math.max(0, n);
            }
            this.track('meeting_ended', props);
        } catch { /* never into a meeting */ }
    }

    /**
     * A feature was used. Reported at most once per feature per local day:
     * which features someone used that day, not how often.
     */
    public featureUsed(feature: string): FunnelTrackResult {
        try {
            if (!this.isEnabled()) return 'disabled';
            const st = this.loadState();
            const day = localDay(Date.now());
            if (st.featuresDay !== day) { st.featuresDay = day; st.featuresUsed = []; }
            if (st.featuresUsed.includes(feature)) return 'duplicate';
            const result = this.track('feature_used', { feature });
            if (result === 'queued') { st.featuresUsed.push(feature); this.saveState(); }
            return result;
        } catch {
            return 'error';
        }
    }

    public trialStarted(): void {
        try { const st = this.loadState(); st.trialStartedAt = Date.now(); this.saveState(); } catch { /* best effort */ }
    }

    public byokExited(): void {
        try { const st = this.loadState(); st.byokExitAt = Date.now(); this.saveState(); } catch { /* best effort */ }
    }

    /** A key or licence was entered. The two ages make "left through own keys, then paid" countable. */
    public keyEntered(kind: 'api_key' | 'pro_licence', result: 'ok' | 'invalid' | 'network' | 'error'): void {
        try {
            const st = this.loadState();
            const now = Date.now();
            const props: FunnelProps = { kind, result };
            const sinceTrial = minutesSince(st.trialStartedAt, now);
            const sinceByok = minutesSince(st.byokExitAt, now);
            if (sinceTrial !== undefined) props.mins_since_trial_start = sinceTrial;
            if (sinceByok !== undefined) props.mins_since_byok_exit = sinceByok;
            this.track('key_entered', props);
        } catch { /* best effort */ }
    }

    /**
     * Attribution for a link that is about to leave the app. Returns the URL to
     * open: unchanged unless it is a checkout link and telemetry is on.
     */
    public tagOutgoingUrl(url: string, surface?: string): { url: string; checkout: boolean; product: string | null; surface: string } {
        const where = typeof surface === 'string' && /^[a-z0-9_]{1,40}$/.test(surface) ? surface : 'other';
        try {
            if (!this.isEnabled()) return { url, checkout: false, product: null, surface: where };
            const tagged = tagCheckoutUrl(url, { installId: this.installId(), surface: where });
            return { ...tagged, surface: where };
        } catch {
            return { url, checkout: false, product: null, surface: where };
        }
    }

    /**
     * Open a link that is leaving the app, tagged and counted when it is a
     * checkout link. For the paths that do not go through the 'open-external'
     * IPC — a target="_blank" link caught by the window-open handler — so a
     * purchase started there is not an unattributed one.
     *
     * `open` is the platform's opener (shell.openExternal). Resolves whether
     * it opened; never throws, and the link opens whatever telemetry does.
     */
    public async openOutgoing(url: string, surface: string | undefined, open: (url: string) => Promise<unknown>): Promise<boolean> {
        const tagged = this.tagOutgoingUrl(url, surface);
        let opened = true;
        try { await open(tagged.url); } catch { opened = false; }
        if (tagged.checkout) {
            this.track('checkout_opened', { ...(tagged.product ? { product: tagged.product } : {}), surface: tagged.surface, opened });
        }
        return opened;
    }

    public getStats(): Record<string, unknown> {
        try { return { enabled: this.isEnabled(), ...this.getClient().stats(), install: this.getRegistrar().stats() }; } catch { return { enabled: false }; }
    }
}

export const funnelTelemetry = FunnelTelemetry.getInstance();
