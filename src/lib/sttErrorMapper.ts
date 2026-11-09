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
    | 'local_model'
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
 * Why an on-device model (LocalWhisperSTT) could not transcribe, read from the
 * messages it raises (LocalWhisperSTT.ts, whisper/loadFailure.ts,
 * whisper/onnxMacSupport.ts). Null for anything that is not a local model.
 *   'memory'   the memory gate refused it, or loading ran out of memory
 *   'download' the model is not on disk yet and its download stalled or failed
 *   'model'    any other local failure (not loaded in time, engine stopped,
 *              damaged files, a runtime or OS it needs)
 *   'slow'     the model runs, but slower than people talk on this computer
 *              (LocalWhisperSTT 'local_stt_behind'): text comes later and later
 * Issue #707: every one of these used to read as a provider fault, and the
 * banner told a local-only user to check a key they do not have.
 */
function localModelCause(lower: string): 'memory' | 'download' | 'model' | 'slow' | null {
    // LocalWhisperSTT's "behind" message names no "local" anything: "Transcription
    // is 34 seconds behind: this model is too slow for this computer. …"
    if (lower.includes('too slow for this computer')) return 'slow';
    const isLocal = lower.includes('local stt')
        || lower.includes('local model')
        || lower.includes('local speech model')
        || lower.includes('downloaded model files')
        || lower.includes('onnx session slot');
    if (!isLocal) return null;
    if (lower.includes('insufficient available memory') || lower.includes('ran out of memory')) return 'memory';
    if (lower.includes('is still downloading') || lower.includes('could not be downloaded')) return 'download';
    return 'model';
}

const LOCAL_MEMORY_ADVICE = 'Close other apps, or choose a smaller local model in Settings → Audio.';
const LOCAL_DOWNLOAD_BODY = 'The local model has not finished downloading. Check your internet connection, or choose a cloud provider in Settings → Audio.';
const LOCAL_MODEL_BODY = 'The local speech model stopped. Restart the meeting, or choose another local model or a cloud provider in Settings → Audio.';
const LOCAL_SLOW_BODY = 'This local model is too slow for this computer, so text arrives later and later. Choose a lighter local model in Settings → Audio.';

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

    // 0b. An on-device model that could not run. Before everything else: its
    // messages mention downloads, connections and "unavailable", and none of
    // that is a provider or a key.
    const local = localModelCause(lower);
    if (local === 'memory') {
        // The gate's own figures (LocalWhisperSTT localSttMemoryRefusal):
        // "(0.61GB available, this model needs 0.62GB)".
        const figures = rawError.match(/(\d+(?:\.\d+)?GB) available, this model needs (\d+(?:\.\d+)?GB)/);
        return {
            title: 'Not Enough Memory',
            body: figures
                ? `This computer has ${figures[1]} available and the local model needs ${figures[2]}. ${LOCAL_MEMORY_ADVICE}`
                : `There is not enough free memory for the local model. ${LOCAL_MEMORY_ADVICE}`,
            category: 'local_model',
        };
    }
    if (local === 'download') {
        return { title: 'Local Model Not Downloaded', body: LOCAL_DOWNLOAD_BODY, category: 'local_model' };
    }
    if (local === 'slow') {
        // Not a stop: text still comes, only late (the overlay's own notice).
        return { title: 'Transcription Falling Behind', body: LOCAL_SLOW_BODY, category: 'local_model' };
    }
    if (local === 'model') {
        // A runtime or OS the models need: that message already names what to
        // install for THIS platform (the Visual C++ runtime on Windows, a macOS
        // update on a Mac), so it is shown as written.
        if (lower.startsWith('local speech models need')) {
            return { title: 'Local Model Cannot Run', body: rawError.trim(), category: 'local_model' };
        }
        return { title: 'Local Model Stopped', body: LOCAL_MODEL_BODY, category: 'local_model' };
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

    // 3a. Natively Pro account states the relay ends the stream on
    // (NativelyProSTT.FATAL_SERVER_ERRORS). Each used to fall through to the
    // generic provider error.
    if (lower.includes('subscription_inactive')) {
        return {
            title: 'Subscription Inactive',
            body: 'Your Natively Pro subscription is not active. Renew it, or choose another transcription provider in Settings.',
            category: 'auth',
        };
    }
    if (lower.includes('account_suspended')) {
        return {
            title: 'Account Suspended',
            body: 'Your Natively account is suspended. Contact support, or choose another transcription provider in Settings.',
            category: 'auth',
        };
    }
    if (lower.includes('auth_required')) {
        return {
            title: 'Sign In Required',
            body: 'Sign in to Natively again to use Natively transcription, or choose another provider in Settings.',
            category: 'auth',
        };
    }

    // 3b. Out of credits: the provider account itself (OpenAI's
    // insufficient_quota). Before 4, whose "for this period" would be wrong.
    // ElevenLabs quota_exceeded is the plan's credits running out (it closes
    // with reason insufficient_funds), not a per-period cap. 402 Payment
    // Required (Deepgram, Soniox, Qwen) and DashScope's Arrearage mean the same.
    if (
        lower.includes('insufficient_quota')
        || lower.includes('credit_balance_exhausted')
        || lower.includes('elevenlabs quota_exceeded')
        || lower.includes('insufficient_funds')
        || lower.includes('arrearage')
        || rawError.startsWith('402 ')
    ) {
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

/**
 * Why an on-device model stopped, across the given raw errors (most specific
 * first: memory, then download, then any other local failure, then a model
 * that is merely too slow). Null when none of them is a local model, so the
 * banner keeps its provider advice.
 */
export function sttLocalModelCause(rawErrors: ReadonlyArray<string>): 'memory' | 'download' | 'model' | 'slow' | null {
    const causes = rawErrors.filter(Boolean).map((raw) => localModelCause(raw.toLowerCase()));
    if (causes.includes('memory')) return 'memory';
    if (causes.includes('download')) return 'download';
    if (causes.includes('model')) return 'model';
    if (causes.includes('slow')) return 'slow';
    return null;
}
