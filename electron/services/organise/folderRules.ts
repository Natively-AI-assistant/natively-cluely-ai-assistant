// folderRules.ts
//
// Which folders a meeting files itself into. A folder holds any number of
// rules; a meeting matching ANY of them goes in. Three kinds:
//
//   title     the calendar event's title (or the meeting's own) contains the text
//   attendee  someone on the invite has this address, or an address at this
//             domain ("acme.com" also matches eng.acme.com)
//   mode      the mode the meeting ran in, or the one detected from what was said
//
// Rules run when a meeting is saved, and once over past meetings when the user
// asks ("Apply to past meetings"). They only ever ADD a meeting; one the user
// took out of a folder stays out (the store keeps that as a removal).
//
// Pure: no database, no Electron, no platform branches.

import { emailDomain } from '../meeting/meetingNotesContext';

export type FolderRuleKind = 'title' | 'attendee' | 'mode';
export const FOLDER_RULE_KINDS: readonly FolderRuleKind[] = ['title', 'attendee', 'mode'];

export interface FolderRule {
  folderId: string;
  kind: FolderRuleKind;
  value: string;
}

export interface MeetingRuleFacts {
  /** The meeting's title as saved. */
  title?: string;
  /** The linked calendar event's title. */
  calendarTitle?: string;
  /** Every address on the invite (the user's own included; it never decides anything alone). */
  attendeeEmails?: string[];
  /** Mode ids and template types the meeting ran in or was detected as. */
  modes?: string[];
}

const TITLE_MIN = 2;
const VALUE_MAX = 120;

/**
 * The value as stored, or null when it cannot be a rule: too short, an
 * attendee value that is neither an address nor a domain.
 */
export function normaliseRuleValue(kind: unknown, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, VALUE_MAX);
  if (kind === 'title') return v.length >= TITLE_MIN ? v : null;
  if (kind === 'mode') return v.length >= 1 ? v : null;
  if (kind === 'attendee') {
    const lower = v.toLowerCase().replace(/^mailto:/, '').replace(/^@/, '');
    if (lower.includes('@')) return emailDomain(lower) && /^[^\s@]+@[^\s@]+$/.test(lower) ? lower : null;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(lower) && /\.[a-z]{2,}$/.test(lower) ? lower : null;
  }
  return null;
}

function contains(haystack: string | undefined, needle: string): boolean {
  return !!haystack && haystack.toLowerCase().includes(needle.toLowerCase());
}

export function ruleMatches(rule: Pick<FolderRule, 'kind' | 'value'>, facts: MeetingRuleFacts): boolean {
  const value = normaliseRuleValue(rule.kind, rule.value);
  if (!value) return false;
  switch (rule.kind) {
    case 'title':
      return contains(facts.calendarTitle, value) || contains(facts.title, value);
    case 'attendee': {
      const emails = (facts.attendeeEmails || []).map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')).filter(Boolean);
      if (value.includes('@')) return emails.includes(value);
      return emails.some((e) => {
        const d = emailDomain(e);
        return !!d && (d === value || d.endsWith(`.${value}`));
      });
    }
    case 'mode':
      return (facts.modes || []).some((m) => typeof m === 'string' && m.toLowerCase() === value.toLowerCase());
    default:
      return false;
  }
}

/** The folders (each once, in rule order) a meeting with these facts belongs in. */
export function foldersForMeeting(facts: MeetingRuleFacts, rules: FolderRule[]): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (out.includes(rule.folderId)) continue;
    if (ruleMatches(rule, facts)) out.push(rule.folderId);
  }
  return out;
}

/** The rule facts of a saved meeting: its title, the linked event, and its mode record. */
export function ruleFactsFromMeeting(meeting: {
  title?: string;
  calendarEvent?: { title?: string; attendees?: Array<{ email?: string }> } | null;
  detailedSummary?: { mode?: { selectedModeId?: string; selectedTemplateType?: string; detectedModeId?: string; summaryModeUsed?: string } } | null;
}, extra: { detectedTemplateType?: string } = {}): MeetingRuleFacts {
  const mode = meeting.detailedSummary?.mode || {};
  const modes = [mode.selectedModeId, mode.selectedTemplateType, mode.detectedModeId, extra.detectedTemplateType]
    .filter((m): m is string => typeof m === 'string' && m.length > 0);
  return {
    title: meeting.title,
    calendarTitle: meeting.calendarEvent?.title,
    attendeeEmails: (meeting.calendarEvent?.attendees || []).map((a) => a?.email).filter((e): e is string => typeof e === 'string'),
    modes: [...new Set(modes)],
  };
}
