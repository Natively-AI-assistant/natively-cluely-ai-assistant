// Launcher memory search — turns recalled Hindsight memories into rows the search pill
// can show (2026-09-25).
//
// Post-meeting retain tags each summary `meeting:<id>` (HindsightTagBuilder.retainTags);
// a recalled fact that carries that tag links back to the saved meeting, so its row can
// open it. A fact without the tag, or whose meeting is gone, still shows — as text only.
// Whether a real Hindsight server copies a document's tags onto the facts it extracts
// is not verified; unlinked rows are the designed fallback, not an error.
import type { RecalledMemory } from './MemoryProvider';

export interface MemorySearchHit {
  text: string;
  /** Present only when the memory links to a meeting that still exists. */
  meetingId?: string;
  meetingTitle?: string;
  /** The meeting's date when linked, else when the memory happened (ISO). */
  date?: string;
}

export interface MeetingHeadline { id: string; title: string; date: string }

const MEETING_TAG = 'meeting:';

/** The meeting ids a set of memories is tagged with (deduplicated, in order). */
export function meetingIdsFromMemories(memories: RecalledMemory[]): string[] {
  const ids: string[] = [];
  for (const m of memories) {
    const id = meetingTagOf(m);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * One row per distinct memory text, at most `limit`, linked to its meeting when the
 * meeting is among `meetings`. Retain tags carry the id sanitised (lowercased, see
 * sanitizeTagValue); meeting ids are crypto.randomUUID(), which sanitising leaves as is.
 */
export function linkMemoriesToMeetings(memories: RecalledMemory[], meetings: MeetingHeadline[], limit = 3): MemorySearchHit[] {
  const byId = new Map(meetings.map((m) => [m.id.toLowerCase(), m]));
  const seen = new Set<string>();
  const hits: MemorySearchHit[] = [];
  for (const m of memories) {
    const text = String(m?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const tagged = meetingTagOf(m);
    const meeting = tagged ? byId.get(tagged) : undefined;
    hits.push(meeting
      ? { text, meetingId: meeting.id, meetingTitle: meeting.title || undefined, date: meeting.date || undefined }
      : { text, ...(m.date ? { date: m.date } : {}) });
    if (hits.length >= limit) break;
  }
  return hits;
}

function meetingTagOf(m: RecalledMemory): string | null {
  const tag = (m?.tags || []).find((t) => typeof t === 'string' && t.startsWith(MEETING_TAG));
  const id = tag ? tag.slice(MEETING_TAG.length).trim().toLowerCase() : '';
  return id || null;
}
