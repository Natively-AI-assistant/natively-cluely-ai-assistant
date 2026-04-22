/**
 * Shared ElectronAPI mock factory for the test suite.
 *
 * Parses the ElectronAPI interface from electron/preload.ts and creates a
 * comprehensive mock covering every IPC method with sensible defaults.
 *
 * Usage:
 *   import { createElectronAPIMock, installElectronAPIMock, resetElectronAPIMock } from './electronAPI.mock'
 *
 *   // Per-test
 *   const api = createElectronAPIMock()
 *
 *   // Global (renderer tests)
 *   installElectronAPIMock()
 *
 *   // Between tests
 *   resetElectronAPIMock()
 */

import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// Listener storage for fireIPCEvent helper
// ---------------------------------------------------------------------------
const listeners = new Map<string, Set<Function>>()

/**
 * Fire an IPC event from main process to renderer.
 * Enables simulating main→renderer events in tests.
 */
export function fireIPCEvent(channel: string, data: any): void {
  listeners.get(channel)?.forEach(cb => cb(data))
}

// ---------------------------------------------------------------------------
// Helper: create an on* listener mock that returns an unsubscribe function
// ---------------------------------------------------------------------------
function listenerMock(channel: string) {
  return vi.fn((callback: Function) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(callback)
    return () => listeners.get(channel)?.delete(callback)
  })
}

// ---------------------------------------------------------------------------
// Default mocks by method-name pattern
// ---------------------------------------------------------------------------

/**
 * Build the full mock object.  Every method from the ElectronAPI interface
 * is present with a vi.fn() that resolves to a type-appropriate default.
 */
export function createElectronAPIMock(
  overrides: Partial<Record<string, any>> = {}
): Record<string, any> {
  const mock: Record<string, any> = {
    // ===================================================================
    // Non-function properties
    // ===================================================================
    platform: 'linux' as NodeJS.Platform,

    // ===================================================================
    // Async IPC — void returns
    // ===================================================================
    updateContentDimensions: vi.fn(() => Promise.resolve()),
    takeScreenshot: vi.fn(() => Promise.resolve()),
    moveWindowLeft: vi.fn(() => Promise.resolve()),
    moveWindowRight: vi.fn(() => Promise.resolve()),
    moveWindowUp: vi.fn(() => Promise.resolve()),
    moveWindowDown: vi.fn(() => Promise.resolve()),
    windowMinimize: vi.fn(() => Promise.resolve()),
    windowMaximize: vi.fn(() => Promise.resolve()),
    windowClose: vi.fn(() => Promise.resolve()),
    analyzeImageFile: vi.fn(() => Promise.resolve()),
    quitApp: vi.fn(() => Promise.resolve()),
    showWindow: vi.fn(() => Promise.resolve()),
    hideWindow: vi.fn(() => Promise.resolve()),
    showOverlay: vi.fn(() => Promise.resolve()),
    hideOverlay: vi.fn(() => Promise.resolve()),
    toggleModelSelector: vi.fn(() => Promise.resolve()),
    forceRestartOllama: vi.fn(() => Promise.resolve()),
    toggleSettingsWindow: vi.fn(() => Promise.resolve()),
    toggleAdvancedSettings: vi.fn(() => Promise.resolve()),
    streamGeminiChat: vi.fn(() => Promise.resolve()),
    finalizeMicSTT: vi.fn(() => Promise.resolve()),
    setOverlayOpacity: vi.fn(() => Promise.resolve()),
    restartAndInstall: vi.fn(() => Promise.resolve()),
    checkForUpdates: vi.fn(() => Promise.resolve()),
    downloadUpdate: vi.fn(() => Promise.resolve()),

    // ===================================================================
    // Async IPC — boolean returns
    // ===================================================================
    windowIsMaximized: vi.fn(() => Promise.resolve(false)),
    getMeetingActive: vi.fn(() => Promise.resolve(false)),
    getOverlayMousePassthrough: vi.fn(() => Promise.resolve(false)),
    getVerboseLogging: vi.fn(() => Promise.resolve(false)),
    getOpenAtLogin: vi.fn(() => Promise.resolve(false)),
    getUndetectable: vi.fn(() => Promise.resolve(false)),
    ragIsMeetingProcessed: vi.fn(() => Promise.resolve(false)),

    // ===================================================================
    // Async IPC — string returns
    // ===================================================================
    getSttProvider: vi.fn(() => Promise.resolve('google')),
    getSttLanguage: vi.fn(() => Promise.resolve('')),
    getAiResponseLanguage: vi.fn(() => Promise.resolve('')),
    getArch: vi.fn(() => Promise.resolve('')),
    getDisguise: vi.fn(() => Promise.resolve('none')),
    generateFollowupEmail: vi.fn(() => Promise.resolve('')),
    licenseGetHardwareId: vi.fn(() => Promise.resolve('')),

    // ===================================================================
    // Async IPC — object / structured returns
    // ===================================================================
    getRecognitionLanguages: vi.fn(() => Promise.resolve({})),
    getScreenshots: vi.fn(() => Promise.resolve([])),
    takeSelectiveScreenshot: vi.fn(() =>
      Promise.resolve({ path: '', preview: '', cancelled: false })
    ),
    deleteScreenshot: vi.fn(() => Promise.resolve({ success: true })),

    // LLM
    getCurrentLlmConfig: vi.fn(() =>
      Promise.resolve({ provider: 'ollama' as const, model: '', isOllama: true })
    ),
    getAvailableOllamaModels: vi.fn(() => Promise.resolve<string[]>([])),
    switchToOllama: vi.fn(() => Promise.resolve({ success: true })),
    switchToGemini: vi.fn(() => Promise.resolve({ success: true })),
    testLlmConnection: vi.fn(() => Promise.resolve({ success: true })),
    selectServiceAccount: vi.fn(() =>
      Promise.resolve({ success: true, path: undefined, cancelled: false })
    ),

    // API keys
    setGeminiApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setGroqApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setOpenaiApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setClaudeApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setNativelyApiKey: vi.fn(() => Promise.resolve({ success: true })),
    getStoredCredentials: vi.fn(() =>
      Promise.resolve({
        hasGeminiKey: false,
        hasGroqKey: false,
        hasOpenaiKey: false,
        hasClaudeKey: false,
        hasNativelyKey: false,
        googleServiceAccountPath: null as string | null,
        sttProvider: 'google',
        hasSttGroqKey: false,
        hasSttOpenaiKey: false,
        hasDeepgramKey: false,
        hasElevenLabsKey: false,
        hasAzureKey: false,
        azureRegion: '',
        hasIbmWatsonKey: false,
        ibmWatsonRegion: '',
        hasSonioxKey: false,
      })
    ),

    // STT
    setSttProvider: vi.fn(() => Promise.resolve({ success: true })),
    setGroqSttApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setOpenAiSttApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setDeepgramApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setElevenLabsApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setAzureApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setAzureRegion: vi.fn(() => Promise.resolve({ success: true })),
    setIbmWatsonApiKey: vi.fn(() => Promise.resolve({ success: true })),
    setGroqSttModel: vi.fn(() => Promise.resolve({ success: true })),
    setSonioxApiKey: vi.fn(() => Promise.resolve({ success: true })),
    testSttConnection: vi.fn(() => Promise.resolve({ success: true })),

    // Devices / languages
    generateSuggestion: vi.fn(() => Promise.resolve({ suggestion: '' })),
    getInputDevices: vi.fn(() => Promise.resolve<Array<{ id: string; name: string }>>([])),
    getOutputDevices: vi.fn(() => Promise.resolve<Array<{ id: string; name: string }>>([])),
    setRecognitionLanguage: vi.fn(() => Promise.resolve({ success: true })),
    getAiResponseLanguages: vi.fn(() =>
      Promise.resolve<Array<{ label: string; code: string }>>([])
    ),
    setAiResponseLanguage: vi.fn(() => Promise.resolve({ success: true })),

    // Intelligence
    generateAssist: vi.fn(() => Promise.resolve({ insight: null as string | null })),
    generateWhatToSay: vi.fn(() =>
      Promise.resolve({ answer: null as string | null, question: undefined })
    ),
    generateFollowUp: vi.fn(() =>
      Promise.resolve({ refined: null as string | null, intent: '' })
    ),
    generateRecap: vi.fn(() => Promise.resolve({ summary: null as string | null })),
    submitManualQuestion: vi.fn(() => Promise.resolve({ answer: null as string | null, question: '' })),
    getIntelligenceContext: vi.fn(() =>
      Promise.resolve({ context: '', lastAssistantMessage: null as string | null, activeMode: '' })
    ),
    resetIntelligence: vi.fn(() => Promise.resolve({ success: true })),
    generateClarify: vi.fn(() => Promise.resolve({ clarification: null as string | null })),
    generateCodeHint: vi.fn(() => Promise.resolve({ hint: null as string | null })),
    generateBrainstorm: vi.fn(() => Promise.resolve({ ideas: null as string | null })),
    generateFollowUpQuestions: vi.fn(() => Promise.resolve({ questions: '' })),

    // Meetings
    startMeeting: vi.fn(() => Promise.resolve({ success: true })),
    endMeeting: vi.fn(() => Promise.resolve({ success: true })),
    getRecentMeetings: vi.fn(() =>
      Promise.resolve<Array<{ id: string; title: string; date: string; duration: string; summary: string }>>([])
    ),
    getMeetingDetails: vi.fn(() => Promise.resolve({})),
    updateMeetingTitle: vi.fn(() => Promise.resolve(true)),
    updateMeetingSummary: vi.fn(() => Promise.resolve(true)),
    deleteMeeting: vi.fn(() => Promise.resolve({ success: true })),

    // Model management
    getDefaultModel: vi.fn(() => Promise.resolve({ model: '' })),
    setModel: vi.fn(() => Promise.resolve({ success: true })),
    setDefaultModel: vi.fn(() => Promise.resolve({ success: true })),

    // Groq fast text
    getGroqFastTextMode: vi.fn(() => Promise.resolve({ enabled: false })),
    setGroqFastTextMode: vi.fn(() => Promise.resolve({ success: true })),

    // Demo
    seedDemo: vi.fn(() => Promise.resolve({ success: true })),

    // Custom providers
    saveCustomProvider: vi.fn(() => Promise.resolve({ success: true })),
    getCustomProviders: vi.fn(() => Promise.resolve<any[]>([])),
    deleteCustomProvider: vi.fn(() => Promise.resolve({ success: true })),

    // Email
    extractEmailsFromTranscript: vi.fn(() => Promise.resolve<string[]>([])),
    getCalendarAttendees: vi.fn(() =>
      Promise.resolve<Array<{ email: string; name: string }>>([])
    ),
    openMailto: vi.fn(() => Promise.resolve({ success: true })),

    // Audio test
    startAudioTest: vi.fn(() => Promise.resolve({ success: true })),
    stopAudioTest: vi.fn(() => Promise.resolve({ success: true })),

    // Database
    flushDatabase: vi.fn(() => Promise.resolve({ success: true })),

    // Window / overlay / misc
    toggleWindow: vi.fn(() => Promise.resolve()),
    openExternal: vi.fn(() => Promise.resolve()),
    setUndetectable: vi.fn(() => Promise.resolve()),
    setOpenAtLogin: vi.fn(() => Promise.resolve()),
    setDisguise: vi.fn(() => Promise.resolve()),
    getNativeAudioStatus: vi.fn(() => Promise.resolve({})),
    setWindowMode: vi.fn(() => Promise.resolve()),

    // Theme
    getThemeMode: vi.fn(() =>
      Promise.resolve({ mode: 'system' as const, resolved: 'light' as const })
    ),
    setThemeMode: vi.fn(() => Promise.resolve()),

    // Calendar
    calendarConnect: vi.fn(() => Promise.resolve({ success: true })),
    calendarDisconnect: vi.fn(() => Promise.resolve({ success: true })),
    getCalendarStatus: vi.fn(() => Promise.resolve({ connected: false })),
    getUpcomingEvents: vi.fn(() =>
      Promise.resolve<Array<{ id: string; title: string; startTime: string; endTime: string; link?: string; source: 'google' }>>([])
    ),
    calendarRefresh: vi.fn(() => Promise.resolve({ success: true })),

    // Auto-update
    testReleaseFetch: vi.fn(() => Promise.resolve({ success: true })),

    // RAG
    ragQueryMeeting: vi.fn(() => Promise.resolve({})),
    ragQueryLive: vi.fn(() => Promise.resolve({})),
    ragQueryGlobal: vi.fn(() => Promise.resolve({})),
    ragCancelQuery: vi.fn(() => Promise.resolve({ success: true })),
    ragGetQueueStatus: vi.fn(() =>
      Promise.resolve({ pending: 0, processing: 0, completed: 0, failed: 0 })
    ),
    ragRetryEmbeddings: vi.fn(() => Promise.resolve({ success: true })),
    reindexIncompatibleMeetings: vi.fn(() => Promise.resolve()),

    // Keybinds
    getKeybinds: vi.fn(() =>
      Promise.resolve<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>([])
    ),
    setKeybind: vi.fn(() => Promise.resolve(true)),
    resetKeybinds: vi.fn(() =>
      Promise.resolve<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>([])
    ),

    // Donation
    getDonationStatus: vi.fn(() =>
      Promise.resolve({ shouldShow: false, hasDonated: false, lifetimeShows: 0 })
    ),
    markDonationToastShown: vi.fn(() => Promise.resolve({ success: true })),
    setDonationComplete: vi.fn(() => Promise.resolve({ success: true })),

    // Profile
    profileUploadResume: vi.fn(() => Promise.resolve({ success: true })),
    profileGetStatus: vi.fn(() =>
      Promise.resolve({ hasProfile: false, profileMode: false })
    ),
    profileSetMode: vi.fn(() => Promise.resolve({ success: true })),
    profileDelete: vi.fn(() => Promise.resolve({ success: true })),
    profileGetProfile: vi.fn(() => Promise.resolve({})),
    profileSelectFile: vi.fn(() => Promise.resolve({ success: true })),
    profileUploadJD: vi.fn(() => Promise.resolve({ success: true })),
    profileDeleteJD: vi.fn(() => Promise.resolve({ success: true })),
    profileResearchCompany: vi.fn(() => Promise.resolve({ success: true })),
    profileGenerateNegotiation: vi.fn(() => Promise.resolve({ success: true })),
    profileGetNegotiationState: vi.fn(() => Promise.resolve({ success: true })),
    profileResetNegotiation: vi.fn(() => Promise.resolve({ success: true })),

    // Tavily
    setTavilyApiKey: vi.fn(() => Promise.resolve({ success: true })),

    // Overlay
    setOverlayMousePassthrough: vi.fn(() => Promise.resolve({ success: true })),
    toggleOverlayMousePassthrough: vi.fn(() =>
      Promise.resolve({ success: true, enabled: false })
    ),

    // Verbose logging
    setVerboseLogging: vi.fn(() => Promise.resolve({ success: true })),

    // Action button
    getActionButtonMode: vi.fn(() => Promise.resolve('recap' as const)),
    setActionButtonMode: vi.fn(() => Promise.resolve()),

    // Provider model discovery
    fetchProviderModels: vi.fn(() => Promise.resolve([])),
    setProviderPreferredModel: vi.fn(() => Promise.resolve()),

    // License
    licenseActivate: vi.fn(() => Promise.resolve({ success: true })),
    licenseCheckPremium: vi.fn(() => Promise.resolve({ isPremium: false })),
    licenseDeactivate: vi.fn(() => Promise.resolve({ success: true })),

    // Cropper (fire-and-forget, no return)
    cropperConfirmed: vi.fn(),
    cropperCancelled: vi.fn(),

    // ===================================================================
    // Event listeners — all return () => void (unsubscribe)
    // ===================================================================
    onScreenshotTaken: listenerMock('onScreenshotTaken'),
    onScreenshotAttached: listenerMock('onScreenshotAttached'),
    onCaptureAndProcess: listenerMock('onCaptureAndProcess'),
    onSolutionsReady: listenerMock('onSolutionsReady'),
    onResetView: listenerMock('onResetView'),
    onSolutionStart: listenerMock('onSolutionStart'),
    onDebugStart: listenerMock('onDebugStart'),
    onDebugSuccess: listenerMock('onDebugSuccess'),
    onDebugError: listenerMock('onDebugError'),
    onSolutionError: listenerMock('onSolutionError'),
    onProcessingNoScreenshots: listenerMock('onProcessingNoScreenshots'),
    onProblemExtracted: listenerMock('onProblemExtracted'),
    onSolutionSuccess: listenerMock('onSolutionSuccess'),
    onUnauthorized: listenerMock('onUnauthorized'),

    onMeetingStateChanged: listenerMock('onMeetingStateChanged'),
    onWindowMaximizedChanged: listenerMock('onWindowMaximizedChanged'),
    onEnsureExpanded: listenerMock('onEnsureExpanded'),
    onToggleExpand: listenerMock('onToggleExpand'),

    onNativeAudioTranscript: listenerMock('onNativeAudioTranscript'),
    onNativeAudioSuggestion: listenerMock('onNativeAudioSuggestion'),
    onNativeAudioConnected: listenerMock('onNativeAudioConnected'),
    onNativeAudioDisconnected: listenerMock('onNativeAudioDisconnected'),

    onSuggestionGenerated: listenerMock('onSuggestionGenerated'),
    onSuggestionProcessingStart: listenerMock('onSuggestionProcessingStart'),
    onSuggestionError: listenerMock('onSuggestionError'),

    onAudioTestLevel: listenerMock('onAudioTestLevel'),
    onMeetingsUpdated: listenerMock('onMeetingsUpdated'),

    // Intelligence events
    onIntelligenceAssistUpdate: listenerMock('onIntelligenceAssistUpdate'),
    onIntelligenceSuggestedAnswer: listenerMock('onIntelligenceSuggestedAnswer'),
    onIntelligenceSuggestedAnswerToken: listenerMock('onIntelligenceSuggestedAnswerToken'),
    onIntelligenceRefinedAnswer: listenerMock('onIntelligenceRefinedAnswer'),
    onIntelligenceRefinedAnswerToken: listenerMock('onIntelligenceRefinedAnswerToken'),
    onIntelligenceRecap: listenerMock('onIntelligenceRecap'),
    onIntelligenceRecapToken: listenerMock('onIntelligenceRecapToken'),
    onIntelligenceClarify: listenerMock('onIntelligenceClarify'),
    onIntelligenceClarifyToken: listenerMock('onIntelligenceClarifyToken'),
    onIntelligenceManualStarted: listenerMock('onIntelligenceManualStarted'),
    onIntelligenceManualResult: listenerMock('onIntelligenceManualResult'),
    onIntelligenceModeChanged: listenerMock('onIntelligenceModeChanged'),
    onIntelligenceError: listenerMock('onIntelligenceError'),
    onIntelligenceFollowUpQuestionsToken: listenerMock('onIntelligenceFollowUpQuestionsToken'),
    onIntelligenceFollowUpQuestionsUpdate: listenerMock('onIntelligenceFollowUpQuestionsUpdate'),
    onSessionReset: listenerMock('onSessionReset'),

    // Streaming
    onGeminiStreamToken: listenerMock('onGeminiStreamToken'),
    onGeminiStreamDone: listenerMock('onGeminiStreamDone'),
    onGeminiStreamError: listenerMock('onGeminiStreamError'),

    // State change listeners
    onUndetectableChanged: listenerMock('onUndetectableChanged'),
    onOverlayMousePassthroughChanged: listenerMock('onOverlayMousePassthroughChanged'),
    onGroqFastTextChanged: listenerMock('onGroqFastTextChanged'),
    onModelChanged: listenerMock('onModelChanged'),

    // Ollama
    onOllamaPullProgress: listenerMock('onOllamaPullProgress'),
    onOllamaPullComplete: listenerMock('onOllamaPullComplete'),

    // Theme
    onThemeChanged: listenerMock('onThemeChanged'),

    // Auto-update
    onUpdateAvailable: listenerMock('onUpdateAvailable'),
    onUpdateDownloaded: listenerMock('onUpdateDownloaded'),
    onUpdateChecking: listenerMock('onUpdateChecking'),
    onUpdateNotAvailable: listenerMock('onUpdateNotAvailable'),
    onUpdateError: listenerMock('onUpdateError'),
    onDownloadProgress: listenerMock('onDownloadProgress'),

    // RAG
    onRAGStreamChunk: listenerMock('onRAGStreamChunk'),
    onRAGStreamComplete: listenerMock('onRAGStreamComplete'),
    onRAGStreamError: listenerMock('onRAGStreamError'),

    // Keybinds
    onKeybindsUpdate: listenerMock('onKeybindsUpdate'),
    onGlobalShortcut: listenerMock('onGlobalShortcut'),

    // Misc
    onIncompatibleProviderWarning: listenerMock('onIncompatibleProviderWarning'),
    onDisguiseChanged: listenerMock('onDisguiseChanged'),
    onSettingsVisibilityChange: listenerMock('onSettingsVisibilityChange'),
    onOverlayOpacityChanged: listenerMock('onOverlayOpacityChanged'),
    onActionButtonModeChanged: listenerMock('onActionButtonModeChanged'),
    onResetCropper: listenerMock('onResetCropper'),
    onSttStatusChanged: listenerMock('onSttStatusChanged'),
  }

  // Apply per-test overrides
  for (const [key, value] of Object.entries(overrides)) {
    mock[key] = value
  }

  return mock
}

// ---------------------------------------------------------------------------
// Singleton reference for install / reset
// ---------------------------------------------------------------------------
let _installedMock: Record<string, any> | null = null

/**
 * Install the mock onto window.electronAPI for renderer tests.
 * Can be called again after resetElectronAPIMock() to re-install.
 */
export function installElectronAPIMock(
  overrides: Partial<Record<string, any>> = {}
): Record<string, any> {
  _installedMock = createElectronAPIMock(overrides)
  Object.defineProperty(window, 'electronAPI', {
    value: _installedMock,
    writable: true,
    configurable: true,
  })
  return _installedMock
}

/**
 * Clear all vi.fn() call history on the installed mock without replacing it.
 * Call this in beforeEach / afterEach to reset call counts between tests.
 */
export function resetElectronAPIMock(): void {
  const mock = _installedMock ?? (window as any).electronAPI
  if (!mock) return

  for (const value of Object.values(mock)) {
    if (typeof value === 'function' && 'mockClear' in value) {
      ;(value as ReturnType<typeof vi.fn>).mockClear()
    }
  }

  // Clear IPC event listeners
  listeners.clear()
}

/**
 * Return the full list of method/property names expected on ElectronAPI.
 * Useful for completeness assertions in tests.
 */
export function getExpectedElectronAPIMethods(): string[] {
  return [
    // Non-function
    'platform',
    // Async void
    'updateContentDimensions',
    'takeScreenshot',
    'moveWindowLeft',
    'moveWindowRight',
    'moveWindowUp',
    'moveWindowDown',
    'windowMinimize',
    'windowMaximize',
    'windowClose',
    'analyzeImageFile',
    'quitApp',
    'showWindow',
    'hideWindow',
    'showOverlay',
    'hideOverlay',
    'toggleModelSelector',
    'forceRestartOllama',
    'toggleSettingsWindow',
    'toggleAdvancedSettings',
    'streamGeminiChat',
    'finalizeMicSTT',
    'setOverlayOpacity',
    'restartAndInstall',
    'checkForUpdates',
    'downloadUpdate',
    // Async boolean
    'windowIsMaximized',
    'getMeetingActive',
    'getOverlayMousePassthrough',
    'getVerboseLogging',
    'getOpenAtLogin',
    'getUndetectable',
    'ragIsMeetingProcessed',
    // Async string
    'getSttProvider',
    'getSttLanguage',
    'getAiResponseLanguage',
    'getArch',
    'getDisguise',
    'generateFollowupEmail',
    'licenseGetHardwareId',
    // Async object
    'getRecognitionLanguages',
    'getScreenshots',
    'takeSelectiveScreenshot',
    'deleteScreenshot',
    'getCurrentLlmConfig',
    'getAvailableOllamaModels',
    'switchToOllama',
    'switchToGemini',
    'testLlmConnection',
    'selectServiceAccount',
    'setGeminiApiKey',
    'setGroqApiKey',
    'setOpenaiApiKey',
    'setClaudeApiKey',
    'setNativelyApiKey',
    'getStoredCredentials',
    'setSttProvider',
    'setGroqSttApiKey',
    'setOpenAiSttApiKey',
    'setDeepgramApiKey',
    'setElevenLabsApiKey',
    'setAzureApiKey',
    'setAzureRegion',
    'setIbmWatsonApiKey',
    'setGroqSttModel',
    'setSonioxApiKey',
    'testSttConnection',
    'generateSuggestion',
    'getInputDevices',
    'getOutputDevices',
    'setRecognitionLanguage',
    'getAiResponseLanguages',
    'setAiResponseLanguage',
    'generateAssist',
    'generateWhatToSay',
    'generateFollowUp',
    'generateRecap',
    'submitManualQuestion',
    'getIntelligenceContext',
    'resetIntelligence',
    'generateClarify',
    'generateCodeHint',
    'generateBrainstorm',
    'generateFollowUpQuestions',
    'startMeeting',
    'endMeeting',
    'getRecentMeetings',
    'getMeetingDetails',
    'updateMeetingTitle',
    'updateMeetingSummary',
    'deleteMeeting',
    'getDefaultModel',
    'setModel',
    'setDefaultModel',
    'getGroqFastTextMode',
    'setGroqFastTextMode',
    'seedDemo',
    'saveCustomProvider',
    'getCustomProviders',
    'deleteCustomProvider',
    'extractEmailsFromTranscript',
    'getCalendarAttendees',
    'openMailto',
    'startAudioTest',
    'stopAudioTest',
    'flushDatabase',
    'toggleWindow',
    'openExternal',
    'setUndetectable',
    'setOpenAtLogin',
    'setDisguise',
    'getNativeAudioStatus',
    'setWindowMode',
    'getThemeMode',
    'setThemeMode',
    'calendarConnect',
    'calendarDisconnect',
    'getCalendarStatus',
    'getUpcomingEvents',
    'calendarRefresh',
    'testReleaseFetch',
    'ragQueryMeeting',
    'ragQueryLive',
    'ragQueryGlobal',
    'ragCancelQuery',
    'ragGetQueueStatus',
    'ragRetryEmbeddings',
    'reindexIncompatibleMeetings',
    'getKeybinds',
    'setKeybind',
    'resetKeybinds',
    'getDonationStatus',
    'markDonationToastShown',
    'setDonationComplete',
    'profileUploadResume',
    'profileGetStatus',
    'profileSetMode',
    'profileDelete',
    'profileGetProfile',
    'profileSelectFile',
    'profileUploadJD',
    'profileDeleteJD',
    'profileResearchCompany',
    'profileGenerateNegotiation',
    'profileGetNegotiationState',
    'profileResetNegotiation',
    'setTavilyApiKey',
    'setOverlayMousePassthrough',
    'toggleOverlayMousePassthrough',
    'setVerboseLogging',
    'getActionButtonMode',
    'setActionButtonMode',
    'fetchProviderModels',
    'setProviderPreferredModel',
    'licenseActivate',
    'licenseCheckPremium',
    'licenseDeactivate',
    // Fire-and-forget
    'cropperConfirmed',
    'cropperCancelled',
    // Event listeners
    'onScreenshotTaken',
    'onScreenshotAttached',
    'onCaptureAndProcess',
    'onSolutionsReady',
    'onResetView',
    'onSolutionStart',
    'onDebugStart',
    'onDebugSuccess',
    'onDebugError',
    'onSolutionError',
    'onProcessingNoScreenshots',
    'onProblemExtracted',
    'onSolutionSuccess',
    'onUnauthorized',
    'onMeetingStateChanged',
    'onWindowMaximizedChanged',
    'onEnsureExpanded',
    'onToggleExpand',
    'onNativeAudioTranscript',
    'onNativeAudioSuggestion',
    'onNativeAudioConnected',
    'onNativeAudioDisconnected',
    'onSuggestionGenerated',
    'onSuggestionProcessingStart',
    'onSuggestionError',
    'onAudioTestLevel',
    'onMeetingsUpdated',
    'onIntelligenceAssistUpdate',
    'onIntelligenceSuggestedAnswer',
    'onIntelligenceSuggestedAnswerToken',
    'onIntelligenceRefinedAnswer',
    'onIntelligenceRefinedAnswerToken',
    'onIntelligenceRecap',
    'onIntelligenceRecapToken',
    'onIntelligenceClarify',
    'onIntelligenceClarifyToken',
    'onIntelligenceManualStarted',
    'onIntelligenceManualResult',
    'onIntelligenceModeChanged',
    'onIntelligenceError',
    'onIntelligenceFollowUpQuestionsToken',
    'onIntelligenceFollowUpQuestionsUpdate',
    'onSessionReset',
    'onGeminiStreamToken',
    'onGeminiStreamDone',
    'onGeminiStreamError',
    'onUndetectableChanged',
    'onOverlayMousePassthroughChanged',
    'onGroqFastTextChanged',
    'onModelChanged',
    'onOllamaPullProgress',
    'onOllamaPullComplete',
    'onThemeChanged',
    'onUpdateAvailable',
    'onUpdateDownloaded',
    'onUpdateChecking',
    'onUpdateNotAvailable',
    'onUpdateError',
    'onDownloadProgress',
    'onRAGStreamChunk',
    'onRAGStreamComplete',
    'onRAGStreamError',
    'onKeybindsUpdate',
    'onGlobalShortcut',
    'onIncompatibleProviderWarning',
    'onDisguiseChanged',
    'onSettingsVisibilityChange',
    'onOverlayOpacityChanged',
    'onActionButtonModeChanged',
    'onResetCropper',
    'onSttStatusChanged',
  ].sort()
}
