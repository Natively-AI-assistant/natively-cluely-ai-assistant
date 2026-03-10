import React, { useState, useEffect } from "react" // forcing refresh
import { QueryClient, QueryClientProvider } from "react-query"
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
import { JDAwarenessToaster } from '../premium/src/JDAwarenessToaster'
import { ProfileFeatureToaster } from '../premium/src/ProfileFeatureToaster'
import { PremiumPromoToaster } from '../premium/src/PremiumPromoToaster'
import { RemoteCampaignToaster } from '../premium/src/RemoteCampaignToaster'
import { PremiumUpgradeModal } from '../premium/src/PremiumUpgradeModal'
import { useAdCampaigns } from '../premium/src/useAdCampaigns'
import { analytics } from "./lib/analytics/analytics.service"

const queryClient = new QueryClient()

const App: React.FC = () => {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isLauncherWindow = new URLSearchParams(window.location.search).get('window') === 'launcher';
  const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';
  const isModelSelectorWindow = new URLSearchParams(window.location.search).get('window') === 'model-selector';

  // Default to launcher if not specified (dev mode safety)
  const isDefault = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow;

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
  const [settingsInitialTab, setSettingsInitialTab] = useState('general');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [isPremiumActive, setIsPremiumActive] = useState(false);
  
  // Profile state for ad targeting
  const [hasProfile, setHasProfile] = useState(false);

  // Initialize Ads Campaign Manager
  const [appStartTime] = useState<number>(Date.now());
  const [lastMeetingEndTime, setLastMeetingEndTime] = useState<number | null>(null);
  
  const isAppReady = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !showStartup;
  const { activeAd, dismissAd } = useAdCampaigns(
    isPremiumActive, 
    hasProfile, 
    isAppReady,
    appStartTime,
    lastMeetingEndTime
  );

  useEffect(() => {
    // Basic status check for campaign targeting
    window.electronAPI?.profileGetStatus?.().then(s => setHasProfile(s?.hasProfile || false)).catch(() => {});
    window.electronAPI?.licenseCheckPremium?.().then(setIsPremiumActive).catch(() => {});
  }, []);

  // Handlers
  const handleStartMeeting = async () => {
    try {
      localStorage.setItem('natively_last_meeting_start', Date.now().toString());
      const inputDeviceId = localStorage.getItem('preferredInputDeviceId');
      let outputDeviceId = localStorage.getItem('preferredOutputDeviceId');
      const useLegacyAudio = localStorage.getItem('useLegacyAudioBackend') === 'true';

      // Override output device ID to force SCK if experimental mode is enabled
      // Default to SCK unless legacy is enabled
      if (!useLegacyAudio) {
        console.log("[App] Using ScreenCaptureKit backend (Default).");
        outputDeviceId = "sck";
      } else {
        console.log("[App] Using Legacy CoreAudio backend (User Preference).");
      }

      const result = await window.electronAPI.startMeeting({
        audio: { inputDeviceId, outputDeviceId }
      });
      if (result.success) {
        analytics.trackMeetingStarted();
        // Switch to Overlay Mode via IPC
        // The main process handles window switching, but we can reinforce it or just trust main.
        // Actually, main process startMeeting triggers nothing UI-wise unless we tell it to switch window
        // But we configured main.ts to not auto-switch?
        // Let's explicitly request mode change.
        await window.electronAPI.setWindowMode('overlay');
      } else {
        console.error("Failed to start meeting:", result.error);
      }
    } catch (err) {
      console.error("Failed to start meeting:", err);
    }
  };

  const handleEndMeeting = async () => {
    console.log("[App.tsx] handleEndMeeting triggered");
    analytics.trackMeetingEnded();
    try {
      await window.electronAPI.endMeeting();
      console.log("[App.tsx] endMeeting IPC completed");
      
      const startStr = localStorage.getItem('natively_last_meeting_start');
      if (startStr) {
        const duration = Date.now() - parseInt(startStr, 10);
        const threshold = import.meta.env.DEV ? 10000 : 180000;
        if (duration >= threshold) {
          localStorage.setItem('natively_show_profile_toaster', 'true');
        }
        localStorage.removeItem('natively_last_meeting_start');
      }

      // Switch back to Native Launcher Mode
      setLastMeetingEndTime(Date.now());
      await window.electronAPI.setWindowMode('launcher');
    } catch (err) {
      console.error("Failed to end meeting:", err);
      window.electronAPI.setWindowMode('launcher');
    }
  };

  // Render Logic
  if (isSettingsWindow) {
    return (
      <div className="h-full min-h-0 w-full">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SettingsPopup />
            <ToastViewport />
          </ToastProvider>
        </QueryClientProvider>
      </div>
    );
  }

  if (isModelSelectorWindow) {
    return (
      <div className="h-full min-h-0 w-full overflow-hidden">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <ModelSelectorWindow />
            <ToastViewport />
          </ToastProvider>
        </QueryClientProvider>
      </div>
    );
  }

  // --- OVERLAY WINDOW (Meeting Interface) ---
  if (isOverlayWindow) {
    return (
      <div className="w-full relative bg-transparent">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <NativelyInterface
              onEndMeeting={handleEndMeeting}
            />
            <ToastViewport />
          </ToastProvider>
        </QueryClientProvider>
      </div>
    );
  }

  // --- LAUNCHER WINDOW (Default) ---
  // Renders if window=launcher OR no param
  return (
    <div className="h-full min-h-0 w-full relative">
      <AnimatePresence>
        {showStartup ? (
          <motion.div
            key="startup"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, pointerEvents: "none", transition: { duration: 0.6, ease: "easeInOut" } }}
          >
            <StartupSequence onComplete={() => setShowStartup(false)} />
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
                <Launcher
                  onStartMeeting={handleStartMeeting}
                  onOpenSettings={(tab = 'general') => {
                    setSettingsInitialTab(tab);
                    setIsSettingsOpen(true);
                  }}
                />
                <SettingsOverlay
                  isOpen={isSettingsOpen}
                  onClose={() => {
                    setIsSettingsOpen(false);
                  }}
                  initialTab={settingsInitialTab}
                />
                <ToastViewport />
              </ToastProvider>
            </QueryClientProvider>
          </motion.div>
        )}
      </AnimatePresence>
      <UpdateBanner />
      <SupportToaster />
      <ProfileFeatureToaster 
        isOpen={activeAd === 'profile'} 
        onDismiss={dismissAd}
        onSetupProfile={() => {
          setSettingsInitialTab('profile');
          setIsSettingsOpen(true);
        }} 
      />
      <JDAwarenessToaster 
        isOpen={activeAd === 'jd'} 
        onDismiss={dismissAd}
        onSetupJD={() => {
          setSettingsInitialTab('profile');
          setIsSettingsOpen(true);
        }} 
      />
      <PremiumPromoToaster 
        isOpen={activeAd === 'promo'} 
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

      <PremiumUpgradeModal
        isOpen={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
        isPremium={isPremiumActive}
        onActivated={() => {
          setIsPremiumActive(true);
          setShowPremiumModal(false);
          // After activation, open settings to Profile Intelligence
          setTimeout(() => {
            setSettingsInitialTab('profile');
            setIsSettingsOpen(true);
          }, 300);
        }}
        onDeactivated={() => setIsPremiumActive(false)}
      />
    </div>
  )
}

export default App
