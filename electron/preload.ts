import { contextBridge, ipcRenderer } from 'electron';
import type { SkillUploadPayload } from './services/skills/SkillValidator';

/**
 * Metadata the companion extension sends with a captured page (drives the
 * optional "Page context" chip). Mirrors DomCaptureMeta in PhoneMirrorService.
 */
interface DomCaptureMeta {
  title?: string;
  url?: string;
  source?: string;
  pageType?: string;
  firstLine?: string;
}

// Types for the exposed Electron API
interface ElectronAPI {
  updateContentDimensions: (dimensions: { width: number; height: number }) => Promise<void>;
  updateContentDimensionsCentered: (dimensions: { width: number; height: number }) => Promise<void>;
  getRecognitionLanguages: () => Promise<Record<string, any>>;
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>;
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>;
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => () => void;
  onScreenshotAttached: (callback: (data: { path: string; preview: string }) => void) => () => void;
  onCaptureAndProcess: (callback: (data: { path: string; preview: string }) => void) => () => void;
  onSolutionsReady: (callback: (solutions: string) => void) => () => void;
  onResetView: (callback: () => void) => () => void;
  onSolutionStart: (callback: () => void) => () => void;
  onDebugStart: (callback: () => void) => () => void;
  onDebugSuccess: (callback: (data: any) => void) => () => void;
  onSolutionError: (callback: (error: string) => void) => () => void;
  onProcessingNoScreenshots: (callback: () => void) => () => void;
  onProblemExtracted: (callback: (data: any) => void) => () => void;
  onSolutionSuccess: (callback: (data: any) => void) => () => void;

  onUnauthorized: (callback: () => void) => () => void;
  onDebugError: (callback: (error: string) => void) => () => void;
  takeScreenshot: () => Promise<void>;
  takeSelectiveScreenshot: () => Promise<{ path: string; preview: string; cancelled?: boolean }>;
  moveWindowLeft: () => Promise<void>;
  moveWindowRight: () => Promise<void>;
  moveWindowUp: () => Promise<void>;
  moveWindowDown: () => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;

  analyzeImageFile: (path: string) => Promise<void>;
  quitApp: () => Promise<void>;

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{
    provider: 'ollama' | 'gemini';
    model: string;
    isOllama: boolean;
  }>;
  getAvailableOllamaModels: () => Promise<string[]>;
  getProviderStatuses: () => Promise<any[]>;
  getProviderStatus: (id: string) => Promise<any | null>;
  onProviderStatusChanged: (callback: (status: any) => void) => () => void;
  getLocalFallbackPreflight: () => Promise<any | null>;
  runLocalFallbackPreflight: () => Promise<any>;
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>;
  switchToGemini: (
    apiKey?: string,
    modelId?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  testLlmConnection: (
    provider: 'gemini' | 'groq' | 'openai' | 'claude',
    apiKey?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  selectServiceAccount: () => Promise<{
    success: boolean;
    path?: string;
    cancelled?: boolean;
    error?: string;
  }>;

  // API Key Management
  setGeminiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setGroqApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setOpenaiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setClaudeApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setDeepseekApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setLitellmConfig: (config: { apiKey: string; baseURL: string; maxTokens?: number }) => Promise<{ success: boolean; error?: string }>;
  getAvailableLiteLLMModels: () => Promise<string[]>;
  setNativelyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  // ── In-app review / testimonial prompt ─────────────────────────────────
  reviewGetPromptState: () => Promise<{
    ok: boolean;
    local?: {
      has_reviewed: boolean;
      dismissed_count: number;
      dont_show_again: boolean;
      last_prompted_at: string | null;
      last_dismissed_at: string | null;
      next_eligible_at: string | null;
      session_count: number;
      total_usage_ms: number;
    };
    backend?: { ok: boolean; state?: any; eligible?: boolean; reason?: string } | null;
    eligible?: { eligible: boolean; reason: string };
    error?: string;
  }>;
  reviewRecordSession: () => Promise<{ ok: boolean; error?: string }>;
  reviewFlushSession: () => Promise<{ ok: boolean; totals?: { session_count: number; total_usage_ms: number; usage_ms: number; counted: boolean }; error?: string }>;
  reviewMarkShown: () => Promise<{ ok: boolean; error?: string }>;
  reviewDismissLater: () => Promise<{ ok: boolean; error?: string }>;
  reviewDismissForever: () => Promise<{ ok: boolean; error?: string }>;
  reviewSubmit: (payload: { rating: number; review_text: string | null }) => Promise<{ ok: boolean; id?: string; error?: string; status?: number }>;
  reviewUpdateTestimonial: (payload: {
    review_id: string;
    name: string | null;
    role: string | null;
    company: string | null;
    can_use_publicly: boolean;
    display_name_publicly: boolean;
  }) => Promise<{ ok: boolean; error?: string; status?: number }>;
  getNativelyPricing: () => Promise<{
    ok: boolean;
    currency?: string;
    fetchedAt?: string;
    stale?: boolean;
    products?: Record<string, {
      id: string;
      dodoProductId: string;
      name: string;
      amount: number | null;
      currency: string;
      formattedPrice: string | null;
      interval: 'month' | 'year' | 'lifetime';
      checkoutUrl: string;
      coupon: { code: string; eligible: boolean; discountPercent: number; reason?: string };
    }>;
    error?: string;
    status?: number;
  }>;
  getNativelyUsage: () => Promise<{
    ok: boolean;
    plan?: string;
    quota?: {
      transcription: { used: number; limit: number; remaining: number };
      ai: { used: number; limit: number; remaining: number };
      search: { used: number; limit: number; remaining: number };
      resets_at: string;
    };
    member_since?: string;
    error?: string;
    status?: number;
  }>;
  getStoredCredentials: () => Promise<{
    hasGeminiKey: boolean;
    hasGroqKey: boolean;
    hasOpenaiKey: boolean;
    hasClaudeKey: boolean;
    hasDeepseekKey: boolean;
    hasNativelyKey: boolean;
    googleServiceAccountPath: string | null;
    sttProvider: string;
    hasSttGroqKey: boolean;
    hasSttOpenaiKey: boolean;
    hasDeepgramKey: boolean;
    hasElevenLabsKey: boolean;
    hasAzureKey: boolean;
    azureRegion: string;
    hasIbmWatsonKey: boolean;
    ibmWatsonRegion: string;
    hasSonioxKey: boolean;
  }>;
  // Free Trial
  startTrial: () => Promise<{
    ok: boolean;
    hasToken?: boolean;
    started_at?: string;
    expires_at?: string;
    expired?: boolean;
    already_used?: boolean;
    converted_to?: string | null;
    usage?: { ai: number; stt_seconds: number; search: number };
    limits?: {
      duration_ms: number;
      ai_requests: number;
      stt_minutes: number;
      search_requests: number;
    };
    error?: string;
    status?: number;
  }>;
  getTrialStatus: () => Promise<{
    ok: boolean;
    expired?: boolean;
    remaining_ms?: number;
    started_at?: string;
    expires_at?: string;
    converted_to?: string | null;
    usage?: { ai: number; stt_seconds: number; search: number };
    limits?: object;
    error?: string;
  }>;
  getLocalTrial: () => Promise<{
    hasToken: boolean;
    trialClaimed?: boolean;
    expiresAt?: string;
    startedAt?: string;
    expired?: boolean;
  }>;
  convertTrial: (choice: string) => Promise<{ ok: boolean }>;
  endTrialByok: () => Promise<{ success: boolean; error?: string }>;
  onTrialEnded: (cb: (data: { choice: string }) => void) => () => void;
  onModesActiveCleared: (cb: () => void) => () => void;

  // STT Provider Management
  setSttProvider: (
    provider:
      | 'none'
      | 'google'
      | 'groq'
      | 'openai'
      | 'deepgram'
      | 'elevenlabs'
      | 'azure'
      | 'ibmwatson'
      | 'soniox'
      | 'natively'
      | 'local-whisper',
  ) => Promise<{ success: boolean; error?: string }>;
  localWhisperGetModels: () => Promise<{ models: any[]; activeModelId: string }>;
  localWhisperGetRecoveryNotice: () => Promise<{
    recovered: true;
    badModelId: string;
    fallbackModelId: string;
    message: string;
  } | null>;
  // Generalized ONNX load-sentinel recovery surface (intent / embeddings /
  // reranker). Whisper keeps its dedicated banner; the other three families
  // share a single channel keyed by `family`.
  onnxGetRecoveryNotice: (family: 'whisper' | 'intent' | 'embeddings' | 'reranker') => Promise<{
    family: 'whisper' | 'intent' | 'embeddings' | 'reranker';
    badModelId: string;
    message: string;
  } | null>;
  onnxResetFamily: (family: 'whisper' | 'intent' | 'embeddings' | 'reranker') => Promise<{ success: boolean; error?: string }>;
  localWhisperSetModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  localWhisperResetToDefault: () => Promise<{ success: boolean; error?: string; modelId?: string }>;
  localWhisperGetChannelConfig: () => Promise<{
    enabled: boolean;
    micModelId: string;
    systemModelId: string;
    globalModelId: string;
  }>;
  localWhisperSetChannelConfig: (cfg: {
    enabled?: boolean;
    micModelId?: string;
    systemModelId?: string;
    globalModelId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  localWhisperDeleteModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  localWhisperStartDownload: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  onLocalWhisperDownloadProgress: (
    callback: (data: { modelId: string; progress: number }) => void,
  ) => () => void;
  onLocalWhisperDownloadComplete: (callback: (data: { modelId: string }) => void) => () => void;
  onLocalWhisperDownloadError: (
    callback: (data: { modelId: string; error: string }) => void,
  ) => () => void;
  localWhisperPreload: (
    modelId?: string,
  ) => Promise<{ success: boolean; reason?: string; error?: string }>;
  localWhisperGetHardware: () => Promise<{
    arch: string;
    platform: string;
    cpuModel: string;
    isAppleSilicon: boolean;
    totalRamGb: number;
    tier: string;
    recommendation: string;
    recommendedModel: string;
  }>;
  getSttProvider: () => Promise<string>;
  setGroqSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setOpenAiSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setOpenAiSttBaseUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
  setDeepgramApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setElevenLabsApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setAzureApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setAzureRegion: (region: string) => Promise<{ success: boolean; error?: string }>;
  setIbmWatsonApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setGroqSttModel: (model: string) => Promise<{ success: boolean; error?: string }>;
  setSonioxApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setIbmWatsonRegion: (region: string) => Promise<{ success: boolean; error?: string }>;
  testSttConnection: (
    provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
    apiKey: string,
    region?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // STT Config Events
  onSttConfigChanged: (
    callback: (data: { configured: boolean; provider: string }) => void,
  ) => () => void;
  onCredentialsChanged: (callback: () => void) => () => void;

  // Native Audio Service Events
  onNativeAudioTranscript: (
    callback: (transcript: { speaker: string; text: string; final: boolean }) => void,
  ) => () => void;
  onNativeAudioSuggestion: (
    callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void,
  ) => () => void;
  onNativeAudioConnected: (callback: () => void) => () => void;
  onNativeAudioDisconnected: (callback: () => void) => () => void;
  onSuggestionGenerated: (
    callback: (data: { question: string; suggestion: string; confidence: number }) => void,
  ) => () => void;
  onSuggestionProcessingStart: (callback: () => void) => () => void;
  onSuggestionError: (callback: (error: { error: string }) => void) => () => void;
  generateSuggestion: (context: string, lastQuestion: string) => Promise<{ suggestion: string }>;
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>;
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>;
  setRecognitionLanguage: (key: string) => Promise<{ success: boolean; error?: string }>;
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>;
  setAiResponseLanguage: (language: string) => Promise<{ success: boolean; error?: string }>;
  getSttLanguage: () => Promise<string>;
  getAiResponseLanguage: () => Promise<string>;
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => () => void;
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => () => void;
  getSystemAudioPermissionWarning: () => Promise<string | null>;
  onDeviceSelectionApplied: (
    callback: (payload: {
      kind: 'input' | 'output';
      requested: string | null;
      actual: string | null;
      fellBack: boolean;
      reason?: string;
    }) => void,
  ) => () => void;
  onAudioCaptureFailed: (
    callback: (payload: {
      channel: 'system' | 'mic';
      message: string;
      attempt: number;
      maxAttempts: number;
      terminal?: boolean;
      stuck?: boolean;
    }) => void,
  ) => () => void;
  onAudioInputAutoSwitched: (
    callback: (payload: { from: string; to: string; reason: string; message?: string }) => void,
  ) => () => void;

  // STT Status Events
  onSttStatusChanged: (
    callback: (data: {
      state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
      provider: string;
      error?: string;
      channel: 'user' | 'interviewer';
      reconnectAttempts?: number;
    }) => void,
  ) => () => void;

  // Intelligence Mode IPC
  generateAssist: () => Promise<{ insight: string | null }>;
  generateWhatToSay: (
    question?: string,
    imagePaths?: string[],
    options?: { promptInstruction?: string; domContext?: string; domContextEnvelope?: unknown },
  ) => Promise<{
    answer: string | null;
    question?: string;
    error?: string;
    screenContextStatus?: 'not_available' | 'available' | 'failed';
    ocrTextLength?: number;
    imageCount?: number;
    usedImageInput?: boolean;
  }>;
  generateFollowUp: (
    intent: string,
    userRequest?: string,
  ) => Promise<{ refined: string | null; intent: string }>;
  generateRecap: () => Promise<{ summary: string | null }>;
  submitManualQuestion: (question: string) => Promise<{ answer: string | null; question: string }>;
  getIntelligenceContext: () => Promise<{
    context: string;
    lastAssistantMessage: string | null;
    activeMode: string;
  }>;
  testInjectTranscript: (segment: {
    speaker: string;
    text: string;
    timestamp?: number;
    final?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  testGetModeContext: () => Promise<{
    success: boolean;
    block?: string;
    suffix?: string;
    error?: string;
  }>;
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>;

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>;
  endMeeting: () => Promise<{ success: boolean; error?: string }>;
  finalizeMicSTT: () => Promise<void>;
  getRecentMeetings: () => Promise<
    Array<{ id: string; title: string; date: string; duration: string; summary: string }>
  >;
  getMeetingDetails: (id: string) => Promise<any>;
  searchGlobalMeetings: (query: string, filters?: any) => Promise<{ enabled: boolean; results: any[] }>;
  searchInMeeting: (query: string) => Promise<{ enabled: boolean; results: any[] }>;
  generateLectureNotes: (opts?: { title?: string; course?: string }) => Promise<{ enabled: boolean; notes: any }>;
  generateDiagram: (text?: string) => Promise<{ enabled: boolean; diagram: any }>;
  getIntelligenceFlags: () => Promise<Array<{ key: string; enabled: boolean; setting: string; env: string; default: boolean }>>;
  setIntelligenceFlag: (key: string, value: boolean | null) => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
  getHindsightConfig: () => Promise<{ baseUrl: string; hasApiKey: boolean; autoStart: boolean; serverCommand: string; llmProvider: string; available: boolean; mode: 'local' | 'cloud'; synthetic: boolean; explicitlyDisabled: boolean; authFailed: boolean }>;
  setHindsightConfig: (cfg: { baseUrl?: string; apiKey?: string; autoStart?: boolean; serverCommand?: string; llmProvider?: string }) => Promise<{ success: boolean; healthy?: boolean; error?: string }>;
  testHindsightConnection: () => Promise<{ healthy: boolean; error?: string }>;
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>;
  updateMeetingSummary: (
    id: string,
    updates: {
      overview?: string;
      actionItems?: string[];
      keyPoints?: string[];
      actionItemsTitle?: string;
      keyPointsTitle?: string;
    },
  ) => Promise<boolean>;
  onMeetingsUpdated: (callback: () => void) => () => void;

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void;
  onIntelligenceSuggestedAnswer: (
    callback: (data: { answer: string; question: string; confidence: number }) => void,
  ) => () => void;
  onIntelligenceSuggestedAnswerDiscard: (
    callback: (data: { reason: string }) => void,
  ) => () => void;
  onIntelligenceCodeVerified: (
    callback: (data: { question: string; passed: number; total: number; language: string }) => void,
  ) => () => void;
  onIntelligenceCodeCorrection: (
    callback: (data: { question: string; answer: string; note: string; reVerified: boolean }) => void,
  ) => () => void;
  onIntelligenceRefinedAnswer: (
    callback: (data: { answer: string; intent: string }) => void,
  ) => () => void;
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void;
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void;
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => () => void;
  onIntelligenceManualStarted: (callback: () => void) => () => void;
  onIntelligenceManualResult: (
    callback: (data: { answer: string; question: string }) => void,
  ) => () => void;
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void;
  onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => () => void;
  // Sprint 7: dedicated negotiation-coaching channel. Replaces the
  // sentinel-string multiplex through suggested_answer_token / suggested_answer.
  onIntelligenceNegotiationCoaching: (callback: (data: { payload: any }) => void) => () => void;
  // Sprint 9: time-batched IPC token channel. Carries a batch of streaming
  // tokens for ANY of the 5 streaming kinds in one IPC send. Replaces
  // per-token sends to the 5 individual channels (which still exist as
  // unused defense-in-depth bridges).
  onIntelligenceTokenBatch: (
    callback: (data: {
      kind: 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions';
      items: any[];
    }) => void,
  ) => () => void;

  // Model Management
  getDefaultModel: () => Promise<{ model: string }>;
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  toggleModelSelector: (coords: { x: number; y: number; activate?: boolean }) => Promise<void>;
  modelSelectorCloseIfOpen: () => Promise<void>;
  forceRestartOllama: () => Promise<void>;
  isOllamaReachable: () => Promise<boolean>;

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>;

  // Groq Fast Text Mode
  getGroqFastTextMode: () => Promise<{ enabled: boolean }>;
  setGroqFastTextMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  getCodexCliConfig: () => Promise<{
    enabled: boolean;
    path: string;
    model: string;
    fastModel: string;
    timeoutMs: number;
    sandboxMode?: string;
    serviceTier?: string;
    modelReasoningEffort?: string;
  }>;
  setCodexCliConfig: (config: {
    enabled: boolean;
    path: string;
    model: string;
    fastModel: string;
    timeoutMs: number;
    sandboxMode?: string;
    serviceTier?: string;
    modelReasoningEffort?: string;
  }) => Promise<{
    success: boolean;
    error?: string;
    config?: {
      enabled: boolean;
      path: string;
      model: string;
      fastModel: string;
      timeoutMs: number;
      sandboxMode?: string;
      serviceTier?: string;
      modelReasoningEffort?: string;
    };
  }>;
  testCodexCli: (config?: {
    enabled?: boolean;
    path?: string;
    model?: string;
    fastModel?: string;
    timeoutMs?: number;
    sandboxMode?: string;
    serviceTier?: string;
    modelReasoningEffort?: string;
  }) => Promise<{
    success: boolean;
    error?: string;
    resolvedPath?: string;
    config?: {
      enabled: boolean;
      path: string;
      model: string;
      fastModel: string;
      timeoutMs: number;
      sandboxMode?: string;
      serviceTier?: string;
      modelReasoningEffort?: string;
    };
  }>;
  codexCliAuthStatus: (config?: any) => Promise<{ success: boolean; action: string; output?: string; error?: string; resolvedPath?: string; config?: any }>;
  codexCliLogout: (config?: any) => Promise<{ success: boolean; action: string; output?: string; error?: string; resolvedPath?: string; config?: any }>;
  codexCliLogin: (config?: any) => Promise<{ success: boolean; action: string; output?: string; error?: string; resolvedPath?: string; config?: any }>;
  codexCliDoctor: (config?: any) => Promise<{ success: boolean; action: string; output?: string; error?: string; resolvedPath?: string; config?: any }>;
  // ChatGPT OAuth IPCs — replace the old `codex login` CLI subprocess flow.
  // startLogin kicks off the PKCE flow + opens the system browser; the
  // renderer listens for codex:login:complete / :failed events to update UI.
  codexLoginStatus: () => Promise<{ success: boolean; signedIn: boolean; email?: string; expiresAt?: number; error?: string }>;
  codexStartLogin: () => Promise<{ success: boolean; email?: string; expiresAt?: number; error?: string }>;
  codexSignOut: () => Promise<{ success: boolean; error?: string }>;
  codexRefreshTokens: () => Promise<{ success: boolean; email?: string; expiresAt?: number; error?: string }>;

  // Demo
  seedDemo: () => Promise<{ success: boolean }>;

  // Custom Providers
  saveCustomProvider: (provider: any) => Promise<{ success: boolean; id?: string; error?: string }>;
  getCustomProviders: () => Promise<any[]>;
  deleteCustomProvider: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Follow-up Email
  generateFollowupEmail: (input: any) => Promise<string>;
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => Promise<string[]>;
  getCalendarAttendees: (eventId: string) => Promise<Array<{ email: string; name: string }>>;
  openMailto: (params: {
    to: string;
    subject: string;
    body: string;
  }) => Promise<{ success: boolean; error?: string }>;

  // Audio Test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>;
  stopAudioTest: () => Promise<{ success: boolean }>;
  onAudioTestLevel: (callback: (level: number) => void) => () => void;
  // UX4: parallel system-audio probe — system audio level + error events
  // emitted during the same startAudioTest lifecycle.
  onAudioTestSystemLevel: (callback: (level: number) => void) => () => void;
  onAudioTestSystemError: (callback: (errorMessage: string) => void) => () => void;

  // Database
  flushDatabase: () => Promise<{ success: boolean }>;
  showWindow: () => Promise<void>;
  hideWindow: () => Promise<void>;
  showOverlay: () => Promise<void>;
  hideOverlay: () => Promise<void>;
  getMeetingActive: () => Promise<boolean>;
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => () => void;
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void;
  onEnsureExpanded: (callback: () => void) => () => void;
  onToggleExpand: (callback: () => void) => () => void;
  toggleAdvancedSettings: () => Promise<void>;
  openSettingsTab: (tab: string) => Promise<void>;
  onOpenSettingsTab: (callback: (tab: string) => void) => () => void;
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>;
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>;
  getOverlayMousePassthrough: () => Promise<boolean>;
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void;

  // Streaming listeners
  streamGeminiChat: (
    message: string,
    imagePaths?: string[],
    context?: string,
    options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean },
  ) => Promise<void>;
  onGeminiStreamToken: (callback: (token: string, meta?: { streamId?: number }) => void) => () => void;
  onGeminiStreamDone: (callback: (data?: { finalText?: string; streamId?: number }) => void) => () => void;
  onGeminiStreamError: (callback: (error: string) => void) => () => void;

  onUndetectableChanged: (callback: (state: boolean) => void) => () => void;
  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => () => void;
  onModelChanged: (callback: (modelId: string) => void) => () => void;

  // Ollama
  onOllamaPullProgress: (
    callback: (data: { status: string; percent: number }) => void,
  ) => () => void;
  onOllamaPullComplete: (callback: () => void) => () => void;

  // Theme API
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }>;
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>;
  onThemeChanged: (
    callback: (data: { mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }) => void,
  ) => () => void;

  // Calendar
  calendarConnect: () => Promise<{ success: boolean; error?: string }>;
  calendarDisconnect: () => Promise<{ success: boolean; error?: string }>;
  getCalendarStatus: () => Promise<{ connected: boolean; email?: string }>;
  getUpcomingEvents: () => Promise<
    Array<{
      id: string;
      title: string;
      startTime: string;
      endTime: string;
      link?: string;
      source: 'google';
    }>
  >;
  calendarRefresh: () => Promise<{ success: boolean; error?: string }>;

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => () => void;
  onUpdateDownloaded: (callback: (info: any) => void) => () => void;
  onUpdateChecking: (callback: () => void) => () => void;
  onUpdateNotAvailable: (callback: (info: any) => void) => () => void;
  onUpdateError: (callback: (err: string) => void) => () => void;
  onDownloadProgress: (callback: (progressObj: any) => void) => () => void;
  restartAndInstall: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  getCanAutoUpdate: () => Promise<{ canAutoUpdate: boolean }>;
  testReleaseFetch: () => Promise<{ success: boolean; error?: string }>;

  // RAG (Retrieval-Augmented Generation) API
  ragQueryMeeting: (
    meetingId: string,
    query: string,
  ) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>;
  ragQueryLive: (
    query: string,
  ) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>;
  ragQueryGlobal: (
    query: string,
  ) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>;
  ragCancelQuery: (options: {
    meetingId?: string;
    global?: boolean;
  }) => Promise<{ success: boolean }>;
  ragIsMeetingProcessed: (meetingId: string) => Promise<boolean>;
  ragGetQueueStatus: () => Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }>;
  ragRetryEmbeddings: () => Promise<{ success: boolean }>;
  onRAGStreamChunk: (
    callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void,
  ) => () => void;
  onRAGStreamComplete: (
    callback: (data: { meetingId?: string; global?: boolean }) => void,
  ) => () => void;
  onRAGStreamError: (
    callback: (data: { meetingId?: string; global?: boolean; error: string }) => void,
  ) => () => void;

  // Keybind Management
  getKeybinds: () => Promise<
    Array<{
      id: string;
      label: string;
      accelerator: string;
      isGlobal: boolean;
      defaultAccelerator: string;
    }>
  >;
  setKeybind: (id: string, accelerator: string) => Promise<boolean>;
  resetKeybinds: () => Promise<
    Array<{
      id: string;
      label: string;
      accelerator: string;
      isGlobal: boolean;
      defaultAccelerator: string;
    }>
  >;
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void;

  // Global shortcut events (stealth: fired even when window is not focused)
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void;

  // CGEventTap-backed stealth keyboard tap (macOS only). Returns false on
  // non-macOS or when the native module / Accessibility permission is missing.
  // M5 cleanup: three dead query-style IPCs were removed — they never had
  // main-side handlers; tap state arrives via onStealthTapState instead.
  stealthTapAvailable: () => Promise<boolean>;
  stealthTapOpenSettings: () => Promise<void>;
  stealthTapStop: () => Promise<void>;
  stealthTapStart: () => Promise<boolean>;
  /** False on macOS when a composition IME (Pinyin/Hangul/Kanji/…) is
   *  enabled — the tap captures below the IME and breaks composition, so
   *  the renderer falls back to plain DOM focus on click. */
  stealthTapShouldAutoEngage: () => Promise<boolean>;
  onStealthTapState: (cb: (state: { active: boolean; reason?: string }) => void) => () => void;
  onStealthKeyCaptured: (
    cb: (ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean }) => void,
  ) => () => void;

  // Donation API
  getDonationStatus: () => Promise<{
    shouldShow: boolean;
    hasDonated: boolean;
    lifetimeShows: number;
  }>;
  markDonationToastShown: () => Promise<{ success: boolean }>;
  setDonationComplete: () => Promise<{ success: boolean }>;

  // Profile Engine API
  profileUploadResume: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  profileGetStatus: () => Promise<{
    hasProfile: boolean;
    profileMode: boolean;
    name?: string;
    role?: string;
    totalExperienceYears?: number;
  }>;
  profileSetMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  profileDelete: () => Promise<{ success: boolean; error?: string }>;
  profileGetProfile: () => Promise<any>;
  profileSelectFile: () => Promise<{
    success?: boolean;
    cancelled?: boolean;
    filePath?: string;
    error?: string;
  }>;

  // JD & Research API
  profileUploadJD: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  profileDeleteJD: () => Promise<{ success: boolean; error?: string }>;
  // OKF Profile Intelligence (2026-07-02).
  knowledgeExportProfilePack: () => Promise<{ success: boolean; path?: string; fileCount?: number; error?: string; violations?: Array<{ path: string; reason: string }> }>;
  knowledgeListProfilePacks: () => Promise<{ success: boolean; error?: string; packs: Array<{ id: string; fileName: string; cardCount: number; entityCount: number; packVersion: number; updatedAt: string; cardsByType: Record<string, number> }> }>;
  knowledgeGetProfilePack: (kind: string) => Promise<{ success: boolean; error?: string; pack?: { id: string; fileName: string; packVersion: number; updatedAt: string; cards: Array<{ id: string; type: string; title: string; conceptId: string; body: string; confidence: string; tags: string[]; entities: string[]; sourceQuotes: string[]; pii: boolean }> } }>;
  profileResearchCompany: (
    companyName: string,
  ) => Promise<{ success: boolean; dossier?: any; error?: string }>;
  profileGenerateNegotiation: (
    force?: boolean,
  ) => Promise<{ success: boolean; script?: any; error?: string }>;
  profileGetNegotiationState: () => Promise<{
    success: boolean;
    state?: any;
    isActive?: boolean;
    error?: string;
  }>;
  profileResetNegotiation: () => Promise<{ success: boolean; error?: string }>;

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Verbose / Debug Logging
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  getMeetingRetention: () => Promise<'forever' | '7d' | '30d' | 'never'>;
  setMeetingRetention: (
    retention: 'forever' | '7d' | '30d' | 'never',
  ) => Promise<{ success: boolean; error?: string }>;
  onMeetingRetentionChanged: (
    callback: (retention: 'forever' | '7d' | '30d' | 'never') => void,
  ) => () => void;
  getProviderDataScopes: () => Promise<{
    transcript?: boolean;
    screenshots?: boolean;
    reference_files?: boolean;
    profile_history?: boolean;
    embeddings?: boolean;
    post_call_summary?: boolean;
  }>;
  setProviderDataScopes: (scopes: {
    transcript?: boolean;
    screenshots?: boolean;
    reference_files?: boolean;
    profile_history?: boolean;
    embeddings?: boolean;
    post_call_summary?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  onProviderDataScopesChanged: (
    callback: (scopes: {
      transcript?: boolean;
      screenshots?: boolean;
      reference_files?: boolean;
      profile_history?: boolean;
      embeddings?: boolean;
      post_call_summary?: boolean;
    }) => void,
  ) => () => void;
  getScreenUnderstandingMode: () => Promise<'vision_first' | 'vision_only' | 'private_vision'>;
  setScreenUnderstandingMode: (
    mode: 'vision_first' | 'vision_only' | 'private_vision',
  ) => Promise<{ success: boolean; error?: string }>;
  onScreenUnderstandingModeChanged: (
    callback: (mode: 'vision_first' | 'vision_only' | 'private_vision') => void,
  ) => () => void;
  getTechnicalInterviewVisionFirst: () => Promise<boolean>;
  setTechnicalInterviewVisionFirst: (
    enabled: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  onTechnicalInterviewVisionFirstChanged: (callback: (enabled: boolean) => void) => () => void;
  /** @deprecated alias for technicalInterviewVisionFirst — retained so older renderer builds keep working. */
  getTechnicalInterviewDirectVision: () => Promise<boolean>;
  /** @deprecated alias for technicalInterviewVisionFirst — retained so older renderer builds keep working. */
  setTechnicalInterviewDirectVision: (
    enabled: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  /** @deprecated alias for technicalInterviewVisionFirstChanged — retained so older renderer builds keep working. */
  onTechnicalInterviewDirectVisionChanged: (callback: (enabled: boolean) => void) => () => void;
  getLogFilePath: () => Promise<string | null>;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;

  // Onboarding & gate persistent backup flags
  onboardingGetFlags: () => Promise<{
    seenStartup: boolean;
    seenProfileOnboarding: boolean;
    seenModesOnboarding: boolean;
    permsShown: boolean;
  }>;
  onboardingSetFlag: (
    key: 'seenStartup' | 'seenProfileOnboarding' | 'seenModesOnboarding' | 'permsShown',
    value: boolean,
  ) => Promise<{ success: boolean; error?: string }>;

  // Arch
  getArch: () => Promise<string>;
  getOsVersion: () => Promise<string>;

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => void;
  cropperCancelled: () => void;
  onResetCropper: (
    callback: (data: { hudPosition: { x: number; y: number } }) => void,
  ) => () => void;

  // Platform
  platform: NodeJS.Platform;

  // Modes API
  modesGetAll: () => Promise<
    Array<{
      id: string;
      name: string;
      templateType: string;
      customContext: string;
      isActive: boolean;
      createdAt: string;
      referenceFileCount: number;
    }>
  >;
  modesGetActive: () => Promise<{
    id: string;
    name: string;
    templateType: string;
    customContext: string;
    isActive: boolean;
    createdAt: string;
  } | null>;
  modesCreate: (params: {
    name: string;
    templateType: string;
  }) => Promise<{ success: boolean; mode?: any; error?: string }>;
  modesGenerateFromBrief: (params: {
    brief: string;
    requiresGrounding?: boolean;
    templateHint?: string;
    key?: string;
    persist?: boolean;
  }) => Promise<{
    success: boolean;
    mode?: any;
    draft?: any;
    attempts?: number;
    issues?: any[];
    persisted?: boolean;
    error?: string;
  }>;
  e2eInvoke: (channel: string, ...args: any[]) => Promise<any>;
  modesUpdate: (
    id: string,
    updates: { name?: string; templateType?: string; customContext?: string },
  ) => Promise<{ success: boolean; error?: string }>;
  modesDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
  modesSetActive: (id: string | null) => Promise<{ success: boolean; error?: string }>;
  modesGetReferenceFiles: (
    modeId: string,
  ) => Promise<
    Array<{ id: string; modeId: string; fileName: string; content: string; createdAt: string }>
  >;
  modesUploadReferenceFile: (
    modeId: string,
  ) => Promise<{ success: boolean; cancelled?: boolean; file?: any; error?: string }>;
  modesDeleteReferenceFile: (id: string) => Promise<{ success: boolean; error?: string }>;
  modesGetReferenceFileStatus: (
    modeId: string,
  ) => Promise<{ success: boolean; statuses?: Array<{ fileId: string; fileName: string; status: string; chunkCount: number }>; error?: string }>;
  onModeFileIndexStatus: (callback: (data: { modeId: string; fileId?: string }) => void) => () => void;
  onKnowledgeIndexProgress: (callback: (data: { fileId: string; status: string; startedAt?: number; finishedAt?: number; error?: string }) => void) => () => void;
  knowledgeListPacks: (modeId: string) => Promise<{ success: boolean; packs: Array<{ id: string; sourceId: string; fileName: string; cardCount: number; entityCount: number; relationCount: number; packVersion: number; updatedAt: string }>; error?: string }>;
  knowledgeGetPack: (fileId: string) => Promise<{ success: boolean; pack: any | null; error?: string }>;
  knowledgeRegeneratePack: (params: { fileId: string; modeId: string; fileName: string }) => Promise<{ success: boolean; status?: string; pack?: any; error?: string }>;
  knowledgeExportPack: (fileId: string) => Promise<{ success: boolean; cancelled?: boolean; exportedFileCount?: number; destRoot?: string; error?: string }>;
  knowledgeEditCard: (params: { cardId: string; title?: string; body?: string; entities?: string[]; tags?: string[] }) => Promise<{ success: boolean; card?: any; error?: string }>;
  knowledgeApproveCard: (cardId: string) => Promise<{ success: boolean; card?: any; error?: string }>;
  knowledgeRejectCard: (cardId: string) => Promise<{ success: boolean; card?: any; error?: string }>;
  knowledgeRestoreCardVersion: (params: { cardId: string; versionId: string }) => Promise<{ success: boolean; card?: any; error?: string }>;
  knowledgeGetCardHistory: (cardId: string) => Promise<{ success: boolean; versions: any[]; error?: string }>;
  modesGetNoteSections: (modeId: string) => Promise<
    Array<{
      id: string;
      modeId: string;
      title: string;
      description: string;
      sortOrder: number;
      createdAt: string;
    }>
  >;
  modesAddNoteSection: (
    modeId: string,
    title: string,
    description: string,
  ) => Promise<{ success: boolean; section?: any; error?: string }>;
  modesUpdateNoteSection: (
    id: string,
    updates: { title?: string; description?: string },
  ) => Promise<{ success: boolean; error?: string }>;
  modesDeleteNoteSection: (id: string) => Promise<{ success: boolean; error?: string }>;
  modesRemoveAllNoteSections: (modeId: string) => Promise<{ success: boolean; error?: string }>;

  // Meeting interface theme — cross-window propagation. The settings window
  // writes the new theme to localStorage and calls `setMeetingInterfaceTheme`,
  // which sends an IPC to main; main re-broadcasts to every window so the
  // overlay window's React state stays in sync with the launcher's. Without
  // this, the overlay reads stale theme on next meeting start (half-paint hang).
  setMeetingInterfaceTheme: (theme: string) => void;
  onMeetingInterfaceThemeChanged: (callback: (theme: string) => void) => () => void;

  // Cancel the in-flight gemini-chat-stream. Renderer wires this to "drop
  // the current answer" user actions (Escape, navigation, chat-overlay unmount).
  // Without explicit cancel the chat IPC handler keeps streaming tokens that
  // the renderer silently discards — wasting provider quota and feeling slow
  // because a subsequent question's first token has to wait for the prior
  // response to drain through the supersession check.
  cancelChatStream: () => void;
  onDomContextReceived: (
    callback: (dom: string, meta?: DomCaptureMeta, envelope?: unknown) => void,
  ) => () => void;

  // Skills — types live in the interface so the IPC contract is type-checked
  // at preload-build time. The actual upload/outcome types are mirrored
  // (structurally compatible) in src/types/electron.d.ts.
  skillsRefresh: () => Promise<unknown[]>;
  skillsOpenFolder: () => Promise<{ success: boolean; path: string; error?: string }>;
  skillsDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
  skillsUpload: (
    payload: SkillUploadPayload,
    opts?: { autoInstall?: boolean }
  ) => Promise<unknown>;
  skillsPreview: (payload: SkillUploadPayload) => Promise<unknown>;
}

export const PROCESSING_EVENTS = {
  //global states
  UNAUTHORIZED: 'procesing-unauthorized',
  NO_SCREENSHOTS: 'processing-no-screenshots',

  //states for generating the initial solution
  INITIAL_START: 'initial-start',
  PROBLEM_EXTRACTED: 'problem-extracted',
  SOLUTION_SUCCESS: 'solution-success',
  INITIAL_SOLUTION_ERROR: 'solution-error',

  //states for processing the debugging
  DEBUG_START: 'debug-start',
  DEBUG_SUCCESS: 'debug-success',
  DEBUG_ERROR: 'debug-error',
} as const;

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // ── TEST-ONLY eval bridges (gated in main by NODE_ENV==='test') ──────────────
  // Exposed unconditionally but inert in production: the underlying IPC handlers
  // ('test-inject-transcript') refuse unless NODE_ENV==='test'. Used by the real
  // UI eval (intelligence-eval-real-ui) to feed the production transcript path
  // and read profile debug metadata WITHOUT bypassing the UI or leaking content.
  __evalInjectTranscript: (segment: { speaker: string; text: string; timestamp?: number; final?: boolean }) =>
    ipcRenderer.invoke('test-inject-transcript', segment),
  __evalProfileDebug: () => ipcRenderer.invoke('profile:get-status'),
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke('update-content-dimensions', dimensions),
  updateContentDimensionsCentered: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke('update-content-dimensions-centered', dimensions),
  getRecognitionLanguages: () => ipcRenderer.invoke('get-recognition-languages'),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  takeSelectiveScreenshot: () => ipcRenderer.invoke('take-selective-screenshot'),
  getScreenshots: () => ipcRenderer.invoke('get-screenshots'),
  deleteScreenshot: (path: string) => ipcRenderer.invoke('delete-screenshot', path),

  // Event listeners
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data);
    ipcRenderer.on('screenshot-taken', subscription);
    return () => {
      ipcRenderer.removeListener('screenshot-taken', subscription);
    };
  },
  onScreenshotAttached: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data);
    ipcRenderer.on('screenshot-attached', subscription);
    return () => {
      ipcRenderer.removeListener('screenshot-attached', subscription);
    };
  },
  onCaptureAndProcess: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data);
    ipcRenderer.on('capture-and-process', subscription);
    return () => {
      ipcRenderer.removeListener('capture-and-process', subscription);
    };
  },
  onSolutionsReady: (callback: (solutions: string) => void) => {
    const subscription = (_: any, solutions: string) => callback(solutions);
    ipcRenderer.on('solutions-ready', subscription);
    return () => {
      ipcRenderer.removeListener('solutions-ready', subscription);
    };
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('reset-view', subscription);
    return () => {
      ipcRenderer.removeListener('reset-view', subscription);
    };
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription);
    };
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription);
    };
  },

  onDebugSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('debug-success', subscription);
    return () => {
      ipcRenderer.removeListener('debug-success', subscription);
    };
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
    };
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription);
    };
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription);
    };
  },

  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription);
    };
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription);
    };
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription);
    };
  },
  moveWindowLeft: () => ipcRenderer.invoke('move-window-left'),
  moveWindowRight: () => ipcRenderer.invoke('move-window-right'),
  moveWindowUp: () => ipcRenderer.invoke('move-window-up'),
  moveWindowDown: () => ipcRenderer.invoke('move-window-down'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  analyzeImageFile: (path: string) => ipcRenderer.invoke('analyze-image-file', path),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  toggleWindow: () => ipcRenderer.invoke('toggle-window'),
  showWindow: (inactive?: boolean) => ipcRenderer.invoke('show-window', inactive),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showOverlay: () => ipcRenderer.invoke('show-overlay'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  getMeetingActive: () => ipcRenderer.invoke('get-meeting-active'),
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => {
    const subscription = (_: any, data: { isActive: boolean }) => callback(data);
    ipcRenderer.on('meeting-state-changed', subscription);
    return () => {
      ipcRenderer.removeListener('meeting-state-changed', subscription);
    };
  },
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const subscription = (_: any, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-maximized-changed', subscription);
    return () => {
      ipcRenderer.removeListener('window-maximized-changed', subscription);
    };
  },
  onEnsureExpanded: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('ensure-expanded', subscription);
    return () => {
      ipcRenderer.removeListener('ensure-expanded', subscription);
    };
  },
  toggleAdvancedSettings: () => ipcRenderer.invoke('toggle-advanced-settings'),
  openSettingsTab: (tab: string) => ipcRenderer.invoke('settings:open-tab', tab),
  onOpenSettingsTab: (callback: (tab: string) => void) => {
    const subscription = (_: any, tab: string) => callback(tab);
    ipcRenderer.on('settings:open-tab', subscription);
    return () => {
      ipcRenderer.removeListener('settings:open-tab', subscription);
    };
  },
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  // UX2: in-app TCC repair. Returns { ok, bundleId, results, promptRelaunch, message }.
  // Renderer should show the `message` and prompt the user to fully quit and reopen.
  repairTccPermissions: () => ipcRenderer.invoke('repair-tcc-permissions'),
  setUndetectable: (state: boolean) => ipcRenderer.invoke('set-undetectable', state),
  getUndetectable: () => ipcRenderer.invoke('get-undetectable'),
  setOverlayMousePassthrough: (enabled: boolean) =>
    ipcRenderer.invoke('set-overlay-mouse-passthrough', enabled),
  toggleOverlayMousePassthrough: () => ipcRenderer.invoke('toggle-overlay-mouse-passthrough'),
  getOverlayMousePassthrough: () => ipcRenderer.invoke('get-overlay-mouse-passthrough'),
  setOpenAtLogin: (open: boolean) => ipcRenderer.invoke('set-open-at-login', open),
  getOpenAtLogin: () => ipcRenderer.invoke('get-open-at-login'),
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') =>
    ipcRenderer.invoke('set-disguise', mode),
  getDisguise: () => ipcRenderer.invoke('get-disguise'),
  onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => {
    const subscription = (_: any, mode: any) => callback(mode);
    ipcRenderer.on('disguise-changed', subscription);
    return () => {
      ipcRenderer.removeListener('disguise-changed', subscription);
    };
  },

  // Skills — local SKILL.md instructions surfaced in Settings and the overlay.
  skillsRefresh: () => ipcRenderer.invoke('skills:list'),
  skillsOpenFolder: () => ipcRenderer.invoke('skills:open-folder'),
  // Per-skill management: hard-delete. Built-ins are refused inside the
  // manager. Enable/disable is intentionally NOT exposed — users who don't
  // want a skill delete it instead (see SkillsSettings.tsx).
  skillsDelete: (id: string) => ipcRenderer.invoke('skills:delete', id),
  // Skill upload — step-3 wiring. `skillsUpload` is the general call (opts.autoInstall
  // defaults to false on the renderer side; main process uses ?? false). `skillsPreview`
  // is sugar for `autoInstall: false` — the renderer's confirm step calls `skillsUpload`
  // again with `autoInstall: true` to commit.
  skillsUpload: (payload: SkillUploadPayload, opts?: { autoInstall?: boolean }) =>
    ipcRenderer.invoke('skills:upload', payload, opts),
  skillsPreview: (payload: SkillUploadPayload) =>
    ipcRenderer.invoke('skills:upload', payload, { autoInstall: false }),

  // Phone Mirror — stream live AI responses to a paired phone over the LAN.
  phoneMirrorGetInfo: () => ipcRenderer.invoke('phone-mirror:get-info'),
  phoneMirrorEnable: (exposeOnLan: boolean) =>
    ipcRenderer.invoke('phone-mirror:enable', exposeOnLan),
  phoneMirrorDisable: () => ipcRenderer.invoke('phone-mirror:disable'),
  phoneMirrorSetLan: (exposeOnLan: boolean) =>
    ipcRenderer.invoke('phone-mirror:set-lan', exposeOnLan),
  phoneMirrorRotateToken: () => ipcRenderer.invoke('phone-mirror:rotate-token'),
  phoneMirrorArmExtension: () => ipcRenderer.invoke('phone-mirror:arm-extension'),
  phoneMirrorListTabs: () => ipcRenderer.invoke('phone-mirror:list-tabs'),
  phoneMirrorCaptureTab: (tabId: number) => ipcRenderer.invoke('phone-mirror:capture-tab', tabId),
  phoneMirrorRequestAutoContext: () => ipcRenderer.invoke('phone-mirror:request-auto-context'),
  phoneMirrorPushScreenshot: (screenshotPath?: string) =>
    ipcRenderer.invoke('phone-mirror:push-screenshot', screenshotPath),
  // Smart Browser Context v2 — auto-capture settings.
  browserContextGetSettings: () => ipcRenderer.invoke('browser-context:get-settings'),
  browserContextSetSettings: (patch: Record<string, boolean>) =>
    ipcRenderer.invoke('browser-context:set-settings', patch),
  onPhoneMirrorStatus: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info);
    ipcRenderer.on('phone-mirror:status', subscription);
    return () => {
      ipcRenderer.removeListener('phone-mirror:status', subscription);
    };
  },
  onPhoneMirrorIncomingChat: (callback: (data: { message: string; streamId: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('phone-mirror:incoming-chat', subscription);
    return () => {
      ipcRenderer.removeListener('phone-mirror:incoming-chat', subscription);
    };
  },

  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => {
    const subscription = (_: any, isVisible: boolean) => callback(isVisible);
    ipcRenderer.on('settings-visibility-changed', subscription);
    return () => {
      ipcRenderer.removeListener('settings-visibility-changed', subscription);
    };
  },

  onToggleExpand: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('toggle-expand', subscription);
    return () => {
      ipcRenderer.removeListener('toggle-expand', subscription);
    };
  },

  // LLM Model Management
  getCurrentLlmConfig: () => ipcRenderer.invoke('get-current-llm-config'),
  getAvailableOllamaModels: () => ipcRenderer.invoke('get-available-ollama-models'),
  getProviderStatuses: () => ipcRenderer.invoke('get-provider-statuses'),
  getProviderStatus: (id: string) => ipcRenderer.invoke('get-provider-status', id),
  onProviderStatusChanged: (callback: (status: any) => void) => {
    const subscription = (_: any, status: any) => callback(status);
    ipcRenderer.on('provider-status-changed', subscription);
    return () => ipcRenderer.removeListener('provider-status-changed', subscription);
  },
  getLocalFallbackPreflight: () => ipcRenderer.invoke('get-local-fallback-preflight'),
  runLocalFallbackPreflight: () => ipcRenderer.invoke('run-local-fallback-preflight'),
  switchToOllama: (model?: string, url?: string) =>
    ipcRenderer.invoke('switch-to-ollama', model, url),
  switchToGemini: (apiKey?: string, modelId?: string) =>
    ipcRenderer.invoke('switch-to-gemini', apiKey, modelId),
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey: string) =>
    ipcRenderer.invoke('test-llm-connection', provider, apiKey),
  selectServiceAccount: () => ipcRenderer.invoke('select-service-account'),

  // API Key Management
  setGeminiApiKey: (apiKey: string) => ipcRenderer.invoke('set-gemini-api-key', apiKey),
  setGroqApiKey: (apiKey: string) => ipcRenderer.invoke('set-groq-api-key', apiKey),
  setOpenaiApiKey: (apiKey: string) => ipcRenderer.invoke('set-openai-api-key', apiKey),
  setClaudeApiKey: (apiKey: string) => ipcRenderer.invoke('set-claude-api-key', apiKey),
  setDeepseekApiKey: (apiKey: string) => ipcRenderer.invoke('set-deepseek-api-key', apiKey),
  setLitellmConfig: (config: { apiKey: string; baseURL: string; maxTokens?: number }) => ipcRenderer.invoke('set-litellm-config', config),
  getAvailableLiteLLMModels: () => ipcRenderer.invoke('get-available-litellm-models'),
  setNativelyApiKey: (apiKey: string) => ipcRenderer.invoke('set-natively-api-key', apiKey),

  // ── In-app review / testimonial prompt ─────────────────────────────────
  reviewGetPromptState: () => ipcRenderer.invoke('review:get-prompt-state'),
  reviewRecordSession: () => ipcRenderer.invoke('review:record-session'),
  reviewFlushSession: () => ipcRenderer.invoke('review:flush-session'),
  reviewMarkShown: () => ipcRenderer.invoke('review:mark-shown'),
  reviewDismissLater: () => ipcRenderer.invoke('review:dismiss-later'),
  reviewDismissForever: () => ipcRenderer.invoke('review:dismiss-forever'),
  reviewSubmit: (payload: { rating: number; review_text: string | null }) => ipcRenderer.invoke('review:submit', payload),
  reviewUpdateTestimonial: (payload: {
    review_id: string;
    name: string | null;
    role: string | null;
    company: string | null;
    can_use_publicly: boolean;
    display_name_publicly: boolean;
  }) => ipcRenderer.invoke('review:update-testimonial', payload),
  getNativelyPricing: () => ipcRenderer.invoke('get-natively-pricing'),
  getNativelyUsage: () => ipcRenderer.invoke('get-natively-usage'),
  getStoredCredentials: () => ipcRenderer.invoke('get-stored-credentials'),

  // Permissions
  checkPermissions: () => ipcRenderer.invoke('permissions:check'),
  requestMicPermission: () => ipcRenderer.invoke('permissions:request-mic'),

  // Free Trial
  startTrial: () => ipcRenderer.invoke('trial:start'),
  getTrialStatus: () => ipcRenderer.invoke('trial:status'),
  getLocalTrial: () => ipcRenderer.invoke('trial:get-local'),
  convertTrial: (choice: string) => ipcRenderer.invoke('trial:convert', choice),
  endTrialByok: () => ipcRenderer.invoke('trial:end-byok'),
  wipeTrialProfileData: () => ipcRenderer.invoke('trial:wipe-profile-data'),
  onTrialEnded: (cb: (data: { choice: string }) => void) => {
    const sub = (_: any, data: any) => cb(data);
    ipcRenderer.on('trial-ended', sub);
    return () => ipcRenderer.removeListener('trial-ended', sub);
  },

  // STT Provider Management
  setSttProvider: (
    provider:
      | 'none'
      | 'google'
      | 'groq'
      | 'openai'
      | 'deepgram'
      | 'elevenlabs'
      | 'azure'
      | 'ibmwatson'
      | 'soniox'
      | 'natively'
      | 'local-whisper',
  ) => ipcRenderer.invoke('set-stt-provider', provider),
  getSttProvider: () => ipcRenderer.invoke('get-stt-provider'),
  setGroqSttApiKey: (apiKey: string) => ipcRenderer.invoke('set-groq-stt-api-key', apiKey),
  setOpenAiSttApiKey: (apiKey: string) => ipcRenderer.invoke('set-openai-stt-api-key', apiKey),
  setOpenAiSttBaseUrl: (url: string) => ipcRenderer.invoke('set-openai-stt-base-url', url),
  setDeepgramApiKey: (apiKey: string) => ipcRenderer.invoke('set-deepgram-api-key', apiKey),
  setElevenLabsApiKey: (apiKey: string) => ipcRenderer.invoke('set-elevenlabs-api-key', apiKey),
  setAzureApiKey: (apiKey: string) => ipcRenderer.invoke('set-azure-api-key', apiKey),
  setAzureRegion: (region: string) => ipcRenderer.invoke('set-azure-region', region),
  setIbmWatsonApiKey: (apiKey: string) => ipcRenderer.invoke('set-ibmwatson-api-key', apiKey),
  setGroqSttModel: (model: string) => ipcRenderer.invoke('set-groq-stt-model', model),
  setSonioxApiKey: (apiKey: string) => ipcRenderer.invoke('set-soniox-api-key', apiKey),
  setIbmWatsonRegion: (region: string) => ipcRenderer.invoke('set-ibmwatson-region', region),
  testSttConnection: (
    provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
    apiKey: string,
    region?: string,
  ) => ipcRenderer.invoke('test-stt-connection', provider, apiKey, region),
  localWhisperGetModels: () => ipcRenderer.invoke('local-whisper-get-models'),
  localWhisperGetRecoveryNotice: () => ipcRenderer.invoke('local-whisper-get-recovery-notice'),
  onnxGetRecoveryNotice: (family) => ipcRenderer.invoke('onnx-get-recovery-notice', family),
  onnxResetFamily: (family) => ipcRenderer.invoke('onnx-reset-family', family),
  localWhisperSetModel: (modelId: string) => ipcRenderer.invoke('local-whisper-set-model', modelId),
  // In-app recovery: resets the active local-Whisper model + per-channel
  // overrides back to the safe fallback. See electron/ipcHandlers.ts handler.
  localWhisperResetToDefault: () => ipcRenderer.invoke('local-whisper-reset-to-default'),
  localWhisperGetChannelConfig: () => ipcRenderer.invoke('local-whisper-get-channel-config'),
  localWhisperSetChannelConfig: (cfg: {
    enabled?: boolean;
    micModelId?: string;
    systemModelId?: string;
    globalModelId?: string;
  }) => ipcRenderer.invoke('local-whisper-set-channel-config', cfg),
  localWhisperDeleteModel: (modelId: string) =>
    ipcRenderer.invoke('local-whisper-delete-model', modelId),
  localWhisperStartDownload: (modelId: string) =>
    ipcRenderer.invoke('local-whisper-start-download', modelId),
  localWhisperCancelDownload: (modelId: string) =>
    ipcRenderer.invoke('local-whisper-cancel-download', modelId),
  localWhisperGetDownloadState: (modelId?: string) =>
    ipcRenderer.invoke('local-whisper-get-download-state', modelId),
  onLocalWhisperDownloadProgress: (cb: (data: { modelId: string; progress: number }) => void) => {
    const listener = (_: any, data: any) => cb(data);
    ipcRenderer.on('local-whisper-download-progress', listener);
    return () => ipcRenderer.removeListener('local-whisper-download-progress', listener);
  },
  onLocalWhisperDownloadComplete: (cb: (data: { modelId: string }) => void) => {
    const listener = (_: any, data: any) => cb(data);
    ipcRenderer.on('local-whisper-download-complete', listener);
    return () => ipcRenderer.removeListener('local-whisper-download-complete', listener);
  },
  onLocalWhisperDownloadError: (cb: (data: { modelId: string; error: string }) => void) => {
    const listener = (_: any, data: any) => cb(data);
    ipcRenderer.on('local-whisper-download-error', listener);
    return () => ipcRenderer.removeListener('local-whisper-download-error', listener);
  },
  localWhisperPreload: (modelId?: string) => ipcRenderer.invoke('local-whisper-preload', modelId),
  localWhisperGetHardware: () => ipcRenderer.invoke('local-whisper-get-hardware'),

  // STT Config Events (Adapted from public PR #173 — verify premium interaction)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-config-changed', subscription);
    return () => {
      ipcRenderer.removeListener('stt-config-changed', subscription);
    };
  },
  onCredentialsChanged: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('credentials-changed', subscription);
    return () => {
      ipcRenderer.removeListener('credentials-changed', subscription);
    };
  },
  // Hindsight: the app-managed companion server inherited the OLD AI-provider env at
  // spawn and won't pick up new keys until restart. HindsightManager.notifyHindsightOfKeyChange
  // broadcasts this event after every AI key save; the Intelligence Settings panel surfaces
  // a small inline nudge so the user knows what to do.
  onHindsightRestartNeeded: (callback: (data: { provider: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('hindsight-restart-needed', subscription);
    return () => {
      ipcRenderer.removeListener('hindsight-restart-needed', subscription);
    };
  },
  // Hindsight: lifecycle state broadcasts from the main process. `state` is one of
  // 'spawning' | 'ready' | 'unreachable' | 'spawn-failed'. The persistent top-of-overlay
  // banner subscribes once and surfaces a "View log" affordance on failure states.
  onHindsightStatus: (callback: (data: { state: string; reason?: string; logPath?: string; at?: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('hindsight-status', subscription);
    return () => {
      ipcRenderer.removeListener('hindsight-status', subscription);
    };
  },
  // Hindsight: open the server's log file in the OS default viewer. Restricted to the
  // Hindsight log path (under app userData); renderer cannot pass arbitrary paths.
  openHindsightLog: () => ipcRenderer.invoke('open-hindsight-log'),
  // User-initiated Hindsight opt-out. Sets the explicit-disable sentinel so the synthetic
  // default can't silently re-enable Hindsight on next launch. Idempotent.
  disableHindsight: () => ipcRenderer.invoke('hindsight:disable'),

  // Native Audio Service Events
  onNativeAudioTranscript: (
    callback: (transcript: { speaker: string; text: string; final: boolean }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('native-audio-transcript', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-transcript', subscription);
    };
  },
  onNativeAudioSuggestion: (
    callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('native-audio-suggestion', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-suggestion', subscription);
    };
  },
  onNativeAudioConnected: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('native-audio-connected', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-connected', subscription);
    };
  },
  onNativeAudioDisconnected: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('native-audio-disconnected', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-disconnected', subscription);
    };
  },
  onSuggestionGenerated: (
    callback: (data: { question: string; suggestion: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('suggestion-generated', subscription);
    return () => {
      ipcRenderer.removeListener('suggestion-generated', subscription);
    };
  },
  onSuggestionProcessingStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('suggestion-processing-start', subscription);
    return () => {
      ipcRenderer.removeListener('suggestion-processing-start', subscription);
    };
  },
  onSuggestionError: (callback: (error: { error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('suggestion-error', subscription);
    return () => {
      ipcRenderer.removeListener('suggestion-error', subscription);
    };
  },
  generateSuggestion: (context: string, lastQuestion: string) =>
    ipcRenderer.invoke('generate-suggestion', context, lastQuestion),

  getNativeAudioStatus: () => ipcRenderer.invoke('native-audio-status'),
  getInputDevices: () => ipcRenderer.invoke('get-input-devices'),
  getOutputDevices: () => ipcRenderer.invoke('get-output-devices'),
  setRecognitionLanguage: (key: string) => ipcRenderer.invoke('set-recognition-language', key),
  getAiResponseLanguages: () => ipcRenderer.invoke('get-ai-response-languages'),
  setAiResponseLanguage: (language: string) =>
    ipcRenderer.invoke('set-ai-response-language', language),
  getSttLanguage: () => ipcRenderer.invoke('get-stt-language'),
  getAiResponseLanguage: () => ipcRenderer.invoke('get-ai-response-language'),
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => {
    const subscription = (_: any, bcp47: string) => callback(bcp47);
    ipcRenderer.on('stt-language-auto-detected', subscription);
    return () => {
      ipcRenderer.removeListener('stt-language-auto-detected', subscription);
    };
  },
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => {
    const subscription = (_: any, message: string) => callback(message);
    ipcRenderer.on('system-audio-permission-denied', subscription);
    return () => {
      ipcRenderer.removeListener('system-audio-permission-denied', subscription);
    };
  },
  getSystemAudioPermissionWarning: () => ipcRenderer.invoke('get-system-audio-permission-warning'),
  onDeviceSelectionApplied: (
    callback: (payload: {
      kind: 'input' | 'output';
      requested: string | null;
      actual: string | null;
      fellBack: boolean;
      reason?: string;
    }) => void,
  ) => {
    const subscription = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('device-selection-applied', subscription);
    return () => {
      ipcRenderer.removeListener('device-selection-applied', subscription);
    };
  },
  onAudioCaptureFailed: (
    callback: (payload: {
      channel: 'system' | 'mic';
      message: string;
      attempt: number;
      maxAttempts: number;
      terminal?: boolean;
      stuck?: boolean;
    }) => void,
  ) => {
    const subscription = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('audio-capture-failed', subscription);
    return () => {
      ipcRenderer.removeListener('audio-capture-failed', subscription);
    };
  },
  onAudioInputAutoSwitched: (
    callback: (payload: { from: string; to: string; reason: string; message?: string }) => void,
  ) => {
    const subscription = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('audio-input-auto-switched', subscription);
    return () => {
      ipcRenderer.removeListener('audio-input-auto-switched', subscription);
    };
  },

  // STT Status Events
  onSttStatusChanged: (
    callback: (data: {
      state: 'connected' | 'reconnecting' | 'failed';
      provider: string;
      error?: string;
      channel: 'user' | 'interviewer';
      reconnectAttempts?: number;
    }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-status', subscription);
    return () => {
      ipcRenderer.removeListener('stt-status', subscription);
    };
  },

  // Intelligence Mode IPC
  generateAssist: () => ipcRenderer.invoke('generate-assist'),
  generateWhatToSay: (
    question?: string,
    imagePaths?: string[],
    options?: { promptInstruction?: string; domContext?: string; domContextEnvelope?: unknown },
  ) => ipcRenderer.invoke('generate-what-to-say', question, imagePaths, options),
  generateClarify: () => ipcRenderer.invoke('generate-clarify'),
  generateCodeHint: (imagePaths?: string[], problemStatement?: string) =>
    ipcRenderer.invoke('generate-code-hint', imagePaths, problemStatement),
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string) =>
    ipcRenderer.invoke('generate-brainstorm', imagePaths, problemStatement),
  generateFollowUp: (intent: string, userRequest?: string) =>
    ipcRenderer.invoke('generate-follow-up', intent, userRequest),
  generateFollowUpQuestions: () => ipcRenderer.invoke('generate-follow-up-questions'),
  generateRecap: () => ipcRenderer.invoke('generate-recap'),
  submitManualQuestion: (question: string) =>
    ipcRenderer.invoke('submit-manual-question', question),
  getIntelligenceContext: () => ipcRenderer.invoke('get-intelligence-context'),
  testInjectTranscript: (segment: {
    speaker: string;
    text: string;
    timestamp?: number;
    final?: boolean;
  }) => ipcRenderer.invoke('test-inject-transcript', segment),
  testGetModeContext: () => ipcRenderer.invoke('test-get-mode-context'),
  resetIntelligence: () => ipcRenderer.invoke('reset-intelligence'),

  // Action Button Mode (Dynamic Recap / Brainstorm toggle)
  getActionButtonMode: () => ipcRenderer.invoke('get-action-button-mode'),
  setActionButtonMode: (mode: 'recap' | 'brainstorm') =>
    ipcRenderer.invoke('set-action-button-mode', mode),
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => {
    const subscription = (_: any, mode: 'recap' | 'brainstorm') => callback(mode);
    ipcRenderer.on('action-button-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('action-button-mode-changed', subscription);
    };
  },

  onModeChanged: (callback: (data: { id: string | null; name: string | null }) => void) => {
    const subscription = (_: any, data: { id: string | null; name: string | null }) =>
      callback(data);
    ipcRenderer.on('mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('mode-changed', subscription);
    };
  },

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => ipcRenderer.invoke('start-meeting', metadata),
  endMeeting: () => ipcRenderer.invoke('end-meeting'),
  finalizeMicSTT: () => ipcRenderer.invoke('finalize-mic-stt'),
  getRecentMeetings: () => ipcRenderer.invoke('get-recent-meetings'),
  getMeetingDetails: (id: string) => ipcRenderer.invoke('get-meeting-details', id),
  searchGlobalMeetings: (query: string, filters?: any) => ipcRenderer.invoke('search:global-meetings', { query, filters }),
  searchInMeeting: (query: string) => ipcRenderer.invoke('search:in-meeting', { query }),
  generateLectureNotes: (opts?: { title?: string; course?: string }) => ipcRenderer.invoke('lecture:generate-notes', opts),
  generateDiagram: (text?: string) => ipcRenderer.invoke('diagram:generate', { text }),
  getIntelligenceFlags: () => ipcRenderer.invoke('intelligence-flags:get'),
  setIntelligenceFlag: (key: string, value: boolean | null) => ipcRenderer.invoke('intelligence-flags:set', { key, value }),
  getHindsightConfig: () => ipcRenderer.invoke('hindsight-config:get'),
  setHindsightConfig: (cfg: { baseUrl?: string; apiKey?: string; autoStart?: boolean; serverCommand?: string; llmProvider?: string }) => ipcRenderer.invoke('hindsight-config:set', cfg),
  testHindsightConnection: () => ipcRenderer.invoke('hindsight-config:test'),
  updateMeetingTitle: (id: string, title: string) =>
    ipcRenderer.invoke('update-meeting-title', { id, title }),
  updateMeetingSummary: (id: string, updates: any) =>
    ipcRenderer.invoke('update-meeting-summary', { id, updates }),
  regenerateMeetingSummary: (id: string, opts?: { templateType?: string; tone?: 'professional' | 'warm' | 'concise' | 'friendly' }) =>
    ipcRenderer.invoke('regenerate-meeting-summary', { id, templateType: opts?.templateType, tone: opts?.tone }),
  regenerateMeetingFollowUp: (id: string, tone?: 'professional' | 'warm' | 'concise' | 'friendly') =>
    ipcRenderer.invoke('regenerate-meeting-followup', { id, tone }),
  updateMeetingSpeakerLabels: (id: string, labels: Record<string, string>) =>
    ipcRenderer.invoke('update-meeting-speaker-labels', { id, labels }),
  deleteMeeting: (id: string) => ipcRenderer.invoke('delete-meeting', id),

  onMeetingsUpdated: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('meetings-updated', subscription);
    return () => {
      ipcRenderer.removeListener('meetings-updated', subscription);
    };
  },

  // Window Mode
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) =>
    ipcRenderer.invoke('set-window-mode', mode, inactive),

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-assist-update', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-assist-update', subscription);
    };
  },
  // Phase 3 — Dynamic Action Cards
  onIntelligenceDynamicAction: (callback: (data: { action: any }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-dynamic-action', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-dynamic-action', subscription);
    };
  },
  acceptDynamicAction: (actionId: string) => ipcRenderer.invoke('dynamic-action:accept', actionId),
  dismissDynamicAction: (actionId: string) =>
    ipcRenderer.invoke('dynamic-action:dismiss', actionId),
  listDynamicActions: () => ipcRenderer.invoke('dynamic-action:list'),
  onIntelligenceSuggestedAnswerToken: (
    callback: (data: { token: string; question: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-suggested-answer-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-suggested-answer-token', subscription);
    };
  },
  onIntelligenceSuggestedAnswer: (
    callback: (data: { answer: string; question: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-suggested-answer', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-suggested-answer', subscription);
    };
  },
  // Orphaned-scaffold fix: drop the open what-to-answer scaffold row when a
  // stream ends with no final answer (superseded / declined / errored).
  onIntelligenceSuggestedAnswerDiscard: (
    callback: (data: { reason: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-suggested-answer-discard', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-suggested-answer-discard', subscription);
    };
  },
  // Verified code execution: ✓ badge when shown code passed executed tests.
  onIntelligenceCodeVerified: (
    callback: (data: { question: string; passed: number; total: number; language: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-code-verified', subscription);
    return () => { ipcRenderer.removeListener('intelligence-code-verified', subscription); };
  },
  // Verified code execution: a NEW corrected message when shown code failed.
  onIntelligenceCodeCorrection: (
    callback: (data: { question: string; answer: string; note: string; reVerified: boolean }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-code-correction', subscription);
    return () => { ipcRenderer.removeListener('intelligence-code-correction', subscription); };
  },
  // Sprint 7: dedicated negotiation-coaching channel.
  onIntelligenceNegotiationCoaching: (callback: (data: { payload: any }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-negotiation-coaching', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-negotiation-coaching', subscription);
    };
  },
  // Sprint 9: time-batched IPC token channel.
  onIntelligenceTokenBatch: (callback: (data: { kind: string; items: any[] }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-token-batch', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-token-batch', subscription);
    };
  },
  onIntelligenceRefinedAnswerToken: (
    callback: (data: { token: string; intent: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-refined-answer-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-refined-answer-token', subscription);
    };
  },
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-refined-answer', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-refined-answer', subscription);
    };
  },
  onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-recap-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-recap-token', subscription);
    };
  },
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-recap', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-recap', subscription);
    };
  },
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-clarify-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-clarify-token', subscription);
    };
  },
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-clarify', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-clarify', subscription);
    };
  },
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-follow-up-questions-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-follow-up-questions-token', subscription);
    };
  },
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-follow-up-questions-update', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-follow-up-questions-update', subscription);
    };
  },
  onIntelligenceManualStarted: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('intelligence-manual-started', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-manual-started', subscription);
    };
  },
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-manual-result', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-manual-result', subscription);
    };
  },
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-mode-changed', subscription);
    };
  },
  onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-error', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-error', subscription);
    };
  },
  onSessionReset: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('session-reset', subscription);
    return () => {
      ipcRenderer.removeListener('session-reset', subscription);
    };
  },

  // Streaming Chat
  streamGeminiChat: (
    message: string,
    imagePaths?: string[],
    context?: string,
    options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean },
  ) => ipcRenderer.invoke('gemini-chat-stream', message, imagePaths, context, options),

  onGeminiStreamToken: (callback: (token: string, meta?: { streamId?: number }) => void) => {
    // meta is an optional 2nd arg carrying { streamId } (audit finding #3). Existing
    // (token)=>… callbacks ignore it; the renderer uses it to drop stale-stream tokens.
    const subscription = (_: any, token: string, meta?: { streamId?: number }) => callback(token, meta);
    ipcRenderer.on('gemini-stream-token', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-stream-token', subscription);
    };
  },

  onGeminiStreamDone: (callback: (data?: { finalText?: string; streamId?: number }) => void) => {
    const subscription = (_: any, data?: { finalText?: string; streamId?: number }) => callback(data);
    ipcRenderer.on('gemini-stream-done', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-stream-done', subscription);
    };
  },

  onGeminiStreamError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on('gemini-stream-error', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-stream-error', subscription);
    };
  },

  // NOTE: onSkillsChanged broadcast subscription was removed. The main
  // process no longer broadcasts on delete (the only mutation left); the
  // Settings panel re-fetches via skillsRefresh after a successful delete,
  // and the overlay's autocomplete picker is fetched once on mount — users
  // who delete a skill in Settings then switch to the overlay will see the
  // stale autocomplete until the next mount, which is acceptable for v1.

  // Model Management
  getDefaultModel: () => ipcRenderer.invoke('get-default-model'),
  setModel: (modelId: string) => ipcRenderer.invoke('set-model', modelId),
  setDefaultModel: (modelId: string) => ipcRenderer.invoke('set-default-model', modelId),
  toggleModelSelector: (coords: { x: number; y: number; activate?: boolean }) =>
    ipcRenderer.invoke('toggle-model-selector', coords),
  modelSelectorCloseIfOpen: () => ipcRenderer.invoke('model-selector:close-if-open'),
  forceRestartOllama: () => ipcRenderer.invoke('force-restart-ollama'),
  isOllamaReachable: () => ipcRenderer.invoke('is-ollama-reachable'),

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) =>
    ipcRenderer.invoke('toggle-settings-window', coords),

  // Groq Fast Text Mode
  getGroqFastTextMode: () => ipcRenderer.invoke('get-groq-fast-text-mode'),
  setGroqFastTextMode: (enabled: boolean) => ipcRenderer.invoke('set-groq-fast-text-mode', enabled),
  getCodexCliConfig: () => ipcRenderer.invoke('get-codex-cli-config'),
  setCodexCliConfig: (config: {
    enabled: boolean;
    path: string;
    model: string;
    fastModel: string;
    timeoutMs: number;
    sandboxMode?: string;
    serviceTier?: string;
    modelReasoningEffort?: string;
  }) => ipcRenderer.invoke('set-codex-cli-config', config),
  testCodexCli: (config?: {
    enabled?: boolean;
    path?: string;
    model?: string;
    fastModel?: string;
    timeoutMs?: number;
    sandboxMode?: string;
    serviceTier?: string;
    modelReasoningEffort?: string;
  }) => ipcRenderer.invoke('test-codex-cli', config),
  codexCliAuthStatus: (config?: any) => ipcRenderer.invoke('codex-cli:auth-status', config),
  codexCliLogout: (config?: any) => ipcRenderer.invoke('codex-cli:logout', config),
  codexCliLogin: (config?: any) => ipcRenderer.invoke('codex-cli:login', config),
  codexCliDoctor: (config?: any) => ipcRenderer.invoke('codex-cli:doctor', config),
  // ChatGPT OAuth (PKCE) — replaces the old `codex login` CLI subprocess.
  // The renderer listens for `codex:login:complete` / `:failed` /
  // `:signed-out` / `:tokens:refreshed` events for live UI updates.
  codexLoginStatus: () => ipcRenderer.invoke('codex:login-status'),
  codexStartLogin: () => ipcRenderer.invoke('codex:start-login'),
  codexSignOut: () => ipcRenderer.invoke('codex:sign-out'),
  codexRefreshTokens: () => ipcRenderer.invoke('codex:refresh-tokens'),
  onCodexLoginComplete: (callback: (info: { email?: string }) => void) => {
    const subscription = (_: any, info: any) => callback(info || {});
    ipcRenderer.on('codex:login:complete', subscription);
    return () => { ipcRenderer.removeListener('codex:login:complete', subscription); };
  },
  onCodexLoginFailed: (callback: (info: { message: string }) => void) => {
    const subscription = (_: any, info: any) => callback(info || { message: 'Unknown error' });
    ipcRenderer.on('codex:login:failed', subscription);
    return () => { ipcRenderer.removeListener('codex:login:failed', subscription); };
  },
  onCodexSignedOut: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('codex:signed-out', subscription);
    return () => { ipcRenderer.removeListener('codex:signed-out', subscription); };
  },
  onCodexTokensRefreshed: (callback: (info: { expiresAt: number }) => void) => {
    const subscription = (_: any, info: any) => callback(info || {});
    ipcRenderer.on('codex:tokens:refreshed', subscription);
    return () => { ipcRenderer.removeListener('codex:tokens:refreshed', subscription); };
  },

  // Demo
  seedDemo: () => ipcRenderer.invoke('seed-demo'),

  // Custom Providers
  saveCustomProvider: (provider: any) => ipcRenderer.invoke('save-custom-provider', provider),
  getCustomProviders: () => ipcRenderer.invoke('get-custom-providers'),
  deleteCustomProvider: (id: string) => ipcRenderer.invoke('delete-custom-provider', id),

  // Follow-up Email
  generateFollowupEmail: (input: any) => ipcRenderer.invoke('generate-followup-email', input),
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) =>
    ipcRenderer.invoke('extract-emails-from-transcript', transcript),
  getCalendarAttendees: (eventId: string) => ipcRenderer.invoke('get-calendar-attendees', eventId),
  openMailto: (params: { to: string; subject: string; body: string }) =>
    ipcRenderer.invoke('open-mailto', params),

  // Audio Test
  startAudioTest: (deviceId?: string) => ipcRenderer.invoke('start-audio-test', deviceId),
  stopAudioTest: () => ipcRenderer.invoke('stop-audio-test'),
  onAudioTestLevel: (callback: (level: number) => void) => {
    const subscription = (_: any, level: number) => callback(level);
    ipcRenderer.on('audio-test-level', subscription);
    return () => {
      ipcRenderer.removeListener('audio-test-level', subscription);
    };
  },
  // UX4: parallel system-audio probe level meter. Wired during the existing
  // startAudioTest so users see both mic AND system audio levels in Settings
  // before starting a meeting.
  onAudioTestSystemLevel: (callback: (level: number) => void) => {
    const subscription = (_: any, level: number) => callback(level);
    ipcRenderer.on('audio-test-system-level', subscription);
    return () => {
      ipcRenderer.removeListener('audio-test-system-level', subscription);
    };
  },
  onAudioTestSystemError: (callback: (errorMessage: string) => void) => {
    const subscription = (_: any, errorMessage: string) => callback(errorMessage);
    ipcRenderer.on('audio-test-system-error', subscription);
    return () => {
      ipcRenderer.removeListener('audio-test-system-error', subscription);
    };
  },

  // Database
  flushDatabase: () => ipcRenderer.invoke('flush-database'),

  onUndetectableChanged: (callback: (state: boolean) => void) => {
    const subscription = (_: any, state: boolean) => callback(state);
    ipcRenderer.on('undetectable-changed', subscription);
    return () => {
      ipcRenderer.removeListener('undetectable-changed', subscription);
    };
  },

  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('overlay-mouse-passthrough-changed', subscription);
    return () => {
      ipcRenderer.removeListener('overlay-mouse-passthrough-changed', subscription);
    };
  },

  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('groq-fast-text-changed', subscription);
    return () => {
      ipcRenderer.removeListener('groq-fast-text-changed', subscription);
    };
  },

  onModelChanged: (callback: (modelId: string) => void) => {
    const subscription = (_: any, modelId: string) => callback(modelId);
    ipcRenderer.on('model-changed', subscription);
    return () => {
      ipcRenderer.removeListener('model-changed', subscription);
    };
  },

  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('ollama:pull-progress', subscription);
    return () => {
      ipcRenderer.removeListener('ollama:pull-progress', subscription);
    };
  },

  onOllamaPullComplete: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('ollama:pull-complete', subscription);
    return () => {
      ipcRenderer.removeListener('ollama:pull-complete', subscription);
    };
  },

  // Theme API
  getThemeMode: () => ipcRenderer.invoke('theme:get-mode'),
  setThemeMode: (mode: 'system' | 'light' | 'dark') => ipcRenderer.invoke('theme:set-mode', mode),
  onThemeChanged: (
    callback: (data: { mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('theme:changed', subscription);
    return () => {
      ipcRenderer.removeListener('theme:changed', subscription);
    };
  },

  // Calendar API
  calendarConnect: () => ipcRenderer.invoke('calendar-connect'),
  calendarDisconnect: () => ipcRenderer.invoke('calendar-disconnect'),
  getCalendarStatus: () => ipcRenderer.invoke('get-calendar-status'),
  getUpcomingEvents: () => ipcRenderer.invoke('get-upcoming-events'),
  calendarRefresh: () => ipcRenderer.invoke('calendar-refresh'),

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info);
    ipcRenderer.on('update-available', subscription);
    return () => {
      ipcRenderer.removeListener('update-available', subscription);
    };
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info);
    ipcRenderer.on('update-downloaded', subscription);
    return () => {
      ipcRenderer.removeListener('update-downloaded', subscription);
    };
  },
  onUpdateChecking: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('update-checking', subscription);
    return () => {
      ipcRenderer.removeListener('update-checking', subscription);
    };
  },
  onUpdateNotAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info);
    ipcRenderer.on('update-not-available', subscription);
    return () => {
      ipcRenderer.removeListener('update-not-available', subscription);
    };
  },
  onUpdateError: (callback: (err: string) => void) => {
    const subscription = (_: any, err: string) => callback(err);
    ipcRenderer.on('update-error', subscription);
    return () => {
      ipcRenderer.removeListener('update-error', subscription);
    };
  },
  onDownloadProgress: (callback: (progressObj: any) => void) => {
    const subscription = (_: any, progressObj: any) => callback(progressObj);
    ipcRenderer.on('download-progress', subscription);
    return () => {
      ipcRenderer.removeListener('download-progress', subscription);
    };
  },
  restartAndInstall: () => ipcRenderer.invoke('quit-and-install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  getCanAutoUpdate: () => ipcRenderer.invoke('get-can-auto-update'),
  testReleaseFetch: () => ipcRenderer.invoke('test-release-fetch'),

  // RAG API
  ragQueryMeeting: (meetingId: string, query: string) =>
    ipcRenderer.invoke('rag:query-meeting', { meetingId, query }),
  ragQueryLive: (query: string) => ipcRenderer.invoke('rag:query-live', { query }),
  ragQueryGlobal: (query: string) => ipcRenderer.invoke('rag:query-global', { query }),
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) =>
    ipcRenderer.invoke('rag:cancel-query', options),
  ragIsMeetingProcessed: (meetingId: string) =>
    ipcRenderer.invoke('rag:is-meeting-processed', meetingId),
  ragGetQueueStatus: () => ipcRenderer.invoke('rag:get-queue-status'),
  ragRetryEmbeddings: () => ipcRenderer.invoke('rag:retry-embeddings'),

  onIncompatibleProviderWarning: (
    callback: (data: { count: number; oldProvider: string; newProvider: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('embedding:incompatible-provider-warning', subscription);
    return () => {
      ipcRenderer.removeListener('embedding:incompatible-provider-warning', subscription);
    };
  },
  // Automatic background re-index progress (fired when the embedding space changes,
  // e.g. after a Gemini embedding-model upgrade). started → progress* → complete.
  onReindexProgress: (
    callback: (
      phase: 'started' | 'progress' | 'complete',
      data: { count?: number; done?: number; total?: number; space?: string; partial?: boolean },
    ) => void,
  ) => {
    const onStarted = (_: any, data: any) => callback('started', data);
    const onProgress = (_: any, data: any) => callback('progress', data);
    const onComplete = (_: any, data: any) => callback('complete', data);
    ipcRenderer.on('embedding:reindex-started', onStarted);
    ipcRenderer.on('embedding:reindex-progress', onProgress);
    ipcRenderer.on('embedding:reindex-complete', onComplete);
    return () => {
      ipcRenderer.removeListener('embedding:reindex-started', onStarted);
      ipcRenderer.removeListener('embedding:reindex-progress', onProgress);
      ipcRenderer.removeListener('embedding:reindex-complete', onComplete);
    };
  },
  reindexIncompatibleMeetings: () => ipcRenderer.invoke('rag:reindex-incompatible-meetings'),

  onRAGStreamChunk: (
    callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('rag:stream-chunk', subscription);
    return () => {
      ipcRenderer.removeListener('rag:stream-chunk', subscription);
    };
  },
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('rag:stream-complete', subscription);
    return () => {
      ipcRenderer.removeListener('rag:stream-complete', subscription);
    };
  },
  onRAGStreamError: (
    callback: (data: { meetingId?: string; global?: boolean; error: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('rag:stream-error', subscription);
    return () => {
      ipcRenderer.removeListener('rag:stream-error', subscription);
    };
  },

  // Keybind Management
  getKeybinds: () => ipcRenderer.invoke('keybinds:get-all'),
  setKeybind: (id: string, accelerator: string) =>
    ipcRenderer.invoke('keybinds:set', id, accelerator),
  resetKeybinds: () => ipcRenderer.invoke('keybinds:reset'),
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => {
    const subscription = (_: any, keybinds: any) => callback(keybinds);
    ipcRenderer.on('keybinds:update', subscription);
    return () => {
      ipcRenderer.removeListener('keybinds:update', subscription);
    };
  },
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => {
    const subscription = (_: any, data: { id: string; accelerator: string }) => callback(data);
    ipcRenderer.on('keybinds:registration-failed', subscription);
    return () => {
      ipcRenderer.removeListener('keybinds:registration-failed', subscription);
    };
  },

  // Global shortcut listener — fired stealthily from main process without focusing the window
  onGlobalShortcut: (callback: (data: { action: string }) => void) => {
    const subscription = (_: any, data: { action: string }) => callback(data);
    ipcRenderer.on('global-shortcut', subscription);
    return () => {
      ipcRenderer.removeListener('global-shortcut', subscription);
    };
  },

  // Stealth keyboard tap bridge. Three dead query-style IPCs were dropped in
  // the M5 cleanup — they had no main-side handler and were not called from
  // src/; tap state arrives via onStealthTapState instead.
  stealthTapAvailable: () => ipcRenderer.invoke('stealth-tap:available'),
  stealthTapOpenSettings: () => ipcRenderer.invoke('stealth-tap:open-settings'),
  stealthTapStop: () => ipcRenderer.invoke('stealth-tap:stop'),
  stealthTapStart: () => ipcRenderer.invoke('stealth-tap:start'),
  stealthTapShouldAutoEngage: () => ipcRenderer.invoke('stealth-tap:should-auto-engage'),
  onStealthTapState: (cb: (state: { active: boolean; reason?: string }) => void) => {
    const sub = (_: any, state: { active: boolean; reason?: string }) => cb(state);
    ipcRenderer.on('stealth-tap-state', sub);
    return () => {
      ipcRenderer.removeListener('stealth-tap-state', sub);
    };
  },
  onStealthKeyCaptured: (
    cb: (ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean }) => void,
  ) => {
    const sub = (
      _: any,
      ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean },
    ) => cb(ev);
    ipcRenderer.on('stealth-key-captured', sub);
    return () => {
      ipcRenderer.removeListener('stealth-key-captured', sub);
    };
  },

  // Donation API
  getDonationStatus: () => ipcRenderer.invoke('get-donation-status'),
  markDonationToastShown: () => ipcRenderer.invoke('mark-donation-toast-shown'),
  setDonationComplete: () => ipcRenderer.invoke('set-donation-complete'),

  // Profile Engine API
  profileUploadResume: (filePath: string) => ipcRenderer.invoke('profile:upload-resume', filePath),
  profileGetStatus: () => ipcRenderer.invoke('profile:get-status'),
  profileSetMode: (enabled: boolean) => ipcRenderer.invoke('profile:set-mode', enabled),
  profileDelete: () => ipcRenderer.invoke('profile:delete'),
  profileGetProfile: () => ipcRenderer.invoke('profile:get-profile'),
  profileSelectFile: () => ipcRenderer.invoke('profile:select-file'),

  // JD & Research API
  profileUploadJD: (filePath: string) => ipcRenderer.invoke('profile:upload-jd', filePath),
  profileDeleteJD: () => ipcRenderer.invoke('profile:delete-jd'),
  // OKF Profile Intelligence (2026-07-02): export the profile OKF bundle (explicit
  // user action, premium + okfProfileMarkdownExport gated) and read pack data for
  // the (flag-gated) Knowledge inspector UI.
  knowledgeExportProfilePack: () => ipcRenderer.invoke('knowledge:export-profile-pack'),
  knowledgeListProfilePacks: () => ipcRenderer.invoke('knowledge:list-profile-packs'),
  knowledgeGetProfilePack: (kind: string) => ipcRenderer.invoke('knowledge:get-profile-pack', kind),
  profileResearchCompany: (companyName: string) =>
    ipcRenderer.invoke('profile:research-company', companyName),
  profileGenerateNegotiation: (force?: boolean) =>
    ipcRenderer.invoke('profile:generate-negotiation', force),
  profileGetNegotiationState: () => ipcRenderer.invoke('profile:get-negotiation-state'),
  profileResetNegotiation: () => ipcRenderer.invoke('profile:reset-negotiation'),
  profileGetNotes: () => ipcRenderer.invoke('profile:get-notes'),
  profileSaveNotes: (content: string) => ipcRenderer.invoke('profile:save-notes', content),
  profileGetPersona: () => ipcRenderer.invoke('profile:get-persona'),
  profileSavePersona: (content: string) => ipcRenderer.invoke('profile:save-persona', content),

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => ipcRenderer.invoke('set-tavily-api-key', apiKey),

  // Dynamic Model Discovery
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey: string) =>
    ipcRenderer.invoke('fetch-provider-models', provider, apiKey),
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string) =>
    ipcRenderer.invoke('set-provider-preferred-model', provider, modelId),

  // License Management
  licenseActivate: (key: string) => ipcRenderer.invoke('license:activate', key),
  licenseCheckPremium: () => ipcRenderer.invoke('license:check-premium'),
  licenseGetDetails: () => ipcRenderer.invoke('license:get-details'),
  licenseCheckPremiumAsync: () => ipcRenderer.invoke('license:check-premium-async'),
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
  licenseGetHardwareId: () => ipcRenderer.invoke('license:get-hardware-id'),
  onLicenseStatusChanged: (callback: (data: { isPremium: boolean; plan?: string }) => void) => {
    const subscription = (_: any, data: { isPremium: boolean; plan?: string }) => callback(data);
    ipcRenderer.on('license-status-changed', subscription);
    return () => {
      ipcRenderer.removeListener('license-status-changed', subscription);
    };
  },

  onModesActiveCleared: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('modes-active-cleared', subscription);
    return () => {
      ipcRenderer.removeListener('modes-active-cleared', subscription);
    };
  },

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => ipcRenderer.invoke('set-overlay-opacity', opacity),
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => {
    const subscription = (_: any, opacity: number) => callback(opacity);
    ipcRenderer.on('overlay-opacity-changed', subscription);
    return () => {
      ipcRenderer.removeListener('overlay-opacity-changed', subscription);
    };
  },

  // Verbose / Debug Logging
  getVerboseLogging: () => ipcRenderer.invoke('get-verbose-logging'),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke('set-verbose-logging', enabled),
  getMeetingRetention: () => ipcRenderer.invoke('get-meeting-retention'),
  setMeetingRetention: (retention: 'forever' | '7d' | '30d' | 'never') =>
    ipcRenderer.invoke('set-meeting-retention', retention),
  onMeetingRetentionChanged: (
    callback: (retention: 'forever' | '7d' | '30d' | 'never') => void,
  ) => {
    const subscription = (_: any, retention: 'forever' | '7d' | '30d' | 'never') =>
      callback(retention);
    ipcRenderer.on('meeting-retention-changed', subscription);
    return () => {
      ipcRenderer.removeListener('meeting-retention-changed', subscription);
    };
  },
  getProviderDataScopes: () => ipcRenderer.invoke('get-provider-data-scopes'),
  setProviderDataScopes: (scopes: any) => ipcRenderer.invoke('set-provider-data-scopes', scopes),
  onProviderDataScopesChanged: (callback: (scopes: any) => void) => {
    const subscription = (_: any, scopes: any) => callback(scopes);
    ipcRenderer.on('provider-data-scopes-changed', subscription);
    return () => {
      ipcRenderer.removeListener('provider-data-scopes-changed', subscription);
    };
  },
  getScreenUnderstandingMode: () => ipcRenderer.invoke('get-screen-understanding-mode'),
  setScreenUnderstandingMode: (mode: 'vision_first' | 'vision_only' | 'private_vision') =>
    ipcRenderer.invoke('set-screen-understanding-mode', mode),
  onScreenUnderstandingModeChanged: (
    callback: (mode: 'vision_first' | 'vision_only' | 'private_vision') => void,
  ) => {
    const subscription = (_: any, mode: 'vision_first' | 'vision_only' | 'private_vision') =>
      callback(mode);
    ipcRenderer.on('screen-understanding-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('screen-understanding-mode-changed', subscription);
    };
  },
  getTechnicalInterviewVisionFirst: () =>
    ipcRenderer.invoke('get-technical-interview-vision-first'),
  setTechnicalInterviewVisionFirst: (enabled: boolean) =>
    ipcRenderer.invoke('set-technical-interview-vision-first', enabled),
  onTechnicalInterviewVisionFirstChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('technical-interview-vision-first-changed', subscription);
    return () => {
      ipcRenderer.removeListener('technical-interview-vision-first-changed', subscription);
    };
  },
  // Deprecated aliases — kept so renderer builds compiled against the old API keep working.
  getTechnicalInterviewDirectVision: () =>
    ipcRenderer.invoke('get-technical-interview-direct-vision'),
  setTechnicalInterviewDirectVision: (enabled: boolean) =>
    ipcRenderer.invoke('set-technical-interview-direct-vision', enabled),
  onTechnicalInterviewDirectVisionChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('technical-interview-vision-first-changed', subscription);
    return () => {
      ipcRenderer.removeListener('technical-interview-vision-first-changed', subscription);
    };
  },
  getLogFilePath: () => ipcRenderer.invoke('get-log-file-path'),
  openLogFile: () => ipcRenderer.invoke('open-log-file'),

  // Onboarding & gate persistent backup flags
  onboardingGetFlags: () => ipcRenderer.invoke('onboarding:get-flags'),
  onboardingSetFlag: (
    key: 'seenStartup' | 'seenProfileOnboarding' | 'seenModesOnboarding' | 'permsShown',
    value: boolean
  ) => ipcRenderer.invoke('onboarding:set-flag', key, value),

  // Arch
  getArch: () => ipcRenderer.invoke('get-arch'),
  getOsVersion: () => ipcRenderer.invoke('get-os-version'),

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => ipcRenderer.send('cropper-confirmed', bounds),
  cropperCancelled: () => ipcRenderer.send('cropper-cancelled'),
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => {
    const subscription = (
      _: Electron.IpcRendererEvent,
      data: { hudPosition: { x: number; y: number } },
    ) => callback(data);
    ipcRenderer.on('reset-cropper', subscription);
    return () => {
      ipcRenderer.removeListener('reset-cropper', subscription);
    };
  },

  // Platform
  platform: process.platform,

  // Modes API
  modesGetAll: () => ipcRenderer.invoke('modes:get-all'),
  modesGetActive: () => ipcRenderer.invoke('modes:get-active'),
  modesCreate: (params: { name: string; templateType: string }) =>
    ipcRenderer.invoke('modes:create', params),
  modesGenerateFromBrief: (params: {
    brief: string;
    requiresGrounding?: boolean;
    templateHint?: string;
    key?: string;
    persist?: boolean;
  }) => ipcRenderer.invoke('modes:generate-from-brief', params),
  // E2E test bridge — generic invoke for the __e2e__:* handlers, which only exist
  // when the main process was started with NATIVELY_E2E=1. No-op surface in a
  // shipped app (the handlers aren't registered, so invoke rejects).
  e2eInvoke: (channel: string, ...args: any[]) =>
    ipcRenderer.invoke(channel, ...args),
  modesUpdate: (
    id: string,
    updates: { name?: string; templateType?: string; customContext?: string },
  ) => ipcRenderer.invoke('modes:update', id, updates),
  modesDelete: (id: string) => ipcRenderer.invoke('modes:delete', id),
  modesSetActive: (id: string | null) => ipcRenderer.invoke('modes:set-active', id),
  modesGetReferenceFiles: (modeId: string) =>
    ipcRenderer.invoke('modes:get-reference-files', modeId),
  modesUploadReferenceFile: (modeId: string) =>
    ipcRenderer.invoke('modes:upload-reference-file', modeId),
  modesDeleteReferenceFile: (id: string) => ipcRenderer.invoke('modes:delete-reference-file', id),
  modesGetReferenceFileStatus: (modeId: string) =>
    ipcRenderer.invoke('modes:get-reference-file-status', modeId),
  knowledgeListPacks: (modeId: string) => ipcRenderer.invoke('knowledge:list-packs', modeId),
  knowledgeGetPack: (fileId: string) => ipcRenderer.invoke('knowledge:get-pack', fileId),
  knowledgeRegeneratePack: (params: { fileId: string; modeId: string; fileName: string }) =>
    ipcRenderer.invoke('knowledge:regenerate-pack', params),
  knowledgeExportPack: (fileId: string) => ipcRenderer.invoke('knowledge:export-pack', fileId),
  knowledgeEditCard: (params: { cardId: string; title?: string; body?: string; entities?: string[]; tags?: string[] }) =>
    ipcRenderer.invoke('knowledge:edit-card', params),
  knowledgeApproveCard: (cardId: string) => ipcRenderer.invoke('knowledge:approve-card', cardId),
  knowledgeRejectCard: (cardId: string) => ipcRenderer.invoke('knowledge:reject-card', cardId),
  knowledgeRestoreCardVersion: (params: { cardId: string; versionId: string }) =>
    ipcRenderer.invoke('knowledge:restore-card-version', params),
  knowledgeGetCardHistory: (cardId: string) => ipcRenderer.invoke('knowledge:get-card-history', cardId),
  onModeFileIndexStatus: (callback: (data: { modeId: string; fileId?: string }) => void) => {
    const subscription = (_: any, data: { modeId: string; fileId?: string }) => callback(data);
    ipcRenderer.on('mode-file-index-status', subscription);
    return () => {
      ipcRenderer.removeListener('mode-file-index-status', subscription);
    };
  },
  onKnowledgeIndexProgress: (callback: (data: { fileId: string; status: string; startedAt?: number; finishedAt?: number; error?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('knowledge-index-progress', subscription);
    return () => {
      ipcRenderer.removeListener('knowledge-index-progress', subscription);
    };
  },
  modesGetNoteSections: (modeId: string) => ipcRenderer.invoke('modes:get-note-sections', modeId),
  modesAddNoteSection: (modeId: string, title: string, description: string) =>
    ipcRenderer.invoke('modes:add-note-section', modeId, title, description),
  modesUpdateNoteSection: (id: string, updates: { title?: string; description?: string }) =>
    ipcRenderer.invoke('modes:update-note-section', id, updates),
  modesDeleteNoteSection: (id: string) => ipcRenderer.invoke('modes:delete-note-section', id),
  modesRemoveAllNoteSections: (modeId: string) =>
    ipcRenderer.invoke('modes:remove-all-note-sections', modeId),

  // Meeting interface theme — see ElectronAPI interface for rationale.
  setMeetingInterfaceTheme: (theme: string) => {
    ipcRenderer.send('interface-theme:set', theme);
  },
  onMeetingInterfaceThemeChanged: (callback: (theme: string) => void) => {
    const handler = (_evt: unknown, theme: string) => callback(theme);
    ipcRenderer.on('interface-theme:changed', handler);
    return () => {
      ipcRenderer.removeListener('interface-theme:changed', handler);
    };
  },

  // Cancel the in-flight chat stream. See ElectronAPI interface for rationale.
  cancelChatStream: () => {
    ipcRenderer.send('gemini-chat-stream-stop');
  },
  onDomContextReceived: (
    callback: (dom: string, meta?: DomCaptureMeta, envelope?: unknown) => void,
  ) => {
    // The desktop sends (dom, meta?, envelope?) — meta drives the "Page context"
    // chip, envelope (Smart Browser Context v2) carries the structured capture.
    // Forwarding the extra args is back-compatible: existing callers that only
    // declare (dom) or (dom, meta) simply ignore the trailing arg(s).
    const subscription = (_: any, dom: string, meta?: DomCaptureMeta, envelope?: unknown) =>
      callback(dom, meta, envelope);
    ipcRenderer.on('dom-context-received', subscription);
    return () => {
      ipcRenderer.removeListener('dom-context-received', subscription);
    };
  },
} as ElectronAPI);

// Renderer-side console forwarding to main-process log file.
// When verbose logging is on, patch console.log/warn/error so that renderer
// output appears in ~/Documents/natively_debug.log alongside main-process logs.
(function patchRendererConsole() {
  let _verbose = false;

  const _origLog = console.log.bind(console);
  const _origWarn = console.warn.bind(console);
  const _origError = console.error.bind(console);

  function serialize(...args: any[]): string {
    return args
      .map((a) => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object') {
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        }
        return String(a);
      })
      .join(' ');
  }

  console.log = (...args: any[]) => {
    _origLog(...args);
    if (_verbose) ipcRenderer.send('forward-log-to-file', 'log', serialize(...args));
  };
  console.warn = (...args: any[]) => {
    _origWarn(...args);
    if (_verbose) ipcRenderer.send('forward-log-to-file', 'warn', serialize(...args));
  };
  console.error = (...args: any[]) => {
    _origError(...args);
    if (_verbose) ipcRenderer.send('forward-log-to-file', 'error', serialize(...args));
  };

  // Sync verbose flag from main process at startup
  ipcRenderer
    .invoke('get-verbose-logging')
    .then((v: boolean) => {
      _verbose = v;
    })
    .catch(() => {});

  // Keep flag in sync when the user toggles verbose in settings
  ipcRenderer.on('verbose-logging-changed', (_event: any, enabled: boolean) => {
    _verbose = enabled;
  });
})();
