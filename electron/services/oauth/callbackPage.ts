/**
 * The page a browser shows after an OAuth redirect lands on one of Natively's
 * loopback callback servers (Codex, Antigravity, Google Calendar).
 *
 * Pure on purpose: no electron imports, so tests and the preview script can
 * render every provider × outcome without the app.
 *
 * The real app icon over a wash of its own navy, a glass card on the app's
 * glass recipe (blur 40px, saturate 180%), Instrument Sans (OFL, inlined).
 *
 * The page makes zero network requests. The callback URL carries `?code=`, and
 * the Calendar server closes the moment it answers, so any subresource would
 * fail anyway. Icon, font and marks are inline; the one script (strip the
 * code from the address bar, the two buttons) runs under a nonce, so there are
 * no inline handlers.
 */
import crypto from 'node:crypto';
import { NATIVELY_APP_ICON_DATA_URI } from './nativelyAppIcon';
import { INSTRUMENT_SANS_WOFF2_DATA_URI } from './instrumentSans';

export type OAuthCallbackProvider = 'codex' | 'antigravity' | 'calendar' | 'outlook-calendar' | ConnectorCallbackProvider | 'gmail';

/** Settings › Connectors services that sign in with the browser. */
export type ConnectorCallbackProvider = 'slack' | 'notion' | 'hubspot' | 'salesforce' | 'attio';
const CONNECTORS: readonly string[] = ['slack', 'notion', 'hubspot', 'salesforce', 'attio'];

/**
 * `returned`  — the code reached Natively; the token exchange runs after this
 *               page is sent (Codex, Antigravity), so it must not claim success.
 * `connected` — the exchange already finished (Calendar).
 * `error`     — the provider refused, the state didn't match, or the exchange failed.
 */
export type OAuthCallbackOutcome =
  | { kind: 'returned' }
  | { kind: 'connected' }
  | { kind: 'error'; reason?: string };

export interface OAuthCallbackPage {
  headers: Record<string, string>;
  body: string;
}

const PROVIDERS: Record<OAuthCallbackProvider, { name: string; account: string; detail: string }> = {
  codex: { name: 'ChatGPT', account: 'ChatGPT', detail: 'Codex models in Natively' },
  antigravity: { name: 'Antigravity', account: 'Google', detail: 'Google account' },
  calendar: { name: 'Google Calendar', account: 'Google', detail: 'Google account' },
  'outlook-calendar': { name: 'Outlook Calendar', account: 'Microsoft', detail: 'Microsoft account' },
  slack: { name: 'Slack', account: 'Slack', detail: 'Slack workspace' },
  notion: { name: 'Notion', account: 'Notion', detail: 'Notion workspace' },
  hubspot: { name: 'HubSpot', account: 'HubSpot', detail: 'HubSpot account' },
  salesforce: { name: 'Salesforce', account: 'Salesforce', detail: 'Salesforce org' },
  attio: { name: 'Attio', account: 'Attio', detail: 'Attio workspace' },
  gmail: { name: 'Gmail', account: 'Google', detail: 'Google account' },
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Turns an OAuth `error` / `error_description` pair into one plain sentence. */
export function describeOAuthError(error?: string | null, description?: string | null): string {
  const code = (error || '').trim();
  const detail = (description || '').trim();
  if (code === 'access_denied') return 'Access was declined on the consent screen.';
  if (detail) return detail.slice(0, 300);
  if (code) return `The provider returned “${code.slice(0, 80)}”.`;
  return 'The sign-in response was incomplete.';
}

const OPENAI_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" fill-rule="evenodd"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/></svg>';

// Google's "G" — the same mark Settings › Calendar shows for a Google account.
const GOOGLE_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)"><path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z"/><path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z"/><path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.734 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z"/><path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z"/></g></svg>';

// Microsoft's four squares, for an Outlook (Microsoft 365 or Outlook.com) calendar.
const MICROSOFT_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M2 2h9.5v9.5H2z"/><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/></svg>';


// Connector marks, the same files Settings › Connectors shows
// (src/assets/provider-logos, sources in its README), inlined so the page loads
// nothing from the network.
const SLACK_MARK = '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="#e01e5a" d="M53.841 161.32c0 14.832-11.987 26.82-26.819 26.82S.203 176.152.203 161.32c0-14.831 11.987-26.818 26.82-26.818H53.84zm13.41 0c0-14.831 11.987-26.818 26.819-26.818s26.819 11.987 26.819 26.819v67.047c0 14.832-11.987 26.82-26.82 26.82c-14.83 0-26.818-11.988-26.818-26.82z"/><path fill="#36c5f0" d="M94.07 53.638c-14.832 0-26.82-11.987-26.82-26.819S79.239 0 94.07 0s26.819 11.987 26.819 26.819v26.82zm0 13.613c14.832 0 26.819 11.987 26.819 26.819s-11.987 26.819-26.82 26.819H26.82C11.987 120.889 0 108.902 0 94.069c0-14.83 11.987-26.818 26.819-26.818z"/><path fill="#2eb67d" d="M201.55 94.07c0-14.832 11.987-26.82 26.818-26.82s26.82 11.988 26.82 26.82s-11.988 26.819-26.82 26.819H201.55zm-13.41 0c0 14.832-11.988 26.819-26.82 26.819c-14.831 0-26.818-11.987-26.818-26.82V26.82C134.502 11.987 146.489 0 161.32 0s26.819 11.987 26.819 26.819z"/><path fill="#ecb22e" d="M161.32 201.55c14.832 0 26.82 11.987 26.82 26.818s-11.988 26.82-26.82 26.82c-14.831 0-26.818-11.988-26.818-26.82V201.55zm0-13.41c-14.831 0-26.818-11.988-26.818-26.82c0-14.831 11.987-26.818 26.819-26.818h67.25c14.832 0 26.82 11.987 26.82 26.819s-11.988 26.819-26.82 26.819z"/></svg>';
const NOTION_MARK = '<svg aria-hidden="true" fill="currentColor" fill-rule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path clip-rule="evenodd" d="M15.257.055l-13.31.98C.874 1.128.5 1.83.5 2.667v14.559c0 .654.233 1.213.794 1.96l3.129 4.06c.513.653.98.794 1.962.745l15.457-.932c1.307-.093 1.681-.7 1.681-1.727V4.954c0-.53-.21-.684-.829-1.135l-.106-.078L18.34.755c-1.027-.746-1.45-.84-3.083-.7zm-8.521 4.63c-1.263.086-1.549.105-2.266-.477L2.647 2.76c-.186-.187-.092-.42.375-.466l12.796-.933c1.074-.094 1.634.28 2.054.606l2.195 1.587c.093.047.326.326.047.326l-13.216.794-.162.01zM5.263 21.193V7.287c0-.606.187-.886.748-.933l15.176-.886c.515-.047.748.28.748.886v13.81c0 .609-.093 1.122-.934 1.168l-14.523.84c-.842.047-1.215-.232-1.215-.98zm14.338-13.16c.093.422 0 .842-.422.89l-.699.139v10.264c-.608.327-1.168.513-1.635.513-.747 0-.934-.232-1.495-.932l-4.576-7.185v6.952l1.448.327s0 .84-1.169.84l-3.221.186c-.094-.187 0-.654.327-.747l.84-.232V9.853L7.832 9.76c-.093-.42.14-1.026.794-1.073l3.456-.232 4.763 7.279v-6.44l-1.214-.14c-.094-.513.28-.887.747-.933l3.223-.187z"></path></svg>';
const HUBSPOT_MARK = '<svg aria-hidden="true" fill="#FF7A59" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z"/></svg>';
const SALESFORCE_MARK = '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 180"><path fill="#00a1e0" d="M106.553 19.651c8.248-8.594 19.731-13.924 32.43-13.924c16.883 0 31.612 9.414 39.455 23.389a54.5 54.5 0 0 1 22.3-4.74c30.449 0 55.134 24.9 55.134 55.615c0 30.719-24.685 55.62-55.134 55.62a54.7 54.7 0 0 1-10.86-1.083c-6.908 12.321-20.07 20.645-35.178 20.645a40.1 40.1 0 0 1-17.632-4.058c-7.002 16.47-23.316 28.019-42.33 28.019c-19.8 0-36.674-12.529-43.152-30.1c-2.83.602-5.763.915-8.772.915c-23.574 0-42.686-19.308-42.686-43.13a43.2 43.2 0 0 1 21.345-37.36a49.4 49.4 0 0 1-4.088-19.727C17.385 22.336 39.626.128 67.06.128c16.106 0 30.42 7.658 39.494 19.523"/></svg>';
const ATTIO_MARK = '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 28"><path fill="currentColor" d="m31.669 19.175l-2.673-4.279l-.016-.026l-.211-.336a2.16 2.16 0 0 0-1.838-1.022l-4.306-.014l-.3.481l-5.146 8.235l-.284.456l2.156 3.444a2.15 2.15 0 0 0 1.843 1.023h6.035a2.19 2.19 0 0 0 1.842-1.02l.213-.34s.008-.01.01-.015l2.677-4.284c.44-.7.44-1.605 0-2.303zm-.816 1.792l-2.677 4.284l-.037.052a.363.363 0 0 1-.579-.054l-2.678-4.284a1.2 1.2 0 0 1-.137-.969c.03-.105.076-.21.135-.306l2.674-4.28l.006-.01a.34.34 0 0 1 .213-.154q.04-.01.071-.014h.03c.062 0 .215.02.31.176l2.674 4.278c.244.39.244.891 0 1.28zM23.758 8.823a2.19 2.19 0 0 0 0-2.303l-2.673-4.278l-.223-.36a2.16 2.16 0 0 0-1.844-1.02h-6.034c-.754 0-1.442.381-1.844 1.022L.333 19.178a2.16 2.16 0 0 0-.002 2.301L3.23 26.12c.4.64 1.088 1.02 1.842 1.02h6.035c.758 0 1.446-.381 1.844-1.022l.22-.35v-.004s.005-.006.005-.008l2.154-3.445l6.384-10.218l2.041-3.268zm-.63-1.151c0 .22-.062.443-.187.64L12.355 25.255a.36.36 0 0 1-.31.17a.36.36 0 0 1-.31-.17l-2.676-4.286a1.22 1.22 0 0 1 0-1.28L19.645 2.752a.36.36 0 0 1 .31-.173c.062 0 .215.018.313.175L22.94 7.03c.125.197.187.42.187.64"/></svg>';

const PROVIDER_MARKS: Record<OAuthCallbackProvider, { svg: string; tile: 'openai' | 'google' | 'light' }> = {
  codex: { svg: OPENAI_MARK, tile: 'openai' },
  antigravity: { svg: GOOGLE_MARK, tile: 'google' },
  calendar: { svg: GOOGLE_MARK, tile: 'google' },
  // The same white tile as Google's.
  'outlook-calendar': { svg: MICROSOFT_MARK, tile: 'google' },
  slack: { svg: SLACK_MARK, tile: 'google' },
  hubspot: { svg: HUBSPOT_MARK, tile: 'google' },
  salesforce: { svg: SALESFORCE_MARK, tile: 'google' },
  // Monochrome marks (currentColor): a white tile with dark ink.
  notion: { svg: NOTION_MARK, tile: 'light' },
  attio: { svg: ATTIO_MARK, tile: 'light' },
  gmail: { svg: GOOGLE_MARK, tile: 'google' },
};

const CHECK_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="tick" d="M3.8 8.4l2.6 2.6 5.8-6.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ALERT_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.6v5.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="8" cy="12.1" r="1.1" fill="currentColor"/></svg>';
const COPY_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 3.5v-.3A1.7 1.7 0 008.8 1.5H4.2A1.7 1.7 0 002.5 3.2v4.6a1.7 1.7 0 001.7 1.7h.3"/></svg>';
const DONE_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.4l2.9 2.9 6.1-6.3"/></svg>';

function copyFor(provider: OAuthCallbackProvider, outcome: OAuthCallbackOutcome) {
  const p = PROVIDERS[provider];
  if (outcome.kind === 'error') {
    return {
      title: 'Couldn’t sign in · Natively',
      headline: 'Couldn’t sign in',
      sub: 'Nothing was connected. Try again from Natively.',
      status: 'Not connected',
      reason: outcome.reason?.trim() || 'The sign-in response was incomplete.',
    };
  }
  if (outcome.kind === 'connected') {
    return {
      title: `${p.name} connected · Natively`,
      headline: `${p.name} connected`,
      sub: provider === 'calendar' || provider === 'outlook-calendar'
        ? 'Your upcoming meetings will show up in Natively.'
        : provider === 'gmail'
          ? 'Follow-ups and meeting briefs can now use Gmail. Nothing is sent until you press Send.'
        : CONNECTORS.includes(provider)
          ? `Meeting notes can now go to ${p.name}. Nothing is sent until you press Send.`
          : `Natively can now use your ${p.account} account.`,
      status: 'Connected',
      reason: null,
    };
  }
  return {
    title: `Signed in to ${p.account} · Natively`,
    headline: `Signed in to ${p.account}`,
    sub: 'Natively is finishing setup. Head back to the app.',
    status: 'Signed in',
    reason: null,
  };
}

/*
 * Motion follows the transitions tokens (smooth-out curve, 40ms stagger):
 *   card        panel open   400ms, 8px, scale .96, blur 2px
 *   text        text reveal  500ms ease-in-out, 12px, blur 3px, staggered 40ms
 *   provider    badge pop    500ms bounce, 8px diagonal
 *   status      success check 500ms, blur 8px, path drawn 80ms later
 *               (error: one small shake instead)
 *   buttons     colour-only hover 150ms; press scale .985 on pointer-down
 *               (the Start Natively pill's press); label swaps 150ms, 4px.
 */
const STYLE = `
@font-face{font-family:"Instrument Sans";src:url(${INSTRUMENT_SANS_WOFF2_DATA_URI}) format("woff2");
  font-weight:400 700;font-stretch:75% 100%;font-style:normal;font-display:block}
:root{
  --page:#07080C;--wash:#0C1C40;
  --glass:rgba(22,23,28,.66);--ring:#17181D;--glass-edge:rgba(255,255,255,.09);--glass-hi:rgba(255,255,255,.07);
  --inset:rgba(255,255,255,.045);--inset-hover:rgba(255,255,255,.07);--hairline:rgba(255,255,255,.08);
  --btn:rgba(255,255,255,.08);--btn-hover:rgba(255,255,255,.13);
  --text-1:#F5F5F7;--text-2:#A1A1A6;--text-3:#8E8E93;
  --ok:#34D399;--ok-soft:rgba(52,211,153,.13);--danger:#FF6961;--danger-soft:rgba(255,105,97,.13);
  --font:"Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;
  --smooth:cubic-bezier(.22,1,.36,1);--bounce:cubic-bezier(.34,1.36,.64,1);
}
@media (prefers-color-scheme: light){
  :root{--page:#F2F2F7;--wash:#DCE5FF;
    --glass:rgba(255,255,255,.72);--ring:#F7F8FC;--glass-edge:rgba(0,0,0,.07);--glass-hi:rgba(255,255,255,.9);
    --inset:rgba(0,0,0,.035);--inset-hover:rgba(0,0,0,.055);--hairline:rgba(0,0,0,.08);
    --btn:rgba(0,0,0,.055);--btn-hover:rgba(0,0,0,.09);
    --text-1:#1D1D1F;--text-2:#6E6E73;--text-3:#6E6E73;
    --ok:#1F8F4E;--ok-soft:rgba(31,143,78,.11);--danger:#D70015;--danger-soft:rgba(215,0,21,.08)}
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--page);color:var(--text-1);font-family:var(--font);font-size:15px;
  -webkit-font-smoothing:antialiased;display:grid;place-items:center;padding:56px 16px;overflow-x:hidden;
  background-image:linear-gradient(180deg,var(--wash) 0%,transparent 62%)}
/* The app icon itself, blown up and blurred, is what the glass frosts over. */
.stage{position:relative;width:min(400px,100%)}
.aura{position:absolute;left:50%;top:-70px;width:300px;height:300px;margin-left:-150px;
  background:center/contain no-repeat;filter:blur(80px) saturate(1.3);opacity:.32;pointer-events:none;
  animation:fade .4s var(--smooth) both}
@media (prefers-color-scheme: light){.aura{opacity:.22}}
.card{position:relative;width:100%;padding:32px 24px 20px;border-radius:22px;text-align:center;
  background:var(--glass);border:1px solid var(--glass-edge);
  -webkit-backdrop-filter:blur(40px) saturate(180%);backdrop-filter:blur(40px) saturate(180%);
  box-shadow:inset 0 1px 0 var(--glass-hi),0 30px 60px -30px rgba(0,0,0,.55);
  animation:panel .4s var(--smooth) both}
@media (prefers-color-scheme: light){.card{box-shadow:inset 0 1px 0 var(--glass-hi),0 24px 48px -28px rgba(20,30,60,.28)}}
.icons{position:relative;width:76px;height:76px;margin:0 auto 22px}
.app-icon{width:76px;height:76px;display:block;animation:icon .25s var(--smooth) .08s both}
.badge{position:absolute;right:-9px;bottom:-7px;width:32px;height:32px;border-radius:9px;display:grid;place-items:center;
  box-shadow:0 0 0 3px var(--ring),0 4px 10px rgba(0,0,0,.35);animation:badge .5s var(--bounce) .36s both}
.badge svg{width:18px;height:18px}
.badge.openai{background:#000;color:#fff}
.badge.google{background:#fff}
.badge.light{background:#fff;color:#111}
h1{margin:0;font-size:27px;line-height:1.15;font-weight:600;font-stretch:88%;letter-spacing:-.022em;text-wrap:balance}
.sub{margin:8px auto 0;max-width:34ch;line-height:1.45;color:var(--text-2);text-wrap:balance}
.row{margin:24px 0 0;display:flex;align-items:center;gap:12px;padding:12px 12px 12px 16px;border-radius:14px;
  background:var(--inset);text-align:left;transition:background-color .15s ease-out}
@media (hover:hover) and (pointer:fine){.row:hover{background:var(--inset-hover)}}
.who{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.who b{font-size:14.5px;font-weight:600}
.who small{font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status{flex:none;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px 0 9px;border-radius:999px;
  font-size:13px;font-weight:600;color:var(--ok);background:var(--ok-soft);animation:check .5s var(--smooth) .52s both}
.status svg{width:15px;height:15px}
.tick{stroke-dasharray:14;animation:draw .35s var(--smooth) .6s both}
html[data-state="error"] .status{color:var(--danger);background:var(--danger-soft);
  animation:check .5s var(--smooth) .52s both,shake .32s ease-in-out 1.08s}
.reason{margin:10px 0 0;padding:12px 14px;border-radius:12px;border:1px solid var(--hairline);text-align:left;
  font-size:13.5px;line-height:1.5;color:var(--text-2);overflow-wrap:anywhere}
.foot{margin:20px -24px 0;padding:14px 16px 0 24px;border-top:1px solid var(--hairline);display:flex;align-items:center;gap:10px}
.foot p{margin:0 auto 0 0;font-size:13px;color:var(--text-3);text-align:left}
button{font:inherit;font-size:13px;font-weight:600;color:var(--text-1);height:32px;padding:0 14px;border:0;border-radius:999px;
  background:var(--btn);cursor:pointer;display:inline-flex;align-items:center;gap:7px;outline:none;
  transition:background-color .15s ease-out,transform .25s var(--smooth);-webkit-tap-highlight-color:transparent}
@media (hover:hover) and (pointer:fine){button:hover{background:var(--btn-hover)}}
button:focus-visible{background:var(--btn-hover)}
button:active{transform:scale(.985);transition:background-color .15s ease-out,transform .14s var(--smooth)}
button:disabled{cursor:default}
.glyphs{position:relative;width:14px;height:14px;flex:none}
.glyphs svg{position:absolute;inset:0;width:14px;height:14px;transition:opacity .25s ease-in-out,transform .25s ease-in-out,filter .25s ease-in-out}
.glyphs .done{opacity:0;transform:scale(.6);filter:blur(2px)}
button.copied .glyphs .idle{opacity:0;transform:scale(.6);filter:blur(2px)}
button.copied .glyphs .done{opacity:1;transform:none;filter:none;color:var(--ok)}
.label{display:inline-block;transition:opacity .15s ease-in-out,transform .15s ease-in-out,filter .15s ease-in-out}
.label.out{opacity:0;transform:translateY(-4px);filter:blur(2px)}
.label.pre{opacity:0;transform:translateY(4px);filter:blur(2px);transition:none}
.reveal{animation:reveal .5s ease-in-out both}
.reveal:nth-child(1){animation-delay:.12s}.reveal:nth-child(2){animation-delay:.16s}
.reveal:nth-child(3){animation-delay:.2s}.reveal:nth-child(4){animation-delay:.24s}.reveal:nth-child(5){animation-delay:.28s}
@keyframes fade{from{opacity:0}}
@keyframes panel{from{opacity:0;transform:translateY(8px) scale(.96);filter:blur(2px)}}
@keyframes icon{from{opacity:0;transform:scale(.96)}}
@keyframes badge{from{opacity:0;transform:translate(8px,8px) scale(.96)}}
@keyframes reveal{from{opacity:0;transform:translateY(12px);filter:blur(3px)}}
@keyframes check{from{opacity:0;transform:scale(.96);filter:blur(8px)}}
@keyframes draw{from{stroke-dashoffset:14}}
@keyframes shake{20%{transform:translateX(-6px)}45%{transform:translateX(8px)}70%{transform:translateX(-6px)}90%{transform:translateX(2px)}}
@media (prefers-reduced-motion: reduce){*,*::before{animation:none!important;transition:none!important}}
@media (max-width:440px){.card{padding:28px 18px 18px}.foot{margin:18px -18px 0;padding:14px 12px 0 18px}}
`;

// Tries window.close() (browsers refuse it for a tab reached by redirect) and,
// if the tab is still here, says which keys close it. Copy puts the provider,
// reason and time on the clipboard: never the code or state.
const SCRIPT = `
try{history.replaceState(null,"",location.pathname)}catch(e){}
function swap(el,text){el.classList.add("out");setTimeout(function(){el.textContent=text;el.classList.remove("out");
  el.classList.add("pre");void el.offsetWidth;el.classList.remove("pre")},150)}
var close=document.getElementById("close");
if(close)close.addEventListener("click",function(){try{window.close()}catch(e){}
  setTimeout(function(){if(window.closed)return;close.disabled=true;swap(close.querySelector(".label"),close.getAttribute("data-fallback"))},150)});
var copy=document.getElementById("copy");
if(copy)copy.addEventListener("click",function(){var label=copy.querySelector(".label");
  var text=copy.getAttribute("data-details")+"\\nTime: "+new Date().toISOString();
  var done=function(ok){copy.classList.toggle("copied",ok);swap(label,ok?"Copied":"Couldn\\u2019t copy");
    setTimeout(function(){copy.classList.remove("copied");swap(label,"Copy details")},1600)};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(function(){done(true)},function(){done(false)});
  else done(false)});
`;

export function renderOAuthCallbackPage(
  provider: OAuthCallbackProvider,
  outcome: OAuthCallbackOutcome,
  platform: NodeJS.Platform,
): OAuthCallbackPage {
  const nonce = crypto.randomBytes(16).toString('base64');
  const copy = copyFor(provider, outcome);
  const p = PROVIDERS[provider];
  const mark = PROVIDER_MARKS[provider];
  const state = outcome.kind;
  // The browser runs on the machine that answered, so the server's platform
  // is the reader's platform.
  const closeKeys = platform === 'darwin' ? '⌘W' : 'Ctrl+W';
  const details = `Natively sign-in: ${p.name}\nReason: ${copy.reason ?? ''}`;
  const extra = copy.reason
    ? `<div class="reason reveal">${escapeHtml(copy.reason)}</div>`
    : '';
  const action = copy.reason
    ? `<button type="button" id="copy" data-details="${escapeHtml(details)}"><span class="glyphs"><span class="idle">${COPY_GLYPH}</span><span class="done">${DONE_GLYPH}</span></span><span class="label">Copy details</span></button>`
    : `<button type="button" id="close" data-fallback="${escapeHtml(`Press ${closeKeys}`)}"><span class="label">Close tab</span></button>`;

  const body = `<!doctype html>
<html lang="en" data-state="${state}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(copy.title)}</title>
<link rel="icon" href="${NATIVELY_APP_ICON_DATA_URI}">
<style>${STYLE}.aura{background-image:url(${NATIVELY_APP_ICON_DATA_URI})}</style>
</head>
<body>
<div class="stage">
<div class="aura" aria-hidden="true"></div>
<main class="card" role="status">
  <div class="icons">
    <img class="app-icon" src="${NATIVELY_APP_ICON_DATA_URI}" alt="Natively" width="76" height="76">
    <span class="badge ${mark.tile}">${mark.svg}</span>
  </div>
  <div class="copy">
    <h1 class="reveal">${escapeHtml(copy.headline)}</h1>
    <p class="sub reveal">${escapeHtml(copy.sub)}</p>
    <div class="row reveal">
      <span class="who"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.detail)}</small></span>
      <span class="status">${state === 'error' ? ALERT_GLYPH : CHECK_GLYPH}${escapeHtml(copy.status)}</span>
    </div>
    ${extra}
    <div class="foot reveal"><p>You can close this tab.</p>${action}</div>
  </div>
</main>
</div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;

  return {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body,
  };
}
