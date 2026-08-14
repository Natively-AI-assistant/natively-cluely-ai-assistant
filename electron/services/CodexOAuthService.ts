/**
 * CodexOAuthService — ChatGPT OAuth (PKCE) login + token lifecycle for Codex
 *
 * Replaces the old `codex login` CLI subprocess flow (which required the user
 * to have @openai/codex installed) with a self-contained, in-app OAuth flow
 * that uses the public ChatGPT OAuth client_id and a loopback HTTP server for
 * the browser callback. Tokens are persisted via CredentialsManager (safeStorage-
 * encrypted) so they survive a restart.
 *
 * Constants come from the open-sse reference implementation at
 * codex.md:1149-1169 (PROVIDER_OAUTH.codex): the same client_id the official
 * codex CLI uses, the same authorize/token URLs, the same scope and PKCE
 * method (S256). This means a user signed in here is authenticated against
 * the same ChatGPT Codex account the codex CLI would have used, and the
 * resulting bearer token is accepted by https://api.openai.com/v1/responses
 * with the same backend routing as the official CLI.
 *
 * The flow:
 *   1. startLogin() — generates PKCE verifier+challenge + CSRF state, opens
 *      a loopback HTTP server on port 1455 (or the next free port if busy),
 *      and launches the system browser to the authorize URL. The server
 *      waits for /auth/callback with ?code=... or ?error=... and resolves
 *      a promise with the query params.
 *   2. exchangeCode() — POSTs the code+verifier to /oauth/token and gets
 *      { access_token, refresh_token, expires_in, id_token }.
 *   3. storeTokens() — persists the bundle via CredentialsManager (encrypted).
 *   4. getAccessToken() — returns a fresh bearer token, refreshing proactively
 *      5 minutes before expiry (matches open-sse TOKEN_EXPIRY_BUFFER_MS).
 *   5. refreshTokens() — exposed for IPC-driven force-refresh and for the
 *      401-retry path in CodexCliService. ChatGPT OAuth rotates refresh
 *      tokens on every successful refresh, so the new refresh_token MUST
 *      overwrite the stored one or the next refresh will fail with
 *      invalid_grant (see refreshCodexToken at codex.md:2151-2208).
 *
 * EventEmitter signals:
 *   'login:complete'  — fired on successful callback+exchange with the email
 *                       parsed from the id_token (best-effort; undefined if
 *                       no id_token).
 *   'login:failed'    — fired with an Error when callback errors out, the
 *                       user denies, the code exchange fails, or the
 *                       loopback server can't bind.
 *   'tokens:refreshed' — fired after a successful proactive/forced refresh
 *                        so the renderer can update its UI badge.
 *
 * Why no `codex` CLI binary dependency: the user was hitting "hit or miss"
 * failures because the old CodexCliService spawned `codex exec` and the
 * absence or staleness of the codex binary caused ENOENT / 1+ minute cold
 * loads. With OAuth, the binary is no longer required — we just need a
 * bearer token, and the streaming happens over plain HTTPS to api.openai.com.
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import * as crypto from 'crypto';
import * as os from 'os';
import { app, shell } from 'electron';

// We import CredentialsManager lazily inside getters/setters so a missing
// or uninitialised instance doesn't crash the module (test harness can
// import this file before init()).

// =============================================================================
// Constants — sourced from open-sse codex.md:1149-1169 (PROVIDER_OAUTH.codex)
// =============================================================================

// Public client_id used by the official codex CLI. Safe to embed — it's a
// non-confidential identifier for a public OAuth client.
export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

// OpenAI's ChatGPT OAuth endpoints. The same endpoints the codex CLI uses.
export const CODEX_OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
export const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';

// `openid profile email` gives us a profile + email for the Settings UI;
// `offline_access` is required to receive a refresh_token from the
// authorization-code grant.
export const CODEX_OAUTH_SCOPE = 'openid profile email offline_access';

// The codex CLI pins port 1455; we try that first and fall back to a
// random free port to avoid EADDRINUSE on a second concurrent login.
export const CODEX_OAUTH_PREFERRED_PORT = 1455;
export const CODEX_OAUTH_CALLBACK_PATH = '/auth/callback';

// Same buffer as open-sse's TOKEN_EXPIRY_BUFFER_MS (5 min) — refresh
// proactively so an in-flight request doesn't race a 401.
export const CODEX_OAUTH_REFRESH_LEAD_MS = 5 * 60 * 1000;

// Proactive re-auth window: if the last successful token exchange
// (initial login OR refresh) is older than 8 days, the refresh_token is
// treated as stale and credentials are cleared BEFORE attempting a refresh.
// OpenAI's ChatGPT OAuth occasionally invalidates refresh_tokens that
// have been aging too long without a fresh exchange; the result would
// otherwise be a sudden `invalid_grant` mid-use with no prior warning.
//
// This mirrors open-sse's `maxRefreshAgeMs: 691200000` (8 days) and
// `trackRefreshAt: true` at codex.md:1167 / 1329. The 8-day cap is
// deliberately shorter than the actual refresh_token lifetime (~30
// days in normal operation) so the user gets a clean re-auth prompt
// instead of a broken session.
export const CODEX_OAUTH_MAX_REFRESH_AGE_MS = 8 * 24 * 60 * 60 * 1000;

// Localhost redirect URI is implicit; the codex CLI uses the same scheme.
function buildRedirectUri(port: number): string {
  return `http://localhost:${port}${CODEX_OAUTH_CALLBACK_PATH}`;
}

// =============================================================================
// Types
// =============================================================================

export interface CodexOAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  /** Unix ms when the accessToken becomes invalid. */
  expiresAt: number;
  /** Best-effort email parsed from id_token; may be undefined. */
  email?: string;
  /** Account id (chatgpt-account-id) for workspace binding headers. */
  accountId?: string;
  /**
   * Epoch ms of the last successful token exchange (initial login OR
   * refresh-token rotation). Used by getAccessToken() to enforce the
   * 8-day proactive re-auth check (mirrors open-sse
   * `maxRefreshAgeMs: 691200000` at codex.md:1167). OpenAI silently
   * invalidates refresh tokens that have been aging too long without a
   * fresh exchange; the user would otherwise hit `invalid_grant`
   * mid-session with no prior warning. Stamped on initial login and on
   * every successful refresh.
   */
  lastRefreshAt?: number;
}

export interface CodexOAuthLoginResult {
  tokens: CodexOAuthTokens;
  email?: string;
}

export type CodexOAuthStatus = {
  signedIn: boolean;
  email?: string;
  expiresAt?: number;
};

// =============================================================================
// PKCE helpers
// =============================================================================

/**
 * Generate a PKCE pair + CSRF state. Mirrors open-sse/utils/pkce.js.
 * Verifier is 32 random bytes URL-safe-base64 (43 chars no padding),
 * challenge is the S256 base64url(sha256(verifier)).
 */
function generatePkce(): { codeVerifier: string; codeChallenge: string; state: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  return { codeVerifier, codeChallenge, state };
}

/**
 * Build the OpenAI authorize URL. open-sse uses encodeURIComponent on
 * each value to force %20 (not +) for spaces — the same convention is
 * mirrored here. See codex.md:5888-5906.
 */
function buildAuthorizeUrl(
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: CODEX_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: CODEX_OAUTH_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Codex-specific extras from open-sse (codex.md:1157-1161) — the
    // backend's simplified flow uses these to skip the workspace picker.
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
    state,
  };
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${CODEX_OAUTH_AUTHORIZE_URL}?${qs}`;
}

// =============================================================================
// Loopback HTTP server — receives the OAuth callback
// =============================================================================

interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

function tryListen(server: http.Server, port: number, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve(actual);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Start a loopback HTTP server that accepts exactly one request to
 * CODEX_OAUTH_CALLBACK_PATH. Resolves with the parsed query params.
 *
 * Auto-redirects to a "you can close this tab" page on success/failure
 * so the user's browser doesn't show a blank page. Closes the server
 * after the first match to free the port.
 *
 * 5-minute hard timeout (matches open-sse codex.md:5973) — if the user
 * never completes the browser flow, the promise rejects so the renderer
 * UI doesn't hang forever.
 */
function startCallbackServer(): { portReady: Promise<number>; waitForCallback: Promise<CallbackResult>; close: () => void } {
  let resolveCallback: ((r: CallbackResult) => void) | null = null;
  let rejectCallback: ((e: Error) => void) | null = null;
  const waitForCallback = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname !== CODEX_OAUTH_CALLBACK_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const code = url.searchParams.get('code') || undefined;
      const state = url.searchParams.get('state') || undefined;
      const error = url.searchParams.get('error') || undefined;
      const errorDescription = url.searchParams.get('error_description') || undefined;

      // Friendly landing page (open-sse renders similar — codex.md:5998-6002).
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Natively × ChatGPT</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0a0a0a;color:#fafafa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:0 24px}
.card{max-width:480px;background:#161616;border:1px solid #262626;border-radius:12px;padding:32px;text-align:center}
h1{font-size:18px;margin:0 0 8px;font-weight:600}
p{color:#a3a3a3;margin:0;font-size:14px;line-height:1.5}
.ok{color:#10b981}.err{color:#ef4444}</style></head><body>
<div class="card">${
        error
          ? `<h1 class="err">Sign-in failed</h1><p>${(errorDescription || error).replace(/[<>]/g, '')}</p>`
          : '<h1 class="ok">Signed in!</h1><p>You can close this tab and return to Natively.</p>'
      }</div>
</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);

      const result: CallbackResult = { code, state, error, errorDescription };
      if (resolveCallback) resolveCallback(result);
    } catch (e) {
      if (rejectCallback) rejectCallback(e instanceof Error ? e : new Error(String(e)));
    }
  });

  let boundPort = 0;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { server.close(); } catch { /* swallow */ }
  };

  // Try preferred port (1455 — matches codex CLI). On EADDRINUSE, pick a
  // random free port so two concurrent logins don't deadlock. The actual
  // port is reported through the returned promise so the caller can build
  // the redirect_uri with the right port (preferred vs OS-assigned).
  const portReady = new Promise<number>((resolve, reject) => {
    (async () => {
      try {
        const p = await tryListen(server, CODEX_OAUTH_PREFERRED_PORT);
        boundPort = p;
        resolve(p);
      } catch (e: any) {
        if (e && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) {
          // Fall back to a random port. Listen on port 0 lets the OS assign.
          try {
            const p = await tryListen(server, 0);
            boundPort = p;
            resolve(p);
          } catch (e2) {
            if (rejectCallback) rejectCallback(e2 instanceof Error ? e2 : new Error(String(e2)));
            close();
            reject(e2);
          }
        } else {
          if (rejectCallback) rejectCallback(e instanceof Error ? e : new Error(String(e)));
          close();
          reject(e);
        }
      }
    })();
  });

  return { portReady, waitForCallback, close };
}

// =============================================================================
// id_token claims (no signature verification — best-effort email extraction)
// =============================================================================

interface IdTokenPayload {
  email?: string;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
    chatgpt_plan_type?: string;
    chatgpt_user_id?: string;
  };
}

/** Decode the JWT payload without verifying the signature. We only use this
 * to extract the user's email for the Settings UI — ChatGPT's id_token
 * signature is verified server-side on every API call. */
function decodeIdTokenUnsafe(idToken: string | undefined): IdTokenPayload | null {
  if (!idToken) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as IdTokenPayload;
  } catch {
    return null;
  }
}

// =============================================================================
// CodexOAuthService
// =============================================================================

/**
 * Singleton manager for ChatGPT OAuth tokens. Persists via CredentialsManager
 * (safeStorage-encrypted) and emits events on state transitions.
 *
 * Public methods are all async because they may need to hit the OAuth token
 * endpoint for refresh; getters that read from memory are sync (getStatus).
 */
export class CodexOAuthService extends EventEmitter {
  private static instance: CodexOAuthService;
  private cachedTokens: CodexOAuthTokens | null = null;
  /** In-flight refresh promise — dedupes concurrent refresh requests. */
  private refreshInFlight: Promise<CodexOAuthTokens | null> | null = null;
  /** Active callback server handle, so signOut / error can close it. */
  private activeCallbackServer: { close: () => void } | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): CodexOAuthService {
    if (!CodexOAuthService.instance) {
      CodexOAuthService.instance = new CodexOAuthService();
    }
    return CodexOAuthService.instance;
  }

  /** For tests: reset in-memory state without touching persisted credentials. */
  public __resetForTest(): void {
    this.cachedTokens = null;
    this.refreshInFlight = null;
    if (this.activeCallbackServer) {
      try { this.activeCallbackServer.close(); } catch { /* swallow */ }
      this.activeCallbackServer = null;
    }
  }

  /** For tests: seed the in-memory token cache to bypass the storage layer. */
  public __setCachedTokensForTest(tokens: CodexOAuthTokens): void {
    this.cachedTokens = tokens;
  }

  // ---------------------------------------------------------------------------
  // Persistence — CredentialsManager (lazy)
  // ---------------------------------------------------------------------------

  private getCredentialsManager(): any | null {
    try {
      // Lazy require so test harnesses that mock or stub this module don't
      // pull in the full Electron app at import time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CredentialsManager } = require('./CredentialsManager');
      return CredentialsManager.getInstance();
    } catch {
      return null;
    }
  }

  private loadFromStorage(): CodexOAuthTokens | null {
    const cm = this.getCredentialsManager();
    if (!cm) return null;
    try {
      const raw = cm.getCodexOAuthTokens?.() ?? null;
      if (!raw) return null;
      // Defensive shape check — storage may have a stale/partial object.
      if (typeof raw.accessToken !== 'string' || typeof raw.refreshToken !== 'string') return null;
      if (typeof raw.expiresAt !== 'number') return null;
      return raw as CodexOAuthTokens;
    } catch {
      return null;
    }
  }

  private saveToStorage(tokens: CodexOAuthTokens): boolean {
    const cm = this.getCredentialsManager();
    if (!cm) return false;
    try {
      // Stamp lastRefreshAt on every persist. This drives the 8-day
      // proactive re-auth check in getAccessToken() (see
      // CODEX_OAUTH_MAX_REFRESH_AGE_MS).
      const stamped: CodexOAuthTokens = { ...tokens, lastRefreshAt: Date.now() };
      cm.setCodexOAuthTokens?.(stamped);
      return true;
    } catch (e) {
      console.error('[CodexOAuthService] Failed to persist tokens:', e);
      return false;
    }
  }

  private clearStorage(): void {
    const cm = this.getCredentialsManager();
    if (!cm) return;
    try { cm.clearCodexOAuthTokens?.(); } catch { /* swallow */ }
  }

  // ---------------------------------------------------------------------------
  // Public status API
  // ---------------------------------------------------------------------------

  /** Synchronous status read — does NOT refresh. Safe to call from IPC. */
  public getStatus(): CodexOAuthStatus {
    const tokens = this.cachedTokens || this.loadFromStorage();
    if (!tokens || !tokens.accessToken) return { signedIn: false };
    return {
      signedIn: true,
      email: tokens.email,
      expiresAt: tokens.expiresAt,
    };
  }

  public getCachedTokens(): CodexOAuthTokens | null {
    return this.cachedTokens || this.loadFromStorage();
  }

  // ---------------------------------------------------------------------------
  // Token refresh — deduped + retry-once
  // ---------------------------------------------------------------------------

  /**
   * Return a valid access token, refreshing if the current one expires
   * within CODEX_OAUTH_REFRESH_LEAD_MS. Concurrent calls share a single
   * refresh in flight (matches open-sse dedupRefresh at codex.md:1917-1946).
   */
  public async getAccessToken(): Promise<string | null> {
    const tokens = this.cachedTokens || this.loadFromStorage();
    if (!tokens || !tokens.refreshToken) return null;

    const now = Date.now();
    // 8-day proactive re-auth: if the last successful token exchange
    // (initial login OR refresh) is older than 8 days, the refresh
    // token is treated as stale. Clear credentials BEFORE attempting
    // a refresh so the UI can re-prompt the user before they hit a
    // broken call. Mirrors open-sse maxRefreshAgeMs: 691200000.
    // (codex.md:1167 + 1329)
    //
    // If lastRefreshAt is missing (older bundle written before this
    // check existed), fall back to the access-token expiry as the
    // "age" — the accessToken is always set with the bundle, so this
    // gives a sane upper bound. The user just gets prompted to re-auth
    // earlier than they otherwise would.
    const lastExchange = tokens.lastRefreshAt ?? tokens.expiresAt;
    if (lastExchange && now - lastExchange > CODEX_OAUTH_MAX_REFRESH_AGE_MS) {
      console.warn(
        `[CodexOAuthService] Refresh token is ${Math.round((now - lastExchange) / (24 * 60 * 60 * 1000))} days old ` +
        `(cap=${CODEX_OAUTH_MAX_REFRESH_AGE_MS / (24 * 60 * 60 * 1000)}d) — clearing credentials and prompting re-auth`,
      );
      this.clearStorage();
      this.cachedTokens = null;
      this.emit('login:failed', { reason: 'refresh_token_stale', message: 'Codex session expired — please sign in again.' });
      return null;
    }

    if (tokens.accessToken && tokens.expiresAt - now > CODEX_OAUTH_REFRESH_LEAD_MS) {
      return tokens.accessToken;
    }
    const refreshed = await this.refreshTokens();
    return refreshed?.accessToken || null;
  }

  /**
   * Force-refresh using the stored refresh token. Matches
   * refreshCodexToken at codex.md:2151-2208: POST application/json to
   * /oauth/token with grant_type=refresh_token, parse the rotated bundle,
   * and persist. 401 invalid_grant means the refresh token is dead —
   * clear the bundle and surface login:failed so the UI can re-prompt.
   */
  public async refreshTokens(): Promise<CodexOAuthTokens | null> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const inflight = (async () => {
      const tokens = this.cachedTokens || this.loadFromStorage();
      if (!tokens || !tokens.refreshToken) {
        return null;
      }
      let response: Response;
      try {
        response = await fetch(CODEX_OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: CODEX_OAUTH_CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
          }),
        });
      } catch (e: any) {
        console.error('[CodexOAuthService] Refresh network error:', e?.message || e);
        return null;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        // open-sse classifyOAuthRefreshError (codex.md:2130-2149) — the four
        // "permanent" markers mean re-auth is required.
        const combined = errorText.toLowerCase();
        const permanent = ['refresh_token_expired', 'refresh_token_reused', 'refresh_token_invalidated', 'invalid_grant']
          .some((m) => combined.includes(m));
        if (permanent) {
          console.error('[CodexOAuthService] Refresh token invalid; clearing credentials and requiring re-login.');
          this.cachedTokens = null;
          this.clearStorage();
          this.emit('login:failed', new Error('Codex session expired. Please sign in again.'));
        } else {
          console.error('[CodexOAuthService] Refresh failed:', response.status, errorText);
        }
        return null;
      }

      let bundle: any;
      try {
        bundle = await response.json();
      } catch (e) {
        console.error('[CodexOAuthService] Failed to parse refresh response:', e);
        return null;
      }

      if (!bundle || typeof bundle.access_token !== 'string') {
        console.error('[CodexOAuthService] Refresh response missing access_token');
        return null;
      }

      const claims = decodeIdTokenUnsafe(bundle.id_token);
      const expiresInMs = typeof bundle.expires_in === 'number' ? bundle.expires_in * 1000 : 60 * 60 * 1000;
      const newTokens: CodexOAuthTokens = {
        accessToken: bundle.access_token,
        // CRITICAL: ChatGPT OAuth rotates refresh tokens. If we don't use
        // the NEW refresh_token from this response, the next refresh
        // returns invalid_grant (open-sse mergeRefreshedCredentials at
        // codex.md:1401-1403 does the same).
        refreshToken: typeof bundle.refresh_token === 'string' ? bundle.refresh_token : tokens.refreshToken,
        idToken: bundle.id_token || tokens.idToken,
        expiresAt: Date.now() + expiresInMs,
        email: claims?.email || tokens.email,
        accountId: claims?.['https://api.openai.com/auth']?.chatgpt_account_id || tokens.accountId,
      };

      this.cachedTokens = newTokens;
      this.saveToStorage(newTokens);
      this.emit('tokens:refreshed', { expiresAt: newTokens.expiresAt });
      return newTokens;
    })();

    this.refreshInFlight = inflight.finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  // ---------------------------------------------------------------------------
  // Login flow — PKCE + browser + loopback server
  // ---------------------------------------------------------------------------

  /**
   * Run the full ChatGPT OAuth login flow. Opens the system browser,
   * waits for the callback, exchanges the code, and persists tokens.
   * Resolves with the token bundle (and email if id_token provided one).
   *
   * Caller is responsible for wiring the EventEmitter 'login:complete'
   * event to IPC broadcasts — the promise itself resolves synchronously
   * with the result, but renderer-side UI updates typically want a
   * separate event channel.
   */
  public async startLogin(): Promise<CodexOAuthLoginResult> {
    // If a previous login is still in flight, fail fast instead of stacking
    // loopback servers.
    if (this.activeCallbackServer) {
      throw new Error('A Codex login is already in progress.');
    }

    const { codeVerifier, codeChallenge, state } = generatePkce();
    const { portReady, waitForCallback, close } = startCallbackServer();
    this.activeCallbackServer = { close };
    // Wait for the actual bound port (preferred or OS-assigned) so the
    // redirect_uri the browser hits matches the one we sent in the auth
    // URL. Falling back to the preferred port keeps the call from hanging
    // if the listener fails to bind for an unexpected reason.
    const port = await portReady.catch(() => CODEX_OAUTH_PREFERRED_PORT);
    const redirectUri = buildRedirectUri(port);
    const authUrl = buildAuthorizeUrl(redirectUri, state, codeChallenge);

    // Hard 5-minute timeout (matches open-sse codex.md:5973). If the user
    // never completes the browser flow, the promise rejects.
    const HARD_TIMEOUT_MS = 5 * 60 * 1000;
    const timeoutHandle = setTimeout(() => {
      const err = new Error('Codex login timed out (5 minutes).');
      this.emit('login:failed', err);
      try { close(); } catch { /* swallow */ }
      this.activeCallbackServer = null;
    }, HARD_TIMEOUT_MS);

    let callback: CallbackResult;
    try {
      // Open the system browser. open-sse uses the `open` npm package;
      // Electron's shell.openExternal is the equivalent and is async.
      // Catch the promise so a failed `open` doesn't reject the whole flow
      // before the user sees the URL in the Settings panel.
      try {
        await shell.openExternal(authUrl);
      } catch (e) {
        // Surface the URL in console so the user can copy-paste it
        // manually if their default browser is broken.
        console.warn('[CodexOAuthService] shell.openExternal failed; please open this URL manually:', authUrl);
      }
      callback = await waitForCallback;
    } catch (e) {
      clearTimeout(timeoutHandle);
      try { close(); } catch { /* swallow */ }
      this.activeCallbackServer = null;
      const err = e instanceof Error ? e : new Error(String(e));
      this.emit('login:failed', err);
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }

    try { close(); } catch { /* swallow */ }
    this.activeCallbackServer = null;

    if (callback.error) {
      const err = new Error(callback.errorDescription || callback.error);
      this.emit('login:failed', err);
      throw err;
    }
    if (!callback.code) {
      const err = new Error('No authorization code received from ChatGPT.');
      this.emit('login:failed', err);
      throw err;
    }
    if (callback.state !== state) {
      const err = new Error('OAuth state mismatch — possible CSRF attempt, aborting.');
      this.emit('login:failed', err);
      throw err;
    }

    const tokens = await this.exchangeCode(callback.code, redirectUri, codeVerifier);
    this.cachedTokens = tokens;
    this.saveToStorage(tokens);
    this.emit('login:complete', { email: tokens.email });
    return { tokens, email: tokens.email };
  }

  /**
   * Exchange an authorization code for a token bundle. Mirrors the
   * codex.md:5998 — POST application/x-www-form-urlencoded to /oauth/token
   * (matches the OpenAI spec; the refresh path uses application/json —
   * open-sse supports both).
   */
  private async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<CodexOAuthTokens> {
    let response: Response;
    try {
      response = await fetch(CODEX_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CODEX_OAUTH_CLIENT_ID,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
      });
    } catch (e: any) {
      throw new Error(`Codex token exchange network error: ${e?.message || e}`);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Codex token exchange failed (${response.status}): ${errorText.slice(0, 500)}`);
    }

    let bundle: any;
    try {
      bundle = await response.json();
    } catch (e) {
      throw new Error('Codex token exchange returned an invalid JSON response.');
    }

    if (!bundle || typeof bundle.access_token !== 'string') {
      throw new Error('Codex token exchange response missing access_token.');
    }

    const claims = decodeIdTokenUnsafe(bundle.id_token);
    const expiresInMs = typeof bundle.expires_in === 'number' ? bundle.expires_in * 1000 : 60 * 60 * 1000;
    return {
      accessToken: bundle.access_token,
      refreshToken: typeof bundle.refresh_token === 'string' ? bundle.refresh_token : '',
      idToken: bundle.id_token,
      expiresAt: Date.now() + expiresInMs,
      email: claims?.email,
      accountId: claims?.['https://api.openai.com/auth']?.chatgpt_account_id,
    };
  }

  // ---------------------------------------------------------------------------
  // Sign out — clear tokens, close any active server, fire event
  // ---------------------------------------------------------------------------

  public signOut(): void {
    this.cachedTokens = null;
    this.clearStorage();
    if (this.activeCallbackServer) {
      try { this.activeCallbackServer.close(); } catch { /* swallow */ }
      this.activeCallbackServer = null;
    }
    // Reuse login:failed-shape by emitting a custom event the renderer
    // can listen for to flip back to the signed-out state.
    this.emit('signed-out', undefined);
  }
}
