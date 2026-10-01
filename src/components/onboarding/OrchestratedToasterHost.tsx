/**
 * OrchestratedToasterHost — single-slot renderer for the onboarding orchestrator.
 *
 * Mounted once at the App.tsx root (in the launcher render path). Reads
 * `activeToasterId` from the orchestrator state and renders exactly one toaster
 * component. Single-slot invariant is enforced by the orchestrator; this host
 * just dispatches.
 */

import React, { useEffect, useState, useSyncExternalStore } from 'react';
// Explicit `.ts` extension is load-bearing — see App.tsx's import of the
// same module for why (Vite resolves the sibling orchestrator.mjs test
// companion first on an unqualified specifier, silently loading a no-op
// stub whose getSnapshot() is not referentially stable and infinite-loops
// useSyncExternalStore below).
import { getOrchestrator, type OrchestratorEvent, type UserState } from '../../lib/onboarding/orchestrator.ts';
import type { ToasterId } from '../../lib/onboarding/orchestrator.ts';
import { PermissionsToaster } from './PermissionsToaster';
import { BrowserExtensionToaster } from './BrowserExtensionToaster';
import { TrialPromoToaster } from '../trial/TrialPromoToaster';
import { SupportToaster } from '../SupportToaster';
import ReviewPromptHost from '../ReviewPromptHost';
import {
  NativelyApiPromoToaster,
  ProfileFeatureToaster,
  JDAwarenessToaster,
  MaxUltraUpgradeToaster,
} from '../../premium';
import { CARDS, DAY_MS } from '../../lib/cards/cardPolicy.mjs';
import { createShowingRecorder } from '../../lib/cards/outcomeLatch.mjs';
import { startTrialWithRetry } from '../../lib/trial/trialStart.mjs';

/** Why a card closed, as the card reports it: its primary action, an explicit "never", or a plain close. */
// 'after_error': the trial promo closed after our own error (network, server);
// that showing ends with no outcome, so it is no strike (spec §6 row 8).
// 'connected': the browser extension connected while its card was open, which
// retires the card (spec §6 row 9).
type CloseReason = 'acted' | 'never' | 'after_error' | 'connected' | undefined;

/** Write one card outcome to the main-process ledger (cards:record). */
function recordCard(card: string, outcome: string, meta?: { until?: number }): void {
  window.electronAPI?.cardsRecord?.(card, outcome, meta)?.catch?.(() => {});
}

interface HostProps {
  /** Open a Settings tab (ai-providers, plans, natively-api…). */
  onOpenSettings?: (tab: string) => void;
  /** Open the Profile manager (résumé / JD). */
  onOpenProfile?: () => void;
}

// ─── Event channel ────────────────────────────────────────────────

let emitFn: ((e: OrchestratorEvent) => void) | null = null;

export function emitOrchestratorEvent(e: OrchestratorEvent): void {
  emitFn?.(e);
}

export function setUserState(patch: Partial<UserState>): void {
  const orch = getOrchestrator();
  orch.setUserState(patch);
}

// ─── Provider ─────────────────────────────────────────────────────

interface ProviderProps {
  children: React.ReactNode;
}

export const OrchestratorProvider: React.FC<ProviderProps> = ({ children }) => {
  const orch = getOrchestrator();
  const [activeId, setActiveId] = useState<ToasterId | null>(null);

  useEffect(() => {
    emitFn = orch.emit.bind(orch);
    // Subscribe to state changes for the host
    const unsubscribe = orch.subscribe((state) => {
      setActiveId(state.activeToasterId);
    });

    return () => {
      emitFn = null;
      unsubscribe();
    };
  }, [orch]);

  // Hand the App's launcher/event channels through the orchestrator.
  // (Mount/unmount events come from Launcher via emitOrchestratorEvent.)
  return <>{children}</>;
};

// ─── Host ─────────────────────────────────────────────────────────

export const OrchestratedToasterHost: React.FC<HostProps> = ({ onOpenSettings, onOpenProfile }) => {
  const orch = getOrchestrator();
  // Stable subscribe/snapshot refs — .bind() would re-allocate every render.
  const orchSubscribe = React.useCallback((cb: () => void) => orch.subscribe(cb), [orch]);
  const orchSnapshot = React.useCallback(() => orch.getSnapshot(), [orch]);
  const state = useSyncExternalStore(orchSubscribe, orchSnapshot);
  const activeId = state.activeToasterId;

  // Card ledger (toaster policy): record each showing and the first definite
  // outcome of it. A card the app takes away (unmount) records nothing.
  const recorder = React.useRef(createShowingRecorder(recordCard)).current;
  // A card a DEV override forced (devOverrides.ts) records nothing (spec §10).
  const forced = state.forcedToasterId === activeId;
  useEffect(() => {
    if (activeId && !forced && Object.prototype.hasOwnProperty.call(CARDS, activeId)) recorder.start(activeId);
    else recorder.end();
  }, [activeId, forced, recorder]);

  const onDismiss = (id: ToasterId) => () => orch.markDismissed(id);
  /** Close a card, recording why: its own reason, else a plain "later". */
  const closeWith = (id: ToasterId) => (reason?: CloseReason) => {
    if (reason === 'after_error') recorder.end();
    else if (reason === 'connected') recorder.outcome('never');
    else recorder.outcome(reason ?? 'later');
    orch.markDismissed(id);
  };
  const openSettings = (tab: string) => {
    if (onOpenSettings) onOpenSettings(tab);
    else window.electronAPI?.openSettingsTab?.(tab);
  };

  if (!activeId) return null;

  // Development-only native-OOM bisection. Keep orchestration/state updates
  // alive but exclude every visible onboarding modal, which distinguishes the
  // host's scheduling work from the currently-active modal implementation.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('isolate') === 'no-modals') {
    return null;
  }

  switch (activeId) {
    case 'permissions':
      // Dev-only native-OOM bisection: keep the orchestrator and every later
      // stage active while excluding only the permissions card's animated,
      // backdrop-filter-heavy visual guide.
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('isolate') === 'permissions-toaster') {
        return null;
      }
      return (
        <PermissionsToaster
          isOpen={true}
          onDismiss={() => {
            // Write the legacy flag so future launches don't re-show on first
            // launch. A permission that later breaks (either platform) is
            // detected via checkPermissions and re-triggers via the
            // permissionsNeedAttention user-state.
            try { localStorage.setItem('natively_perms_shown_v1', '1'); } catch {}
            window.electronAPI?.onboardingSetFlag?.('permsShown', true).catch(() => {});
            // Reflect permsShown in the live orchestrator user-state *now*.
            // Without this, `permsShown` stays false in-session (it is only
            // re-read from localStorage on the next App.tsx effect / relaunch),
            // so stageCatalog's `skipWhen: permsShown && !permissionsNeedAttention` never
            // becomes true and the RAF drain loop re-raises this toaster on the
            // very next frame — making the X button appear to do nothing.
            orch.setUserState({ permsShown: true });
            onDismiss('permissions')();
          }}
        />
      );

    case 'browser_extension':
      // No onSkip: a card's waits live in the card ledger, never in a skip.
      return <BrowserExtensionToaster isOpen={true} onDismiss={closeWith('browser_extension')} />;

    case 'profile_intelligence':
      // Profile intelligence is rendered by Launcher's popover when triggered
      // via the existing icon click. The orchestrator's "completion" here
      // means user has seen the settings panel; the popover itself is gone.
      return null;

    case 'modes_manager':
      // Same as profile — modes onboarding popover gone.
      return null;

    case 'trial_promo':
      // TrialPromoToaster needs additional props for start/manual setup,
      // which it reads from window.electronAPI at runtime. The orchestrator
      // hands it `isOpen` and onDismiss only.
      return (
        <TrialPromoToaster
          isOpen={true}
          hasNativelyKey={orch.getUserState().hasNativelyKey}
          hasTrialToken={orch.getUserState().hasTrialToken}
          onDismiss={closeWith('trial_promo')}
          onStartTrial={async () => {
            // Our own errors (network, server) are retried once; the server's
            // answers are final (spec §6 row 8).
            const kind = await startTrialWithRetry(() => window.electronAPI?.startTrial?.() ?? Promise.resolve(undefined));
            if (kind === 'started') { orch.setUserState({ hasTrialToken: true, trialClaimed: true }); recorder.outcome('acted'); }
            // Already used on this device: the promo retires and the card
            // offers a key or the user's own keys instead.
            if (kind === 'unavailable') { orch.setUserState({ trialClaimed: true }); recorder.outcome('never'); }
            // The toaster reports the dismiss itself, once its close has
            // played: dismissing here would unmount it mid-genie.
            return kind;
          }}
          onGetKey={() => openSettings('plans')}
          onManualSetup={() => {
            // "I'll set up manually" is a decision: the trial promo retires.
            recorder.outcome('acted');
            openSettings('ai-providers');
          }}
        />
      );

    case 'quiet_window':
      // Internal gate — never renders a visible component.
      return null;

    case 'support':
      return (
        <SupportToaster
          isOpen={true}
          onDismiss={(reason?: CloseReason) => {
            // DonationManager still counts showings (About page, legacy
            // import); the card ledger decides when support may return.
            window.electronAPI?.markDonationToastShown?.().catch(() => {});
            closeWith('support')(reason);
          }}
        />
      );

    // ── Ads (premium components; scheduled like every other card) ──
    case 'natively_api_new':
    case 'natively_api_existing': {
      const id = activeId;
      return (
        <NativelyApiPromoToaster
          isOpen={true}
          variant={id === 'natively_api_new' ? 'new' : 'existing'}
          onDismiss={(reason?: CloseReason) => {
            // "I'll set up manually" on the new-user variant retires it and
            // goes where the keys are entered.
            if (reason === 'never' && id === 'natively_api_new') openSettings('ai-providers');
            closeWith(id)(reason);
          }}
          onOpenSettings={(tab: string) => openSettings(tab)}
        />
      );
    }

    case 'profile_ad':
      return (
        <ProfileFeatureToaster
          isOpen={true}
          onDismiss={closeWith('profile_ad')}
          onSetupProfile={() => onOpenProfile?.()}
        />
      );

    case 'jd_ad':
      return (
        <JDAwarenessToaster
          isOpen={true}
          onDismiss={closeWith('jd_ad')}
          onSetupJD={() => onOpenProfile?.()}
        />
      );

    case 'max_ultra':
      return (
        <MaxUltraUpgradeToaster
          isOpen={true}
          onDismiss={(reason?: CloseReason) => {
            if (reason === 'acted') {
              // Retired for this billing cycle only: back next cycle if the
              // user is near the limit again. 30 days when the cycle end is unknown.
              const until = orch.getUserState().nativelyQuotaResetsAt ?? Date.now() + 30 * DAY_MS;
              recorder.outcome('acted', { until });
            }
            closeWith('max_ultra')(reason);
          }}
          onUpgrade={() => openSettings('plans')}
        />
      );

    case 'review_prompt':
      return (
        <ReviewPromptHost
          isOpen={true}
          paused={false}
          onOutcome={(o) => recorder.outcome(o)}
          onClose={closeWith('review_prompt')}
        />
      );

    default:
      return null;
  }
};