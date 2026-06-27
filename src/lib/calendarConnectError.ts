const DEFAULT_CALENDAR_CONNECT_ERROR =
    'Could not connect Google Calendar. Try again, or ask Natively support to add your Google account as a test user while verification is pending.';

const GOOGLE_AUTH_BLOCKED_ERROR =
    'Google Calendar authorization is not available for this account yet. Ask Natively support to add your Google account as a test user, then try again.';

const GOOGLE_CONSENT_DECLINED_ERROR =
    'Google Calendar authorization was cancelled. Approve the Google consent prompt to connect your calendar.';

export function getCalendarConnectErrorMessage(error?: unknown): string {
    const rawMessage = typeof error === 'string'
        ? error
        : error instanceof Error
            ? error.message
            : '';

    const message = rawMessage.trim();
    if (!message) return DEFAULT_CALENDAR_CONNECT_ERROR;

    if (/unauthorized_client|invalid_client|oauth client not found|google_client_id/i.test(message)) {
        return 'Google Calendar is not configured for this build. Add a valid Google OAuth client ID, restart Natively, and try again.';
    }

    if (/access_denied/i.test(message)) {
        return GOOGLE_CONSENT_DECLINED_ERROR;
    }

    if (/status=403|forbidden|verification|test user/i.test(message)) {
        return GOOGLE_AUTH_BLOCKED_ERROR;
    }

    if (/timed out|timeout/i.test(message)) {
        return 'Google Calendar authorization timed out. Try connecting again.';
    }

    const compactMessage = message.length > 160
        ? `${message.slice(0, 157)}...`
        : message;

    return `Could not connect Google Calendar: ${compactMessage}`;
}
