import React, { useState, useEffect, useCallback } from "react" // forcing refresh
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ToastProvider, ToastViewport } from "./components/ui/toast"
import NativelyInterface from "./components/NativelyInterface"
import SettingsPopup from "./components/SettingsPopup" // Keeping for legacy/specific window support if needed
import Launcher from "./components/Launcher"
import ModelSelectorWindow from "./components/ModelSelectorWindow"
import SettingsOverlay from "./components/SettingsOverlay"
import StartupSequence from "./components/StartupSequence"
import { AnimatePresence, motion } from "framer-motion"
import UpdateBanner from "./components/UpdateBanner"
import { SupportToaster } from "./components/SupportToaster"
import { NativelyQuotaBanner } from "./components/NativelyQuotaBanner"
import { FreeTrialBanner }      from "./components/trial/FreeTrialBanner"
import { FreeTrialModal }       from "./components/trial/FreeTrialModal"
import { TrialPromoToaster }    from "./components/trial/TrialPromoToaster"
import { PermissionsToaster }   from "./components/onboarding/PermissionsToaster"
import { AlertCircle } from "lucide-react"
import { clampOverlayOpacity, OVERLAY_OPACITY_DEFAULT, getDefaultOverlayOpacity } from "./lib/overlayAppearance"
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from './lib/meetingInterfaceTheme'
import { isMac } from "./utils/platformUtils"
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

const App: React.FC = () => {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isLauncherWindow = new URLSearchParams(window.location.search).get('window') === 'launcher';
  const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';
  const isModelSelectorWindow = new URLSearchParams(window.location.search).get('window') === 'model-selector';
  const isCropperWindow = new URLSearchParams(window.location.search).get('window') === 'cropper';

  // Default to launcher if not specified (dev mode safety)
  const isDefault = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !isCropperWindow;

  if (isCropperWindow) {
    const Cropper = React.lazy(() => import('./components/Cropper'));
    return (
      <React.Suspense fallback={<div className="w-screen h-screen bg-transparent" />}>
        <Cropper />
      </React.Suspense>
    );
  }

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
  // One-shot first-run startup sequence. Once the user dismisses it (or any
  // future code flips the flag), it never appears again on subsequent launches.
  const [showStartup, setShowStartup] = useState<boolean>(() => {
    try {
      return localStorage.getItem('natively_seen_startup_v1') !== 'true';
    } catch {
      return true;
    }
  });
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
  
  // API check
  const [hasNativelyApi, setHasNativelyApi] = useState<boolean>(false);

  // ── Onboarding / promo toasters ───────────────────────────
  const [showPermissionsToaster, setShowPermissionsToaster] = useState(false);
  const [showTrialPromo,         setShowTrialPromo]         = useState(false);

  // ── Free Trial global state ────────────────────────────────
  const [activeTrial, setActiveTrial] = useState<{
    expiresAt: string;
    usage: { ai: number; stt_seconds: number; search: number };
  } | null>(null);
  const [showTrialExpiredModal, setShowTrialExpiredModal] = useState(false);

  const isAppReady = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !showStartup && !isSettingsOpen && isLauncherMainView && !isProfileOpen;
  const { activeAd, dismissAd, previewAd } = useAdCampaigns(
    planDetails,
    hasProfile,
    isAppReady,
    appStartTime,
    lastMeetingEndTime,
    isProcessingMeeting,
    hasNativelyApi
  );

  // Preview shortcuts — Ctrl/Cmd+Shift+1-5 force-show any ad card.
  // Uses e.code so Shift doesn't remap the digit to a symbol ('!' etc.).
  useEffect(() => {
    const CODE_MAP: Record<string, string> = {
      'Digit1': 'max_ultra_upgrade',
      'Digit2': 'promo',
      'Digit3': 'natively_api',
      'Digit4': 'profile',
      'Digit5': 'jd',
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      const ad = CODE_MAP[e.code];
      if (!ad) return;
      e.preventDefault();
      previewAd(ad as any);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewAd]);

  useEffect(() => {
    // Clean up old local storage
    localStorage.removeItem('useLegacyAudioBackend');

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

    // ── Onboarding toasters ──────────────────────────────────
    if (isLauncherWindow || isDefault) {
      const permsShown = localStorage.getItem('natively_perms_shown_v1');
      if (!permsShown) {
        // First ever launch — show permissions toaster
        setShowPermissionsToaster(true);
      } else {
        // Subsequent launches — trial promo will self-gate via TrialPromoToaster
        setShowTrialPromo(true);
      }
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
    const handleStorage = () => setMeetingInterfaceThemeState(getMeetingInterfaceTheme());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
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
      }
    } catch (err) {
      console.error("Failed to start meeting:", err);
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

  // Render Logic
  if (isSettingsWindow) {
    return (
      <ErrorBoundary context="SettingsPopup">
        <div className="h-full min-h-0 w-full">
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
        <div className="h-full min-h-0 w-full overflow-hidden">
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
        <div className="w-full relative bg-transparent">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <div
                style={{
                  ['--overlay-opacity' as '--overlay-opacity']: String(overlayOpacity),
                  transition: 'background-color 75ms ease, border-color 75ms ease, box-shadow 75ms ease'
                } as React.CSSProperties}
              >
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
    <div className="h-full min-h-0 w-full relative bg-[#000000]">
      <AnimatePresence>
        {showStartup ? (
          <motion.div
            key="startup"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, pointerEvents: "none", transition: { duration: 0.6, ease: "easeInOut" } }}
          >
            <StartupSequence onComplete={() => {
              try { localStorage.setItem('natively_seen_startup_v1', 'true'); } catch {}
              setShowStartup(false);
            }} />
          </motion.div>
        ) : (
          <motion.div
            key="main"
            className="h-full w-full"
            initial={{ opacity: 0, scale: 0.98, y: 15 }} // "Linear" style entry: slightly down and scaled down
            animate={{ opacity: 1, scale: 1, y: 0 }}      // Slide up and snap to place
            transition={{
              duration: 0.8,
              ease: [0.19, 1, 0.22, 1], // Expo-out: snappy start, smooth landing
              delay: 0.1
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

      <UpdateBanner />
      <SupportToaster />
      <NativelyQuotaBanner />



      {/* Free trial countdown banner — only in launcher window while trial is active */}
      {(isLauncherWindow || isDefault) && activeTrial && (
        <FreeTrialBanner
          expiresAt={activeTrial.expiresAt}
          usage={activeTrial.usage}
          onUpgrade={() => openSettingsExclusive('api')}
        />
      )}

      {/* Permissions toaster — first ever launch */}
      <PermissionsToaster
        isOpen={showPermissionsToaster}
        onDismiss={() => {
          localStorage.setItem('natively_perms_shown_v1', '1');
          setShowPermissionsToaster(false);
          // After permissions, allow trial promo on next launch
        }}
      />

      {/* Trial promo toaster — 5s after restart (self-gates via localStorage + conditions) */}
      <TrialPromoToaster
        isOpen={showTrialPromo}
        hasNativelyKey={hasNativelyApi}
        hasTrialToken={!!activeTrial}
        onDismiss={() => setShowTrialPromo(false)}
        onStartTrial={async () => {
          const res = await window.electronAPI?.startTrial?.();
          if (!res?.ok) throw new Error(res?.error || 'Could not start trial');
          if (res.expires_at) {
            setActiveTrial({ expiresAt: res.expires_at, usage: res.usage ?? { ai: 0, stt_seconds: 0, search: 0 } });
          }
          setShowTrialPromo(false);
        }}
        onManualSetup={() => {
          setShowTrialPromo(false);
          openSettingsExclusive('api');
        }}
      />

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
      {/* Ad toasters — render whenever activeAd is set (isLauncherMainView guard bypassed
          when triggered via preview shortcut so the card always surfaces) */}
      {(isLauncherMainView || !!activeAd) && !isSettingsOpen && (
        <NativelyApiPromoToaster
          isOpen={activeAd === 'natively_api'}
          onDismiss={() => dismissAd('natively_api')}
          onOpenSettings={(tab: string) => openSettingsExclusive(tab)}
        />
      )}
      {(isLauncherMainView || !!activeAd) && (
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

          {/* Remote Campaigns Render Logic */}
          <RemoteCampaignToaster
            isOpen={typeof activeAd === 'object' && activeAd !== null}
            campaign={typeof activeAd === 'object' && activeAd !== null ? activeAd : undefined as any}
            onDismiss={dismissAd}
          />
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
