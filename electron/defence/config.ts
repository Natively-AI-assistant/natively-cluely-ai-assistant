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
  };
}

export function publicConfig(config: DefenceConfig) {
  return {
    host: config.host, port: config.port, storeAudio: config.storeAudio,
    projectId: config.projectId, projectDisplayName: config.projectDisplayName,
    secure: config.tls.enabled, adminLocalOnly: config.adminLocalOnly, publicMode: config.publicMode,
    adminNotExposed: config.publicMode === 'companion-only', retrievalTopK: config.retrievalTopK,
    capabilities: {
      stt: config.stt.provider !== 'none' && !!config.stt.apiKey,
      llm: config.llm.provider !== 'none' && (!!config.llm.apiKey || config.llm.provider === 'ollama'),
      search: config.search.provider !== 'none' && !!config.search.apiKey,
      localRetrieval: true,
    },
  };
}
