// AssistService.ts
//
// The assist features' one owner in the main process: it reads the saved
// meetings, keeps the little local state they need (ticked items, dismissed
// catch-ups, cached talking points: the database's app_state key/value
// table, no new schema), and holds the "Last time" recap of the meeting that
// is running.
//
//   Daily brief                  dailyBrief.ts, no model
//   Brief me (pre-meeting)       meetingBrief.ts; talking points by the model
//                                only on the button, only when the notes may
//                                go to the configured model, cached per event
//   Catch-up after back-to-back  backToBack.ts, no model; Settings › Calendar
//   Last time, at meeting start  recurringMeetings.ts, no model; looked up
//                                after the start returns (the calendar link
//                                can land seconds later), sent to the overlay
//                                and the notes window once
//
// Everything is injected (AssistDeps), so tests run it without Electron, a
// database or a model. No platform branches: nothing here touches the OS.

import { getLastTimeRecap, type LastTimeRecap } from '../meeting/recurringMeetings';
import type { UserIdentity } from './assistPeople';
import type { AssistMeeting } from './assistNotes';
import { buildCatchUp, catchUpGapMs, findCatchUpBlock, type CatchUp } from './backToBack';
import { buildDailyBrief, type DailyBrief } from './dailyBrief';
import {
  assembleMeetingBrief, briefInputHash, briefPromptInput,
  BRIEF_LOOKBACK_DAYS, BRIEF_MAX_EMAILS, BRIEF_TALKING_POINTS_SHAPE, BRIEF_TALKING_POINTS_SYSTEM, validateTalkingPoints,
  type BriefEmail, type BriefEvent, type MeetingBrief,
} from './meetingBrief';
import { owedItemKey, type DoneMap } from './owedItems';

const DAY_MS = 24 * 60 * 60 * 1000;

export const KV_OWED_DONE = 'assist.owedDone';
export const KV_CATCH_UP_DISMISSED = 'assist.catchUpDismissed';
export const KV_BRIEF_CACHE = 'assist.briefCache';
const BRIEF_CACHE_MAX = 40;
const DISMISSED_MAX = 30;

/** When the start-of-meeting recap looks for the calendar link, after the start (ms). */
export const LIVE_RECAP_CHECKS_MS = [0, 2_000, 6_000, 15_000, 45_000, 120_000, 300_000, 600_000];

export type LiveRecapPayload = { recap: LastTimeRecap; eventTitle?: string } | null;

/** Why a brief has no model-written talking points. */
export type TalkingPointsSkip = 'privacy' | 'no-model' | 'failed';

export interface AssistDeps {
  /** Saved meetings that started at or after `sinceMs`, newest first (DatabaseManager.getMeetingsWithNotesSince). */
  loadMeetings(sinceMs: number): AssistMeeting[];
  kvGet(key: string): string | null;
  kvSet(key: string, value: string): void;
  identity(): UserIdentity;
  /** Settings reads: assistCatchUpEnabled, assistCatchUpGapMinutes. */
  setting(key: string): unknown;
  meetingActive(): boolean;
  /**
   * The notes may go to the model the user configured: the "post-call
   * summary" data scope is not turned off, or the model is local. When false,
   * every model part is skipped and the lists still show.
   */
  modelAllowed(): boolean;
  /** One small JSON call through the app's provider routing (generateStructured). Null when no model answered. */
  generateTalkingPoints?(system: string, user: string, shape: string, validate: typeof validateTalkingPoints): Promise<string[] | null>;
  /**
   * Recent email threads with these addresses (Gmail, when connected and its
   * brief switch is on: outputs/gmailIpc.gmailBriefContext). [] for none;
   * never expected to throw, but a throw is treated as none.
   */
  recentEmails?(emails: string[]): Promise<BriefEmail[]>;
  /** To every window that listens (the overlay and the notes window). */
  broadcast(channel: string, payload: unknown): void;
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

function readJson<T>(deps: AssistDeps, key: string, fallback: T): T {
  try {
    const raw = deps.kvGet(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

export class AssistService {
  private liveRecap: LiveRecapPayload = null;
  private liveRecapDismissed = false;
  private liveTimers: unknown[] = [];
  private liveToken = 0;

  constructor(private readonly deps: AssistDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private meetings(days: number): AssistMeeting[] {
    try {
      const rows = this.deps.loadMeetings(this.now() - days * DAY_MS);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  private done(): DoneMap {
    return readJson<DoneMap>(this.deps, KV_OWED_DONE, {});
  }

  // ── Daily brief ───────────────────────────────────────────────

  getDailyBrief(events: BriefEvent[]): DailyBrief {
    return buildDailyBrief({
      events: sanitizeEvents(events),
      meetings: this.meetings(BRIEF_LOOKBACK_DAYS),
      identity: this.deps.identity(),
      nowMs: this.now(),
    });
  }

  // ── Brief me ──────────────────────────────────────────────────────────────

  /**
   * The brief for one upcoming event. The lists are rebuilt each time (local
   * reads only). The talking points are the model's when it is allowed and
   * answered, cached per event until what they were written from changes;
   * `refresh` asks again.
   */
  async getMeetingBrief(event: BriefEvent, opts: { refresh?: boolean } = {}): Promise<MeetingBrief & { modelSkipped?: TalkingPointsSkip }> {
    const [clean] = sanitizeEvents([event]);
    if (!clean) throw new Error('This event could not be read.');
    const brief = assembleMeetingBrief({
      event: clean,
      meetings: this.meetings(BRIEF_LOOKBACK_DAYS),
      identity: this.deps.identity(),
      nowMs: this.now(),
      done: this.done(),
    });
    if (this.deps.recentEmails && brief.people.length) {
      const emails = await this.loadRecentEmails(brief.people.map((p) => p.email));
      if (emails.length) brief.recentEmails = emails;
    }
    const input = briefPromptInput(brief, clean.description);
    const hash = briefInputHash(input);
    const cache = readJson<Record<string, { hash: string; points: string[]; at: number }>>(this.deps, KV_BRIEF_CACHE, {});
    const hit = cache[clean.id];
    if (hit && hit.hash === hash && Array.isArray(hit.points) && hit.points.length && !opts.refresh) {
      return { ...brief, talkingPoints: hit.points, talkingPointsFrom: 'model' };
    }
    // Nothing worth writing about: the points from the items stand (no call).
    if (brief.people.every((p) => !p.lastMet) && !brief.lastTime && brief.yourOpenItems.length === 0 && !brief.recentEmails?.length) return brief;
    if (!this.deps.modelAllowed()) return { ...brief, modelSkipped: 'privacy' };
    if (!this.deps.generateTalkingPoints) return { ...brief, modelSkipped: 'no-model' };
    let points: string[] | null = null;
    try {
      points = await this.deps.generateTalkingPoints(BRIEF_TALKING_POINTS_SYSTEM, input, BRIEF_TALKING_POINTS_SHAPE, validateTalkingPoints);
    } catch {
      points = null;
    }
    if (!points || points.length === 0) return { ...brief, modelSkipped: 'failed' };
    const next = { ...cache, [clean.id]: { hash, points, at: this.now() } };
    const keys = Object.keys(next).sort((a, b) => (next[b].at || 0) - (next[a].at || 0));
    for (const k of keys.slice(BRIEF_CACHE_MAX)) delete next[k];
    this.deps.kvSet(KV_BRIEF_CACHE, JSON.stringify(next));
    return { ...brief, talkingPoints: points, talkingPointsFrom: 'model' };
  }

  /** The brief's emails, bounded and with plain strings only. */
  private async loadRecentEmails(addresses: string[]): Promise<BriefEmail[]> {
    let rows: unknown;
    try {
      rows = await this.deps.recentEmails!(addresses);
    } catch {
      return [];
    }
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => r && typeof r === 'object')
      .slice(0, BRIEF_MAX_EMAILS)
      .map((r: any) => ({ subject: s(r.subject, 200), from: s(r.from, 200), date: s(r.date, 64), snippet: s(r.snippet, 300) }))
      .filter((r) => r.subject || r.snippet);
  }

  // ── Catch-up after back-to-back meetings ──────────────────────────────────

  catchUpEnabled(): boolean {
    return this.deps.setting('assistCatchUpEnabled') !== false;
  }

  getCatchUp(): CatchUp | null {
    if (!this.catchUpEnabled()) return null;
    const block = findCatchUpBlock(this.meetings(2), {
      nowMs: this.now(),
      gapMs: catchUpGapMs(this.deps.setting('assistCatchUpGapMinutes')),
      meetingActive: this.deps.meetingActive(),
    });
    if (!block) return null;
    const dismissed = readJson<string[]>(this.deps, KV_CATCH_UP_DISMISSED, []);
    if (Array.isArray(dismissed) && dismissed.includes(block.key)) return null;
    return buildCatchUp(block, this.deps.identity());
  }

  dismissCatchUp(key: string): void {
    if (typeof key !== 'string' || !key) return;
    const list = readJson<string[]>(this.deps, KV_CATCH_UP_DISMISSED, []);
    const next = [key, ...(Array.isArray(list) ? list.filter((k) => k !== key) : [])].slice(0, DISMISSED_MAX);
    this.deps.kvSet(KV_CATCH_UP_DISMISSED, JSON.stringify(next));
  }

  // ── Last time, when a meeting starts ──────────────────────────────────────

  /**
   * Called once a meeting has started (never awaited by the start). Looks for
   * the calendar link on the session's metadata (SessionCalendarLinker fills
   * it in place, sometimes seconds later) on a short schedule, and as soon as
   * there is one with an earlier meeting of the series, sends the recap once.
   * `isCurrent` turns false when the meeting ends or another starts.
   */
  noteMeetingStarted(metadata: any, isCurrent: () => boolean): void {
    this.noteMeetingEnded();
    const token = ++this.liveToken;
    const setTimer = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const alive = () => token === this.liveToken && isCurrent();
    const check = () => {
      if (!alive() || this.liveRecap || this.liveRecapDismissed) return true;
      const eventId: string | undefined = metadata?.calendarEvent?.id || metadata?.calendarEventId;
      if (!eventId) return false;
      const ev = metadata?.calendarEvent;
      const recap = getLastTimeRecap(ev?.recurringEventId || eventId, {
        nowMs: this.now(),
        calendarEvent: ev ? { ...ev, id: ev.id || eventId } : { id: eventId },
        loadCandidates: () => this.meetings(365).filter((m) => !!m.calendarEventId || !!m.calendarEvent),
      });
      if (!recap) return !!ev; // linked with no earlier meeting: stop looking
      this.liveRecap = { recap, ...(ev?.title ? { eventTitle: String(ev.title) } : {}) };
      this.deps.broadcast('assist:last-time-recap', this.liveRecap);
      return true;
    };
    for (const delay of LIVE_RECAP_CHECKS_MS) {
      const handle = setTimer(() => {
        if (!alive()) return;
        if (check()) this.clearLiveTimers();
      }, delay);
      this.liveTimers.push(handle);
    }
  }

  noteMeetingEnded(): void {
    this.liveToken++;
    this.clearLiveTimers();
    const had = this.liveRecap !== null;
    this.liveRecap = null;
    this.liveRecapDismissed = false;
    if (had) this.deps.broadcast('assist:last-time-recap', null);
  }

  private clearLiveTimers(): void {
    const clear = this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as any));
    for (const h of this.liveTimers) {
      try { clear(h); } catch { /* already fired */ }
    }
    this.liveTimers = [];
  }

  getLiveRecap(): LiveRecapPayload {
    return this.liveRecapDismissed ? null : this.liveRecap;
  }

  dismissLiveRecap(): void {
    this.liveRecapDismissed = true;
    this.deps.broadcast('assist:last-time-recap', null);
  }
}

/** Events from the renderer, kept to the fields the briefs read, with bounded strings. */
export function sanitizeEvents(events: unknown): BriefEvent[] {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const out: BriefEvent[] = [];
  for (const e of Array.isArray(events) ? events.slice(0, 100) : []) {
    if (!e || typeof e !== 'object') continue;
    const id = s((e as any).id, 512);
    const startTime = s((e as any).startTime, 64);
    if (!id || !startTime || !Number.isFinite(Date.parse(startTime))) continue;
    const attendees = (Array.isArray((e as any).attendees) ? (e as any).attendees : [])
      .slice(0, 100)
      .filter((a: any) => a && typeof a.email === 'string')
      .map((a: any) => ({ email: a.email.slice(0, 320), ...(s(a.name, 200) ? { name: s(a.name, 200) } : {}), ...(s(a.response, 32) ? { response: s(a.response, 32) } : {}) }));
    const org = (e as any).organizer;
    out.push({
      id,
      startTime,
      ...(s((e as any).title, 500) ? { title: s((e as any).title, 500) } : {}),
      ...(s((e as any).endTime, 64) ? { endTime: s((e as any).endTime, 64) } : {}),
      attendees,
      ...(s((e as any).recurringEventId, 512) ? { recurringEventId: s((e as any).recurringEventId, 512) } : {}),
      ...(org && typeof org === 'object' ? { organizer: { ...(s(org.email, 320) ? { email: s(org.email, 320) } : {}), ...(s(org.name, 200) ? { name: s(org.name, 200) } : {}), self: org.self === true } } : {}),
      ...(s((e as any).description, 2000) ? { description: s((e as any).description, 2000) } : {}),
    });
  }
  return out;
}

export { owedItemKey };

// ── The app's instance ──────────────────────────────────────────────────────

let instance: AssistService | null = null;

export function configureAssistService(deps: AssistDeps): AssistService {
  instance = new AssistService(deps);
  return instance;
}

export function getAssistService(): AssistService | null {
  return instance;
}
