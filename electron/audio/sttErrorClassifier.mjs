// How main's STT error handler reads a provider error (electron/main.ts,
// `stt.on('error', ...)`). Pure, so every branch is testable without main.
//
// The contract a provider can rely on, beyond a plain Error:
//   terminal: true   the provider has stopped reconnecting (a verdict on the
//                    key or account, or its retries are exhausted). Main shows
//                    "failed" at once instead of "reconnecting" forever.
//   httpStatus: n    the HTTP status behind the failure, when the provider
//                    knows it without an axios response (a refused WebSocket
//                    handshake). Prefixed to the message for the overlay.
//   code: '...'      provider or Node error code.
//
// Until 2026-11-01 main matched words in err.message only. Axios errors
// (RestSTT) carry "Request failed with status code 429" there, so the body
// ("You exceeded your current quota", insufficient_quota) was never seen; 402
// and 403 were retried five times; and providers that stopped on an account
// verdict (Natively trial_expired, Soniox 401/402, Google PERMISSION_DENIED)
// sent one error and left the overlay on "reconnecting" for good.

/** Words that mean the key or account is refused: retrying cannot help. */
const AUTH_MARKERS = [
    'auth_timeout',
    'invalid_key',
    'invalid api',
    'authentication',
    // Natively relay verdicts (NativelyProSTT.FATAL_SERVER_ERRORS).
    'trial_expired',
    'subscription_inactive',
    'account_suspended',
    'auth_required',
];

/** Out of credit or over a plan quota, whatever the status. */
const CREDIT_MARKERS = [
    'insufficient_quota',
    'credit_balance_exhausted',
    'insufficient_funds',
    'transcription_quota_exceeded',
    'quota_exceeded',
    // Alibaba DashScope (Qwen): the account is in arrears.
    'arrearage',
];

const CREDIT_CODES = new Set([
    'insufficient_quota',
    'quota_exceeded',
    'transcription_quota_exceeded',
    'credit_balance_exhausted',
    'insufficient_funds',
    'arrearage',
]);

function stringOrEmpty(value) {
    return typeof value === 'string' ? value : '';
}

/**
 * The message the overlay maps (src/lib/sttErrorMapper.ts) and the HTTP
 * status, from an Error or an axios error.
 */
export function describeSttError(err) {
    const message = stringOrEmpty(err?.message) || 'Unknown STT error';
    const code = err?.code;
    const response = err?.response;
    const httpStatus = Number(response?.status || err?.httpStatus || 0) || 0;

    let errorMessage = message;
    // Node's socket/TLS code (UNABLE_TO_VERIFY_LEAF_SIGNATURE, ECONNRESET…)
    // travels with the message so the overlay can tell an intercepted or
    // blocked connection from a bad key.
    const nodeCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,}$/.test(code) ? code : '';
    if (nodeCode && !errorMessage.includes(nodeCode)) errorMessage = `${errorMessage} (${nodeCode})`;

    const respErr = response?.data?.error;
    if (respErr) {
        let respMsg;
        if (typeof respErr === 'string') {
            respMsg = respErr;
        } else {
            const text = stringOrEmpty(respErr.message);
            const respCode = stringOrEmpty(respErr.code) || stringOrEmpty(respErr.type);
            // OpenAI's insufficient_quota lives in code/type, not the text,
            // and it is what tells "no credits" from a per-minute limit.
            respMsg = text
                ? (respCode && !text.includes(respCode) ? `${text} (${respCode})` : text)
                : (respCode || JSON.stringify(respErr));
        }
        errorMessage = httpStatus ? `${httpStatus} ${respMsg}` : respMsg;
    } else if (response && httpStatus) {
        errorMessage = `${httpStatus} ${stringOrEmpty(response.statusText)}`.trim();
    } else if (httpStatus && !errorMessage.startsWith(`${httpStatus} `)) {
        errorMessage = `${httpStatus} ${errorMessage}`;
    }

    return { errorMessage, httpStatus };
}

/**
 * kind:
 *   'idle'              a provider's no-audio timeout; the next chunk reconnects
 *   'local_unavailable' a local model that could not start (terminal)
 *   'auth'              key/account refused, or the provider has stopped (terminal)
 *   'quota'             out of credit or over quota (a stand-in may take over)
 *   'retry'             anything else: reconnecting, failed after five
 */
export function classifySttError(err) {
    const message = stringOrEmpty(err?.message);
    const code = err?.code;

    // Google streamingRecognize's silence timeout (gRPC 11, "Audio Timeout
    // Error"): the lazy-reconnect path recovers from it cleanly.
    if (code === 11 || /Audio Timeout Error/i.test(message)) {
        return { kind: 'idle', errorMessage: message, httpStatus: 0 };
    }

    const { errorMessage, httpStatus } = describeSttError(err);
    const text = `${errorMessage} ${message}`.toLowerCase();

    if (code === 'local_stt_unavailable') {
        return { kind: 'local_unavailable', errorMessage, httpStatus };
    }

    // "quota" alone on a 429 is a per-minute limit (Google, Gemini, Groq
    // wording); an explicit credit marker or a 402 is not.
    const isQuota = httpStatus === 402
        || (typeof code === 'string' && CREDIT_CODES.has(code.toLowerCase()))
        || CREDIT_MARKERS.some((m) => text.includes(m))
        || (text.includes('quota') && httpStatus !== 429);
    if (isQuota) return { kind: 'quota', errorMessage, httpStatus };

    const isAuth = httpStatus === 401
        || httpStatus === 403
        || err?.terminal === true
        || AUTH_MARKERS.some((m) => text.includes(m))
        // Google STT with no usable Service Account JSON (GoogleSTT has
        // already disabled the channel until a new key is set).
        || code === 'google_stt_credentials_unavailable';
    if (isAuth) return { kind: 'auth', errorMessage, httpStatus };

    return { kind: 'retry', errorMessage, httpStatus };
}

/**
 * For providers that upload audio over HTTP (RestSTT, OpenAI's REST
 * fallback): whether a failed upload is a verdict on the key or account, so
 * later uploads should stop. 'credits': no balance or quota (402, or an
 * insufficient_quota body, which OpenAI sends as a 429 and RestSTT used to
 * hold and retry as a rate limit forever). 'refused': 401/403. null: retry.
 */
export function restAccountVerdict(err) {
    const { errorMessage, httpStatus } = describeSttError(err);
    const text = errorMessage.toLowerCase();
    if (httpStatus === 402 || /insufficient_quota|credit_balance_exhausted|insufficient_funds/.test(text)) return 'credits';
    if (httpStatus === 401 || httpStatus === 403) return 'refused';
    return null;
}
