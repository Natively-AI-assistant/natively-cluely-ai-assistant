/**
 * The installed-app OAuth flow on a loopback redirect, with PKCE: the pattern
 * Google Calendar's connect uses (CalendarManager.startAuthFlow), for the
 * other calendar sources that sign in (Outlook).
 *
 * A server on a free loopback port waits for the provider's redirect; the
 * browser opens the provider's sign-in page; the code that comes back is
 * exchanged by the caller with the verifier only this process holds; the
 * browser tab gets Natively's callback page; the server closes. Five minutes
 * without an answer frees the port.
 *
 * Loopback only, never every interface: the callback carries an auth code, and
 * binding every interface raises the Windows Defender Firewall prompt.
 * "localhost" redirects (Microsoft's rule for public clients) are served on
 * 127.0.0.1 and, when the machine has it, ::1 on the same port, since a
 * browser may resolve localhost to either.
 */
import crypto from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import { describeOAuthError, renderOAuthCallbackPage, type OAuthCallbackProvider } from '../../oauth/callbackPage';
import { CalendarSourceError } from './types';

export function base64Url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export function pkcePair(): { verifier: string; challenge: string } {
    const verifier = base64Url(crypto.randomBytes(32));
    return { verifier, challenge: base64Url(crypto.createHash('sha256').update(verifier).digest()) };
}

export interface LoopbackAuthOptions {
    page: OAuthCallbackProvider;
    platform: NodeJS.Platform;
    /** The host the redirect URI names. The server always listens on loopback addresses only. */
    redirectHost: 'localhost' | '127.0.0.1';
    authUrl(redirectUri: string, codeChallenge: string, state: string): string;
    /** Exchanges the code; throws on failure. */
    exchange(code: string, codeVerifier: string, redirectUri: string): Promise<void>;
    openExternal(url: string): Promise<unknown> | unknown;
    /** The sentence the callback page and Settings show for a failed exchange. */
    failureReason(err: unknown): string;
    timeoutMs?: number;
    /** Names the sign-in in the port-failure message; "Calendar" by default. */
    label?: string;
    /** Aborting stops waiting: the port closes and the promise rejects. */
    signal?: AbortSignal;
}

export function runLoopbackAuth(opts: LoopbackAuthOptions): Promise<void> {
    const { verifier, challenge } = pkcePair();
    const state = base64Url(crypto.randomBytes(16));
    const servers: http.Server[] = [];

    return new Promise((resolve, reject) => {
        let settled = false;
        let redirectUri = '';
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            for (const s of servers) { try { s.close(); } catch { /* already closed */ } }
            clearTimeout(timeout);
            fn();
        };

        const handler: http.RequestListener = async (req, res) => {
            const qs = new URL(req.url || '/', 'http://127.0.0.1').searchParams;
            const code = qs.get('code');
            const error = qs.get('error');
            // Anything else (a favicon request, a stray probe) is not the redirect.
            if (!code && !error) {
                res.statusCode = 404;
                res.end();
                return;
            }
            const respond = (outcome: Parameters<typeof renderOAuthCallbackPage>[1]) => {
                const page = renderOAuthCallbackPage(opts.page, outcome, opts.platform);
                res.writeHead(200, page.headers);
                res.end(page.body);
            };
            if (qs.get('state') !== state) {
                respond({ kind: 'error', reason: 'This response belongs to a different sign-in attempt.' });
                finish(() => reject(new CalendarSourceError('That sign-in was for a different attempt. Connect again.')));
                return;
            }
            if (error) {
                const reason = describeOAuthError(error, qs.get('error_description'));
                respond({ kind: 'error', reason });
                finish(() => reject(new CalendarSourceError(reason, { cause: new Error(error) })));
                return;
            }
            try {
                await opts.exchange(code!, verifier, redirectUri);
                respond({ kind: 'connected' });
                finish(() => resolve());
            } catch (err) {
                const reason = opts.failureReason(err);
                respond({ kind: 'error', reason });
                finish(() => reject(err instanceof CalendarSourceError ? err : new CalendarSourceError(reason, { cause: err })));
            }
        };

        const timeout = setTimeout(() => {
            finish(() => reject(new CalendarSourceError('Sign-in wasn’t finished within five minutes. Connect again.')));
        }, opts.timeoutMs ?? 5 * 60_000);
        if (opts.signal) {
            const onAbort = () => finish(() => reject(new CalendarSourceError('Sign-in was cancelled.')));
            if (opts.signal.aborted) { onAbort(); return; }
            opts.signal.addEventListener('abort', onAbort, { once: true });
        }

        const primary = http.createServer(handler);
        servers.push(primary);
        primary.on('error', (err) => {
            finish(() => reject(new CalendarSourceError(`${opts.label ?? 'Calendar'} sign-in could not open a local callback port.`, { cause: err })));
        });
        // Port 0: the OS picks a free port. Both providers accept any loopback port.
        primary.listen(0, '127.0.0.1', () => {
            const address = primary.address() as AddressInfo | null;
            if (!address || typeof address === 'string') {
                finish(() => reject(new CalendarSourceError(`${opts.label ?? 'Calendar'} sign-in could not open a local callback port.`)));
                return;
            }
            redirectUri = `http://${opts.redirectHost}:${address.port}`;
            const open = () => { void Promise.resolve(opts.openExternal(opts.authUrl(redirectUri, challenge, state))).catch(() => {}); };
            if (opts.redirectHost !== 'localhost') {
                open();
                return;
            }
            // The same port on IPv6 loopback, when there is one; without it the
            // browser falls back to 127.0.0.1.
            const v6 = http.createServer(handler);
            servers.push(v6);
            v6.once('error', () => { try { v6.close(); } catch { /* never listened */ } open(); });
            v6.listen(address.port, '::1', open);
        });
    });
}
