import React, { useState, useEffect, useCallback, useSyncExternalStore } from "react" // forcing refresh
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ToastProvider, ToastViewport } from "./components/ui/toast"
import NativelyInterface from "./components/NativelyInterface"
import HindsightStatusBanner from "./components/HindsightStatusBanner"
import SettingsPopup from "./components/SettingsPopup" // Keeping for legacy/specific window support if needed
import Launcher from "./components/Launcher"
import ModelSelectorWindow from "./components/ModelSelectorWindow"
import SettingsOverlay from "./components/SettingsOverlay"
import StartupSequence from "./components/StartupSequence"
import { AnimatePresence, motion } from "framer-motion"
import UpdateBanner from "./components/UpdateBanner"
import { NativelyQuotaBanner } from "./components/NativelyQuotaBanner"
import { FreeTrialBanner }      from "./components/trial/FreeTrialBanner"
import { FreeTrialModal }       from "./components/trial/FreeTrialModal"
import { OrchestratorProvider, OrchestratedToasterHost, setUserState as setOrchestratorUserState, emitOrchestratorEvent } from "./components/onboarding/OrchestratedToasterHost"
import { getOrchestrator } from "./lib/onboarding/orchestrator"
import { AlertCircle, RefreshCw } from "lucide-react"
import { clampOverlayOpacity, OVERLAY_OPACITY_DEFAULT, getDefaultOverlayOpacity } from "./lib/overlayAppearance"
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from './lib/meetingInterfaceTheme'
import { isMac } from "./utils/platformUtils"
import { trackAppOpen } from "./lib/toasterGating"
import {
  JDAwarenessToaster,
  ProfileFeatureToaster,
  PremiumPromoToaster,
  RemoteCampaignToaster,
  PremiumUpgradeModal,
  NativelyApiPromoToaster,
  MaxUltraUpgradeToaster,
  useAdCampaigns
} from './premium'
import { analytics } from "./lib/analytics/analytics.service"
import { ErrorBoundary } from "./components/ErrorBoundary"
import ModesSettings from "./components/settings/ModesSettings"
import { ProfileIntelligenceSettings } from "./components/ProfileIntelligenceSettings"

const queryClient = new QueryClient()
const CropperWindow = React.lazy(() => import('./components/Cropper'))

const App: React.FC = () => {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isLauncherWindow = new URLSearchParams(window.location.search).get('window') === 'launcher';
  const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';
  const isModelSelectorWindow = new URLSearchParams(window.location.search).get('window') === 'model-selector';
  const isCropperWindow = new URLSearchParams(window.location.search).get('window') === 'cropper';

  // Default to launcher if not specified (dev mode safety)
  const isDefault = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !isCropperWindow;

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string>('general');
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const openSettingsExclusive = useCallback((tab: string = 'general') => {
    setIsModesOpen(false);
    setIsProfileOpen(false);
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  }, []);
  const openProfileExclusive = useCallback(() => {
    setIsModesOpen(false);
    setIsSettingsOpen(false);
    setIsProfileOpen(true);
  }, []);
  const openModesExclusive = useCallback(() => {
    setIsProfileOpen(false);
    setIsSettingsOpen(false);
    setIsModesOpen(true);
  }, []);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
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
  
  // API check
  const [hasNativelyApi, setHasNativelyApi] = useState<boolean>(false);

  // ── Onboarding toasters now handled by OnboardingOrchestrator ──
  // (No local state for permissions / trial promo toasters.)

  // ── Free Trial global state ────────────────────────────────
  const [activeTrial, setActiveTrial] = useState<{
    expiresAt: string;
    usage: { ai: number; stt_seconds: number; search: number };
  } | null>(null);
  const [showTrialExpiredModal, setShowTrialExpiredModal] = useState(false);

  const isAppReady = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !showStartup && !isSettingsOpen && isLauncherMainView && !isProfileOpen;

  // Gate useAdCampaigns behind orchestrator eligibility. Ads only self-schedule
  // when (a) the orchestrator is ready (no other toaster active) and (b) the
  // `ads` stage's prerequisites have been met. We approximate (b) with the
  // simple "no orchestrated toaster is active" gate — useAdCampaigns has its
  // own eligibility logic for which ad to show.
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
  const orchestratorAllowsAds = orchState
    ? orchState.activeToasterId === null
    : false;

  const { activeAd, dismissAd } = useAdCampaigns(
    planDetails,
    hasProfile,
    isAppReady,
    appStartTime,
    lastMeetingEndTime,
    isProcessingMeeting,
    hasNativelyApi,
    orchestratorAllowsAds
  );

  // Start the onboarding orchestrator (launcher window only). Stages are
  // registered lazily; the drain loop only runs while foreground + homepage
  // mounted.
  useEffect(() => {
    if (!isLauncherWindow && !isDefault) return;
    let cancelled = false;
    let stopFn: (() => void) | null = null;
    import('./lib/onboarding/orchestrator').then(({ getOrchestrator }) => {
      if (cancelled) return;
      import('./lib/onboarding/stageCatalog').then(({ STAGES, QUIET_WINDOW_STAGE }) => {
        if (cancelled) return;
        const orch = getOrchestrator();
        orch.start([...STAGES, QUIET_WINDOW_STAGE]);
        stopFn = () => orch.stop();
      });
    });
    return () => {
      cancelled = true;
      stopFn?.();
    };
  }, [isLauncherWindow, isDefault]);

  // Push user-state patches to the orchestrator as plan/profile state evolves.
  useEffect(() => {
    setOrchestratorUserState({
      isPremium: isPremiumActive,
      hasProfile,
      hasNativelyKey: hasNativelyApi,
      hasTrialToken: !!activeTrial,
    });
  }, [isPremiumActive, hasProfile, hasNativelyApi, activeTrial]);

  // Pause the orchestrator while Settings/Modes/Profile panels are open so
  // toasters don't fire over the user's settings interaction.
  useEffect(() => {
    if (!isLauncherWindow && !isDefault) return;
    const anyPanelOpen = isSettingsOpen || isModesOpen || isProfileOpen;
    if (anyPanelOpen) {
      emitOrchestratorEvent({ type: 'launcher:unmounted' });
    } else {
      emitOrchestratorEvent({ type: 'launcher:mounted' });
    }
  }, [isSettingsOpen, isModesOpen, isProfileOpen, isLauncherWindow, isDefault]);



  useEffect(() => {
    // Track app opens for global gating
    trackAppOpen();

    // Clean up old local storage
    localStorage.removeItem('useLegacyAudioBackend');

    const fallbackLocal = () => {
      // The classic launch animation is intentionally shown on every launcher
      // startup, matching the older app behavior from 93ee4a21.
    };

    if (window.electronAPI?.onboardingGetFlags) {
      window.electronAPI.onboardingGetFlags()
        .then((flags) => {
          if (flags) {
            // 1. seenStartup intentionally no longer suppresses the classic
            // black-logo launch animation; the old app played it every launch.

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
    let trialPollId: ReturnType<typeof setInterval> | null = null;
    let profileWiped = false; // guard: only wipe once per session
    const checkTrial = async () => {
      try {
        const res = await window.electronAPI?.getTrialStatus?.();
        if (!res?.ok) return;
        if (res.expired) {
          setActiveTrial(null);
          // Auto-wipe profile data the first time expiry is detected so that
          // resume/JD data doesn't linger in SQLite beyond the trial window.
          if (!profileWiped) {
            profileWiped = true;
            window.electronAPI?.wipeTrialProfileData?.().catch(() => {});
          }
          setShowTrialExpiredModal(true);
          if (trialPollId) { clearInterval(trialPollId); trialPollId = null; }
        } else {
          setActiveTrial({
            expiresAt: res.expires_at ?? '',
            usage:     res.usage     ?? { ai: 0, stt_seconds: 0, search: 0 },
          });
        }
      } catch { /* ignore — non-critical */ }
    };
    window.electronAPI?.getLocalTrial?.().then((local: any) => {
      if (!local?.hasToken) return;
      if (local.expired) {
        // Already expired at launch — wipe immediately then show modal after a brief delay
        if (!profileWiped) {
          profileWiped = true;
          window.electronAPI?.wipeTrialProfileData?.().catch(() => {});
        }
        setTimeout(() => setShowTrialExpiredModal(true), 10_000);
        return;
      }
      checkTrial();
      trialPollId = setInterval(checkTrial, 30_000);
    }).catch(() => {});

    // Listen for trial-ended event (emitted by trial:end-byok IPC)
    const removeTrialListener = window.electronAPI?.onTrialEnded?.(() => {
      setActiveTrial(null);
      setShowTrialExpiredModal(false);
    });

    // ── Onboarding orchestrator — push user-state patches ─────
    // The orchestrator owns scheduling; we just feed it the latest user state.
    if (isLauncherWindow || isDefault) {
      // Permissions state — first launch vs returning mac with revoked TCC.
      const permsShown = localStorage.getItem('natively_perms_shown_v1') === '1';
      const seenModes = localStorage.getItem('natively_seen_modes_onboarding_v5') === 'true';
      const seenProfile = localStorage.getItem('natively_seen_profile_onboarding_v1') === 'true';

      const maybeCheck = window.electronAPI?.checkPermissions;
      if (maybeCheck) {
        maybeCheck()
          .then((p) => {
            const blocked = (s?: string) => s === 'denied' || s === 'restricted';
            const macTCCBlocked = p?.platform === 'darwin' && (blocked(p.microphone) || blocked(p.screen));
            setOrchestratorUserState({
              permsShown,
              macTCCBlocked,
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

    let removeWarning: (() => void) | undefined;
    if (window.electronAPI?.onIncompatibleProviderWarning) {
      removeWarning = window.electronAPI.onIncompatibleProviderWarning((data) => {
        setIncompatibleWarning(data);
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
      if (removeWarning) removeWarning();
      if (removeReindexProgress) removeReindexProgress();
      if (removeLicenseListener) removeLicenseListener();
      if (trialPollId) clearInterval(trialPollId);
      if (removeTrialListener) removeTrialListener();
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
      setIncompatibleWarning(null);
      await window.electronAPI.reindexIncompatibleMeetings();
    }
  };

  const handleStartMeeting = async () => {
    try {
      localStorage.setItem('natively_last_meeting_start', Date.now().toString());
      const inputDeviceId = localStorage.getItem('preferredInputDeviceId');
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
        doNotPersist: meetingRetention === 'never'
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
          // Route through the orchestrator: mark mac TCC as blocked so the
          // permissions stage becomes re-eligible.
          setOrchestratorUserState({ macTCCBlocked: true });
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
        setOrchestratorUserState({ macTCCBlocked: true });
      }
    }
  };

  const handleEndMeeting = () => {
    console.log("[App.tsx] handleEndMeeting triggered");
    analytics.trackMeetingEnded();
    setIsProcessingMeeting(true);

    // Local bookkeeping that does not depend on the main process.
    const startStr = localStorage.getItem('natively_last_meeting_start');
    if (startStr) {
      const duration = Date.now() - parseInt(startStr, 10);
      const threshold = import.meta.env.DEV ? 10000 : 180000;
      if (duration >= threshold) {
        localStorage.setItem('natively_show_profile_toaster', 'true');
      }
      localStorage.removeItem('natively_last_meeting_start');
    }

    // Fire-and-forget: main's endMeeting() handler now performs the
    // launcher swap synchronously at the top, BEFORE any blocking audio
    // teardown. Awaiting here would stall the overlay's React render
    // loop for the IPC round-trip while libuv-blocking setImmediate
    // native stops fire on the main process — which is the lag the user
    // was seeing. The launcher window receives a 'meetings-updated'
    // event after the BG teardown so its list refreshes on its own.
    window.electronAPI.endMeeting().catch(err => {
      console.error("Failed to end meeting:", err);
      // Belt-and-suspenders: if the IPC itself rejected, the swap may
      // not have happened — request it manually so the user isn't
      // stranded on a dead overlay.
      window.electronAPI.setWindowMode('launcher');
    });
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
                  onEndMeeting={handleEndMeeting}
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
      <HindsightStatusBanner />
      <AnimatePresence>
        {showStartup ? (
          <motion.div
            key="startup"
            className="h-full w-full"
            initial={{ opacity: 0, scale: 1.01 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] } }}
            exit={{ opacity: 0, scale: 1.04, pointerEvents: "none", transition: { duration: 0.55, ease: [0.4, 0, 0.2, 1] } }}
          >
            <StartupSequence onComplete={() => setShowStartup(false)} />
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
                  initialTab={settingsInitialTab}
                  initialIsPremium={hasLoadedLicense ? isPremiumActive : null}
                  initialHasNativelyKey={hasNativelyApi}
                />
                <AnimatePresence>
                  {isModesOpen && (
                    <motion.div
                      key="modes-panel"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                      onClick={(e) => { if (e.target === e.currentTarget) setIsModesOpen(false); }}
                    >
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 18, filter: 'blur(12px)' }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(8px)' }}
                        transition={{
                          opacity: { duration: 0.32, ease: [0.23, 1, 0.32, 1] },
                          filter: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
                          scale: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                          y: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                        }}
                        style={{
                          willChange: 'transform, opacity, filter',
                          transformOrigin: 'center',
                          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.65), 0 16px 40px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
                        }}
                        className="w-[820px] h-[600px] max-w-[95vw] max-h-[90vh] rounded-2xl overflow-hidden border border-white/10 bg-[#141414]"
                      >
                        <ModesSettings onClose={() => setIsModesOpen(false)} isPremium={isPremiumActive} isLoaded={hasLoadedLicense} isTrialActive={!!activeTrial} onOpenNativelyAPI={() => openSettingsExclusive('natively-api')} />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {isProfileOpen && (
                    <motion.div
                      key="profile-panel"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                      onClick={(e) => { if (e.target === e.currentTarget) setIsProfileOpen(false); }}
                    >
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 18, filter: 'blur(12px)' }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(8px)' }}
                        transition={{
                          opacity: { duration: 0.32, ease: [0.23, 1, 0.32, 1] },
                          filter: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
                          scale: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                          y: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                        }}
                        style={{
                          willChange: 'transform, opacity, filter',
                          transformOrigin: 'center',
                          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.65), 0 16px 40px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
                        }}
                        className="w-[820px] h-[600px] max-w-[95vw] max-h-[90vh] rounded-2xl overflow-hidden border border-white/10 bg-[#141414]"
                      >
                        <ProfileIntelligenceSettings
                          onClose={() => setIsProfileOpen(false)}
                        />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <ToastViewport />
              </ToastProvider>
            </QueryClientProvider>
          </motion.div>
        )}
      </AnimatePresence>


      <AnimatePresence>
        {incompatibleWarning && isDefault && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed bottom-6 right-6 z-50 pointer-events-auto"
          >
            <div className="bg-[#1A1A1A] border border-[#ff3333]/30 shadow-2xl rounded-2xl p-5 max-w-[340px] flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#ff3333] shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-[#E0E0E0] font-medium text-sm">Provider Changed</h3>
                  <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                    ⚠ {incompatibleWarning.count} meetings used your previous AI provider ({incompatibleWarning.oldProvider}) and won't appear in search results under {incompatibleWarning.newProvider}.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-1 justify-end">
                <button 
                  onClick={() => setIncompatibleWarning(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#A0A0A0] hover:text-white hover:bg-white/5 transition-colors"
                >
                  Dismiss
                </button>
                <button 
                  onClick={handleReindex}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ff3333]/10 text-[#ff3333] hover:bg-[#ff3333]/20 transition-colors"
                >
                  Re-index automatically
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reindexProgress && isDefault && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed bottom-6 right-6 z-50 pointer-events-auto"
          >
            <div className="bg-[#1A1A1A] border border-white/10 shadow-2xl rounded-2xl p-5 max-w-[340px] flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <RefreshCw className={`w-5 h-5 text-[#A0A0A0] shrink-0 mt-0.5 ${reindexProgress.done < reindexProgress.total ? 'animate-spin' : ''}`} />
                <div className="flex-1">
                  <h3 className="text-[#E0E0E0] font-medium text-sm">
                    {reindexProgress.done >= reindexProgress.total && reindexProgress.total > 0
                      ? 'Search index updated'
                      : 'Updating search index'}
                  </h3>
                  <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                    {reindexProgress.done >= reindexProgress.total && reindexProgress.total > 0
                      ? 'Your past conversations are searchable again.'
                      : `Re-indexing your past conversations for the upgraded AI model… ${reindexProgress.done}/${reindexProgress.total}`}
                  </p>
                  {reindexProgress.total > 0 && (
                    <div className="mt-2 h-1 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-[#E0E0E0] transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.round((reindexProgress.done / reindexProgress.total) * 100))}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UpdateBanner />
      <NativelyQuotaBanner />

      {/* Orchestrated onboarding toasters (single-slot, controlled by OnboardingOrchestrator) */}
      <OrchestratorProvider>
        <OrchestratedToasterHost />
      </OrchestratorProvider>

      {/* Free trial countdown banner — only in launcher window while trial is active */}
      {(isLauncherWindow || isDefault) && activeTrial && (
        <FreeTrialBanner
          expiresAt={activeTrial.expiresAt}
          usage={activeTrial.usage}
          onUpgrade={() => openSettingsExclusive('api')}
        />
      )}

      {/* Post-trial upgrade modal — shown when trial expires */}
      {(isLauncherWindow || isDefault) && showTrialExpiredModal && (
        <FreeTrialModal
          usage={activeTrial?.usage ?? { ai: 0, stt_seconds: 0, search: 0 }}
          onByok={async () => {
            await window.electronAPI?.endTrialByok?.();
          }}
          onStandard={async () => {
            // Wipe resume + JD (orchestrator caches + SQLite) before checkout opens
            await window.electronAPI?.wipeTrialProfileData?.().catch(() => {});
            // Revert active mode to none — Standard plan has no modes access
            await window.electronAPI?.modesSetActive?.(null).catch(() => {});
          }}
          onDone={() => {
            setShowTrialExpiredModal(false);
            setActiveTrial(null);
          }}
        />
      )}

      {/* Ad toasters */}
      {isLauncherMainView && !isSettingsOpen && (
        <NativelyApiPromoToaster
          isOpen={activeAd === 'natively_api'}
          onDismiss={() => dismissAd('natively_api')}
          onOpenSettings={(tab: string) => openSettingsExclusive(tab)}
        />
      )}
      {isLauncherMainView && (
        <>
          <ProfileFeatureToaster
            isOpen={activeAd === 'profile'}
            onDismiss={dismissAd}
            onSetupProfile={() => openProfileExclusive()}
          />
          <JDAwarenessToaster
            isOpen={activeAd === 'jd'}
            onDismiss={dismissAd}
            onSetupJD={() => openProfileExclusive()}
          />
          <PremiumPromoToaster
            isOpen={activeAd === 'promo'}
            onDismiss={dismissAd}
            onUpgrade={() => {
              setShowPremiumModal(true);
            }}
          />
          <MaxUltraUpgradeToaster
            isOpen={activeAd === 'max_ultra_upgrade'}
            onDismiss={dismissAd}
            onUpgrade={() => {
              setShowPremiumModal(true);
            }}
          />

          {/* Remote Campaigns Render Logic (Commented out)
          <RemoteCampaignToaster
            isOpen={typeof activeAd === 'object' && activeAd !== null}
            campaign={typeof activeAd === 'object' && activeAd !== null ? activeAd : undefined as any}
            onDismiss={dismissAd}
          />
          */}
        </>
      )}

      <PremiumUpgradeModal
        isOpen={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
        isPremium={isPremiumActive}
        onActivated={() => {
          setIsPremiumActive(true);
          // Refresh full plan details after activation so ad targeting reflects the new plan
          window.electronAPI?.licenseGetDetails?.()
            .then(d => setPlanDetails(d ?? { isPremium: true }))
            .catch(() => setPlanDetails({ isPremium: true }));
          setShowPremiumModal(false);
          // If user activated during post-trial modal, close it — they have a plan now
          setShowTrialExpiredModal(false);
          setActiveTrial(null);
          // After activation, open settings to Profile Intelligence
          setTimeout(() => {
            openProfileExclusive();
          }, 300);
        }}
        onDeactivated={() => { setIsPremiumActive(false); setPlanDetails({ isPremium: false }); }}
      />
    </div>
    </ErrorBoundary>
  )
}

export default App
