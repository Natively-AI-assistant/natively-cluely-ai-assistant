// electron/utils/emailUtils.ts
// Utilities for follow-up email functionality

/**
 * Extract email addresses from transcript text
 * Uses regex to find email patterns mentioned in conversation
 */
export function extractEmailsFromTranscript(transcript: Array<{ text: string }>): string[] {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = new Set<string>();

    for (const entry of transcript) {
        const matches = entry.text.match(emailRegex);
        if (matches) {
            matches.forEach(email => emails.add(email.toLowerCase()));
        }
    }

    return Array.from(emails);
}

/**
 * Build a mailto: link with pre-filled content
 * @param to - Recipient email(s), comma-separated
 * @param subject - Email subject line
 * @param body - Email body text
 */
export function buildMailtoLink(to: string, subject: string, body: string): string {
    const params = new URLSearchParams();
    params.set('subject', subject);
    params.set('body', body);

    // URLSearchParams encodes spaces as '+', but mailto expects '%20'
    const queryString = params.toString().replace(/\+/g, '%20');

    // Each address encoded on its own, the commas between them left as commas:
    // RFC 6068's separator, which some mail clients do not read when encoded.
    const recipients = to.split(',').map((a) => a.trim()).filter(Boolean).map(encodeURIComponent).join(',');
    return `mailto:${recipients}?${queryString}`;
}

/**
 * Build a Gmail composition URL
 * Opens Gmail web interface with pre-filled content
 */
export function buildGmailComposeUrl(to: string, subject: string, body: string): string {
    const params = new URLSearchParams();
    params.set('view', 'cm');
    params.set('fs', '1');
    params.set('to', to);
    params.set('su', subject);
    params.set('body', body);

    return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Generate a suggested email subject from meeting title
 */
export function generateEmailSubject(meetingTitle: string, meetingType: string = 'meeting'): string {
    const cleanTitle = meetingTitle.replace(/["\*]/g, '').trim();

    if (meetingType === 'interview') {
        return `Following up on our conversation - ${cleanTitle}`;
    }

    return `Following up - ${cleanTitle}`;
}

/**
 * Build the input payload for follow-up email LLM generation
 */
export interface FollowUpEmailInput {
    meeting_type: 'interview' | 'call' | 'demo' | 'discussion' | 'meeting';
    title: string;
    summary?: string;
    action_items?: string[];
    key_points?: string[];
    recipient_name?: string;
    sender_name?: string;
    tone?: 'friendly' | 'neutral' | 'formal';
}

export function buildFollowUpEmailPromptInput(input: FollowUpEmailInput): string {
    const parts: string[] = [];

    parts.push(`Meeting Type: ${input.meeting_type}`);
    parts.push(`Title: ${input.title}`);

    if (input.recipient_name) {
        parts.push(`Recipient Name: ${input.recipient_name}`);
    }

    if (input.sender_name) {
        parts.push(`Sender Name: ${input.sender_name}`);
    }

    if (input.summary) {
        parts.push(`Summary: ${input.summary}`);
    }

    if (input.action_items && input.action_items.length > 0) {
        parts.push(`Action Items:\n${input.action_items.map(item => `- ${item}`).join('\n')}`);
    }

    if (input.key_points && input.key_points.length > 0) {
        parts.push(`Key Points:\n${input.key_points.map(point => `- ${point}`).join('\n')}`);
    }

    if (input.tone) {
        parts.push(`Tone: ${input.tone}`);
    }

    return parts.join('\n\n');
}

/**
 * Parse attendee name from calendar data or transcript
 * Extracts first name from full name or email
 */
export function extractRecipientName(attendeeInfo: string): string {
    // If it's an email, extract the part before @
    if (attendeeInfo.includes('@')) {
        const localPart = attendeeInfo.split('@')[0];
        // Convert something like "john.doe" to "John"
        const firstName = localPart.split(/[._-]/)[0];
        return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    }

    // If it's a full name, take the first word
    const firstName = attendeeInfo.split(' ')[0];
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

/**
 * Copy text to clipboard (renderer process helper)
 */
export function copyToClipboard(text: string): Promise<void> {
    return navigator.clipboard.writeText(text);
}
