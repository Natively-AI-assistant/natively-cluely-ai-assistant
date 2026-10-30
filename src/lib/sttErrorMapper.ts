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
    | 'secure_connection_blocked'
    | 'provider_error';

/**
 * Node's certificate errors when something between Natively and the provider
 * re-signs the connection: antivirus HTTPS scanning (Kaspersky, ESET, Avast…)
 * or a corporate TLS-inspection proxy whose root Node does not trust. Messages
 * and codes as Node 24 reports them; main appends the code to the message.
 */
const SECURE_CONNECTION_BLOCKED = [
    'self-signed certificate',
    'self signed certificate',
    'unable to verify the first certificate',
    'unable_to_verify_leaf_signature',
    'unable to get local issuer certificate',
    'unable_to_get_issuer_cert',
    'self_signed_cert_in_chain',
    'depth_zero_self_signed_cert',
    'err_tls_cert_altname_invalid',
    "does not match certificate's altnames",
    'certificate has expired',
    'cert_has_expired',
];

/**
 * Categorize a raw STT error message into a user-friendly display.
 * Returns the first matching category based on error content patterns.
 */
export function categorizeSttError(rawError: string): SttErrorCategory {
    const lower = rawError.toLowerCase();

    // 0. Google STT with no usable service-account key. GoogleSTT sends its
    // own worded message for this (credentialsUnavailableError); "API key"
    // below would be the wrong thing to tell someone whose provider takes a
    // key FILE, and the generic fallback would tell them nothing.
    if (lower.includes('service account json')) {
        return {
            title: 'Google Key Missing',
            // Google Cloud speech is the default provider, so a free user who
            // only added a Gemini key lands here (customer, 2026-10-29) and
            // took the Gemini key to be the one it wanted. Local Models
            // transcribes on the device with no key at all.
            body: 'Google speech-to-text needs a Service Account JSON, and a Gemini key cannot transcribe. To transcribe free on this device, choose Local Models in Audio Settings, or add a Service Account JSON there.',
            category: 'auth',
        };
    }

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

    // 3. Trial expired — NativelyPro fatal code
    if (lower.includes('trial_expired')) {
        return {
            title: 'Trial Expired',
            body: 'Your Natively Pro trial has ended. Upgrade your plan to continue using STT.',
            category: 'auth',
        };
    }

    // 3b. Out of credits: the provider account itself (OpenAI's
    // insufficient_quota). Before 4, whose "for this period" would be wrong.
    if (lower.includes('insufficient_quota') || lower.includes('credit_balance_exhausted')) {
        return {
            title: 'Out of Credits',
            body: 'Your provider account has no credits left. Add credits, then start a new meeting.',
            category: 'quota',
        };
    }

    // 4. Quota exceeded
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

    // 5. Rate limited
    if (rawError.startsWith('429 ') || lower.includes('too many requests') || lower.includes('rate limit')) {
        return {
            title: 'Rate Limited',
            body: 'Too many requests. The service is throttling your connection.',
            category: 'rate_limited',
        };
    }

    // 5b. The connection was intercepted, not lost. Before 6: "Check your
    // internet connection" sends someone whose internet works on a long hunt.
    if (SECURE_CONNECTION_BLOCKED.some((pattern) => lower.includes(pattern))) {
        return {
            title: 'Secure Connection Blocked',
            body: 'Antivirus HTTPS scanning or a network filter is intercepting the connection. Allow Natively in your antivirus, or turn off its HTTPS scanning for Natively.',
            category: 'secure_connection_blocked',
        };
    }

    // 6. Connection lost
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

    // 7. Timed out
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

    // 8. Service unavailable (5xx)
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

    // 9. Invalid configuration / bad request
    if (rawError.startsWith('400 ') || lower.includes('bad request') || lower.includes('invalid argument')) {
        return {
            title: 'Invalid Configuration',
            body: 'The STT service rejected the request. Verify your settings.',
            category: 'invalid_config',
        };
    }

    // 10. Session conflict (NativelyPro specific)
    if (lower.includes('concurrent_session_blocked')) {
        return {
            title: 'Session Conflict',
            body: 'Another session is active. Wait a moment and try again.',
            category: 'session_conflict',
        };
    }

    // 11. Generic provider error
    return {
        title: 'STT Provider Error',
        body: 'The transcription service encountered an unexpected issue.',
        category: 'provider_error',
    };
}

/**
 * Why the transcription service cannot be reached, when the errors say so:
 * 'secure-connection' when a certificate was rejected (antivirus or network
 * interception), 'unreachable' when the connection never got through.
 * Null for everything else (keys, quota, provider faults), where the advice
 * stays "check your provider and its key".
 */
export function sttConnectionCause(rawErrors: ReadonlyArray<string>): 'secure-connection' | 'unreachable' | null {
    const categories = rawErrors.filter(Boolean).map((raw) => categorizeSttError(raw).category);
    if (categories.includes('secure_connection_blocked')) return 'secure-connection';
    if (categories.includes('connection_lost') || categories.includes('timed_out')) return 'unreachable';
    return null;
}
