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
      // Permanently stripped (commercial-surface-strip / ticket 03). Stage is
      // always skipWhen; TrialPromoToaster must not mount.
      return null;

    case 'quiet_window':
      // Internal gate — never renders a visible component.
      return null;

    case 'ads':
      // Permanently stripped (commercial-surface-strip / ticket 05). Stage is
      // always skipWhen; premium useAdCampaigns stubs remain no-op.
      return null;

    case 'review_prompt':
      // Permanently stripped — ReviewPromptHost must not mount on product paths.
      return null;

    default:
      return null;
  }
};