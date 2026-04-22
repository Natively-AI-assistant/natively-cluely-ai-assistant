import { Page } from '@playwright/test'
import { E2EMockMeeting } from '../data/meetings'
import { E2EMockModel } from '../data/models'
import { E2EMockSettings } from '../data/settings'

export interface MockScenario {
  name: string
  meetings?: E2EMockMeeting[]
  settings?: Partial<E2EMockSettings>
  models?: string[]
  providerModels?: E2EMockModel[]
  credentials?: Record<string, unknown>
  meetingActive?: boolean
  themeMode?: { resolved: string; source: string }
  actionButtonMode?: string
  calendarStatus?: { connected: boolean; events: unknown[] }
  profileStatus?: { hasProfile: boolean; profileMode: boolean }
  premium?: boolean
  undetectable?: boolean
  openAtLogin?: boolean
  sttProvider?: string
  recognitionLanguage?: string
  aiResponseLanguage?: string
  disguise?: string
  customProviders?: unknown[]
  donationStatus?: { shown: boolean }
  meetingHistory?: unknown[]
  screenshots?: unknown[]
  keybinds?: unknown[]
  nativeAudioStatus?: { connected: boolean }
  defaultModel?: string
  currentModel?: { id: string; provider: string }
  sttLanguage?: string
  profile?: unknown
}

function buildElectronMockScript(scenario: MockScenario): string {
  const json = (val: unknown) => JSON.stringify(val)

  const defaults: MockScenario = {
    name: 'default',
    meetings: [],
    settings: {},
    models: [],
    providerModels: [],
    credentials: {
      hasGeminiKey: true,
      hasGroqKey: false,
      hasOpenaiKey: false,
      hasClaudeKey: false,
      hasSttGroqKey: false,
      hasSttOpenaiKey: false,
      hasDeepgramKey: false,
      hasElevenLabsKey: false,
      hasAzureKey: false,
      azureRegion: '',
      hasIbmWatsonKey: false,
      ibmWatsonRegion: '',
      googleServiceAccountPath: null,
      sttProvider: 'google',
    },
    meetingActive: false,
    themeMode: { resolved: 'dark', source: 'system' },
    actionButtonMode: 'recap',
    calendarStatus: { connected: false, events: [] },
    profileStatus: { hasProfile: false, profileMode: false },
    premium: false,
    undetectable: false,
    openAtLogin: false,
    sttProvider: 'google',
    recognitionLanguage: 'en-US',
    aiResponseLanguage: 'en',
    disguise: 'none',
    customProviders: [],
    donationStatus: { shown: true },
    meetingHistory: [],
    screenshots: [],
    keybinds: [],
    nativeAudioStatus: { connected: false },
    defaultModel: 'gpt-4',
    currentModel: { id: 'gpt-4', provider: 'openai' },
    sttLanguage: 'en-US',
    profile: null,
  }

  const merged: MockScenario = { ...defaults, ...scenario }

  return `
    window.process = window.process || {};
    window.process.platform = 'win32';

    // ── Set localStorage to prevent toasters from showing ──────────────
    localStorage.setItem('natively_perms_shown_v1', '1');  // Skip permissions toaster
    localStorage.setItem('natively_trial_promo_shown', '1');  // Skip trial promo
    localStorage.setItem('natively_profile_toaster_shown', '1');  // Skip profile toaster

    // Hide any stored ad campaign flags
    localStorage.setItem('natively_ad_promo_shown', '1');
    localStorage.setItem('natively_ad_max_ultra_shown', '1');
    localStorage.setItem('natively_ad_profile_shown', '1');
    localStorage.setItem('natively_ad_jd_shown', '1');
    localStorage.setItem('natively_ad_natively_api_shown', '1');

    const scenario = ${json(merged)};

    const createListenerMock = () => {
      return (_callback) => {
        return () => {};
      };
    };

    window.electronAPI = {
      platform: 'win32',

      // Getters
      getThemeMode: () => Promise.resolve(scenario.themeMode),
      getSettings: () => Promise.resolve(scenario.settings),
      getSttProvider: () => Promise.resolve(scenario.sttProvider),
      getStoredCredentials: () => Promise.resolve(scenario.credentials),
      getKeybinds: () => Promise.resolve(scenario.keybinds),
      getActionButtonMode: () => Promise.resolve(scenario.actionButtonMode),
      getRecentMeetings: () => Promise.resolve(scenario.meetings),
      getMeetingActive: () => Promise.resolve(scenario.meetingActive),
      getUndetectable: () => Promise.resolve(scenario.undetectable),
      getOpenAtLogin: () => Promise.resolve(scenario.openAtLogin),
      getCalendarStatus: () => Promise.resolve(scenario.calendarStatus),
      getNativeAudioStatus: () => Promise.resolve(scenario.nativeAudioStatus),
      getScreenshots: () => Promise.resolve(scenario.screenshots),
      getDefaultModel: () => Promise.resolve(scenario.defaultModel),
      getModel: () => Promise.resolve(scenario.currentModel),
      getCustomProviders: () => Promise.resolve(scenario.customProviders),
      getRecognitionLanguages: () => Promise.resolve(['en-US', 'es-ES', 'fr-FR', 'de-DE']),
      getAiResponseLanguages: () => Promise.resolve(['en', 'es', 'fr', 'de']),
      getSttLanguage: () => Promise.resolve(scenario.sttLanguage),
      getAiResponseLanguage: () => Promise.resolve(scenario.aiResponseLanguage),
      getDonationStatus: () => Promise.resolve(scenario.donationStatus),
      getMeetingHistory: () => Promise.resolve(scenario.meetingHistory),

      // Profile Engine
      profileGetStatus: () => Promise.resolve(scenario.profileStatus),
      profileGetProfile: () => Promise.resolve(scenario.profile),
      licenseCheckPremium: () => Promise.resolve(scenario.premium),

      // Setters
      setSetting: () => Promise.resolve(),
      setThemeMode: () => Promise.resolve(),
      setModel: () => Promise.resolve(),
      setUndetectable: () => Promise.resolve(),
      setOpenAtLogin: () => Promise.resolve(),
      setRecognitionLanguage: () => Promise.resolve(),
      setAiResponseLanguage: () => Promise.resolve(),
      markDonationToastShown: () => Promise.resolve(),
      setSttProvider: () => Promise.resolve(),

      // Listeners
      onUpdateAvailable: createListenerMock(),
      onDownloadProgress: createListenerMock(),
      onUpdateDownloaded: createListenerMock(),
      onUpdateError: createListenerMock(),
      onUpdateChecking: createListenerMock(),
      onUpdateNotAvailable: createListenerMock(),
      onThemeChanged: createListenerMock(),
      onKeybindsUpdate: createListenerMock(),
      onMeetingUpdate: createListenerMock(),
      onSettingsUpdate: createListenerMock(),
      onCalendarUpdate: createListenerMock(),
      onUndetectableChanged: createListenerMock(),
      onGroqFastTextChanged: createListenerMock(),
      onActionButtonModeChanged: createListenerMock(),
      onNativeAudioConnected: createListenerMock(),
      onNativeAudioDisconnected: createListenerMock(),
      onNativeAudioTranscript: createListenerMock(),
      onSuggestionProcessingStart: createListenerMock(),
      onSuggestionGenerated: createListenerMock(),
      onSuggestionError: createListenerMock(),
      onDisguiseChanged: createListenerMock(),
      onOverlayMousePassthroughChanged: createListenerMock(),
      onSettingsVisibilityChange: createListenerMock(),
      onToggleExpand: createListenerMock(),
      onEnsureExpanded: createListenerMock(),
      onSessionReset: createListenerMock(),
      onModelChanged: createListenerMock(),
      onMeetingStateChanged: createListenerMock(),
      onWindowMaximizedChanged: createListenerMock(),
      onScreenshotTaken: createListenerMock(),
      onScreenshotAttached: createListenerMock(),
      onCaptureAndProcess: createListenerMock(),
      onSolutionsReady: createListenerMock(),
      onResetView: createListenerMock(),
      onSolutionStart: createListenerMock(),
      onDebugStart: createListenerMock(),
      onDebugSuccess: createListenerMock(),
      onSolutionError: createListenerMock(),
      onProcessingNoScreenshots: createListenerMock(),
      onProblemExtracted: createListenerMock(),
      onSolutionSuccess: createListenerMock(),
      onUnauthorized: createListenerMock(),
      onDebugError: createListenerMock(),

      onResetCropper: (callback) => {
        window.__cropperResetCallback = callback
        return () => { delete window.__cropperResetCallback }
      },

      cropperCancelled: () => {
        document.body.innerHTML = ''
        return Promise.resolve()
      },

      // Void methods
      updateContentDimensions: () => Promise.resolve(),
      takeScreenshot: () => Promise.resolve(),
      moveWindowLeft: () => Promise.resolve(),
      moveWindowRight: () => Promise.resolve(),
      moveWindowUp: () => Promise.resolve(),
      moveWindowDown: () => Promise.resolve(),
      windowMinimize: () => Promise.resolve(),
      windowMaximize: () => Promise.resolve(),
      windowClose: () => Promise.resolve(),
      analyzeImageFile: () => Promise.resolve(),
      quitApp: () => Promise.resolve(),
      showWindow: () => Promise.resolve(),
      hideWindow: () => Promise.resolve(),
      showOverlay: () => Promise.resolve(),
      hideOverlay: () => Promise.resolve(),
      selectModel: () => Promise.resolve(),
      deleteMeeting: () => Promise.resolve(),
      exportMeeting: () => Promise.resolve(),
      importMeeting: () => Promise.resolve(),
      startMeeting: () => Promise.resolve(),
      endMeeting: () => Promise.resolve(),
      sendTranscript: () => Promise.resolve(),
      connectCalendar: () => Promise.resolve(),
      disconnectCalendar: () => Promise.resolve(),
      testReleaseFetch: () => Promise.resolve(),
      downloadUpdate: () => Promise.resolve(),
      restartAndInstall: () => Promise.resolve(),
      openExternal: () => Promise.resolve(),
      checkForUpdates: () => Promise.resolve(),
      toggleWindow: () => Promise.resolve(),
      toggleSettingsWindow: () => Promise.resolve(),
      closeSettingsWindow: () => Promise.resolve(),
      toggleAdvancedSettings: () => Promise.resolve(),
      closeAdvancedSettings: () => Promise.resolve(),
      setOverlayMousePassthrough: () => Promise.resolve(),
      toggleOverlayMousePassthrough: () => Promise.resolve(),
      getOverlayMousePassthrough: () => Promise.resolve(false),
      setDisguise: () => Promise.resolve(),
      getDisguise: () => Promise.resolve(scenario.disguise),
      getCurrentLlmConfig: () => Promise.resolve({}),
      getAvailableOllamaModels: () => Promise.resolve(scenario.models),
      switchToOllama: () => Promise.resolve(),
      switchToGemini: () => Promise.resolve(),
      testLlmConnection: () => Promise.resolve({ success: true }),
      selectServiceAccount: () => Promise.resolve(),
      setGeminiApiKey: () => Promise.resolve(),
      setGroqApiKey: () => Promise.resolve(),
      setOpenaiApiKey: () => Promise.resolve(),
      setClaudeApiKey: () => Promise.resolve(),
      setNativelyApiKey: () => Promise.resolve(),
      setGroqSttApiKey: () => Promise.resolve(),
      setOpenAiSttApiKey: () => Promise.resolve(),
      setDeepgramApiKey: () => Promise.resolve(),
      setElevenLabsApiKey: () => Promise.resolve(),
      setAzureApiKey: () => Promise.resolve(),
      setAzureRegion: () => Promise.resolve(),
      setIbmWatsonApiKey: () => Promise.resolve(),
      setGroqSttModel: () => Promise.resolve(),
      setSonioxApiKey: () => Promise.resolve(),
      testSttConnection: () => Promise.resolve({ success: true }),
    };

    const handler = {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        const name = typeof prop === 'string' ? prop : '';
        if (name.startsWith('on')) {
          return createListenerMock();
        }
        return () => Promise.resolve([]);
      }
    };
    window.electronAPI = new Proxy(window.electronAPI, handler);
  `
}

export async function setupElectronMock(page: Page, scenario: MockScenario): Promise<void> {
  await page.addInitScript(buildElectronMockScript(scenario))
}
