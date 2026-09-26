// DEV-ONLY visual harness for the free-trial card in Plans & Billing. Not part
// of the shipped app (same precedent as embeddingSettingsHarness.tsx /
// aiProvidersTablistHarness.tsx and their sibling *.html entries; vite's build
// input is index.html alone, so this never ships).
//
// WHY this exists rather than "just look at the app": the card renders only for
// a user with NO Natively key, and CredentialsManager reads the macOS keychain,
// which is per-USER — not per-userData-dir. So even a throwaway
// `--user-data-dir` profile picks up a real saved key on a developer machine and
// the `!isSaved` gate correctly hides the very card you are trying to look at.
// The only ways to see it live are to remove a real credential or to sign out,
// both of which mutate something the developer wants to keep.
//
// `?claimed=1` renders the post-claim branch, `?error=1` the failure line.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { NativelyApiSettings } from '../components/settings/NativelyApiSettings';

const params = new URLSearchParams(location.search);
const CLAIMED = params.get('claimed') === '1';
const LIGHT = params.get('theme') === 'light';
/** `?active=1` renders a trial IN PROGRESS: the countdown card plus the
 *  "Usage this trial" table, which is otherwise unreachable without spending a
 *  real 30-minute trial to look at it. */
const ACTIVE = params.get('active') === '1';
/** `?near=1` pushes every meter into the >=80% band, and `?over=1` past 100%.
 *  ResourceMeter has three colour branches — accent, amber at >=80%, red at
 *  >100% — and AI genuinely CAN exceed its limit, because a stream is billed
 *  after it completes. A fixture that only ever sits at 36% renders one of the
 *  three, which is how the over-limit row ships unlooked-at. */
const NEAR = params.get('near') === '1';
const OVER = params.get('over') === '1';
const startedAt = new Date(Date.now() - 11 * 60_000).toISOString();
const expiresAt = new Date(Date.now() + 19 * 60_000).toISOString();

// Every call site is `window.electronAPI?.foo?.()`, so a Proxy answering any
// name with a resolved no-op is enough to mount the real component. Only the
// handful of getters this card's state machine actually reads need real shapes.
const noop = async () => ([] as any);

const OVERRIDES: Record<string, () => Promise<any>> = {
  // No key saved: `isSaved` false is half of what puts the card on screen.
  getStoredCredentials: async () => ({ hasNativelyKey: false }),
  getNativelyApiKey: async () => null,
  // The other half: no trial token, and never claimed.
  getLocalTrial: async () => (ACTIVE
    ? { hasToken: true, trialClaimed: true, expiresAt, startedAt, expired: false }
    : { hasToken: false, trialClaimed: CLAIMED }),
  getTrialStatus: async () => (ACTIVE
    ? {
      ok: true,
      expired: false,
      started_at: startedAt,
      expires_at: expiresAt,
      // Mid-trial, deliberately uneven so every meter shows a different fill.
      usage: OVER
        // AI past its limit (105%), the rest untouched: the red row next to
        // two ordinary ones is the comparison that matters.
        ? { ai: 0, ai_tokens: 63_000, stt_seconds: 7 * 60, search: 2, embedding_tokens: 4_800 }
        : NEAR
          // 92% / 90% / 100%: amber on all three, plus the at-limit case.
          ? { ai: 0, ai_tokens: 55_000, stt_seconds: 27 * 60, search: 3, embedding_tokens: 18_400 }
          : { ai: 0, ai_tokens: 21_400, stt_seconds: 7 * 60, search: 2, embedding_tokens: 4_800 },
      limits: {
        duration_ms: 30 * 60_000, ai_requests: 10, ai_tokens: 60_000,
        stt_minutes: 30, transcription_minutes: 30, search_requests: 3,
        research_credits_usd: 3, embedding_tokens: 20_000, reranker_tokens: 250_000,
      },
    }
    : { ok: false }),
  getNativelyUsage: async () => null,
  getNativelyPlans: async () => null,
  getLicenseDetails: async () => ({ isPremium: false }),
};

(window as any).electronAPI = new Proxy({}, {
  get: (_t, prop: string) => {
    if (prop === 'then') return undefined; // never look thenable
    if (prop.startsWith('on')) return () => () => { }; // subscribe -> unsubscribe
    return OVERRIDES[prop] ?? noop;
  },
});

document.documentElement.setAttribute('data-theme', LIGHT ? 'light' : 'dark');

function Harness() {
  return (
    // The real panel renders inside SettingsOverlay's periwinkle theme scope and
    // on --bg-main; without both, the card's material resolves against the wrong
    // accent and an untinted canvas.
    <div
      data-settings-theme="periwinkle"
      style={{
        padding: 32, maxWidth: 640, margin: '0 auto',
        minHeight: '100vh',
        background: LIGHT ? '#fafafa' : '#1E1E21',
      }}
    >
      <NativelyApiSettings />
    </div>
  );
}

createRoot(document.getElementById('harness-root')!).render(<Harness />);
