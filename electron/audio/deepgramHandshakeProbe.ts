/**
 * Why a Deepgram live socket never opened.
 *
 * The SDK (v3) uses Node's built-in WebSocket, which reports a refused
 * handshake only as a generic network error: no HTTP status. A wrong key
 * (401), a key without listen scope (403) and an empty balance (402) all
 * looked like a dropped connection, so a meeting ran ten reconnects with
 * "[object Event]" in the overlay and then retried on every audio chunk.
 *
 * This repeats the handshake once with the `ws` package, which exposes the
 * refusal (`unexpected-response`), exactly as Settings' "Test connection"
 * does (ipcHandlers.ts test-stt-connection). It sends no audio.
 */
import WebSocket from 'ws';

export interface DeepgramHandshakeResult {
    /** 101 when the socket opened; the refusal's status otherwise. */
    status: number;
    body: string;
}

const PROBE_TIMEOUT_MS = 10_000;

export function probeDeepgramHandshake(apiKey: string, model: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<DeepgramHandshakeResult | null> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (result: DeepgramHandshakeResult | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { ws.removeAllListeners(); ws.on('error', () => { /* closing */ }); ws.terminate(); } catch { /* already closed */ }
            resolve(result);
        };
        const url = `wss://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&encoding=linear16&sample_rate=16000&channels=1`;
        const ws = new WebSocket(url, { headers: { Authorization: `Token ${apiKey.trim()}` } });
        const timer = setTimeout(() => done(null), timeoutMs);
        ws.on('open', () => done({ status: 101, body: '' }));
        ws.on('unexpected-response', (_req: unknown, res: any) => {
            const status = Number(res?.statusCode) || 0;
            let body = '';
            res.on('data', (chunk: Buffer) => { if (body.length < 2000) body += chunk.toString(); });
            res.on('end', () => done({ status, body }));
            res.on('error', () => done({ status, body }));
        });
        ws.on('error', () => done(null));
    });
}

/**
 * The terminal error for a refused handshake, or null when the refusal is
 * not a verdict on the key or account (timeouts, 5xx, a 400 on parameters):
 * those keep the normal reconnect path.
 */
export function deepgramHandshakeVerdict(result: DeepgramHandshakeResult | null): Error | null {
    if (!result) return null;
    const { status } = result;
    if (status !== 401 && status !== 402 && status !== 403) return null;
    let detail = '';
    try {
        const parsed = JSON.parse(result.body);
        detail = String(parsed?.err_msg || parsed?.message || parsed?.err_code || '').trim();
    } catch {
        detail = result.body.trim().slice(0, 200);
    }
    const what = status === 401
        ? 'Deepgram rejected the API key (invalid API key)'
        : status === 402
            ? 'Deepgram account is out of credits (insufficient_funds)'
            : 'Deepgram key lacks permission for live transcription';
    const message = detail ? `${what}: ${detail}` : what;
    return Object.assign(new Error(message), { httpStatus: status, terminal: true, code: `deepgram_${status}` });
}
