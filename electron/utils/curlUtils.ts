import curl2Json from "@bany/curl-to-json";
import fs from "node:fs";
import path from "node:path";

export interface CurlValidationResult {
    isValid: boolean;
    message?: string;
    json?: any;
}

// Placeholder rules live in one dependency-free module shared with the renderer
// and the IPC boundary — see curlPlaceholderPolicy for why.
import {
    TEXT_PLACEHOLDER_RE,
    placeholderReachesTheWire,
    explainMissingPlaceholder,
} from '../../src/lib/curlPlaceholderPolicy';

/**
 * Validates if the cURL command is parseable and contains required variables
 */
export const validateCurl = (curl: string): CurlValidationResult => {
    if (!curl || !curl.trim()) {
        return { isValid: false, message: "Command cannot be empty." };
    }

    if (!curl.trim().toLowerCase().startsWith("curl")) {
        return { isValid: false, message: "Command must start with 'curl'." };
    }

    try {
        const json = curl2Json(curl);

        // Ensure {{TEXT}} is present so we can inject the prompt.
        // We check the raw string for the placeholder because it might be in url, header, or body.
        // Spacing is tolerated to match deepVariableReplacer, which substitutes
        // `{{ TEXT }}` as readily as `{{TEXT}}`.
        if (!TEXT_PLACEHOLDER_RE.test(curl)) {
            return {
                isValid: false,
                message: "Your cURL must contain {{TEXT}} placeholder for the prompt."
            };
        }

        // A body that isn't valid JSON does not fail loudly: curl2Json returns
        // `data: {}` for it, so the placeholders vanish and the request goes out
        // as an empty POST with the prompt silently dropped. The usual cause is
        // an unquoted placeholder — `{"prompt": {{TEXT}}}` instead of
        // `{"prompt": "{{TEXT}}"}`. Catch it here, where the user can still fix
        // the template, rather than at dispatch where nothing acts on it.
        if (!placeholderReachesTheWire(json)) {
            // The placeholder survived the raw string but not the parse. Which of
            // the two causes it was, and the copy for each, is decided in one
            // place — see curlPlaceholderPolicy for why (this logic used to be
            // written out three times, which is how it drifted).
            return { isValid: false, message: explainMissingPlaceholder(json) };
        }

        return { isValid: true, json };
    } catch (error) {
        return { isValid: false, message: "Invalid cURL syntax." };
    }
};

/**
 * Replaces {{KEY}} placeholders with actual values
 */
export function deepVariableReplacer(
    node: any,
    variables: Record<string, string>
): any {
    if (typeof node === "string") {
        let result = node;
        for (const [key, value] of Object.entries(variables)) {
            // Global replace of {{KEY}}, tolerating inner whitespace.
            //
            // `\s*` is load-bearing, not cosmetic: customProviderSupportsVision
            // accepts `{{ IMAGE_BASE64 }}` as proof the template can carry an
            // image, so a template written that way was admitted to the vision
            // chain and then shipped the LITERAL string `{{ IMAGE_BASE64 }}` as
            // its image field. Detection and substitution have to agree on the
            // same shape. validateCurl accepts the spaced {{ TEXT }} for the
            // same reason.
            //
            // The replacement is a FUNCTION, not the raw string. As a string,
            // `$&`, "$`", `$'` and `$1` are replacement PATTERNS, so a prompt
            // asking what `$&` means in sed rewrote itself to contain
            // `{{TEXT}}`, and "$`" spliced in preceding payload text. The
            // function form takes the value literally. Base64 is unaffected
            // (no `$` in the alphabet); prompts and context were not.
            result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), () => value);
        }
        return result;
    }
    if (Array.isArray(node)) {
        return node.map((item) => deepVariableReplacer(item, variables));
    }
    if (node && typeof node === "object") {
        const newNode: { [key: string]: any } = {};
        for (const key in node) {
            newNode[key] = deepVariableReplacer(node[key], variables);
        }
        return newNode;
    }
    return node;
}

/**
 * Substitute template variables into the three surfaces an executor sends,
 * escaping each for the surface it lands on.
 *
 * WHY THIS EXISTS (2026-09-04): the values must NOT be pre-escaped for the body
 * — curl2Json parses `-d` into an object and axios serializes it, so escaping
 * there produced double escaping (`\"` and `\n` reaching the model literally).
 * That fix was right, but it was applied to one `variables` object shared by all
 * three surfaces, and the URL and headers are not JSON-serialized by anything:
 *
 *   • A header value cannot contain CR/LF. Node throws ERR_INVALID_CHAR and the
 *     turn dies — and a template with `{{TEXT}}` in an auth or metadata header
 *     is a common gateway pattern, so any multi-line prompt killed it. Left
 *     unescaped it is also textbook CRLF header injection.
 *   • A URL silently DROPS a raw newline (`?q=a b\nc` → `?q=a%20bc`, verified),
 *     so the prompt is corrupted rather than rejected.
 *
 * Each surface therefore gets the variables escaped its own way, and the body
 * keeps the raw values it correctly wants.
 */
export function applyCurlVariables(
    config: { url?: any; header?: any; data?: any },
    variables: Record<string, string>,
): { url: any; headers: any; data: any } {
    // Header values: strip characters a header cannot carry. Removing rather
    // than encoding is right — a header is not a percent-encoded surface, and a
    // prompt's newlines carry no meaning to a gateway reading it as one value.
    const forHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(variables)) {
        forHeaders[k] = String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ');
    }
    // URL: percent-encode. The placeholder virtually always sits in a query
    // value, and an unencoded `&`, `#` or space rewrites the request shape.
    const forUrl: Record<string, string> = {};
    for (const [k, v] of Object.entries(variables)) {
        forUrl[k] = encodeURIComponent(String(v ?? ''));
    }
    return {
        url: deepVariableReplacer(config.url, forUrl),
        headers: deepVariableReplacer(config.header || {}, forHeaders),
        // Raw — see above. The serializer escapes this one.
        data: deepVariableReplacer(config.data || {}, variables),
    };
}

/**
 * Detects MIME type from a file path's extension.
 * Defaults to "image/png" because the app's ScreenshotHelper exclusively produces .png files.
 */
export function imageMimeTypeFromPath(filePath: string): string {
    // Extract only the final extension component, guarding against paths with no dot
    const basename = filePath.split(/[/\\]/).pop() ?? "";
    const dotIdx = basename.lastIndexOf(".");
    const ext = dotIdx !== -1 ? basename.slice(dotIdx + 1).toLowerCase() : "";
    const map: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
    };
    return map[ext] ?? "image/png";
}

/**
 * Auto-upgrades the last user message in an OpenAI-compatible `messages` array
 * from a plain string to a multimodal content array when a base64 image is present.
 *
 * - If `body.messages` is not an array, returns `body` unchanged (no-op for non-OpenAI formats).
 * - If the last user message already contains an image_url part, it is not duplicated.
 * - If the content is already a multimodal array (e.g. user manually included {{IMAGE_BASE64}}
 *   in an image_url field), the image is appended only if not already present.
 * - All other messages and body fields are left untouched (fully backward-compatible).
 */
export function injectImageIntoMessages(
    body: any,
    base64Image: string,
    imagePath: string
): any {
    if (!base64Image || !Array.isArray(body?.messages)) return body;

    const messages: any[] = body.messages.slice();

    // Find the last user-role message
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === "user") {
            lastUserIdx = i;
            break;
        }
    }
    if (lastUserIdx === -1) return body;

    const lastUser = messages[lastUserIdx];
    const mimeType = imageMimeTypeFromPath(imagePath);
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    if (Array.isArray(lastUser.content)) {
        // Already a multimodal array — append image_url only if absent
        const alreadyHasImage = lastUser.content.some(
            (part: any) => part?.type === "image_url"
        );
        if (alreadyHasImage) return body;
        messages[lastUserIdx] = {
            ...lastUser,
            content: [
                ...lastUser.content,
                { type: "image_url", image_url: { url: imageUrl } },
            ],
        };
    } else if (typeof lastUser.content === "string") {
        // Plain string → standard OpenAI multimodal array
        messages[lastUserIdx] = {
            ...lastUser,
            content: [
                { type: "text", text: lastUser.content },
                { type: "image_url", image_url: { url: imageUrl } },
            ],
        };
    }
    // Non-string, non-array content (e.g. null/undefined): leave untouched

    return { ...body, messages };
}

/**
 * Validates a URL to prevent SSRF attacks.
 * Returns { isValid: true } if the URL is safe to fetch.
 * Returns { isValid: false, reason: string } if the URL is blocked.
 *
 * Blocks:
 * - localhost, 127.0.0.1, ::1 (loopback)
 * - 0.0.0.0
 * - link-local (169.254.0.0/16)
 * - private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Protocol-relative URLs (//example.com)
 * - Path traversal sequences (/../)
 */
export function validateUrlForSsrf(urlString: string): { isValid: boolean; reason?: string } {
    if (!urlString || typeof urlString !== 'string') {
        return { isValid: false, reason: 'URL must be a non-empty string' };
    }

    // Block protocol-relative URLs
    if (urlString.startsWith('//')) {
        return { isValid: false, reason: 'Protocol-relative URLs are not allowed' };
    }

    // Block data: URLs
    if (urlString.toLowerCase().startsWith('data:')) {
        return { isValid: false, reason: 'Data URLs are not allowed' };
    }

    // Block file: URLs
    if (urlString.toLowerCase().startsWith('file:')) {
        return { isValid: false, reason: 'File URLs are not allowed' };
    }

    // Block javascript: URLs
    if (urlString.toLowerCase().startsWith('javascript:')) {
        return { isValid: false, reason: 'JavaScript URLs are not allowed' };
    }

    let url: URL;
    try {
        url = new URL(urlString);
    } catch (e) {
        return { isValid: false, reason: 'Invalid URL format' };
    }

    const hostname = url.hostname.toLowerCase();
    const bareHostname = hostname.replace(/^\[/, '').replace(/\]$/, '');

    // Block localhost variants (the entire 127.0.0.0/8 range is loopback, not
    // just 127.0.0.1 — e.g. 127.0.0.2 also routes to the local machine).
    if (hostname === 'localhost' || hostname.startsWith('127.') || bareHostname === '::1' || hostname === '0.0.0.0') {
        return { isValid: false, reason: 'Loopback addresses are not allowed' };
    }

    // Reject non-dotted numeric hostnames before DNS/canonicalization tricks can
    // reinterpret them as IPv4 (e.g. https://2130706433/ → 127.0.0.1 in some stacks).
    if (/^(?:0x[0-9a-f]+|\d+)$/i.test(bareHostname)) {
        return { isValid: false, reason: 'Encoded IP hostnames are not allowed' };
    }

    // Block link-local IPv4 (169.254.x.x) and IPv6 (fe80::/10).
    if (hostname.startsWith('169.254.') || /^fe[89ab][0-9a-f]*:/i.test(bareHostname)) {
        return { isValid: false, reason: 'Link-local addresses are not allowed' };
    }

    // Block IPv6 unique-local/private (fc00::/7 — fc* and fd*).
    if (/^f[cd][0-9a-f]*:/i.test(bareHostname)) {
        return { isValid: false, reason: 'Private IPv6 networks are not allowed' };
    }

    // Block private network ranges
    // 10.0.0.0/8
    if (hostname.startsWith('10.')) {
        return { isValid: false, reason: 'Private network (10.x.x.x) is not allowed' };
    }

    // 172.16.0.0/12 — 172.16.x.x through 172.31.x.x
    if (hostname.startsWith('172.')) {
        const secondOctet = parseInt(hostname.split('.')[1], 10);
        if (secondOctet >= 16 && secondOctet <= 31) {
            return { isValid: false, reason: 'Private network (172.16-31.x.x) is not allowed' };
        }
    }

    // 192.168.0.0/16
    if (hostname.startsWith('192.168.')) {
        return { isValid: false, reason: 'Private network (192.168.x.x) is not allowed' };
    }

    // Block URLs with path traversal
    if (urlString.includes('/../') || urlString.includes('/..\\')) {
        return { isValid: false, reason: 'Path traversal sequences are not allowed' };
    }

    // Require HTTPS for external URLs. All loopback/localhost hosts are already
    // rejected above, so no http exemption is needed here.
    if (url.protocol !== 'https:') {
        return { isValid: false, reason: 'Only HTTPS URLs are allowed' };
    }

    return { isValid: true };
}

/**
 * SECURITY: cloud/container METADATA endpoints, which are never a legitimate
 * LLM host.
 *
 * This is deliberately NOT validateUrlForSsrf. That function blocks loopback
 * and all of RFC-1918 — exactly the hosts a custom provider exists to reach
 * (Ollama on 127.0.0.1, LM Studio on the LAN, llama.cpp on localhost), which is
 * why it was removed from chatWithCurl rather than copied into the two live
 * executors. The classic SSRF threat model also does not transfer: the URL is
 * the local user's own configuration in a desktop app running with their own
 * privileges, so reaching an internal host grants no access they did not
 * already have, and exfiltration to a PUBLIC attacker host — the real risk in a
 * pasted-cURL scenario — was never something that function blocked.
 *
 * What remains worth refusing is the narrow set of link-local metadata
 * addresses: they hand out ambient cloud credentials, they are unreachable by
 * design from a normal desktop, and nobody serves a model on them. Blocking
 * them costs no legitimate configuration.
 *
 * SCOPE, stated honestly because the previous docblock over-promised: this
 * matches the ADDRESS a URL literally names, after normalisation. It does NOT
 * resolve DNS, so a hostname that resolves to a metadata address still passes —
 * closing that would need a lookup on every request plus a TOCTOU-prone
 * re-check at connect time, which is not what this narrow guard is for. It is a
 * guard against the obvious literal, not a general SSRF control.
 *
 * Returns a reason string when the host is refused, or null when it is fine.
 */
const METADATA_REASON = 'cloud metadata endpoints are not valid model hosts';

/**
 * The dotted-quad an address-shaped hostname denotes, or null.
 *
 * `URL` already folds the octal and integer spellings of an IPv4 literal
 * (`0251.0376.0251.0376`, `2852039166`) down to dotted-quad — verified — so the
 * only form left to fold is IPv6-mapped IPv4. Node prints that in its compressed
 * hex form: `http://[::ffff:169.254.169.254]` arrives as `::ffff:a9fe:a9fe`,
 * which matched none of the literals this function used to compare against and
 * so walked straight past it (code review, 2026-09-04).
 */
function ipv4FromHostname(host: string): string | null {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
    const mapped = /^::ffff:(.+)$/i.exec(host);
    if (!mapped) return null;
    const rest = mapped[1];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return rest;          // ::ffff:169.254.169.254
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);    // ::ffff:a9fe:a9fe
    if (!hex) return null;
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

export function blockedInfrastructureHost(urlString: string): string | null {
    let host: string;
    try {
        host = new URL(urlString).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    } catch {
        return null; // not a URL we can classify; the request will fail on its own
    }

    // GCP's DNS aliases.
    if (host === 'metadata.google.internal' || host === 'metadata') return METADATA_REASON;
    // AWS IPv6 IMDS.
    if (host === 'fd00:ec2::254') return METADATA_REASON;

    const ipv4 = ipv4FromHostname(host);
    if (!ipv4) return null;

    // The whole link-local /16, not the two literals it used to name. AWS/Azure/
    // GCP IMDS (169.254.169.254) and ECS task metadata (169.254.170.2) both live
    // here, the block is autoconfiguration-only, and nothing serves a model on
    // it — so the wider net costs no legitimate configuration and cannot be
    // stepped around by picking a neighbouring address.
    if (/^169\.254\./.test(ipv4)) return METADATA_REASON;
    // Providers whose metadata service sits outside link-local.
    if (ipv4 === '100.100.100.200') return METADATA_REASON; // Alibaba Cloud
    if (ipv4 === '192.0.0.192') return METADATA_REASON;     // Oracle Cloud

    return null;
}

/**
 * SECURITY: Validates an STT provider "region" slug before it is interpolated
 * into a provider endpoint hostname (Azure / IBM Watson).
 *
 * The region is renderer-supplied and is placed *directly into the host* of the
 * outbound, API-key-bearing request, e.g.
 *   https://${region}.stt.speech.microsoft.com/...
 *   https://api.${region}.speech-to-text.watson.cloud.ibm.com/...
 * Without validation a value like `evil.com/x#` or `foo.attacker.net` would
 * redirect the key to an attacker-controlled host (SSRF + credential exfil).
 *
 * Real Azure/IBM regions are short lowercase slugs (letters, digits, hyphen),
 * e.g. `eastus`, `westeurope`, `us-south`, `eu-gb`. We allow exactly that shape.
 * Empty is allowed (callers fall back to a hardcoded default region).
 */
export function isValidSttRegion(region: unknown): boolean {
    if (region === undefined || region === null || region === '') return true;
    if (typeof region !== 'string') return false;
    // 1–40 chars, lowercase alphanumerics and single hyphens only. No dots,
    // slashes, `@`, `#`, whitespace, or uppercase — anything that could break
    // out of the host label or introduce credentials/paths into the URL.
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(region) && region.length <= 40;
}

/**
 * SECURITY: Validates a user-supplied OpenAI-compatible STT base URL.
 *
 * Reuses validateUrlForSsrf so a renderer cannot point the STT upload (which
 * carries the user's OpenAI key) at a loopback/private/non-HTTPS host. Empty is
 * allowed (falls back to https://api.openai.com). Returns a normalized result
 * shaped like the other validators in this module.
 */
export function validateSttBaseUrl(url: unknown): { isValid: boolean; reason?: string } {
    if (url === undefined || url === null || url === '') return { isValid: true };
    if (typeof url !== 'string') return { isValid: false, reason: 'Base URL must be a string' };
    const trimmed = url.trim();
    if (trimmed === '') return { isValid: true };
    return validateUrlForSsrf(trimmed);
}

/**
 * SECURITY (P0): Validates that an image path is safe to use.
 *
 * Uses realpath resolution to detect symlink escapes and provides
 * defense-in-depth against path traversal attacks.
 *
 * Blocks:
 * - Path traversal sequences (/../ or /..\)
 * - Absolute paths outside app-owned directories
 * - Sensitive system paths (/etc/, /home/, /var/, etc.)
 * - Windows drive paths (C:\, D:\, etc.)
 * - Symlink escapes to directories outside allowed roots
 *
 * Allowed paths (allowlist):
 * - Paths inside userData directory
 * - Paths inside <userData>/screenshots/
 * - Paths inside <userData>/extra_screenshots/
 * - Any other explicitly created app-owned screenshot directories
 *
 * @param imagePath - The path to validate
 * @param userDataPath - The app's userData directory path
 * @returns { isValid: boolean, reason?: string }
 */
export function validateImagePath(imagePath: string, userDataPath: string): { isValid: boolean; reason?: string } {
    if (!imagePath || typeof imagePath !== 'string') {
        return { isValid: false, reason: 'Image path must be a non-empty string' };
    }

    // Normalize path separators
    const normalizedPath = imagePath.replace(/\\/g, '/');

    // Block path traversal
    if (normalizedPath.includes('/../') || normalizedPath.includes('/..\\')) {
        return { isValid: false, reason: 'Path traversal sequences are not allowed' };
    }

    // NOTE: the Windows-drive-path check lives AFTER the allowlist below, not here.
    // On Windows, userData is itself an absolute drive path
    // (e.g. C:\Users\<user>\AppData\Roaming\natively), so every legitimate
    // screenshot path starts with a drive letter. Rejecting drive paths up front
    // blocked the app's own screenshots before the allowlist could approve them
    // (issue #304). This mirrors the Unix-absolute-path blocks, which also run
    // after the allowlist.

    // Normalize userDataPath for comparison
    const normalizedUserData = userDataPath.replace(/\\/g, '/');

    // Define allowed roots (app-owned directories only)
    const allowedRoots = [
        normalizedUserData,
        path.join(normalizedUserData, 'screenshots').replace(/\\/g, '/'),
        path.join(normalizedUserData, 'extra_screenshots').replace(/\\/g, '/'),
    ].filter(Boolean);

    // Resolve the image path to its real path to detect symlink escapes
    let resolvedPath: string;
    try {
        resolvedPath = fs.realpathSync(imagePath);
        resolvedPath = resolvedPath.replace(/\\/g, '/');
    } catch {
        // If realpath fails, the file doesn't exist or is inaccessible.
        // We still want to validate the requested path for security.
        // Check if the requested path itself is safe (not crossing boundaries).
        resolvedPath = normalizedPath;
    }

    // Normalize userData for comparison (ensure trailing slash for prefix matching)
    const normalizedUserDataWithSlash = normalizedUserData ? normalizedUserData.replace(/\/?$/, '/') : '';

    // Check if resolved path is within any allowed root
    const isAllowed = allowedRoots.some(allowedRoot => {
        const allowedWithSlash = allowedRoot.replace(/\/?$/, '/');
        return resolvedPath.startsWith(allowedWithSlash) || resolvedPath === allowedRoot;
    });

    if (isAllowed) {
        return { isValid: true };
    }

    // Also check the original path against allowed roots as fallback
    // This handles cases where the resolved path is the same as normalized
    const originalIsAllowed = allowedRoots.some(allowedRoot => {
        const allowedWithSlash = allowedRoot.replace(/\/?$/, '/');
        return normalizedPath.startsWith(allowedWithSlash) || normalizedPath === allowedRoot;
    });

    if (originalIsAllowed) {
        return { isValid: true };
    }

    // Block Windows drive paths that are outside userData (e.g. C:\Windows\System32,
    // D:\secrets, or another user's profile). Legitimate Windows screenshot paths
    // live under <userData> and were already allowed by the allowlist above.
    if (/^[A-Za-z]:\\/.test(imagePath)) {
        return { isValid: false, reason: 'Windows absolute paths are not allowed' };
    }

    // Block Unix absolute paths that are outside userData
    if (normalizedPath.startsWith('/etc/') ||
        normalizedPath.startsWith('/home/') ||
        normalizedPath.startsWith('/var/') ||
        normalizedPath.startsWith('/tmp/')) {
        return { isValid: false, reason: 'Paths outside app directory are not allowed' };
    }

    // Block paths that resolve outside allowed roots (symlink escape attempt)
    if (resolvedPath !== normalizedPath && !isAllowed) {
        return { isValid: false, reason: 'Symlink escape detected: path resolves outside allowed directory' };
    }

    // If we can't determine the path is safe, block it
    return { isValid: false, reason: 'Image path must be inside app directory or screenshots folder' };
}

/**
 * Helper to traverse a JSON object via dot notation (e.g. "choices[0].message.content")
 */
export function getByPath(obj: any, path: string): any {
    if (!path) return obj;
    return path
        .replace(/\[/g, ".")
        .replace(/\]/g, "")
        .split(".")
        .reduce((o, k) => (o || {})[k], obj);
}

/**
 * OpenAI Structured Outputs / JSON Schema mode still serializes message.content as a
 * JSON-encoded string rather than auto-flattening it, so a responsePath pointed at
 * that field extracts raw JSON text (e.g. '{"bullet_points": ["a", "b"]}') instead of
 * the intended array. Detect that shape and render it as text; returns null if the
 * string isn't JSON or doesn't match a recognizable list shape, so the caller can
 * fall back to the raw string untouched.
 */
export function flattenStructuredJsonAnswer(answer: string): string | null {
    let parsed: any;
    try {
        parsed = JSON.parse(answer);
    } catch {
        return null;
    }

    const toBulletList = (items: any[]): string =>
        items.map(item => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n');

    if (Array.isArray(parsed)) {
        return toBulletList(parsed);
    }

    if (parsed && typeof parsed === 'object') {
        const arrayValues = Object.values(parsed).filter(v => Array.isArray(v)) as any[][];
        if (arrayValues.length === 1) {
            return toBulletList(arrayValues[0]);
        }
        const keys = Object.keys(parsed);
        if (keys.length === 1 && typeof parsed[keys[0]] === 'string') {
            return parsed[keys[0]];
        }
    }

    return null;
}
