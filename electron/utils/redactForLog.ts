/**
 * Centralized log-redaction helper.
 *
 * Goal: every line that leaves the process via console.* or a log file
 * must NOT carry verbatim user content (transcripts, prompts, reference
 * file bodies, screenshot paths, audio base64) or credentials (API keys,
 * trial tokens, auth headers, bearer/JWT-shaped strings).
 *
 * This module is intentionally framework-free and side-effect-free so it
 * can be safely required from both main and preload processes.
 */

const REDACTED = '[REDACTED]';
const REMOVED = '[REMOVED]';
const MAX_PREVIEW_LEN = 120;

/**
 * Property keys whose value should be REDACTED in serialized log output.
 * The list mirrors TelemetryService.SENSITIVE_KEY_RE but is independently
 * defined here so the redactor has no runtime dependency on the telemetry
 * module (avoids circular imports from main.ts).
 */
const SENSITIVE_KEY_RE = /(api[_-]?key|authorization|bearer|token|secret|password|credential|raw[_-]?(transcript|prompt|reference|content|query)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response|message)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|cookie|set[_-]?cookie|signature|x[_-]?api[_-]?key|x[_-]?trial[_-]?token|x[_-]?natively[_-]?key|answer|^content$|^text$|^output$|ai[_-]?response|full[_-]?answer|full[_-]?prompt|full[_-]?text)$/i;

/**
 * Property keys whose value should be entirely REMOVED (not just redacted)
 * because they are guaranteed to be bulky raw content — even leaving a
 * truncated string would still leak.
 */
const REMOVE_VALUE_KEY_RE = /(raw[_-]?(transcript|prompt|reference|content|query)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|base64|audio[_-]?data)$/i;

/**
 * Substring patterns that scrub credential-shaped sequences out of free-text
 * (e.g., a log line like "auth: Bearer abc123def..." that wasn't wrapped in a
 * nice property bag).
 */
const VALUE_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
    { regex: /Bearer\s+[A-Za-z0-9._~+\/=:-]{12,}/gi, replacement: 'Bearer [REDACTED]' },
    { regex: /x-(natively|trial|api)-(key|token)\s*[:=]\s*[A-Za-z0-9._~+\/=:-]{8,}/gi, replacement: '$&[REDACTED]'.replace(/(=|:)\s*[A-Za-z0-9._~+\/=:-]{8,}/, '$1 [REDACTED]') },
    { regex: /natively_sk_[A-Za-z0-9._-]+/gi, replacement: REDACTED },
    { regex: /sk-[A-Za-z0-9]{20,}/gi, replacement: REDACTED },
    { regex: /gsk_[A-Za-z0-9]{20,}/gi, replacement: REDACTED },
    { regex: /dg_[A-Za-z0-9]{20,}/gi, replacement: REDACTED },
    { regex: /AIza[A-Za-z0-9_-]{20,}/g, replacement: REDACTED },
    { regex: /sk-ant-api03-[A-Za-z0-9_-]{20,}/g, replacement: REDACTED },
    // JWT-shaped triple-base64 sequences (header.payload.signature).
    { regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replacement: REDACTED },
];

/**
 * Lossy redactor for log arguments. Always returns a string suitable for
 * appending to a log file or stdout.
 *
 * - Errors → stack/message but with credential patterns scrubbed.
 * - Plain objects/arrays → JSON, with sensitive keys removed/redacted.
 * - Strings/numbers/booleans → string with credential patterns scrubbed.
 */
export function redactForLog(args: unknown[]): string {
    return args
        .map(arg => formatOne(arg))
        .join(' ');
}

/**
 * Lower-level redactor that returns a sanitized clone of any value. Useful
 * for code that wants to log a structured object rather than a string and
 * still wants the redaction to apply.
 */
export function redactValue(value: unknown): unknown {
    return sanitize(value, new WeakSet());
}

function formatOne(arg: unknown): string {
    if (arg instanceof Error) {
        const base = arg.stack || arg.message || 'Error';
        return scrubString(base);
    }
    if (typeof arg === 'object' && arg !== null) {
        try {
            return JSON.stringify(sanitize(arg, new WeakSet()));
        } catch {
            return '[Unserializable]';
        }
    }
    if (typeof arg === 'string') return scrubString(arg);
    if (typeof arg === 'bigint') return arg.toString();
    if (typeof arg === 'undefined') return 'undefined';
    return String(arg);
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') return scrubString(value).slice(0, MAX_PREVIEW_LEN);
    if (typeof value === 'number' || typeof value === 'boolean') {
        return Number.isNaN(value as number) ? null : value;
    }
    if (typeof value === 'bigint') return (value as bigint).toString();
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;

    if (value instanceof Error) {
        return {
            name: value.name,
            message: scrubString(value.message ?? ''),
            stack: scrubString(value.stack ?? ''),
        };
    }

    if (Array.isArray(value)) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        return value.map(item => sanitize(item, seen)).filter(item => item !== undefined);
    }

    if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);

        const output: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (REMOVE_VALUE_KEY_RE.test(key)) {
                output[key] = REMOVED;
            } else if (SENSITIVE_KEY_RE.test(key)) {
                output[key] = REDACTED;
            } else {
                const sanitized = sanitize(child, seen);
                if (sanitized !== undefined) output[key] = sanitized;
            }
        }
        return output;
    }

    return undefined;
}

function scrubString(value: string): string {
    let scrubbed = value;
    for (const { regex, replacement } of VALUE_PATTERNS) {
        scrubbed = scrubbed.replace(regex, replacement);
    }
    return scrubbed;
}
