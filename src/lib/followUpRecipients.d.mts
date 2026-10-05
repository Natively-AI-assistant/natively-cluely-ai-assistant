export interface Attendee {
    email: string;
    name?: string;
    response?: string;
}

export function followUpRecipients(attendees: Attendee[] | undefined | null): Attendee[];

export function recipientName(a: Attendee): string;

export function recipientSummary(recipients: Attendee[], shown?: number): string;

export function gmailComposeUrl(draft?: { to?: string[]; subject?: string; body?: string; account?: string }): string;
