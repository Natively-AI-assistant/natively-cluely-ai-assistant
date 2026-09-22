/**
 * CodexCliAuth — read-only access to the Codex CLI's `codex login` session.
 *
 * `codex login` stores a ChatGPT OAuth session in `$CODEX_HOME/auth.json`
 * (`~/.codex` on macOS, `%USERPROFILE%\.codex` on Windows — see
 * resolveCodexHome). When the user has not signed in inside Natively, that
 * session's access token lets Natively call the same ChatGPT Codex backend the
 * CLI calls (issue #558: a successful `codex login` used to count for nothing).
 *
 * READ-ONLY, deliberately. ChatGPT OAuth rotates the refresh token on every
 * refresh, so if Natively refreshed this session the CLI's stored refresh token
 * would be dead and the CLI would be signed out. Natively therefore never
 * refreshes it and never writes the file: once the access token expires
 * (roughly ten days), the user runs any `codex` command — the CLI refreshes its
 * own session — or signs in inside Natively.
 *
 * Only `auth_mode: "chatgpt"` sessions are usable. An API-key login
 * (`auth_mode: "apikey"`) authenticates against api.openai.com, not the ChatGPT
 * backend Natively posts to.
 *
 * The token never leaves the main process: CodexCliAuthState carries it only
 * for CodexCliService's request headers, and getCodexAuthStatus() (the shape
 * the renderer sees) omits it.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveCodexHome } from './CodexModelCatalog';

export const CODEX_AUTH_FILE = 'auth.json';

// Treat a token this close to expiry as already expired, so a request never
// starts on a token that lapses before the backend checks it.
export const CODEX_CLI_TOKEN_SKEW_MS = 60_000;

export type CodexCliAuthState =
  | { status: 'ok'; accessToken: string; accountId?: string; email?: string; expiresAt: number }
  | { status: 'expired'; email?: string; expiresAt: number }
  | { status: 'missing' | 'api-key' | 'invalid' };

type PathImpl = Pick<typeof path, 'join' | 'resolve'>;

function decodeJwtPayload(jwt: unknown): Record<string, any> | null {
  if (typeof jwt !== 'string') return null;
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Parse the CLI's auth.json. Pure — `now` is injected. */
export function parseCodexAuthJson(raw: string, now: number): CodexCliAuthState {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'invalid' };
  }
  if (!data || typeof data !== 'object') return { status: 'invalid' };

  const mode = typeof data.auth_mode === 'string' ? data.auth_mode.toLowerCase() : undefined;
  const tokens = data.tokens && typeof data.tokens === 'object' ? data.tokens : null;
  const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token.trim() : '';
  if (mode === 'apikey' || (!accessToken && typeof data.OPENAI_API_KEY === 'string' && data.OPENAI_API_KEY)) {
    return { status: 'api-key' };
  }
  if (!accessToken) return { status: 'invalid' };

  const claims = decodeJwtPayload(accessToken);
  const exp = Number(claims?.exp);
  if (!Number.isFinite(exp)) return { status: 'invalid' };
  const expiresAt = exp * 1000;

  const idClaims = decodeJwtPayload(tokens?.id_token);
  const email = typeof idClaims?.email === 'string' ? idClaims.email : undefined;
  if (expiresAt - CODEX_CLI_TOKEN_SKEW_MS <= now) return { status: 'expired', email, expiresAt };

  const authClaim = claims?.['https://api.openai.com/auth'];
  const accountId = (typeof tokens?.account_id === 'string' && tokens.account_id)
    || (typeof authClaim?.chatgpt_account_id === 'string' ? authClaim.chatgpt_account_id : undefined);
  return { status: 'ok', accessToken, accountId: accountId || undefined, email, expiresAt };
}

export interface CodexCliAuthReader {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  pathImpl?: PathImpl;
  readFileSync?: (filePath: string) => string;
  statSync?: (filePath: string) => { mtimeMs: number; size: number };
  now?: () => number;
  /** Skip the metadata cache and re-read the file (the post-401 re-read). */
  force?: boolean;
}

// Availability is asked on every routing decision, so the file is re-parsed
// only when it changes (the CLI rewrites it on login and on its own refresh).
// Expiry is re-evaluated against `now` on every call regardless. mtime+size can
// miss a rewrite (coarse timestamps, same-length token), so anything reacting
// to a rejected token passes `force`.
let cache: { file: string; mtimeMs: number; size: number; raw: string } | null = null;

/** Synchronous so routing predicates (LLMHelper.isCodexAvailable) can call it. */
export function readCodexCliAuth(opts: CodexCliAuthReader = {}): CodexCliAuthState {
  const pathImpl = opts.pathImpl ?? path;
  const file = pathImpl.join(
    resolveCodexHome(opts.env ?? process.env, opts.homeDir ?? os.homedir(), pathImpl),
    CODEX_AUTH_FILE,
  );
  const statSync = opts.statSync ?? ((p: string) => fs.statSync(p));
  const readFileSync = opts.readFileSync ?? ((p: string) => fs.readFileSync(p, 'utf8'));
  const now = (opts.now ?? Date.now)();
  try {
    const st = statSync(file);
    if (opts.force || !cache || cache.file !== file || cache.mtimeMs !== st.mtimeMs || cache.size !== st.size) {
      cache = { file, mtimeMs: st.mtimeMs, size: st.size, raw: readFileSync(file) };
    }
    return parseCodexAuthJson(cache.raw, now);
  } catch {
    cache = null;
    return { status: 'missing' };
  }
}

/** Test hook: forget the cached file contents. */
export function resetCodexCliAuthCache(): void {
  cache = null;
}
