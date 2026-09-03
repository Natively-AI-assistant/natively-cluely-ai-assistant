/**
 * Centralized log-redaction helper.
 *
 * TWO INDEPENDENT AXES (2026-09-03). These used to be one key list doing two
 * jobs, which meant the only way to get readable diagnostics was to weaken
 * credential scrubbing. They are now separate and only ONE of them is
 * configurable:
 *
 *   1. CREDENTIALS — api keys, bearer tokens, JWTs, cookies, signatures.
 *      ALWAYS redacted, at every level, with no way to turn it off. Both the
 *      key-name rule (CREDENTIAL_KEY_RE) and the free-text pattern rule
 *      (VALUE_PATTERNS) are unconditional.
 *
 *   2. USER CONTENT — transcripts, prompts, questions, answers, evidence.
 *      Redacted at 'standard' exactly as before. KEPT VERBATIM at 'full',
 *      because that content is the entire point of a debug capture: a log
 *      that hides the answer cannot tell you why the answer was wrong.
 *
 * 'full' is opt-in from Settings > General > Advanced and writes the user's
 * own conversations to their own machine. It never relaxes axis 1.
 *
 * This module is intentionally framework-free and side-effect-free so it can
 * be safely required from both main and preload.
 */

const REDACTED = '[REDACTED]';
const REMOVED = '[REMOVED]';

/** String cap at 'standard'. Unchanged from the original implementation. */
const MAX_PREVIEW_LEN = 120;
/**
 * String cap at 'full'. Not unbounded: a stray base64 image or a whole PDF
 * body would still turn one log line into megabytes and push the 10MB
 * rotation over before the session it documents is finished.
 */
const MAX_FULL_LEN = 8000;

export type LogRedactionLevel = 'standard' | 'full';

// ── level binding ───────────────────────────────────────────────────────────
//
// Anchored on globalThis, NOT a module-local `let`. scripts/build-electron.js
// runs esbuild with bundle:true over every .ts as its own entry point, so this
// module is INLINED into each bundle — main.js, ipcHandlers.js and
// IntelligenceEngine.js would otherwise each get their own private copy of the
// flag, and the one main.ts sets would be invisible to the others. Same
// inversion SettingsManager and the context-debug modules use.
const LEVEL_KEY = '__nativelyLogRedactionLevelV1__';

interface LevelHolder { level: LogRedactionLevel }

function holder(): LevelHolder {
    const g = globalThis as unknown as Record<string, LevelHolder | undefined>;
    let h = g[LEVEL_KEY];
    if (!h) {
        h = { level: 'standard' };
        g[LEVEL_KEY] = h;
    }
    return h;
}

/** Current level. Defaults to 'standard' — the pre-2026-09-03 behavior. */
export function getLogRedactionLevel(): LogRedactionLevel {
    try { return holder().level; } catch { return 'standard'; }
}

/** Set by AppState when the user changes Settings > General > Advanced. */
export function setLogRedactionLevel(level: LogRedactionLevel): void {
    try { holder().level = level === 'full' ? 'full' : 'standard'; } catch { /* best-effort */ }
}

/**
 * Credential-shaped property keys. ALWAYS redacted — this list is never
 * consulted against the level. Suffix-matched (no leading anchor), so
 * `xApiKey`, `userToken` and `refreshToken` all match.
 */
const CREDENTIAL_KEY_RE = /(api[_-]?key|authorization|bearer|token|secret|password|credential|cookie|set[_-]?cookie|signature|x[_-]?api[_-]?key|x[_-]?trial[_-]?token|x[_-]?natively[_-]?key)$/i;

/**
 * User-content property keys. Redacted at 'standard', kept at 'full'.
 * These are diagnostics, not secrets — the split from CREDENTIAL_KEY_RE is
 * the whole point of this module.
 */
const CONTENT_KEY_RE = /(raw[_-]?(transcript|prompt|reference|content|query)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response|message)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|answer|^content$|^text$|^output$|ai[_-]?response|full[_-]?answer|full[_-]?prompt|full[_-]?text)$/i;

/**
 * Content keys whose value is REMOVED rather than redacted at 'standard',
 * because they are guaranteed bulky raw content where even a 120-char preview
 * leaks. At 'full' these are kept like any other content key.
 *
 * `base64` and `audio[_-]?data` are the exception: they stay REMOVED at every
 * level. They are never human-readable, so keeping them helps no diagnosis
 * while reliably blowing out the log budget.
 */
const REMOVE_VALUE_KEY_RE = /(raw[_-]?(transcript|prompt|reference|content|query)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?)$/i;
const ALWAYS_REMOVE_KEY_RE = /(base64|audio[_-]?data)$/i;

/**
 * Substring patterns that scrub credential-shaped sequences out of free-text
 * (e.g., a log line like "auth: Bearer abc123def..." that wasn't wrapped in a
 * nice property bag). ALWAYS applied, at every level.
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
 *
 * `level` defaults to the process-wide binding; pass it explicitly in tests so
 * they never depend on global state.
 */
export function redactForLog(args: unknown[], level: LogRedactionLevel = getLogRedactionLevel()): string {
    return args
        .map(arg => formatOne(arg, level))
        .join(' ');
}

/**
 * Lower-level redactor that returns a sanitized clone of any value. Useful
 * for code that wants to log a structured object rather than a string and
 * still wants the redaction to apply.
 */
export function redactValue(value: unknown, level: LogRedactionLevel = getLogRedactionLevel()): unknown {
    return sanitize(value, new WeakSet(), level);
}

/**
 * Credential-only sanitizer. Strips secrets but keeps ALL user content and
 * full-length strings, whatever the level.
 *
 * For trace producers that already hand-pick their fields and stringify them
 * themselves ([V3], [TRACE:ANSWER]). Those payloads reach redactForLog as
 * strings, so they get VALUE_PATTERNS but no key-level scrubbing at all —
 * routing them through this before JSON.stringify closes that hole without
 * costing the fidelity they exist to provide.
 */
export function redactSecretsOnly(value: unknown): unknown {
    // UNCAPPED. Before these payloads were routed through here they reached
    // redactForLog as pre-stringified strings, so sanitize() never ran and the
    // answer was emitted whole at any length. Reusing the 'full' cap would
    // have silently clipped coding answers at 8000 chars while
    // wta-read-session.mjs --full still advertised "untruncated".
    // The cap exists to stop base64 blobs blowing the 10MB rotation, and
    // ALWAYS_REMOVE_KEY_RE already drops those by key.
    return sanitize(value, new WeakSet(), 'full', Number.POSITIVE_INFINITY);
}

function formatOne(arg: unknown, level: LogRedactionLevel): string {
    if (arg instanceof Error) {
        const base = arg.stack || arg.message || 'Error';
        return scrubString(base);
    }
    if (typeof arg === 'object' && arg !== null) {
        try {
            return JSON.stringify(sanitize(arg, new WeakSet(), level));
        } catch {
            return '[Unserializable]';
        }
    }
    if (typeof arg === 'string') return scrubString(arg);
    if (typeof arg === 'bigint') return arg.toString();
    if (typeof arg === 'undefined') return 'undefined';
    return String(arg);
}

function sanitize(
    value: unknown,
    seen: WeakSet<object>,
    level: LogRedactionLevel,
    // Explicit cap rather than one derived from `level`, so redactSecretsOnly
    // can keep strings whole. Deriving it silently clipped [TRACE:ANSWER] at
    // 8000 chars — the one field the full capture exists to expose.
    maxLen: number = level === 'full' ? MAX_FULL_LEN : MAX_PREVIEW_LEN,
): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
        const scrubbed = scrubString(value);
        return scrubbed.length > maxLen ? scrubbed.slice(0, maxLen) : scrubbed;
    }
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
        return value.map(item => sanitize(item, seen, level, maxLen)).filter(item => item !== undefined);
    }

    if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);

        const full = level === 'full';
        const output: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            // Axis 1 — credentials. Checked FIRST and never gated on level, so
            // a key matching both lists (e.g. a hypothetical `promptToken`)
            // resolves as a credential rather than as content.
            if (CREDENTIAL_KEY_RE.test(key)) {
                output[key] = REDACTED;
            } else if (ALWAYS_REMOVE_KEY_RE.test(key)) {
                output[key] = REMOVED;
            // Axis 2 — user content. This is the only level-dependent branch.
            } else if (!full && REMOVE_VALUE_KEY_RE.test(key)) {
                output[key] = REMOVED;
            } else if (!full && CONTENT_KEY_RE.test(key)) {
                output[key] = REDACTED;
            } else {
                const sanitized = sanitize(child, seen, level, maxLen);
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
