const DEFAULT_CALENDAR_CONNECT_ERROR =
    'Could not connect Google Calendar. Try again or contact Natively support.';

const GOOGLE_AUTH_BLOCKED_ERROR =
    'This Google account is not an approved test user yet. Contact Natively support, then try again.';

const GOOGLE_CONSENT_DECLINED_ERROR =
    'Google Calendar authorization was cancelled. Approve the consent prompt and try again.';

const identity = (text) => text;

/**
 * Turn main-process calendar auth failures into concise, user-facing copy.
 *
 * @param {unknown} error
 * @param {(text: string) => string} [translate]
 * @returns {string}
 */
export function getCalendarConnectErrorMessage(error, translate = identity) {
    const rawMessage = typeof error === 'string'
        ? error
        : error instanceof Error
            ? error.message
            : '';

    const message = rawMessage.trim();
    if (!message) return translate(DEFAULT_CALENDAR_CONNECT_ERROR);

    if (/unauthorized_client|invalid_client|oauth client not found|google_client_id/i.test(message)) {
        return translate('Google Calendar is not configured for this build. Add a valid OAuth client ID and restart Natively.');
    }

    // OAuth callback descriptions can contain access_denied alongside the
    // more specific verification/test-user cause, so classify that first.
    if (/has not completed (?:the )?(?:google )?verification|not (?:been )?verified|currently being tested|test user|developer (?:hasn't|has not) given you access/i.test(message)) {
        return translate(GOOGLE_AUTH_BLOCKED_ERROR);
    }

    const accessDenied = /^access_denied(?:\s*:\s*(.*))?$/i.exec(message);
    const denialDescription = accessDenied?.[1]?.trim();
    const userDeclined = denialDescription
        && (
            /\b(?:the\s+)?user\s+(?:has\s+)?(?:denied|declined|cancelled|canceled)\b/i.test(denialDescription)
            || /\b(?:denied|declined|cancelled|canceled)\b.*\bby\s+(?:the\s+)?user\b/i.test(denialDescription)
        );
    if (accessDenied && (!denialDescription || userDeclined)) {
        return translate(GOOGLE_CONSENT_DECLINED_ERROR);
    }

    if (/timed out|timeout/i.test(message)) {
        return translate('Google Calendar authorization timed out. Try again.');
    }

    const compactMessage = message.length > 80
        ? `${message.slice(0, 77)}...`
        : message;

    return `${translate('Could not connect Google Calendar')}: ${compactMessage}`;
}
