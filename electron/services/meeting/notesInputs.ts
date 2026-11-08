// notesInputs.ts
//
// Puts together what the notes prompts carry besides the transcript, from the
// sources MeetingPersistence holds: the linked event's snapshot, the user's
// account and (when allowed) profile, the names the meeting app reported, the
// earlier meetings of the same series, and the user's own notes / spelling list.
//
// Pure: every source is passed in, so the save path and Regenerate build the
// same inputs and the tests need no database.

import type { CalendarEventSnapshot } from '../calendar/calendarSessionMatch';
import { buildMeetingPeopleContext, formatMeetingPeopleBlock, type KnownPersonInput, type MeetingPeopleContext } from './meetingNotesContext';
import { findPreviousSeriesMeeting, formatLastTimeBlock, type SeriesCandidate } from './recurringMeetings';

export interface NotesInputsSource {
  meetingId: string;
  title?: string;
  /** The session's start (ms). */
  startMs: number;
  nowMs: number;
  /** The machine's IANA zone, used when the event carries none. */
  timeZone?: string;
  calendarEvent?: CalendarEventSnapshot | null;
  user?: { name?: string; email?: string } | null;
  profile?: { role?: string; company?: string } | null;
  callParticipants?: string[];
  /** Titles, companies and the user's notes from the People pages (accepted values only). */
  knownPeople?: KnownPersonInput[];
  /** Earlier meetings to look through for the previous one of this series. */
  seriesCandidates?: SeriesCandidate[];
  userNotes?: string;
  vocabulary?: string[];
}

export interface NotesInputs {
  people: MeetingPeopleContext | null;
  meetingContextBlock: string;
  lastTimeBlock: string;
  /** Id of the previous meeting of the series the block came from, for logs. */
  previousMeetingId?: string;
  userNotes?: string;
  vocabulary?: string[];
  /** For MeetingModeDetector: attendee and call names (no addresses). */
  participantNames: string[];
  /** For MeetingModeDetector: the invite's addresses (declined left out), for its domain signals. */
  participantEmails: string[];
}

export function buildNotesInputs(src: NotesInputsSource): NotesInputs {
  const people = buildMeetingPeopleContext({
    calendarEvent: src.calendarEvent ?? null,
    meetingStartMs: src.startMs,
    nowMs: src.nowMs,
    timeZone: src.timeZone,
    user: src.user ?? null,
    profile: src.profile ?? null,
    callParticipants: src.callParticipants,
    knownPeople: src.knownPeople,
  });
  const previous = src.calendarEvent && Array.isArray(src.seriesCandidates) && src.seriesCandidates.length
    ? findPreviousSeriesMeeting({
        meetingId: src.meetingId,
        calendarEvent: src.calendarEvent,
        calendarEventId: src.calendarEvent.id,
        title: src.title,
        startMs: src.startMs,
      }, src.seriesCandidates)
    : null;
  const participantNames = [
    ...(src.calendarEvent?.attendees || []).filter(a => a?.response !== 'declined').map(a => (a?.name || '').trim()).filter(Boolean),
    ...(src.callParticipants || []).map(n => String(n || '').trim()).filter(Boolean),
  ];
  return {
    people,
    meetingContextBlock: formatMeetingPeopleBlock(people),
    lastTimeBlock: formatLastTimeBlock(previous, { timeZone: src.calendarEvent?.timeZone || src.timeZone }),
    ...(previous ? { previousMeetingId: previous.id } : {}),
    ...(typeof src.userNotes === 'string' && src.userNotes.trim() ? { userNotes: src.userNotes } : {}),
    ...(Array.isArray(src.vocabulary) && src.vocabulary.length ? { vocabulary: src.vocabulary } : {}),
    participantNames: [...new Set(participantNames)].slice(0, 50),
    participantEmails: [...new Set((src.calendarEvent?.attendees || [])
      .filter(a => a?.response !== 'declined')
      .map(a => (typeof a?.email === 'string' ? a.email.trim().toLowerCase() : ''))
      .filter(Boolean))].slice(0, 100),
  };
}
