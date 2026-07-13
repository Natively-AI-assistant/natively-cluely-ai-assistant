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

export const OrchestratedToasterHost: React.FC = () => {
  const orch = getOrchestrator();
  // Stable subscribe/snapshot refs — .bind() would re-allocate every render.
  const orchSubscribe = React.useCallback((cb: () => void) => orch.subscribe(cb), [orch]);
  const orchSnapshot = React.useCallback(() => orch.getSnapshot(), [orch]);
  const state = useSyncExternalStore(orchSubscribe, orchSnapshot);
  const activeId = state.activeToasterId;

  const onDismiss = (id: ToasterId) => () => orch.markDismissed(id);
  const onSkip = (id: ToasterId) => () => orch.markSkipped(id);

  if (!activeId) return null;

  // Development-only native-OOM bisection. Keep orchestration/state updates
  // alive but exclude every visible onboarding modal, which distinguishes the
  // host's scheduling work from the currently-active modal implementation.
  if (new URLSearchParams(window.location.search).get('isolate') === 'no-modals') {
    return null;
  }

  switch (activeId) {
    case 'permissions':
      // Dev-only native-OOM bisection: keep the orchestrator and every later
      // stage active while excluding only the permissions card's animated,
      // backdrop-filter-heavy visual guide.
      if (new URLSearchParams(window.location.search).get('isolate') === 'permissions-toaster') {
        return null;
      }
      return (
        <PermissionsToaster
          isOpen={true}
          onDismiss={() => {
            // Write the legacy flag so future launches don't re-show on first
            // launch. Mac TCC revocation is still detected via checkPermissions
            // and re-triggers via macTCCBlocked user-state.
            try { localStorage.setItem('natively_perms_shown_v1', '1'); } catch {}
            window.electronAPI?.onboardingSetFlag?.('permsShown', true).catch(() => {});
            // Reflect permsShown in the live orchestrator user-state *now*.
            // Without this, `permsShown` stays false in-session (it is only
            // re-read from localStorage on the next App.tsx effect / relaunch),
            // so stageCatalog's `skipWhen: permsShown && !macTCCBlocked` never
            // becomes true and the RAF drain loop re-raises this toaster on the
            // very next frame — making the X button appear to do nothing.
            orch.setUserState({ permsShown: true });
            onDismiss('permissions')();
          }}
        />
      );

    case 'browser_extension':
      return <BrowserExtensionToaster isOpen={true} onDismiss={onDismiss('browser_extension')} onSkip={onSkip('browser_extension')} />;

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
          onDismiss={onDismiss('trial_promo')}
          onStartTrial={async () => {
            const res = await window.electronAPI?.startTrial?.();
            if (!res?.ok) throw new Error(res?.error || 'Could not start trial');
            orch.setUserState({ hasTrialToken: true });
            onDismiss('trial_promo')();
          }}
          onManualSetup={() => {
            window.electronAPI?.openSettingsTab?.('api');
            onDismiss('trial_promo')();
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
          onDismiss={() => {
            // Mark the donation toast as shown so DonationManager's
            // lifetimeShows counter increments and the 21-day cooldown
            // starts. Without this the support toaster re-fires on every
            // cold launch past the cooldown threshold.
            window.electronAPI?.markDonationToastShown?.().catch(() => {});
            onDismiss('support')();
          }}
        />
      );

    case 'ads':
      // The 5 ad toasters are driven by useAdCampaigns.ts which still runs in
      // App.tsx and consults natively_ads_shown_history. The orchestrator's
      // role for `ads` is purely as a gate — when eligible, it just allows
      // useAdCampaigns to proceed (the activeAd state already controls which
      // component renders).
      return null;

    case 'review_prompt':
      // In dev builds an uncontrolled <ReviewPromptHost /> is mounted in
      // App.tsx via shouldMountDevReviewHost() so the modal can be iterated
      // on without going through the full orchestrator gating. Skip the
      // orchestrator's own mount in that case to avoid two modals. In
      // production, this branch is the only render path.
      if (typeof window !== 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dev: boolean = !!(import.meta as any)?.env?.DEV
        if (dev) {
          try {
            const params = new URLSearchParams(window.location?.search || '')
            const explicit = params.get('review')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const forced = (window as any).__reviewForceShow === true
            const devAuto = (explicit !== 'off' && (forced || explicit === 'force'))
            if (devAuto) return null
          } catch { /* fall through */ }
        }
      }
      return <ReviewPromptHost isOpen={true} paused={false} onClose={onDismiss('review_prompt')} />;

    default:
      return null;
  }
};