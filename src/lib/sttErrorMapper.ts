/**
 * STT Error Categorization
 *
 * Maps raw STT error messages to user-friendly titles and body messages.
 * The raw error is preserved for Copy Details diagnostics.
 *
 * Categories are checked in priority order — first match wins.
 */

export interface SttErrorCategory {
    /** Short user-facing title (e.g. "Authentication Failed") */
    title: string;
    /** Brief explanation with actionable guidance */
    body: string;
    /** Internal category key for diagnostics */
    category: SttErrorCategoryId;
}

export type SttErrorCategoryId =
    | 'auth'
    | 'access_denied'
    | 'quota'
    | 'rate_limited'
    | 'connection_lost'
    | 'timed_out'
    | 'service_unavailable'
    | 'invalid_config'
    | 'session_conflict'
    | 'provider_error';

/**
 * Categorize a raw STT error message into a user-friendly display.
 * Returns the first matching category based on error content patterns.
 */
export function categorizeSttError(rawError: string): SttErrorCategory {
    const lower = rawError.toLowerCase();

    // 1. Authentication errors — immediately fatal
    if (
        rawError.startsWith('401 ')
        || lower.includes('auth_timeout')
        || lower.includes('invalid_key')
        || lower.includes('invalid api')
        || lower.includes('authentication')
        || lower.includes('invalid_key_format')
        || lower.includes('auth_error')
        || lower.includes('unauthorized')
    ) {
        return {
            title: 'Authentication Failed',
            body: 'Your API key is invalid or expired. Check your settings.',
            category: 'auth',
        };
    }

    // 2. Access denied / geo-blocking
    if (rawError.startsWith('403 ') || lower.includes('forbidden')) {
        return {
            title: 'Access Denied',
            body: 'This service is not available in your region or your API key lacks the required permissions.',
            category: 'access_denied',
        };
    }

    // 3. Quota exceeded
    if (
        lower.includes('transcription_quota_exceeded')
        || lower.includes('quota')
    ) {
        return {
            title: 'Transcription Limit Reached',
            body: "You've exceeded your transcription quota for this period.",
            category: 'quota',
        };
    }

    // 4. Rate limited
    if (rawError.startsWith('429 ') || lower.includes('too many requests') || lower.includes('rate limit')) {
        return {
            title: 'Rate Limited',
            body: 'Too many requests. The service is throttling your connection.',
            category: 'rate_limited',
        };
    }

    // 5. Connection lost
    if (
        lower.includes('econnrefused')
        || lower.includes('enotfound')
        || lower.includes('econnreset')
        || lower.includes('epipe')
        || lower.includes('max reconnect attempts exceeded')
        || lower.includes('abnormal closure')
    ) {
        return {
            title: 'Connection Lost',
            body: 'Unable to reach the STT service. Check your internet connection.',
            category: 'connection_lost',
        };
    }

    // 6. Timed out
    if (
        lower.includes('etimedout')
        || lower.includes('connection timeout')
        || lower.includes('session setup timeout')
        || lower.includes('timed out')
        || lower.includes('deadline exceeded')
    ) {
        return {
            title: 'Connection Timed Out',
            body: 'The STT service didn\'t respond in time. Retrying…',
            category: 'timed_out',
        };
    }

    // 7. Service unavailable (5xx)
    if (
        rawError.startsWith('500 ')
        || rawError.startsWith('502 ')
        || rawError.startsWith('503 ')
        || lower.includes('internal server error')
        || lower.includes('bad gateway')
        || lower.includes('service unavailable')
        || lower.includes('unavailable')
    ) {
        return {
            title: 'Service Unavailable',
            body: 'The transcription provider is experiencing issues. Trying to reconnect…',
            category: 'service_unavailable',
        };
    }

    // 8. Invalid configuration / bad request
    if (rawError.startsWith('400 ') || lower.includes('bad request') || lower.includes('invalid argument')) {
        return {
            title: 'Invalid Configuration',
            body: 'The STT service rejected the request. Verify your settings.',
            category: 'invalid_config',
        };
    }

    // 9. Session conflict (NativelyPro specific)
    if (lower.includes('concurrent_session_blocked')) {
        return {
            title: 'Session Conflict',
            body: 'Another session is active. Wait a moment and try again.',
            category: 'session_conflict',
        };
    }

    // 10. Generic provider error
    return {
        title: 'STT Provider Error',
        body: 'The transcription service encountered an unexpected issue.',
        category: 'provider_error',
    };
}
