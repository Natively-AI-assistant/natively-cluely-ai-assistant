// backToBack.ts
//
// A catch-up after back-to-back meetings: when the user has just come out of
// two or more meetings with short gaps between them (under 15 minutes by
// default), one card collects what was decided and what the user took on,
// across all of them. Nothing is sent anywhere and no model is called: the
// card is read from the notes already written.
//
// The block offered is the latest one, and only once it is over: no meeting
// running, every meeting in it with its notes written (one still being written
// waits for the next check), and it ended within the last 12 hours.
//
// Pure, no I/O, no platform branches.

import { ownerIsUser, type UserIdentity } from './assistPeople';
import { clip, latestTaskStates, meetingTitle, notesReady, readDecisions, type AssistMeeting } from './assistNotes';

export const DEFAULT_CATCH_UP_GAP_MINUTES = 15;
export const CATCH_UP_LOOKBACK_MS = 12 * 60 * 60 * 1000;
/** A meeting shorter than this is a false start, not a meeting in the block. */
const MIN_MEETING_MS = 2 * 60 * 1000;

export interface CatchUpBlock {
  /** The block's meetings' ids, oldest first, joined: what "dismissed" is stored under. */
  key: string;
  meetings: AssistMeeting[];
  startMs: number;
  endMs: number;
}

export interface CatchUp {
  key: string;
  meetings: Array<{ id: string; title: string; startMs: number }>;
  decisions: Array<{ text: string; meetingId: string; meetingTitle: string }>;
  yourActions: Array<{ text: string; meetingId: string; meetingTitle: string; deadline?: string }>;
}

/** The gap setting, read safely: 1 to 60 minutes, else the default. */
export function catchUpGapMs(minutes: unknown): number {
  const n = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round(minutes) : DEFAULT_CATCH_UP_GAP_MINUTES;
  return Math.min(60, Math.max(1, n)) * 60 * 1000;
}

const endOf = (m: AssistMeeting) => m.startMs + Math.max(0, Number(m.durationMs) || 0);

export function findCatchUpBlock(meetings: AssistMeeting[], opts: { nowMs: number; gapMs: number; meetingActive: boolean; lookbackMs?: number }): CatchUpBlock | null {
  if (opts.meetingActive) return null;
  const lookback = opts.lookbackMs ?? CATCH_UP_LOOKBACK_MS;
  const recent = meetings
    .filter((m) => m && Number.isFinite(m.startMs) && (Number(m.durationMs) || 0) >= MIN_MEETING_MS && endOf(m) <= opts.nowMs && opts.nowMs - endOf(m) <= lookback * 2)
    .sort((a, b) => a.startMs - b.startMs);
  if (recent.length < 2) return null;

  // Walk back from the newest meeting while each gap is short.
  const block: AssistMeeting[] = [recent[recent.length - 1]];
  for (let i = recent.length - 2; i >= 0; i--) {
    const gap = block[0].startMs - endOf(recent[i]);
    if (gap < opts.gapMs) block.unshift(recent[i]);
    else break;
  }
  if (block.length < 2) return null;
  const endMs = Math.max(...block.map(endOf));
  if (opts.nowMs - endMs > lookback) return null;
  if (!block.every(notesReady)) return null;
  return { key: block.map((m) => m.id).join('|'), meetings: block, startMs: block[0].startMs, endMs };
}

export function buildCatchUp(block: CatchUpBlock, identity: UserIdentity): CatchUp | null {
  const decisions: CatchUp['decisions'] = [];
  const yourActions: CatchUp['yourActions'] = [];
  for (const m of block.meetings) {
    const title = meetingTitle(m);
    for (const d of readDecisions(m.detailedSummary).slice(0, 4)) {
      decisions.push({ text: clip(d, 160), meetingId: m.id, meetingTitle: title });
    }
  }
  // The user's tasks at their newest state across the whole block
  // (assistNotes.latestTaskStates): one raised in the first meeting and closed
  // in a related later one is not listed, one repeated is listed once, and the
  // same words done in an unrelated meeting of the block close nothing.
  for (const st of latestTaskStates(block.meetings, (a) => (ownerIsUser(a.owner, identity) ? 'user' : null), { selfEmails: identity.emails }).values()) {
    if (st.done) continue;
    yourActions.push({ text: clip(st.action.text, 160), meetingId: st.meeting.id, meetingTitle: meetingTitle(st.meeting), ...(st.action.deadline ? { deadline: st.action.deadline } : {}) });
  }
  if (decisions.length === 0 && yourActions.length === 0) return null;
  return {
    key: block.key,
    meetings: block.meetings.map((m) => ({ id: m.id, title: meetingTitle(m), startMs: m.startMs })),
    decisions: decisions.slice(0, 8),
    yourActions: yourActions.slice(0, 10),
  };
}
