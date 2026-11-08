// The assist features as the renderer sees them. Structural mirrors of
// electron/services/assist/* (the renderer never imports from electron/*).

export interface AssistLastTimeRecap {
  meetingId: string;
  /** ISO time the previous meeting started. */
  date: string;
  title: string;
  bullets: string[];
}

export type AssistLiveRecap = { recap: AssistLastTimeRecap; eventTitle?: string } | null;

export interface AssistOwedItem {
  key: string;
  text: string;
  owner?: string;
  deadline?: string;
  dueMs: number | null;
  overdue: boolean;
  meetingId: string;
  meetingTitle: string;
  meetingStartMs: number;
  sinceMs: number;
}

export interface AssistDailyBriefMeeting {
  eventId: string;
  title: string;
  startTime: string;
  endTime?: string;
  attendeeCount: number;
  recurring: boolean;
  context: string | null;
  contextMeetingId: string | null;
}

export interface AssistDailyBrief {
  meetings: AssistDailyBriefMeeting[];
}

export interface AssistBriefPerson {
  email: string;
  name: string;
  lastMet: { meetingId: string; title: string; startMs: number } | null;
  meetingsCount: number;
  theirOpenItems: Array<{ text: string; meetingId: string; deadline?: string }>;
}

export interface AssistMeetingBrief {
  eventId: string;
  title: string;
  startTime: string;
  people: AssistBriefPerson[];
  lastTime: AssistLastTimeRecap | null;
  yourOpenItems: AssistOwedItem[];
  talkingPoints: string[];
  talkingPointsFrom: 'model' | 'notes';
  generatedAt: number;
  modelSkipped?: 'privacy' | 'no-model' | 'failed';
}

export interface AssistCatchUp {
  key: string;
  meetings: Array<{ id: string; title: string; startMs: number }>;
  decisions: Array<{ text: string; meetingId: string; meetingTitle: string }>;
  yourActions: Array<{ text: string; meetingId: string; meetingTitle: string; deadline?: string }>;
}

/** An upcoming calendar event, as the launcher holds it. */
export interface AssistEvent {
  id: string;
  title?: string;
  startTime: string;
  endTime?: string;
  attendees?: Array<{ email: string; name?: string; response?: string }>;
  recurringEventId?: string;
  organizer?: { email?: string; name?: string; self?: boolean };
  description?: string;
}

export interface AssistSender {
  name: string | null;
  email: string | null;
  google: boolean;
}

/** The overlay's live helpers (electron/llm/liveHelpers.ts). */
export type LiveHelperAction = 'catch_me_up' | 'define' | 'sound_smart' | 'follow_up_questions';
