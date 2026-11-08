export type ReminderKind = 'running_late' | 'no_show' | 'reschedule';

export interface ReminderDraft {
    kind: ReminderKind;
    to: string[];
    subject: string;
    body: string;
}

export const MAILTO_MAX_LENGTH: number;

export function registerFromStyle(style: string | undefined | null): 'formal' | 'casual' | 'neutral';

export function greetingNames(recipients: Array<{ email: string; name?: string }>): string;

export function spokenTime(iso: string, locale?: string, timeZone?: string): string;

export function buildReminderDraft(input: {
    kind: ReminderKind;
    event: { title?: string; startTime: string; attendees?: Array<{ email: string; name?: string; response?: string }> };
    senderName?: string | null;
    minutesLate?: number;
    style?: string | null;
    locale?: string;
    timeZone?: string;
}): ReminderDraft;

export function mailtoUrl(draft: { to: string[]; subject: string; body: string }): string | null;

export function reminderGmailUrl(draft: { to: string[]; subject: string; body: string }, account?: string): string;

export function clipboardText(draft: { subject: string; body: string }): string;
