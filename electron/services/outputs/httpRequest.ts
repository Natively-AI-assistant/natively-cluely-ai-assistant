// The one way outputs talk to Slack, Notion and the CRMs: from the main process,
// with a timeout, an abort signal, a cap on what is sent and on what is read
// back, and failures sorted into causes the UI can word plainly. `fetchImpl` is
// injected so tests never touch the network.

import type { ConnectionErrorKind } from '../../../src/types/meetingOutputs';

export type FetchLike = (url: string, init?: any) => Promise<{
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    body?: any;
    text(): Promise<string>;
}>;

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 1024 * 1024;

export class ConnectionError extends Error {
    constructor(
        public readonly kind: ConnectionErrorKind,
        detail?: string,
        /** The HTTP status and a short start of the body, for callers that branch on them. Never shown. */
        public readonly status?: number,
        public readonly bodyStart?: string,
    ) {
        super(detail || kind);
        this.name = 'ConnectionError';
    }
}

export interface RequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    /** Sent as JSON. */
    json?: unknown;
    timeoutMs?: number;
    maxResponseBytes?: number;
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
}

export interface HttpResponse {
    status: number;
    text: string;
    /** Parsed body, or undefined when it is not JSON. */
    data?: any;
}

export function kindForStatus(status: number): ConnectionErrorKind {
    if (status === 401) return 'auth';
    if (status === 403) return 'forbidden';
    if (status === 404 || status === 410) return 'not_found';
    if (status === 413) return 'too_large';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'server';
    if (status >= 400) return 'invalid_input';
    return 'unknown';
}

async function readCapped(res: Awaited<ReturnType<FetchLike>>, maxBytes: number): Promise<string> {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new ConnectionError('too_large', 'response over the size cap');
    const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
    if (!reader) {
        const text = await res.text();
        if (Buffer.byteLength(text) > maxBytes) throw new ConnectionError('too_large', 'response over the size cap');
        return text;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            try { await reader.cancel(); } catch { /* already closed */ }
            throw new ConnectionError('too_large', 'response over the size cap');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * One HTTPS request. Resolves for 2xx; throws ConnectionError otherwise. Only
 * https URLs are accepted (tests use https URLs against a fake fetch).
 */
export async function httpRequest(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new ConnectionError('invalid_input', 'bad url'); }
    if (parsed.protocol !== 'https:') throw new ConnectionError('invalid_input', 'not https');

    const body = opts.json === undefined ? undefined : JSON.stringify(opts.json);
    if (body !== undefined && Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new ConnectionError('too_large', 'request over the size cap');

    const fetchImpl: FetchLike = opts.fetchImpl || (globalThis.fetch as unknown as FetchLike);
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

    let res: Awaited<ReturnType<FetchLike>>;
    try {
        res = await fetchImpl(url, {
            method: opts.method || (body !== undefined ? 'POST' : 'GET'),
            headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/json', ...(opts.headers || {}) },
            body,
            signal,
            redirect: 'error',
        });
    } catch (err: any) {
        if (timeout.aborted) throw new ConnectionError('timeout');
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw new ConnectionError(timeout.aborted ? 'timeout' : 'network', 'aborted');
        throw new ConnectionError('network', err?.message);
    }

    let text: string;
    try {
        text = await readCapped(res, opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
    } catch (err: any) {
        if (err instanceof ConnectionError) throw err;
        throw new ConnectionError(timeout.aborted ? 'timeout' : 'network', err?.message);
    }
    let data: any;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    if (!res.ok) throw new ConnectionError(kindForStatus(res.status), `status ${res.status}`, res.status, text.slice(0, 200));
    return { status: res.status, text, data };
}

/** The plain-words sentence for a failure, naming the service. Never a status or a code. */
export function describeConnectionError(kind: ConnectionErrorKind | undefined, service: string): string {
    switch (kind) {
        case 'not_connected': return `${service} is not connected. Add it in Settings, Connectors.`;
        case 'invalid_input': return `${service} did not accept what was sent. Check the details and try again.`;
        case 'auth': return `${service} did not accept the token. It may have been revoked or mistyped. Paste a new one in Settings, Connectors.`;
        case 'forbidden': return `The token works, but it is not allowed to do this in ${service}. Check the permissions it was given.`;
        case 'not_found': return `${service} could not find where to send this. It may have been deleted or not shared with the integration.`;
        case 'rate_limited': return `${service} is asking us to slow down. Wait a minute and try again.`;
        case 'timeout': return `${service} took too long to answer. Check your connection and try again.`;
        case 'network': return `Could not reach ${service}. Check your internet connection and try again.`;
        case 'server': return `${service} is having trouble right now. Try again in a few minutes.`;
        case 'too_large': return `This is too large to send to ${service}.`;
        case 'storage_unavailable': return 'This computer has no secure storage available, so the token is kept until Natively quits.';
        case 'pro_required': return `${service} is a connector, and connectors are part of Natively Pro. Upgrade in Settings, Plans & Billing.`;
        default: return `Something went wrong talking to ${service}. Try again.`;
    }
}

export function errorKindOf(err: unknown): ConnectionErrorKind {
    return err instanceof ConnectionError ? err.kind : 'unknown';
}
