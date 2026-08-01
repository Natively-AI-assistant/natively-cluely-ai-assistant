import path from 'path';

export interface DefenceConfig {
  host: string;
  port: number;
  projectSourcePath: string;
  indexPath: string;
  adminLocalOnly: boolean;
  tls: { enabled: boolean; certPath: string; keyPath: string };
  stt: { provider: string; apiKey: string; baseUrl: string; model: string; language: string; timeoutMs: number; maxRetries: number };
  llm: { provider: string; apiKey: string; baseUrl: string; model: string; timeoutMs: number; maxRetries: number };
  search: { provider: string; apiKey: string; baseUrl: string };
  pairingTtlMs: number;
  sessionRetentionDays: number;
  storeAudio: boolean;
  storeTranscripts: boolean;
  maxUploadBytes: number;
  maxAudioBytes: number;
  maxAudioDurationMs: number;
}

const numberFrom = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function loadDefenceConfig(env: NodeJS.ProcessEnv = process.env): DefenceConfig {
  const projectSourcePath = path.resolve(env.PROJECT_SOURCE_PATH || process.cwd());
  return {
    host: env.DEFENCE_HOST || '127.0.0.1',
    port: numberFrom(env.DEFENCE_PORT, 4317),
    adminLocalOnly: env.DEFENCE_ADMIN_LOCAL_ONLY !== 'false',
    tls: {
      enabled: env.DEFENCE_TLS_ENABLED === 'true',
      certPath: env.DEFENCE_TLS_CERT_PATH ? path.resolve(env.DEFENCE_TLS_CERT_PATH) : '',
      keyPath: env.DEFENCE_TLS_KEY_PATH ? path.resolve(env.DEFENCE_TLS_KEY_PATH) : '',
    },
    projectSourcePath,
    indexPath: path.resolve(env.PROJECT_INDEX_PATH || path.join(projectSourcePath, '.defence-index')),
    stt: {
      provider: env.STT_PROVIDER || 'none', apiKey: env.STT_API_KEY || '',
      baseUrl: env.STT_BASE_URL || 'https://api.groq.com/openai/v1',
      model: env.STT_MODEL || 'whisper-large-v3-turbo', language: env.STT_LANGUAGE || 'auto',
      timeoutMs: numberFrom(env.STT_TIMEOUT_MS, 30_000), maxRetries: Math.max(0, Number(env.STT_MAX_RETRIES || 1)),
    },
    llm: {
      provider: env.LLM_PROVIDER || 'none', apiKey: env.LLM_API_KEY || '',
      baseUrl: env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1', model: env.LLM_MODEL || '',
      timeoutMs: numberFrom(env.LLM_TIMEOUT_MS, 45_000), maxRetries: Math.max(0, Number(env.LLM_MAX_RETRIES || 1)),
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
  };
}

export function publicConfig(config: DefenceConfig) {
  return {
    host: config.host, port: config.port, storeAudio: config.storeAudio,
    secure: config.tls.enabled, adminLocalOnly: config.adminLocalOnly,
    capabilities: {
      stt: config.stt.provider !== 'none' && !!config.stt.apiKey,
      llm: config.llm.provider !== 'none' && (!!config.llm.apiKey || config.llm.provider === 'ollama'),
      search: config.search.provider !== 'none' && !!config.search.apiKey,
      localRetrieval: true,
    },
  };
}
