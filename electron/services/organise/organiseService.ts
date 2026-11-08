// organiseService.ts
//
// The app-side glue for folders, tags, people and companies: reads the shared
// database through OrganiseStore, knows who the user is (the connected
// calendar account), and runs the work that follows a meeting save:
//
//   1. people: who the meeting was with, merged by address (local, no model)
//   2. folders: file the meeting by every folder's rules (local, no model)
//   3. facts: one model call proposing titles and companies people stated,
//      only when the notes may be written at all (the same data scope), and
//      kept only as suggestions the user accepts.
//
// Nothing here runs on the live answer path, and nothing leaves the machine
// except step 3's call to the provider the user already uses for notes.

import { DatabaseManager } from '../../db/DatabaseManager';
import { OrganiseStore, type KnownPerson } from './OrganiseStore';
import { peopleInMeeting } from './people';
import { ruleFactsFromMeeting, type MeetingRuleFacts } from './folderRules';
import { extractPersonFacts, type FactLine } from './personFacts';
import { isSpokenSavedLine } from '../../intelligence/savedTranscriptOrigin';

let cached: { db: unknown; store: OrganiseStore } | null = null;

/** The store on the app's connection, or null before the database is open. */
export function organiseStore(): OrganiseStore | null {
  try {
    const db = DatabaseManager.getInstance().getDb();
    if (!db) return null;
    if (!cached || cached.db !== db) cached = { db, store: new OrganiseStore(db) };
    return cached.store;
  } catch {
    return null;
  }
}

/** The connected calendar account: the user, never listed as someone they met. */
export function currentUser(): { email?: string; name?: string } | null {
  try {
    const { CalendarManager } = require('../CalendarManager');
    const status = CalendarManager.getInstance().getConnectionStatus();
    if (!status?.connected) return null;
    return {
      ...(typeof status.email === 'string' ? { email: status.email } : {}),
      ...(typeof status.name === 'string' ? { name: status.name } : {}),
    };
  } catch {
    return null;
  }
}

/** Re-read who one saved meeting was with. Returns the person ids. */
export function indexMeetingPeople(meetingId: string, store: OrganiseStore | null = organiseStore(), user = currentUser()): string[] {
  if (!store) return [];
  const snap = store.meetingSnapshot(meetingId);
  if (!snap) return [];
  const refs = peopleInMeeting({
    calendarEvent: snap.calendarEvent,
    callParticipants: Array.isArray(snap.detailedSummary?.callParticipants) ? snap.detailedSummary.callParticipants : [],
    speakerLabels: snap.detailedSummary?.speakerLabels,
    user,
  });
  return store.indexMeetingPeople(meetingId, refs);
}

/** Index one batch of the meetings saved before this existed (or imported since). */
export function syncPeopleIndex(store: OrganiseStore | null = organiseStore(), limit = PEOPLE_INDEX_BATCH): number {
  if (!store) return 0;
  const user = currentUser();
  const ids = store.unindexedMeetingIds(limit);
  for (const id of ids) indexMeetingPeople(id, store, user);
  return ids.length;
}

/** Meetings indexed per batch: small enough that one batch never holds up the app. */
export const PEOPLE_INDEX_BATCH = 100;
/** A ceiling on batches in one run (5,000 meetings at a time), so a run always ends. */
const PEOPLE_INDEX_MAX_BATCHES = 50;

/** Hands control back to the event loop between batches, so IPC and windows stay responsive. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Index every meeting not yet indexed, in batches, yielding between them.
 * `onBatch` is called after each batch that indexed something (People and
 * Companies refresh then). A meeting that cannot be indexed (no longer
 * readable) is not retried in the same run, so the loop always finishes.
 */
export async function syncPeopleIndexInBatches(
  store: OrganiseStore | null = organiseStore(),
  opts: { batchSize?: number; maxBatches?: number; onBatch?: (indexedSoFar: number) => void; pause?: () => Promise<void>; user?: { email?: string; name?: string } | null } = {},
): Promise<number> {
  if (!store) return 0;
  const batchSize = Math.max(1, opts.batchSize ?? PEOPLE_INDEX_BATCH);
  const maxBatches = Math.max(1, opts.maxBatches ?? PEOPLE_INDEX_MAX_BATCHES);
  const pause = opts.pause ?? yieldToEventLoop;
  const user = opts.user === undefined ? currentUser() : opts.user;
  const tried = new Set<string>();
  let total = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    // Ask for more than one batch so ids that failed earlier do not hide new ones.
    const ids = store.unindexedMeetingIds(batchSize + tried.size).filter((id) => !tried.has(id)).slice(0, batchSize);
    if (ids.length === 0) break;
    for (const id of ids) {
      tried.add(id);
      try { indexMeetingPeople(id, store, user); } catch { /* skipped this run */ }
    }
    total += ids.length;
    try { opts.onBatch?.(total); } catch { /* a closing window */ }
    await pause();
  }
  return total;
}

let backgroundIndex: Promise<number> | null = null;

/**
 * The rest of the index after the first batch, in the background, one run at a
 * time: a second call while one runs joins it.
 */
export function indexRemainingPeopleInBackground(store: OrganiseStore | null, onBatch: () => void): Promise<number> {
  if (backgroundIndex) return backgroundIndex;
  backgroundIndex = syncPeopleIndexInBatches(store, { onBatch: () => onBatch() })
    .catch(() => 0)
    .finally(() => { backgroundIndex = null; });
  return backgroundIndex;
}

/** A saved meeting's facts for the folder rules. */
export function ruleFactsFor(meetingId: string, store: OrganiseStore | null = organiseStore()): MeetingRuleFacts | null {
  const snap = store?.meetingSnapshot(meetingId);
  return snap ? ruleFactsFromMeeting(snap) : null;
}

/** Transcript lines as the fact extractor reads them: who said it, by name where known. */
export function factLines(
  transcript: Array<{ speaker?: string; text?: string; speakerId?: string; origin?: string }>,
  labels: Record<string, string> | undefined | null,
): FactLine[] {
  const named = labels && typeof labels === 'object' ? labels : {};
  const out: FactLine[] = [];
  for (const seg of Array.isArray(transcript) ? transcript : []) {
    if (!seg || typeof seg.text !== 'string' || !seg.text.trim() || !isSpokenSavedLine(seg as any)) continue;
    const speaker = String(seg.speaker || '');
    let label: string;
    if (/^(user|me)$/i.test(speaker)) label = 'Me';
    else if (seg.speakerId && named[seg.speakerId]) label = named[seg.speakerId];
    else if (named.speaker_1 && !seg.speakerId) label = named.speaker_1;
    else label = 'Speaker 1';
    out.push({ label, text: seg.text });
  }
  return out;
}

export interface AfterSaveInput {
  meetingId: string;
  /** The mode detected from what was said (MeetingModeDetector), for "mode" rules. */
  detectedTemplateType?: string;
  transcript: Array<{ speaker?: string; text?: string; speakerId?: string; origin?: string }>;
  speakerLabels?: Record<string, string> | null;
  userNotes?: string;
  /** False when the notes may not be written (data scope): no model call then. */
  allowModel: boolean;
  /** The notes provider's extraction call. */
  call?: (system: string, context: string) => Promise<string>;
}

/**
 * Everything that follows a meeting save. Never throws; the local steps run
 * synchronously, the model call after them. Returns what it did, for logs/tests.
 */
export async function afterMeetingSaved(input: AfterSaveInput, store: OrganiseStore | null = organiseStore()): Promise<{ people: number; folders: string[]; facts: number }> {
  const result = { people: 0, folders: [] as string[], facts: 0 };
  if (!store) return result;
  try {
    const user = currentUser();
    result.people = indexMeetingPeople(input.meetingId, store, user).length;
    const snap = store.meetingSnapshot(input.meetingId);
    if (snap) result.folders = store.applyRulesToMeeting(input.meetingId, ruleFactsFromMeeting(snap, { detectedTemplateType: input.detectedTemplateType }));

    if (input.allowModel && input.call && (process.env.NATIVELY_PERSON_FACTS || '').toLowerCase() !== 'off') {
      const people = store.peopleOfMeeting(input.meetingId).filter((p) => p.name);
      if (people.length > 0) {
        const facts = await extractPersonFacts({
          lines: factLines(input.transcript, input.speakerLabels),
          userNotes: input.userNotes,
          people: people.map((p) => ({ name: p.name })),
          userName: user?.name,
        }, input.call);
        for (const f of facts) {
          const person = people.find((p) => p.name === f.person);
          if (person && store.addFact(person.id, input.meetingId, f.kind, f.value, f.quote)) result.facts++;
        }
      }
    }
  } catch (e: any) {
    console.warn('[organise] after-save step skipped (non-fatal):', e?.message || e);
  }
  return result;
}

/** What the notes prompt may say about the people on an invite (see OrganiseStore.knownPeopleByEmail). */
export function knownPeopleForEvent(event: { attendees?: Array<{ email?: string }> } | null | undefined): KnownPerson[] {
  const emails = (event?.attendees || []).map((a) => a?.email).filter((e): e is string => typeof e === 'string');
  if (emails.length === 0) return [];
  return organiseStore()?.knownPeopleByEmail(emails) ?? [];
}
