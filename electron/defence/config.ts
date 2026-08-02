import path from 'path';

export interface DefenceConfig {
  host: string;
  port: number;
  publicMode: 'full' | 'companion-only';
  companionHost: string;
  companionPort: number;
  companionPublicUrl: string;
  projectSourcePath: string;
  indexPath: string;
  projectId: string;
  projectDisplayName: string;
  projectsConfigPath: string;
  adminLocalOnly: boolean;
  tls: { enabled: boolean; certPath: string; keyPath: string };
  stt: { provider: string; apiKey: string; baseUrl: string; model: string; language: string; timeoutMs: number; maxRetries: number };
  llm: { provider: string; apiKey: string; baseUrl: string; model: string; timeoutMs: number; maxRetries: number; thinking: boolean };
  search: { provider: string; apiKey: string; baseUrl: string };
  pairingTtlMs: number;
  sessionRetentionDays: number;
  storeAudio: boolean;
  storeTranscripts: boolean;
  maxUploadBytes: number;
  maxAudioBytes: number;
  maxAudioDurationMs: number;
  retrievalTopK: number;
  retrievalTopKAdjusted: boolean;
  input: {
    mode: 'windows-audio' | 'dual-process-and-microphone' | 'iphone-microphone';
    iphoneOutputOnly: boolean;
    source: 'dual-process-and-microphone' | 'specific-process-loopback' | 'system-loopback' | 'windows-microphone' | 'iphone-microphone';
    scenario: 'remote-interview' | 'in-person-defence' | 'hybrid';
    processName: string;
    processId?: number;
    deviceId: string;
    dualSource: { enabled: boolean; overlapWindowMs: number; transcriptSimilarity: number };
    vad: {
      minSpeechMs: number;
      silenceMs: number;
      maxUtteranceMs: number;
      partialIntervalMs: number;
      questionMergeSilenceMs: number;
      rmsThreshold: number;
      duplicateWindowMs: number;
    };
  };
  semanticCacheTtlMs: number;
}

const numberFrom = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function loadDefenceConfig(env: NodeJS.ProcessEnv = process.env): DefenceConfig {
  const projectSourcePath = path.resolve(env.PROJECT_SOURCE_PATH || process.cwd());
  const projectId = env.PROJECT_ID || 'default';
  const requestedRetrievalTopK = numberFrom(env.RETRIEVAL_TOP_K, 6);
  const retrievalTopKAdjusted = projectId === 'cba-import-candidate-ranking' && requestedRetrievalTopK < 3;
  const requestedMode = env.INPUT_MODE || '';
  const dualSourceEnabled = env.DUAL_SOURCE_ENABLED === 'true';
  const allowedSources = new Set(['dual-process-and-microphone', 'specific-process-loopback', 'system-loopback', 'windows-microphone', 'iphone-microphone']);
  const requestedSource = env.WINDOWS_AUDIO_SOURCE || (allowedSources.has(requestedMode) ? requestedMode : 'specific-process-loopback');
  const guardedSource = requestedSource === 'dual-process-and-microphone' && !dualSourceEnabled ? 'specific-process-loopback' : requestedSource;
  const inputSource = (allowedSources.has(guardedSource) ? guardedSource : 'specific-process-loopback') as DefenceConfig['input']['source'];
  const inputMode: DefenceConfig['input']['mode'] = inputSource === 'iphone-microphone' ? 'iphone-microphone' : inputSource === 'dual-process-and-microphone' ? 'dual-process-and-microphone' : 'windows-audio';
  const requestedScenario = env.AUDIO_SCENARIO || 'remote-interview';
  const inputScenario = (['remote-interview', 'in-person-defence', 'hybrid'].includes(requestedScenario) ? requestedScenario : 'remote-interview') as DefenceConfig['input']['scenario'];
  const processId = Number(env.WINDOWS_AUDIO_PROCESS_ID || 0);
  return {
    host: env.DEFENCE_HOST || '127.0.0.1',
    port: numberFrom(env.DEFENCE_PORT, 4317),
    publicMode: env.DEFENCE_PUBLIC_MODE === 'companion-only' ? 'companion-only' : 'full',
    companionHost: env.DEFENCE_COMPANION_HOST || '127.0.0.1',
    companionPort: numberFrom(env.DEFENCE_COMPANION_PORT, 4318),
    companionPublicUrl: (env.DEFENCE_COMPANION_PUBLIC_URL || '').replace(/\/$/, ''),
    adminLocalOnly: env.DEFENCE_ADMIN_LOCAL_ONLY !== 'false',
    tls: {
      enabled: env.DEFENCE_TLS_ENABLED === 'true',
      certPath: env.DEFENCE_TLS_CERT_PATH ? path.resolve(env.DEFENCE_TLS_CERT_PATH) : '',
      keyPath: env.DEFENCE_TLS_KEY_PATH ? path.resolve(env.DEFENCE_TLS_KEY_PATH) : '',
    },
    projectSourcePath,
    indexPath: path.resolve(env.PROJECT_INDEX_PATH || path.join(projectSourcePath, '.defence-index')),
    projectId,
    projectDisplayName: env.PROJECT_DISPLAY_NAME || path.basename(projectSourcePath),
    projectsConfigPath: path.resolve(env.PROJECTS_CONFIG_PATH || '.defence-data/projects.json'),
    stt: {
      provider: env.STT_PROVIDER || 'none', apiKey: env.STT_API_KEY || '',
      baseUrl: env.STT_BASE_URL || 'https://api.groq.com/openai/v1',
      model: env.STT_MODEL || 'whisper-large-v3-turbo', language: env.STT_LANGUAGE || 'auto',
      timeoutMs: numberFrom(env.STT_TIMEOUT_MS, 30_000), maxRetries: Math.max(0, Number(env.STT_MAX_RETRIES || 1)),
    },
    llm: {
      provider: env.LLM_PROVIDER || 'none', apiKey: env.LLM_API_KEY || '',
      baseUrl: env.LLM_BASE_URL || 'https://api.deepseek.com', model: env.LLM_MODEL || 'deepseek-v4-flash',
      timeoutMs: numberFrom(env.LLM_TIMEOUT_MS, 45_000), maxRetries: Math.max(0, Number(env.LLM_MAX_RETRIES || 1)),
      thinking: env.LLM_THINKING === 'true',
    },
    search: {
      provider: env.SEARCH_PROVIDER || 'none', apiKey: env.SEARCH_API_KEY || '',
      baseUrl: env.SEARCH_BASE_URL || 'https://api.tavily.com',
    },
    pairingTtlMs: numberFrom(env.PAIRING_TOKEN_TTL, 300) * 1000,
    sessionRetentionDays: numberFrom(env.SESSION_RETENTION_DAYS, 7),
    storeAudio: env.STORE_AUDIO === 'true',
    storeTranscripts: env.STORE_TRANSCRIPTS !== 'false',
    maxUploadBytes: numberFrom(env.MAX_UPLOAD_BYTES, 20 * 1024 * 1024),
    maxAudioBytes: numberFrom(env.MAX_AUDIO_BYTES, 8 * 1024 * 1024),
    maxAudioDurationMs: numberFrom(env.MAX_AUDIO_DURATION_MS, 15_000),
    retrievalTopK: retrievalTopKAdjusted ? 3 : requestedRetrievalTopK,
    retrievalTopKAdjusted,
    input: {
      mode: inputMode,
      iphoneOutputOnly: env.IPHONE_OUTPUT_ONLY !== 'false' && inputMode !== 'iphone-microphone',
      source: inputSource,
      scenario: inputScenario,
      processName: env.WINDOWS_AUDIO_PROCESS_NAME || 'auto',
      processId: Number.isSafeInteger(processId) && processId > 0 ? processId : undefined,
      deviceId: env.WINDOWS_AUDIO_DEVICE_ID || '',
      dualSource: {
        enabled: dualSourceEnabled,
        overlapWindowMs: numberFrom(env.DUAL_SOURCE_OVERLAP_WINDOW_MS, 1_000),
        transcriptSimilarity: Math.min(1, Math.max(0.5, Number(env.DUAL_SOURCE_TRANSCRIPT_SIMILARITY || 0.8))),
      },
      vad: {
        minSpeechMs: numberFrom(env.VAD_MIN_SPEECH_MS, 320),
        silenceMs: Math.min(800, Math.max(500, numberFrom(env.VAD_SILENCE_MS, 650))),
        maxUtteranceMs: numberFrom(env.VAD_MAX_UTTERANCE_MS, 20_000),
        partialIntervalMs: numberFrom(env.VAD_PARTIAL_INTERVAL_MS, 1_200),
        questionMergeSilenceMs: Math.min(2_500, Math.max(1_000, numberFrom(env.QUESTION_MERGE_SILENCE_MS, 1_600))),
        rmsThreshold: Math.min(0.25, Math.max(0.001, Number(env.VAD_RMS_THRESHOLD || 0.012))),
        duplicateWindowMs: numberFrom(env.VAD_DUPLICATE_WINDOW_MS, 30_000),
      },
    },
    semanticCacheTtlMs: numberFrom(env.SEMANTIC_CACHE_TTL_MS, 30 * 60 * 1000),
  };
}

export function publicConfig(config: DefenceConfig) {
  return {
    host: config.host, port: config.port, storeAudio: config.storeAudio,
    projectId: config.projectId, projectDisplayName: config.projectDisplayName,
    secure: config.tls.enabled, adminLocalOnly: config.adminLocalOnly, publicMode: config.publicMode,
    adminNotExposed: config.publicMode === 'companion-only', retrievalTopK: config.retrievalTopK,
    inputMode: config.input.mode, inputSource: config.input.source, audioScenario: config.input.scenario, iphoneOutputOnly: config.input.iphoneOutputOnly,
    capabilities: {
      stt: config.stt.provider !== 'none' && !!config.stt.apiKey,
      llm: config.llm.provider !== 'none' && (!!config.llm.apiKey || config.llm.provider === 'ollama'),
      search: config.search.provider !== 'none' && !!config.search.apiKey,
      localRetrieval: true,
    },
  };
}
