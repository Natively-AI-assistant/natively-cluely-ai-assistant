import React, { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react" // forcing refresh
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ToastProvider, ToastViewport } from "./components/ui/toast"
import NativelyInterface from "./components/NativelyInterface"
import HindsightStatusBanner from "./components/HindsightStatusBanner"
import SettingsPopup from "./components/SettingsPopup" // Keeping for legacy/specific window support if needed
import Launcher from "./components/Launcher"
import ModelSelectorWindow from "./components/ModelSelectorWindow"
import { OverlayPillWindow, OverlayToggleWindow } from "./components/OverlayAuxWindows"
import SettingsOverlay from "./components/SettingsOverlay"
import StartupSequence from "./components/StartupSequence"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import UpdateBanner from "./components/UpdateBanner"
import { NativelyQuotaBanner } from "./components/NativelyQuotaBanner"
import { FreeTrialBanner }      from "./components/trial/FreeTrialBanner"
import type { TrialUsage, TrialLimits } from './types/nativelyUsage';
import { FreeTrialModal }       from "./components/trial/FreeTrialModal"
import { OrchestratorProvider, OrchestratedToasterHost, setUserState as setOrchestratorUserState, emitOrchestratorEvent } from "./components/onboarding/OrchestratedToasterHost"
// NOTE: explicit `.ts` extension is load-bearing. Vite's default resolver
// tries `.mjs` before `.ts` (see DEFAULT_EXTENSIONS in vite/dist/node/constants.js),
// and this directory also has an `orchestrator.mjs` companion (kept for
// `node --test`, which can't run TypeScript directly). An unqualified
// specifier here silently resolved to the `.mjs` file's no-op stub
// orchestrator instead of the real class — the entire onboarding flow
// (permissions/browser-ext/trial-promo toasters) was silently inert, AND
// the stub's getSnapshot() returned a fresh object every call, which
// tripped useSyncExternalStore's referential-equality check into an
// infinite re-render loop (React's "Maximum update depth exceeded"),
// unmounting the whole tree — the black-screen root cause. Do not remove
// the extension.
import { getOrchestrator } from "./lib/onboarding/orchestrator.ts"
import { isInternalCaptureDevice } from "../electron/audio/audioDeviceSelection.mjs"
import { ProviderChangeNotice, type EmbeddingDegradedNotice } from "./components/ProviderChangeNotice"
import { clampOverlayOpacity, OVERLAY_OPACITY_DEFAULT, getDefaultOverlayOpacity } from "./lib/overlayAppearance"
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from './lib/meetingInterfaceTheme'
import { permissionsNeedAttention } from './lib/permissionAttentionPolicy.mjs'
import { collectRendererLegacy } from './lib/cards/rendererLegacy.mjs'
import { cardInputsFromSources } from './lib/cards/cardInputs.mjs'
import { forcedCardFromQuery } from './lib/onboarding/devOverrides.ts'
import { isMac } from "./utils/platformUtils"
import { trackAppOpen } from "./lib/toasterGating"
import { PREMIUM_ADS_AVAILABLE } from './premium'
import { analytics } from "./lib/analytics/analytics.service"
import { ErrorBoundary } from "./components/ErrorBoundary"
import ModesSettings from "./components/settings/ModesSettings"
import { GenieModal } from "./components/ui/GenieModal"
import { GENIE_CLOSE_MS } from "./components/onboarding/useGenieCard"
import { ProfileIntelligenceSettings } from "./components/ProfileIntelligenceSettings"
import { useResolvedTheme } from "./hooks/useResolvedTheme"
import { WelcomeFlow } from "./components/onboarding/WelcomeFlow"
import { shouldShowWelcome, hasOnboardingHistory, WELCOME_SEEN_KEY, LEGACY_PERMS_SHOWN_KEY, ONBOARDING_STATE_KEY } from "./lib/onboarding/welcomeGate.mjs"

// How often the launcher may re-read the card inputs when it regains focus
// (main caches /usage for 60 s; toaster policy §6 row 18).
const CARD_INPUTS_FOCUS_REFRESH_MS = 5 * 60_000;


const queryClient = new QueryClient()
const CropperWindow = React.lazy(() => import('./components/Cropper'))

type LauncherIsolation = 'onboarding' | 'global-surfaces' | 'permissions-toaster' | 'no-modals' | null
type ManagerPanel = 'modes' | 'profile' | null

type ManagerPanelDirection = 'forward' | 'backward'

const MANAGER_EASE = [0.22, 0.61, 0.36, 1] as const
// The manager card's drop shadow (.manager-panel-shell in index.css), carried
// by GenieModal's stand-in while the card is mid-genie.
const MANAGER_SHADOW_DARK = '0 24px 64px -24px rgba(0,0,0,0.72), 0 8px 24px -16px rgba(0,0,0,0.5)'
const MANAGER_SHADOW_LIGHT = '0 24px 64px -24px rgba(0,0,0,0.18), 0 8px 24px -16px rgba(0,0,0,0.1)'
const MANAGER_SHELL_EASE = [0.16, 1, 0.3, 1] as const
const MANAGER_OPEN_EASE = [0.16, 1, 0.3, 1] as const
const MANAGER_CLOSE_EASE = [0.3, 0.9, 0.2, 1] as const

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('inert') && element.offsetParent !== null)
}

// The Electron main process only appends `isolate` during an explicit dev-mode
// native-OOM run. Keeping this query-driven and default-off makes it impossible
// for packaged launcher sessions to lose product surfaces accidentally.
function getLauncherIsolation(): LauncherIsolation {
  try {
    if (!(import.meta as any)?.env?.DEV) return null
    const isolate = new URLSearchParams(window.location.search).get('isolate')
    return isolate === 'onboarding' || isolate === 'global-surfaces' || isolate === 'permissions-toaster' || isolate === 'no-modals' ? isolate : null
  } catch {
    return null
  }
}

const App: React.FC = () => {
  const isLight = useResolvedTheme() === 'light';
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isLauncherWindow = new URLSearchParams(window.location.search).get('window') === 'launcher';
  const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';
  const isModelSelectorWindow = new URLSearchParams(window.location.search).get('window') === 'model-selector';
  const isCropperWindow = new URLSearchParams(window.location.search).get('window') === 'cropper';
  // Overlay aux windows: the TopPill and the resize toggle live in their own
  // tiny BrowserWindows so the main overlay window can hug the shell card
  // exactly (no transparent-but-interactive regions).
  const isOverlayPillWindow = new URLSearchParams(window.location.search).get('window') === 'overlay-pill';
  const isOverlayToggleWindow = new URLSearchParams(window.location.search).get('window') === 'overlay-toggle';
  const launcherIsolation = getLauncherIsolation();
  const isolateOnboarding = launcherIsolation === 'onboarding' || launcherIsolation === 'global-surfaces';
  const isolatePermissionsToaster = launcherIsolation === 'permissions-toaster';
  const isolateModals = launcherIsolation === 'no-modals' || launcherIsolation === 'global-surfaces';
  const isolateGlobalSurfaces = launcherIsolation === 'global-surfaces';

  // Default to launcher if not specified (dev mode safety). The overlay aux
  // windows (pill/toggle) MUST be excluded: they early-return minimal JSX, but
  // hooks above those returns still run — without the exclusion each aux
  // renderer would fire launcher-only effects (analytics app-open/close, the
  // onboarding orchestrator, permission pushes) two extra times per launch.
  const isDefault =
    !isSettingsWindow &&
    !isOverlayWindow &&
    !isModelSelectorWindow &&
    !isCropperWindow &&
    !isOverlayPillWindow &&
    !isOverlayToggleWindow;

  // Initialize Analytics
  useEffect(() => {
    // Only init if we are in a main window context to avoid duplicate events from helper windows
    // Actually, we probably want to track app open from the main entry point.
    // Let's protect initialization to ensure single run per window.
    // The service handles single-init, but let's be thoughtful about WHICH window tracks "App Open".
    // Launcher is the main entry. Overlay is the "Assistant".

    analytics.initAnalytics();

    if (isLauncherWindow || isDefault) {
      analytics.trackAppOpen();
    }

    if (isOverlayWindow) {
      analytics.trackAssistantStart();
    }

    // Cleanup / Session End
    const handleUnload = () => {
      if (isOverlayWindow) {
        analytics.trackAssistantStop();
      }
      if (isLauncherWindow || isDefault) {
        analytics.trackAppClose();
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [isLauncherWindow, isOverlayWindow, isDefault]);

  // State
  const [showStartup, setShowStartup] = useState(true);
  // Stable identity: StartupSequence arms its dismissal timers in a
  // useEffect(deps:[onComplete]). An inline closure would be a new identity on
  // every App re-render — and the boot path re-renders many times (7-10 async
  // IPCs each setState on resolve, plus orchestrator notifies). That would tear
  // down and re-arm BOTH the 2.2s primary AND the 5s hard-cap timer on every
  // render, so under a slow/re-render-heavy boot the hard-cap could keep
  // resetting and never fire — the "stuck at the startup animation" symptom.
  // Memoizing to [] makes the splash timers arm exactly once.
  const dismissStartup = useCallback(() => setShowStartup(false), []);

  // First-launch welcome, shown after the splash and before the launcher on a
  // fresh install only (src/lib/onboarding/welcomeGate.mjs). null = not decided
  // yet: the splash holds until it is, because showing the launcher first let
  // it mount and start the orchestrator's clock, so the permissions card opened
  // on top of the welcome when the flag read landed after the 2.2s splash (a
  // busy first boot). WELCOME_DECIDE_TIMEOUT_MS below bounds the wait.
  const [showWelcome, setShowWelcome] = useState<boolean | null>(null);
  const readWelcomeLocal = useCallback(() => {
    try {
      return {
        welcomeSeen: localStorage.getItem(WELCOME_SEEN_KEY) === '1',
        permsShown: localStorage.getItem(LEGACY_PERMS_SHOWN_KEY) === '1',
        onboarded: hasOnboardingHistory(localStorage.getItem(ONBOARDING_STATE_KEY)),
      };
    } catch {
      // No storage: treat as seen rather than risk showing it every launch.
      return { welcomeSeen: true, permsShown: false, onboarded: false };
    }
  }, []);
  // Welcome, then the shortcut tour (WelcomeFlow owns the step). Marked seen
  // only when the tour ends (finished or skipped), so quitting halfway brings
  // the welcome back.
  const finishWelcome = useCallback(() => {
    try { localStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch {}
    window.electronAPI?.onboardingSetFlag?.('seenStartup', true).catch(() => {});
    setShowWelcome(false);
  }, []);
  // A hung flag read must never trap the user on the splash: decide from the
  // local mirrors alone. Functional update, so a real answer that already
  // landed is kept.
  useEffect(() => {
    const WELCOME_DECIDE_TIMEOUT_MS = 4000;
    const t = setTimeout(() => {
      setShowWelcome(prev => prev ?? shouldShowWelcome(null, readWelcomeLocal()));
    }, WELCOME_DECIDE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [readWelcomeLocal]);

  /**
   * Tell main the boot reveal has landed, so it can restore background
   * throttling on this window.
   *
   * WindowHelper creates the launcher with `backgroundThrottling: false`
   * because Chromium stops rAF for a hidden window and this reveal is a Framer
   * Motion transition — but nothing turned it back on, so the opt-out outlived
   * the one-shot animation. Measured 2026-09-03: a hidden window with the
   * opt-out ran 600 rAF frames in 10s where a throttled one ran 0, which means
   * a launcher hidden during summary generation kept compositing ~19 infinite
   * `.mn-skel` animations off screen.
   *
   * Hung off the entrance animation's own completion rather than a timer, so
   * the reveal is provably finished before throttling returns. Once only —
   * AnimatePresence can re-run this branch.
   */
  const revealReported = useRef(false);
  const reportRevealComplete = useCallback(() => {
    if (revealReported.current) return;
    if (!(isLauncherWindow || isDefault)) return;
    revealReported.current = true;
    try {
      window.electronAPI?.notifyLauncherRevealComplete?.();
    } catch {
      /* a missing bridge just means throttling stays as it was */
    }
  }, [isLauncherWindow, isDefault]);

  // Bug 1 + Bug 2: only mount the launcher-side floating card AFTER the
  // startup animation has finished AND a 3s settle window has elapsed.
  // Triggers `false → true` 3s after `showStartup` flips false; tracked via
  // a single boolean so the IPC subscription + motion entrance don't fire
  // during the startup animation or while the main UI is still settling.
  const [showHindsightBanner, setShowHindsightBanner] = useState(false);
  useEffect(() => {
    if (showStartup || showWelcome !== false) return; // never schedule while startup or the welcome is up
    const t = setTimeout(() => setShowHindsightBanner(true), 3000);
    return () => clearTimeout(t);
  }, [showStartup, showWelcome]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  /* Settings deep-link target, plus a sequence number that increments on EVERY
     request even when the tab is unchanged.

     Without `seq`, re-issuing the SAME tab was a silent no-op: setState with an
     equal value does not re-render, so SettingsOverlay's sync effect never ran.
     That was invisible while a tab id mapped to exactly one view, and became a
     real defect once Retrieval grew Embedding/Reranker sub-tabs — clicking AI
     Providers' lightweight-embedding notice a second time (after browsing to
     the Reranker sub-tab) left the user where they were. Reproduced live
     2026-09-15 before this fix. */
  const [settingsNav, setSettingsNav] = useState<{ tab: string; seq: number }>({ tab: 'general', seq: 0 });
  const [activeManagerPanel, setActiveManagerPanel] = useState<ManagerPanel>(null);
  const lastManagerPanelRef = useRef<Exclude<ManagerPanel, null>>('modes');
  if (activeManagerPanel) lastManagerPanelRef.current = activeManagerPanel;
  const [managerPanelDirection, setManagerPanelDirection] = useState<ManagerPanelDirection>('forward');
  const managerDialogRef = useRef<HTMLDivElement>(null);
  const managerOpenerRef = useRef<HTMLElement | null>(null);
  const reduceManagerMotion = useReducedMotion() ?? false;

  const rememberManagerOpener = useCallback(() => {
    const activeElement = document.activeElement;
    managerOpenerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
  }, []);

  const closeManagerPanel = useCallback(() => {
    setActiveManagerPanel(null);
  }, []);

  const openSettingsExclusive = useCallback((tab: string = 'general') => {
    // Settings replaces the manager rather than closing back to its launcher trigger.
    managerOpenerRef.current = null;
    setActiveManagerPanel(null);
    setSettingsNav(prev => ({ tab, seq: prev.seq + 1 }));
    setIsSettingsOpen(true);
  }, []);

  const openProfileExclusive = useCallback(() => {
    if (!activeManagerPanel) rememberManagerOpener();
    if (activeManagerPanel === 'modes') setManagerPanelDirection('forward');
    setIsSettingsOpen(false);
    setActiveManagerPanel('profile');
  }, [activeManagerPanel, rememberManagerOpener]);

  const openModesExclusive = useCallback(() => {
    if (!activeManagerPanel) rememberManagerOpener();
    if (activeManagerPanel === 'profile') setManagerPanelDirection('backward');
    setIsSettingsOpen(false);
    setActiveManagerPanel('modes');
  }, [activeManagerPanel, rememberManagerOpener]);

  useEffect(() => {
    if (!activeManagerPanel) {
      const opener = managerOpenerRef.current;
      if (opener?.isConnected) opener.focus();
      return;
    }
    const frame = requestAnimationFrame(() => managerDialogRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [activeManagerPanel]);

  // Tab stays inside the manager. A handler on the card rather than an effect
  // keyed on the panel: the card now mounts a render after the panel is set
  // (it pours out through GenieModal), so an effect would find no dialog yet.
  const handleManagerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (document.activeElement === dialog) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);
  const [isPremiumActive, setIsPremiumActive] = useState(false);
  const [hasLoadedLicense, setHasLoadedLicense] = useState(false);
  const [planDetails, setPlanDetails] = useState<{ isPremium: boolean; plan?: string; provider?: string }>({ isPremium: false });

  // Overlay opacity — only meaningful when isOverlayWindow, but stored centrally
  // so it can be initialized once from localStorage and updated via IPC.
  const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
    const stored = localStorage.getItem('natively_overlay_opacity');
    const parsed = stored ? parseFloat(stored) : NaN;
    // Treat missing value or the old default (0.65) as "not user-set"
    const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
    return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
  });

  const [meetingInterfaceTheme, setMeetingInterfaceThemeState] = useState<MeetingInterfaceTheme>(getMeetingInterfaceTheme);

  // Profile state for ad targeting
  const [hasProfile, setHasProfile] = useState(false);
  const [isLauncherMainView, setIsLauncherMainView] = useState(true);

  // Initialize Ads Campaign Manager
  const [appStartTime] = useState<number>(Date.now());
  const [lastMeetingEndTime, setLastMeetingEndTime] = useState<number | null>(null);
  const [isProcessingMeeting, setIsProcessingMeeting] = useState<boolean>(false);
  
  // Ollama Auto-Pull State
  const [ollamaPullStatus, setOllamaPullStatus] = useState<'idle' | 'downloading' | 'complete' | 'failed'>('idle');
  const [ollamaPullPercent, setOllamaPullPercent] = useState<number>(0);
  const [ollamaPullMessage, setOllamaPullMessage] = useState<string>('');

  // Re-index State
  const [incompatibleWarning, setIncompatibleWarning] = useState<{count: number; oldProvider: string; newProvider: string} | null>(null);
  // Automatic background re-index progress (fired after an embedding-model upgrade).
  const [reindexProgress, setReindexProgress] = useState<{done: number; total: number} | null>(null);
  // Re-index was asked for and its first progress event has not arrived yet:
  // the card shows 0 of the warning's count meanwhile instead of closing.
  const [reindexPending, setReindexPending] = useState<number | null>(null);
  const reindexShown = reindexProgress ?? (reindexPending != null ? { done: 0, total: reindexPending } : null);
  // Semantic search fell back to another embedding provider, or its space
  // could not be saved. Shown for a few seconds in the corner notice.
  const [embeddingNotice, setEmbeddingNotice] = useState<EmbeddingDegradedNotice | null>(null);

  // API check
  const [hasNativelyApi, setHasNativelyApi] = useState<boolean>(false);

  // ── Onboarding toasters now handled by OnboardingOrchestrator ──
  // (No local state for permissions / trial promo toasters.)

  // ── Free Trial global state ────────────────────────────────
  const [activeTrial, setActiveTrial] = useState<{
    expiresAt: string;
    usage: TrialUsage;
    /** Carried from /v1/trial/status so the banner does not hardcode allowances. */
    limits?: TrialLimits;
  } | null>(null);
  // Dev-only: `?forceTrialEnded=1` opens the end-of-trial card for a design check.
  const [showTrialExpiredModal, setShowTrialExpiredModal] = useState(() =>
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('forceTrialEnded')
  );
  // The card is due (expired at launch) but still inside its 10 s delay: it
  // already owns the card slot, so no other card can open under it.
  const [trialEndedDue, setTrialEndedDue] = useState(false);
  // 0:00 on the banner: settle the expiry from the LOCAL clock and open the
  // card at once, offline included, instead of waiting for the next poll
  // (toaster policy §5 row 2).
  const handleTrialClockExpired = useCallback(() => {
    window.electronAPI?.getLocalTrial?.().then((local: any) => {
      if (local?.showEndedCard) { setActiveTrial(null); setShowTrialExpiredModal(true); }
    }).catch(() => {});
  }, []);

  const isManagerOpen = activeManagerPanel !== null;
  const managerContentVariants = {
    initial: reduceManagerMotion ? { opacity: 0 } : { opacity: 0, x: 10 },
    animate: reduceManagerMotion
      ? { opacity: 1, transition: { duration: 0 } }
      : { opacity: 1, x: 0, transition: { duration: 0.32, ease: MANAGER_EASE } },
    exit: reduceManagerMotion
      ? { opacity: 0, transition: { duration: 0 } }
      : { opacity: 0, x: -6, transition: { duration: 0.14, ease: MANAGER_EASE } },
  };
  const isAppReady = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !showStartup && showWelcome === false && !isSettingsOpen && !isManagerOpen && isLauncherMainView;

  const orch = (isLauncherWindow || isDefault) ? getOrchestrator() : null;
  // Stable subscribe/snapshot refs for useSyncExternalStore — without these,
  // .bind() creates a new function on every render, causing the store to
  // tear down and re-subscribe unnecessarily.
  const orchSubscribe = React.useCallback(
    (cb: () => void) => orch ? orch.subscribe(cb) : () => {},
    [orch],
  );
  const orchSnapshot = React.useCallback(
    () => orch ? orch.getSnapshot() : null,
    [orch],
  );
  const orchState = useSyncExternalStore(orchSubscribe, orchSnapshot);
  // ── Card scheduler inputs (toaster policy) ──────────────────────────────
  // What decides which card is relevant (keys, plan, profile, JD, trial,
  // extension, quota) is read live and re-read whenever it can have changed;
  // the card ledger arrives from main and follows every cards:changed.
  const refreshCardInputsRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isLauncherWindow && !isDefault) return;
    const api = window.electronAPI;
    let disposed = false;
    // Refreshes overlap (focus, credentials, licence, extension); one carrying
    // the /usage network call can land after a newer one. Only the latest writes.
    let refreshSeq = 0;
    const refresh = async () => {
      const mine = ++refreshSeq;
      const [creds, licence, profile, trialLocal, extension] = await Promise.all([
        api?.getStoredCredentials?.().catch(() => undefined),
        api?.licenseGetDetails?.().catch(() => undefined),
        api?.profileGetStatus?.().catch(() => undefined),
        api?.getLocalTrial?.().catch(() => undefined),
        api?.phoneMirrorGetInfo?.().catch(() => undefined),
      ]);
      const usage = creds?.hasNativelyKey ? await api?.getNativelyUsage?.().catch(() => undefined) : undefined;
      if (disposed || mine !== refreshSeq) return;
      setOrchestratorUserState({
        ...cardInputsFromSources({ creds, licence, profile, trialLocal, extension, usage }),
        adsAvailable: PREMIUM_ADS_AVAILABLE,
      });
    };
    refreshCardInputsRef.current = () => { void refresh(); };
    const applyLedger = (ledger: unknown) => {
      if (!disposed && ledger) setOrchestratorUserState({ cardLedger: ledger as never });
    };
    // Hand main this window's pre-ledger card history first (main ignores
    // every import after the first), then load the ledger. Until it loads, no
    // card stage shows.
    let legacy = {};
    try { legacy = collectRendererLegacy(localStorage); } catch { /* storage unavailable */ }
    Promise.resolve(api?.cardsImportLegacy?.(legacy))
      .catch(() => undefined)
      .then(() => api?.cardsGet?.())
      .then((res) => { if (res?.ok) applyLedger(res.ledger); })
      .catch(() => {});
    void refresh();
    const offs = [
      api?.onCardsChanged?.(applyLedger),
      api?.onCredentialsChanged?.(() => { void refresh(); }),
      // Trial start, end and expiry all broadcast credentials-changed too
      // (syncNativelyModelRuntime), so they need no subscription of their own.
      api?.onLicenseStatusChanged?.(() => { void refresh(); }),
      api?.onPhoneMirrorStatus?.(() => { void refresh(); }),
    ];
    // Quota climbs during the day: re-read on focus, at most every 5 minutes,
    // so Max/Ultra can meet a Pro user who crossed 80 % without a relaunch.
    let lastFocusRefresh = Date.now();
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh < CARD_INPUTS_FOCUS_REFRESH_MS) return;
      lastFocusRefresh = now;
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      disposed = true;
      window.removeEventListener('focus', onFocus);
      offs.forEach((off) => { try { off?.(); } catch { /* already gone */ } });
    };
  }, [isLauncherWindow, isDefault]);

  // Profile / JD edits happen in the managers and keys in Settings: re-read
  // the inputs when either closes.
  useEffect(() => {
    if (!isSettingsOpen && !isManagerOpen) refreshCardInputsRef.current();
  }, [isSettingsOpen, isManagerOpen]);

  // The Trial ended card owns the screen while it is open.
  useEffect(() => {
    if (!isLauncherWindow && !isDefault) return;
    setOrchestratorUserState({ trialEndedOpen: showTrialExpiredModal || trialEndedDue });
  }, [showTrialExpiredModal, trialEndedDue, isLauncherWindow, isDefault]);

  // Start the onboarding orchestrator (launcher window only). Stages are
  // registered lazily; the drain loop only runs while foreground + homepage
  // mounted.
  useEffect(() => {
    if (!isLauncherWindow && !isDefault) return;
    // A/B KILL-SWITCH (2026-07-10): ?noorch=1 (set by WindowHelper when
    // NATIVELY_DISABLE_ONBOARDING_ORCH=1) skips the onboarding orchestrator
    // entirely — no drain loop, no toasters. Lets the same build A/B the
    // orchestrator ON vs OFF to confirm/deny the 2026-07-04 native-leak
    // regression in the field. Remove once the leak fix is field-verified.
    if ((import.meta.env.DEV && new URLSearchParams(window.location.search).get('noorch') === '1') || isolateOnboarding) {
      console.warn(`[LeakTest] onboarding orchestrator disabled (${isolateOnboarding ? 'launcher isolation' : '?noorch=1'})`);
      return;
    }
    let cancelled = false;
    let stopFn: (() => void) | null = null;
    // Explicit `.ts` extensions here for the same reason as the static
    // import above — Vite resolves the sibling `.mjs` test companions first.
    // We use `getOrchestrator()` (statically imported at line 30) directly —
    // the previous dynamic `import('./lib/onboarding/orchestrator.ts')` was
    // dead code: orchestrator.ts is already in the static graph (App.tsx:30
    // and OrchestratedToasterHost.tsx:16), and the dynamic fetch just earned
    // a Vite "mixed static+dynamic import" warning without saving bytes.
    // stageCatalog stays dynamic — it is a `.mjs`-only module with no other
    // importer, so the dynamic boundary is the only thing keeping it out of
    // the launcher's initial bundle.
    import('./lib/onboarding/stageCatalog.ts').then(({ STAGES, QUIET_WINDOW_STAGE }) => {
      if (cancelled) return;
      const orch = getOrchestrator();
      orch.start([...STAGES, QUIET_WINDOW_STAGE]);
      stopFn = () => orch.stop();
      // DEV-only card overrides (?forceCard, ?forceAd, ?review=force,
      // ?extToaster=force): the card goes through the orchestrator, takes the
      // one slot like any card, and records no ledger outcome (spec §10).
      const forced = import.meta.env.DEV ? forcedCardFromQuery(window.location.search, { adsAvailable: PREMIUM_ADS_AVAILABLE }) : null;
      if (forced) orch.forceCard(forced);
    });
    return () => {
      cancelled = true;
      stopFn?.();
    };
  }, [isLauncherWindow, isDefault, isolateOnboarding]);

  // Push user-state patches to the orchestrator as plan/profile state evolves.
  useEffect(() => {
    setOrchestratorUserState({
      isPremium: isPremiumActive,
      hasProfile,
      hasNativelyKey: hasNativelyApi,
      hasTrialToken: !!activeTrial,
    });
  }, [isPremiumActive, hasProfile, hasNativelyApi, activeTrial]);

  // Pause the orchestrator while a foreground settings surface is open so
  // toasters never appear over the user's settings interaction. On the way
  // out, resume only once the card has poured back into the slot: a toaster
  // pouring out of it at the same moment reads as a tangle.
  const surfaceWasOpenRef = useRef(false);
  useEffect(() => {
    if (!isLauncherWindow && !isDefault) return;
    if (isSettingsOpen || isManagerOpen) {
      surfaceWasOpenRef.current = true;
      emitOrchestratorEvent({ type: 'launcher:unmounted' });
      return;
    }
    if (!surfaceWasOpenRef.current) {
      emitOrchestratorEvent({ type: 'launcher:mounted' });
      return;
    }
    surfaceWasOpenRef.current = false;
    const t = setTimeout(() => emitOrchestratorEvent({ type: 'launcher:mounted' }), GENIE_CLOSE_MS);
    return () => clearTimeout(t);
  }, [isSettingsOpen, isManagerOpen, isLauncherWindow, isDefault]);

  // Settings keeps priority; the shared manager owns a single Escape path for
  // both Modes and Profile Intelligence.
  useEffect(() => {
    if (!isSettingsOpen && !isManagerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (isSettingsOpen) { setIsSettingsOpen(false); return; }
      closeManagerPanel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSettingsOpen, isManagerOpen, closeManagerPanel]);



  useEffect(() => {
    // Track app opens for global gating
    trackAppOpen();

    // Clean up old local storage
    localStorage.removeItem('useLegacyAudioBackend');

    const fallbackLocal = () => {
      // The classic launch animation is intentionally shown on every launcher
      // startup, matching the older app behavior from 93ee4a21.
      setShowWelcome(shouldShowWelcome(null, readWelcomeLocal()));
    };

    if (window.electronAPI?.onboardingGetFlags) {
      window.electronAPI.onboardingGetFlags()
        .then((flags) => {
          if (flags) {
            // 1. seenStartup no longer suppresses the classic black-logo launch
            // animation (the old app played it every launch); it now marks the
            // first-launch welcome as seen.
            setShowWelcome(shouldShowWelcome(flags, readWelcomeLocal()));

            // 2. seenModesOnboarding
            if (flags.seenModesOnboarding) {
              try { localStorage.setItem('natively_seen_modes_onboarding_v5', 'true'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('natively_seen_modes_onboarding_v5') === 'true';
                if (localSeen) {
                  window.electronAPI?.onboardingSetFlag?.('seenModesOnboarding', true).catch(() => {});
                }
              } catch {}
            }

            // 3. seenProfileOnboarding
            if (flags.seenProfileOnboarding) {
              try { localStorage.setItem('natively_seen_profile_onboarding_v1', 'true'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('natively_seen_profile_onboarding_v1') === 'true';
                if (localSeen) {
                  window.electronAPI?.onboardingSetFlag?.('seenProfileOnboarding', true).catch(() => {});
                }
              } catch {}
            }

            // 4. permsShown
            if (flags.permsShown) {
              try { localStorage.setItem('natively_perms_shown_v1', '1'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('natively_perms_shown_v1') === '1';
                if (localSeen) {
                  window.electronAPI?.onboardingSetFlag?.('permsShown', true).catch(() => {});
                }
              } catch {}
            }
          } else {
            fallbackLocal();
          }
        })
        .catch(() => {
          fallbackLocal();
        });
    } else {
      fallbackLocal();
    }

    // Basic status check for campaign targeting
    window.electronAPI?.profileGetStatus?.().then(s => setHasProfile(s?.hasProfile || false)).catch(() => {});
    // Load full plan details for targeted ad delivery (plan tier + provider).
    window.electronAPI?.licenseGetDetails?.()
      .then(details => {
        setPlanDetails(details ?? { isPremium: false });
        setIsPremiumActive(details?.isPremium ?? false);
        setHasLoadedLicense(true);
      })
      .catch(() => {
        // Fallback: async premium check if licenseGetDetails is unavailable
        const premiumCheck = window.electronAPI?.licenseCheckPremiumAsync ?? window.electronAPI?.licenseCheckPremium;
        if (premiumCheck) {
          premiumCheck().then((active: boolean) => {
            setIsPremiumActive(active);
            setPlanDetails({ isPremium: active });
            setHasLoadedLicense(true);
          }).catch(() => setHasLoadedLicense(true));
        } else {
          setHasLoadedLicense(true);
        }
      });

    // Also check for Natively API key
    window.electronAPI?.getStoredCredentials?.()
      .then((creds) => setHasNativelyApi(!!creds?.hasNativelyKey))
      .catch(() => {});

    // ── Trial: check stored token and start polling if active ──
    // Only the launcher keeps the trial clock (toaster policy §7.5): App also
    // mounts in the overlay, and every poll there could settle the expiry too.
    const ownsTrialClock = isLauncherWindow || isDefault;
    let trialPollId: ReturnType<typeof setInterval> | null = null;
    let trialEndedTimer: ReturnType<typeof setTimeout> | null = null;
    const checkTrial = async () => {
      try {
        const res = await window.electronAPI?.getTrialStatus?.();
        if (!res?.ok) return;
        if (res.expired) {
          setActiveTrial(null);
          // Main settles the expiry: the profile wipe runs there, once per trial
          // and never for a licensed user, and main says whether the user still
          // has to choose (toaster policy Phase 0, settleExpiredTrial).
          if (res.showEndedCard) setShowTrialExpiredModal(true);
          if (trialPollId) { clearInterval(trialPollId); trialPollId = null; }
        } else {
          setActiveTrial({
            expiresAt: res.expires_at ?? '',
            usage:     res.usage     ?? { ai: 0, ai_tokens: 0, stt_seconds: 0, search: 0 },
            limits:    (res as { limits?: TrialLimits }).limits,
          });
        }
      } catch { /* ignore — non-critical */ }
    };
    if (ownsTrialClock) window.electronAPI?.getLocalTrial?.().then((local: any) => {
      if (!local?.hasToken) return;
      if (local.expired) {
        // Already expired at launch. Main has settled it (wiped once if due) and
        // says whether the user still has to choose; a licence or key replaced
        // the trial otherwise, and the token is already gone.
        if (local.showEndedCard) {
          setTrialEndedDue(true);
          trialEndedTimer = setTimeout(() => { trialEndedTimer = null; setShowTrialExpiredModal(true); }, 10_000);
        }
        return;
      }
      // Seed the banner from the LOCAL token before the first poll answers.
      //
      // This is the "closed the app and reopened it inside the 30 minutes and
      // the trial was gone" report. The trial was fine — the countdown just
      // had nothing to render: activeTrial was only ever set from
      // checkTrial(), a network call, so on every relaunch the banner stayed
      // absent until /v1/trial/status came back, and stayed absent FOREVER if
      // that call failed (it returns early on !ok, offline included).
      //
      // expiresAt is stored locally at start, so the clock is already knowable
      // offline. Usage starts at zero and is replaced by the poll below —
      // the settings panel has seeded itself exactly this way all along.
      setActiveTrial({
        expiresAt: local.expiresAt ?? '',
        usage: { ai: 0, ai_tokens: 0, stt_seconds: 0, search: 0 },
      });
      checkTrial();
      trialPollId = setInterval(checkTrial, 30_000);
    }).catch(() => {});

    // Listen for trial-ended event (emitted by trial:end-byok IPC)
    const removeTrialListener = window.electronAPI?.onTrialEnded?.((data) => {
      setActiveTrial(null);
      // The BYOK exit is announced while its card is still Cleaning up; that
      // card closes itself once the user leaves "All set". Every other ending
      // (a licence or key superseded the trial) takes the card away.
      if (data?.choice !== 'byok') {
        setShowTrialExpiredModal(false);
        setTrialEndedDue(false);
      }
      if (trialEndedTimer) { clearTimeout(trialEndedTimer); trialEndedTimer = null; }
      if (trialPollId) { clearInterval(trialPollId); trialPollId = null; }
    });

    // …and for a trial STARTED mid-session (trial:start IPC). Until this existed
    // the trial state above was read exactly once, on mount, so pressing Start
    // anywhere — the settings card or the promo toaster — left this component
    // believing there was no trial: no countdown banner, and both Pro managers
    // (Modes, Profile Intelligence) still showing their gate, until a relaunch.
    const removeTrialStartedListener = window.electronAPI?.onTrialStarted?.((data) => {
      setActiveTrial({
        expiresAt: data?.expiresAt ?? '',
        usage: data?.usage ?? { ai: 0, ai_tokens: 0, stt_seconds: 0, search: 0 },
        limits: data?.limits as TrialLimits | undefined,
      });
      setShowTrialExpiredModal(false);
      setTrialEndedDue(false);
      // Start the status poll if the mount path did not (it only starts one when
      // a token already existed). Guarded so a re-issue of the same trial — the
      // API is idempotent per hardware id — cannot leak a second interval, which
      // would also be the only thing that ever notices this trial expiring.
      if (ownsTrialClock && !trialPollId) {
        checkTrial();
        trialPollId = setInterval(checkTrial, 30_000);
      }
    });

    // ── Onboarding orchestrator — push user-state patches ─────
    // The orchestrator owns scheduling; we just feed it the latest user state.
    if (isLauncherWindow || isDefault) {
      // Permissions state — first launch, then only when a required permission
      // needs attention (mac: mic/screen; Windows: mic). See permissionAttentionPolicy.mjs.
      const permsShown = localStorage.getItem('natively_perms_shown_v1') === '1';
      const seenModes = localStorage.getItem('natively_seen_modes_onboarding_v5') === 'true';
      const seenProfile = localStorage.getItem('natively_seen_profile_onboarding_v1') === 'true';

      const maybeCheck = window.electronAPI?.checkPermissions;
      if (maybeCheck) {
        maybeCheck()
          .then((p) => {
            setOrchestratorUserState({
              permsShown,
              permissionsNeedAttention: permissionsNeedAttention(p),
              seenModesOnboarding: seenModes,
              seenProfileOnboarding: seenProfile,
              extensionSupported: true, // updated by phoneMirrorGetInfo below
            });
          })
          .catch(() => {
            setOrchestratorUserState({ permsShown, seenModesOnboarding: seenModes, seenProfileOnboarding: seenProfile });
          });
      } else {
        setOrchestratorUserState({ permsShown, seenModesOnboarding: seenModes, seenProfileOnboarding: seenProfile });
      }

      // Donation status (support toaster gate)
      window.electronAPI?.getDonationStatus?.()
        .then(s => setOrchestratorUserState({ donationShouldShow: s?.shouldShow ?? false }))
        .catch(() => {});

      // Extension connection state
      window.electronAPI?.phoneMirrorGetInfo?.()
        .then(info => setOrchestratorUserState({
          extensionConnected: info?.extensionConnected ?? false,
          extensionSupported: true,
          isV2_8_OrNewer: true, // min version handled inside the stage skipWhen
        }))
        .catch(() => {});
    }

    // Listen for open-settings-tab events from other windows (e.g. overlay Modes button)
    const removeOpenSettingsTab = window.electronAPI?.onOpenSettingsTab?.((tab: string) => {
      openSettingsExclusive(tab);
    });

    // Listen for meeting processing completion to trigger post-meeting ads
    const removeMeetingsListener = window.electronAPI?.onMeetingsUpdated?.(() => {
      console.log("[App.tsx] Meetings updated (processing finished), starting ad delay timer");
      setIsProcessingMeeting(false);
      setLastMeetingEndTime(Date.now());
    });

    // Listen for Ollama Auto-Pull Progress
    let removeProgress: (() => void) | undefined;
    let removeComplete: (() => void) | undefined;
    if (window.electronAPI?.onOllamaPullProgress && window.electronAPI?.onOllamaPullComplete) {
      removeProgress = window.electronAPI.onOllamaPullProgress((data) => {
        setOllamaPullStatus('downloading');
        setOllamaPullPercent(data.percent || 0);
        setOllamaPullMessage(data.status || 'Downloading...');
      });

      removeComplete = window.electronAPI.onOllamaPullComplete(() => {
        setOllamaPullStatus('complete');
        setOllamaPullMessage('Local AI memory ready');
        setOllamaPullPercent(100);
        setTimeout(() => setOllamaPullStatus('idle'), 3000);
      });
    }

    // Ollama runtime errors (unreachable / no models installed, after the
    // fallback also failed). Main has always broadcast these on
    // 'ollama-error'; nothing consumed them, so the user saw a silent hang
    // (F-119). Reuses the pull-status banner's 'failed' state — declared in
    // the union since day one but never set.
    // Reset timer for the transient failure notice below. Held in the effect
    // scope so it can be cleared on unmount and re-armed on a second notice,
    // rather than leaking one uncancellable timer per event.
    let bannerResetTimer: ReturnType<typeof setTimeout> | undefined;
    const showTransientBannerFailure = (message: string) => {
      setOllamaPullStatus('failed');
      setOllamaPullMessage(message);
      if (bannerResetTimer) clearTimeout(bannerResetTimer);
      bannerResetTimer = setTimeout(() => {
        // Stand down ONLY if the banner is still showing this failure. A real
        // model pull may have started in the meantime and now owns the banner —
        // forcing 'idle' would wipe its progress while the download continues.
        setOllamaPullStatus(prev => (prev === 'failed' ? 'idle' : prev));
      }, 8000);
    };

    let removeOllamaError: (() => void) | undefined;
    if (window.electronAPI?.onOllamaError) {
      removeOllamaError = window.electronAPI.onOllamaError((data) => {
        showTransientBannerFailure(data.message || 'Local AI (Ollama) is unavailable.');
      });
    }

    let removeWarning: (() => void) | undefined;
    if (window.electronAPI?.onIncompatibleProviderWarning) {
      removeWarning = window.electronAPI.onIncompatibleProviderWarning((data) => {
        setIncompatibleWarning(data);
      });
    }

    // Embedding degradation notices (F-120): a fallback embedding provider or
    // a failed space persist silently degrades semantic search. Surfaced in
    // the corner notice beside the re-index progress, not the launcher's
    // centre pill: that pill never wraps, so this long a line pushed the
    // Start Natively button aside. Fallback fires once per meeting, so a burst
    // re-arms one timer rather than stacking notices.
    let embeddingNoticeTimer: ReturnType<typeof setTimeout> | undefined;
    let removeEmbeddingDegraded: (() => void) | undefined;
    if (window.electronAPI?.onEmbeddingDegraded) {
      removeEmbeddingDegraded = window.electronAPI.onEmbeddingDegraded((data) => {
        setEmbeddingNotice({ kind: data.kind, fallbackProvider: data.fallbackProvider });
        if (embeddingNoticeTimer) clearTimeout(embeddingNoticeTimer);
        embeddingNoticeTimer = setTimeout(() => setEmbeddingNotice(null), 8000);
      });
    }

    let removeReindexProgress: (() => void) | undefined;
    if (window.electronAPI?.onReindexProgress) {
      removeReindexProgress = window.electronAPI.onReindexProgress((phase, data) => {
        if (phase === 'started') {
          setReindexProgress({ done: 0, total: data.count ?? 0 });
        } else if (phase === 'progress') {
          setReindexProgress({ done: data.done ?? 0, total: data.total ?? 0 });
        } else if (phase === 'complete') {
          // On a full completion show 100%; on a partial bail (paused by continuous
          // live meetings — resumes next launch) reflect the actual done count rather
          // than forcing 100%. Either way, briefly show then dismiss.
          const total = data.total ?? 0;
          const done = data.partial ? (data.done ?? 0) : total;
          setReindexProgress({ done, total });
          setTimeout(() => setReindexProgress(null), 4000);
        }
      });
    }

    // Listen for real-time license status changes (activation, revocation, deactivation)
    const removeLicenseListener = window.electronAPI?.onLicenseStatusChanged?.((data) => {
      setIsPremiumActive(data.isPremium);
      setPlanDetails(prev => ({ ...prev, isPremium: data.isPremium, ...(data.plan ? { plan: data.plan } : {}) }));
      setHasLoadedLicense(true);
    });

    return () => {
      if (removeMeetingsListener) removeMeetingsListener();
      if (removeProgress) removeProgress();
      if (removeComplete) removeComplete();
      if (removeOllamaError) removeOllamaError();
      if (removeWarning) removeWarning();
      if (removeEmbeddingDegraded) removeEmbeddingDegraded();
      // Without this the pending reset can fire after unmount/remount and
      // clobber the banner state of the next mount.
      if (bannerResetTimer) clearTimeout(bannerResetTimer);
      if (embeddingNoticeTimer) clearTimeout(embeddingNoticeTimer);
      if (removeReindexProgress) removeReindexProgress();
      if (removeLicenseListener) removeLicenseListener();
      if (trialPollId) clearInterval(trialPollId);
      if (trialEndedTimer) clearTimeout(trialEndedTimer);
      if (removeTrialListener) removeTrialListener();
      if (removeTrialStartedListener) removeTrialStartedListener();
      if (removeOpenSettingsTab) removeOpenSettingsTab();
    }
  }, []);

  // Listen for overlay opacity changes — scoped to overlay window only
  useEffect(() => {
    if (!isOverlayWindow) return;
    const removeOpacityListener = window.electronAPI?.onOverlayOpacityChanged?.((opacity) => {
      setOverlayOpacity(opacity);
    });
    return () => {
      if (removeOpacityListener) removeOpacityListener();
    };
  }, [isOverlayWindow]);

  // When the theme switches and no user preference is stored, reset to theme-aware default
  useEffect(() => {
    if (!isOverlayWindow || !window.electronAPI?.onThemeChanged) return;
    return window.electronAPI.onThemeChanged(() => {
      const stored = localStorage.getItem('natively_overlay_opacity');
      if (!stored) {
        setOverlayOpacity(getDefaultOverlayOpacity());
      }
    });
  }, [isOverlayWindow]);

  useEffect(() => {
    // Two propagation channels:
    //  1. `storage` event — fires within the same window when our own
    //     setMeetingInterfaceTheme() dispatches it (covers settings-pane → App
    //     state in the launcher).
    //  2. IPC `interface-theme:changed` broadcast — main relays the new theme
    //     to EVERY BrowserWindow, including the overlay. Without this the
    //     overlay holds a stale theme value across hide/show cycles, which
    //     yielded the half-painted UI on next meeting start.
    const handleStorage = () => setMeetingInterfaceThemeState(getMeetingInterfaceTheme());
    window.addEventListener('storage', handleStorage);
    const unsubscribeIpc = window.electronAPI?.onMeetingInterfaceThemeChanged?.((theme) => {
      const valid: MeetingInterfaceTheme[] = ['default', 'liquid-glass', 'modern'];
      if (valid.includes(theme as MeetingInterfaceTheme)) {
        setMeetingInterfaceThemeState(theme as MeetingInterfaceTheme);
      }
    });
    return () => {
      window.removeEventListener('storage', handleStorage);
      unsubscribeIpc?.();
    };
  }, []);


  // Handlers
  const handleReindex = async () => {
    if (window.electronAPI?.reindexIncompatibleMeetings) {
      setReindexPending(incompatibleWarning?.count ?? 0);
      setIncompatibleWarning(null);
      try {
        await window.electronAPI.reindexIncompatibleMeetings();
      } finally {
        // Resolves once the re-index is over (or failed to start): from here
        // the progress events alone keep the card open.
        setReindexPending(null);
      }
    }
  };

  // `calendar`: a start asked for from a calendar event (Settings › Calendar's
  // Start Natively), so the session is linked to that event from the first
  // second rather than matched by time. Guarded because a click handler could
  // hand this an event object.
  const handleStartMeeting = async (calendar?: { title: string; calendarEventId: string }) => {
    const linked = calendar && typeof calendar === 'object' && typeof calendar.calendarEventId === 'string' ? calendar : undefined;
    try {
      // Self-heal a poisoned preference. Until the picker started filtering
      // them, Natively's own system-audio tap aggregate could be enumerated as
      // an input device (private CoreAudio aggregates are hidden from other
      // processes, not from ours) and saved here. It is not a microphone and
      // never exists at mic-start time, so every meeting failed with
      // "Input device 'NativelySystemAudioTap' not found". Main falls back to
      // the default either way; dropping the key stops the stale value from
      // being shown as the user's choice in Settings forever.
      let inputDeviceId = localStorage.getItem('preferredInputDeviceId');
      if (isInternalCaptureDevice(inputDeviceId)) {
        console.warn(`[App] Discarding saved input device "${inputDeviceId}" — it is one of Natively's own capture devices, not a microphone.`);
        localStorage.removeItem('preferredInputDeviceId');
        inputDeviceId = null;
      }
      let outputDeviceId = localStorage.getItem('preferredOutputDeviceId');
      // SCK is a macOS-only backend (ScreenCaptureKit + CoreAudio Process Tap
      // live in the Rust speaker module under #[cfg(target_os = "macos")]).
      // F-003 hid the toggle UI on Windows, but the localStorage key can be
      // present on a Windows machine via cross-OS sync or restored backup —
      // routing "sck" as an outputDeviceId then hands the Windows speaker
      // module an unknown WASAPI device id and silently breaks system audio.
      // Defense-in-depth: also require isMac at the consumer.
      const useExperimentalSck = isMac && localStorage.getItem('useExperimentalSckBackend') === 'true';

      // Override output device ID to force SCK if experimental mode is enabled
      // Default to CoreAudio unless experimental is enabled
      if (useExperimentalSck) {
        console.log("[App] Using ScreenCaptureKit backend (Experimental).");
        outputDeviceId = "sck";
      } else if (isMac) {
        console.log("[App] Using CoreAudio backend (Default).");
      }

      const meetingRetention = await window.electronAPI.getMeetingRetention?.().catch(() => 'forever');
      const result = await window.electronAPI.startMeeting({
        audio: { inputDeviceId, outputDeviceId },
        doNotPersist: meetingRetention === 'never',
        ...(linked ? { title: linked.title, calendarEventId: linked.calendarEventId, source: 'calendar' } : {}),
      });
      if (result.success) {
        analytics.trackMeetingStarted();
        // Window swap happens inside main's startMeeting() now (before the
        // meeting-state broadcast) to avoid a blue→green CTA flash on the
        // launcher. No follow-up setWindowMode IPC needed here.
      } else {
        console.error("Failed to start meeting:", result.error);
        // A mic-permission denial aborts the meeting before the overlay (which
        // hosts the in-meeting audio banner) is ever shown — so the user is
        // left on the launcher with nothing actionable. Re-open the permissions
        // card, which checks live mic/screen status, re-requests the mic, and
        // deep-links to System Settings. This is the recoverable surface for
        // the "I press Start Natively and nothing happens" report.
        if (result.code === 'mic-permission-denied') {
          // Route through the orchestrator: mark permissions as needing
          // attention so the permissions stage becomes re-eligible.
          setOrchestratorUserState({ permissionsNeedAttention: true });
        }
      }
    } catch (err) {
      console.error("Failed to start meeting:", err);
      // Defense-in-depth: today the start-meeting IPC handler catches and
      // resolves {success:false, code}, so a mic denial lands in the else
      // branch above. If the call ever rejects instead, Electron preserves the
      // serialized error .code across ipcRenderer.invoke — keep the recovery
      // working so the denial never regresses to a silent failure.
      if ((err as { code?: string })?.code === 'mic-permission-denied') {
        setOrchestratorUserState({ permissionsNeedAttention: true });
      }
    }
  };

  // Settings › Calendar's "Start Natively" on a meeting: close Settings and
  // start through the same path as the Launcher's button (saved devices,
  // retention, the mic-permission recovery), linked to that event. Settings
  // lives in this renderer, so a DOM event carries it; a running meeting is
  // left alone, as the Launcher's button does.
  const startMeetingRef = useRef(handleStartMeeting);
  startMeetingRef.current = handleStartMeeting;
  // A notification's Start (a detected call, the calendar reminder) arrives from
  // main the same way and takes the same path; it may name no event.
  useEffect(() => {
    const start = async (req: { title?: string; calendarEventId?: string }, from: string) => {
      if (await window.electronAPI?.getMeetingActive?.().catch(() => false)) return;
      setIsSettingsOpen(false);
      // What the Launcher's button does before it starts one (Launcher.tsx CTA).
      emitOrchestratorEvent({ type: 'turn:done', surface: 'meeting' });
      void startMeetingRef.current(typeof req.calendarEventId === 'string' ? { title: String(req.title || ''), calendarEventId: req.calendarEventId } : undefined);
      analytics.trackCommandExecuted(from);
    };
    const onStartForEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ title?: string; calendarEventId?: string }>).detail;
      if (!detail || typeof detail.calendarEventId !== 'string') return;
      void start(detail, 'start_natively_from_calendar');
    };
    window.addEventListener('natively:start-meeting-for-event', onStartForEvent);
    const offRequest = window.electronAPI?.onMeetingStartRequest?.((req) => {
      void start(req, req.via === 'reminder' ? 'start_natively_from_reminder' : 'start_natively_from_detection');
    });
    return () => {
      window.removeEventListener('natively:start-meeting-for-event', onStartForEvent);
      offRequest?.();
    };
  }, []);

  // The pill's Stop is ended in main (it used to round-trip through this
  // renderer, so a busy or reloading overlay delayed or dropped it); main then
  // tells this window the meeting ended. Only the local bookkeeping runs here.
  const handleMeetingEnded = () => {
    console.log("[App.tsx] meeting ended from the pill");
    analytics.trackMeetingEnded();
    setIsProcessingMeeting(true);
  };

  const interfaceThemeAttribute = meetingInterfaceTheme === 'default' ? undefined : meetingInterfaceTheme;

  // Render Logic
  if (isCropperWindow) {
    return (
      <React.Suspense fallback={<div className="w-screen h-screen bg-transparent" />}>
        <CropperWindow />
      </React.Suspense>
    );
  }

  if (isSettingsWindow) {
    return (
      <ErrorBoundary context="SettingsPopup">
        <div className="h-full min-h-0 w-full" data-interface-theme={interfaceThemeAttribute}>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <SettingsPopup />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- OVERLAY AUX WINDOWS (pill / resize toggle) ---
  // Deliberately minimal: no providers, no banners — just the floating chrome.
  // State arrives over the 'overlay-ui-state' broadcast; geometry/visibility
  // are owned by WindowHelper.
  if (isOverlayPillWindow) {
    return (
      <ErrorBoundary context="OverlayPill">
        <OverlayPillWindow />
      </ErrorBoundary>
    );
  }
  if (isOverlayToggleWindow) {
    return (
      <ErrorBoundary context="OverlayToggle">
        <OverlayToggleWindow />
      </ErrorBoundary>
    );
  }

  if (isModelSelectorWindow) {
    return (
      <ErrorBoundary context="ModelSelector">
        <div
          className="h-full min-h-0 w-full overflow-hidden"
          data-interface-theme={interfaceThemeAttribute}
        >
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <ModelSelectorWindow />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- OVERLAY WINDOW (Meeting Interface) ---
  if (isOverlayWindow) {
    return (
      <ErrorBoundary context="Overlay">
        <div className="w-full h-full relative overflow-hidden bg-transparent">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <div
                style={{
                  ['--overlay-opacity' as '--overlay-opacity']: String(overlayOpacity),
                  transition: 'background-color 75ms ease, border-color 75ms ease, box-shadow 75ms ease'
                } as React.CSSProperties}
              >
                <HindsightStatusBanner />
                <NativelyInterface
                  onMeetingEnded={handleMeetingEnded}
                  overlayOpacity={overlayOpacity}
                  interfaceTheme={meetingInterfaceTheme}
                />
              </div>
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- LAUNCHER WINDOW (Default) ---
  // Renders if window=launcher OR no param
  return (
    <ErrorBoundary context="Launcher">
    <div className="h-full min-h-0 w-full relative bg-transparent">
      {/* data-opacity-preview-surface: queried (via querySelectorAll, not by
          id — there are two separate blocks below) by SettingsOverlay's
          startPreviewingOpacity/stopPreviewingOpacity so the Interface
          Opacity live-preview hides every global banner/toast/modal along
          with #launcher-container, instead of leaving whichever one happens
          to be visible (update/quota/trial banners, onboarding toasts, ad
          promos) painted opaque on top of the "transparent" preview. */}
      {!isolateGlobalSurfaces && showHindsightBanner && (
        <div data-opacity-preview-surface="">
          <HindsightStatusBanner variant="floating-card" />
        </div>
      )}
      <AnimatePresence>
        {showStartup || showWelcome === null ? (
          <motion.div
            key="startup"
            className="h-full w-full"
            initial={{ opacity: 0, scale: 1.01 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] } }}
            exit={{ opacity: 0, scale: 1.04, pointerEvents: "none", transition: { duration: 0.55, ease: [0.4, 0, 0.2, 1] } }}
          >
            <StartupSequence onComplete={dismissStartup} />
          </motion.div>
        ) : showWelcome ? (
          <motion.div
            key="welcome"
            className="h-full w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, scale: 0.99, pointerEvents: "none", transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
          >
            <WelcomeFlow onDone={finishWelcome} />
          </motion.div>
        ) : (
          <motion.div
            key="main"
            className="h-full w-full"
            initial={{ opacity: 0, scale: 0.99, y: 8 }} // "Linear" style entry: slightly down and scaled down
            animate={{ opacity: 1, scale: 1, y: 0 }}    // Slide up and snap to place
            transition={{
              duration: 0.6,
              ease: [0.19, 1, 0.22, 1], // Expo-out: snappy start, smooth landing
            }}
            onAnimationComplete={reportRevealComplete}
          >
            <QueryClientProvider client={queryClient}>
              <ToastProvider>
                <div id="launcher-container" className="h-full w-full relative">
                  <Launcher
                    onStartMeeting={handleStartMeeting}
                    onOpenSettings={(tab = 'general') => openSettingsExclusive(tab)}
                    onOpenProfile={() => openProfileExclusive()}
                    onOpenModes={() => openModesExclusive()}
                    onPageChange={setIsLauncherMainView}
                    ollamaPullStatus={ollamaPullStatus}
                    ollamaPullPercent={ollamaPullPercent}
                    ollamaPullMessage={ollamaPullMessage}
                  />
                </div>
                <SettingsOverlay
                  isOpen={isSettingsOpen}
                  onClose={() => {
                    setIsSettingsOpen(false);
                  }}
                  initialTab={settingsNav.tab}
                  initialTabSeq={settingsNav.seq}
                  initialIsPremium={hasLoadedLicense ? isPremiumActive : null}
                  initialHasNativelyKey={hasNativelyApi}
                  closeInstantly={isManagerOpen}
                  onOpenModes={openModesExclusive}
                  onOpenProfile={openProfileExclusive}
                />
                {/* Modes and Profile Intelligence share one card, which pours out
                    of and back into the bottom of the window like every other
                    popup (GenieModal). The genie is keyed on the manager being
                    open, not on which panel it shows, so switching panels keeps
                    its crossfade. Handing over to Settings skips the close: only
                    the incoming card pours. */}
                <GenieModal
                  open={activeManagerPanel !== null}
                  label="ManagerPanel"
                  // One picture set per panel. On close the panel is already
                  // null, so the last one shown names it.
                  snapshotKey={`manager:${activeManagerPanel ?? lastManagerPanelRef.current}`}
                  // Profile Intelligence always opens on Identity; Modes opens
                  // on whichever mode it restores, which the genie remembers.
                  openingView={(activeManagerPanel ?? lastManagerPanelRef.current) === 'profile' ? 'identity' : undefined}
                  closeInstantly={isSettingsOpen}
                  onBackdropClick={closeManagerPanel}
                  onOpened={() => managerDialogRef.current?.focus()}
                  backdropClassName={isLight ? 'bg-black/[0.06]' : 'bg-black/60'}
                  wrapClassName="w-[820px] h-[600px] max-w-[95vw] max-h-[90vh]"
                  cardRef={managerDialogRef}
                  cardClassName={`manager-panel-shell rounded-2xl border border-border-muted bg-bg-elevated ${isLight ? 'shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_24px_48px_-12px_rgba(0,0,0,0.16),0_8px_16px_-6px_rgba(0,0,0,0.06)]' : 'shadow-2xl'}`}
                  cardProps={{
                    'data-testid': 'manager-panel-host',
                    role: 'dialog',
                    'aria-modal': true,
                    'aria-label': activeManagerPanel === 'modes' ? 'Modes Manager' : 'Profile Intelligence',
                    tabIndex: -1,
                    onKeyDown: handleManagerKeyDown,
                  }}
                  shadow={isLight ? MANAGER_SHADOW_LIGHT : MANAGER_SHADOW_DARK}
                  radius={16}
                >
                  {activeManagerPanel && (
                    <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={activeManagerPanel}
                      data-testid={`manager-panel-${activeManagerPanel}`}
                      variants={managerContentVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="h-full w-full"
                    >
                      {activeManagerPanel === 'modes' ? (
                        <ModesSettings
                          onClose={closeManagerPanel}
                          isPremium={isPremiumActive}
                          isLoaded={hasLoadedLicense}
                          isTrialActive={!!activeTrial}
                          onOpenNativelyAPI={() => openSettingsExclusive('plans')}
                        />
                      ) : (
                        <ProfileIntelligenceSettings
                          onClose={closeManagerPanel}
                          isTrialActive={!!activeTrial}
                          onOpenNativelyAPI={() => openSettingsExclusive('plans')}
                        />
                      )}
                    </motion.div>
                    </AnimatePresence>
                  )}
                </GenieModal>
                <ToastViewport />
              </ToastProvider>
            </QueryClientProvider>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Provider change, re-index and degraded search: one notice in the bottom-right corner. */}
      <ProviderChangeNotice
        open={isDefault && (!!incompatibleWarning || !!reindexShown || !!embeddingNotice)}
        warning={incompatibleWarning}
        progress={reindexShown}
        degraded={embeddingNotice}
        onDismiss={() => setIncompatibleWarning(null)}
        onReindex={handleReindex}
      />

      <div data-opacity-preview-surface="">
        {!isolateGlobalSurfaces && <UpdateBanner />}
        {!isolateGlobalSurfaces && <NativelyQuotaBanner />}

        {/* Orchestrated onboarding toasters (single-slot, controlled by OnboardingOrchestrator) */}
        {/* Not under the first-launch welcome: its cards follow Get started. */}
        {!isolateOnboarding && showWelcome === false && (
          <OrchestratorProvider>
            <OrchestratedToasterHost onOpenSettings={openSettingsExclusive} onOpenProfile={openProfileExclusive} />
          </OrchestratorProvider>
        )}


        {/* Free trial countdown banner — only in launcher window while trial is active */}
        {!isolateGlobalSurfaces && (isLauncherWindow || isDefault) && activeTrial && (
          <FreeTrialBanner
            expiresAt={activeTrial.expiresAt}
            usage={activeTrial.usage}
            limits={activeTrial.limits}
            onUpgrade={() => openSettingsExclusive('plans')}
            onExpired={handleTrialClockExpired}
          />
        )}

        {/* Post-trial upgrade modal — shown when trial expires */}
        {!isolateModals && (isLauncherWindow || isDefault) && showTrialExpiredModal && (
          <FreeTrialModal
            usage={activeTrial?.usage ?? { ai: 0, ai_tokens: 0, stt_seconds: 0, search: 0 }}
            onByok={async (opts) => {
              // A wipe that did not finish must not read as "All set": the card
              // shows the error with Try again (toaster policy §5 row 5). After
              // repeated failures it may end the trial anyway (opts.force).
              const res = await window.electronAPI?.endTrialByok?.(opts);
              if (!res?.success) throw new Error('wipe_failed');
              return { wipeIncomplete: !!res.wipeIncomplete };
            }}
            onStandard={async () => {
              // The profile wipe already ran once, at expiry (main,
              // settleExpiredTrial). Standard has no modes access.
              await window.electronAPI?.modesSetActive?.(null).catch(() => {});
            }}
            onDone={(reason) => {
              setShowTrialExpiredModal(false);
              setTrialEndedDue(false);
              setActiveTrial(null);
              // "Add my keys" after a finished BYOK exit.
              if (reason === 'byok') openSettingsExclusive('ai-providers');
            }}
          />
        )}

      </div>
    </div>
    </ErrorBoundary>
  )
}

export default App
