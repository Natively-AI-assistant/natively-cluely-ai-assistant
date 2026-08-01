import path from 'path';

export interface DefenceConfig {
  host: string;
  port: number;
  projectSourcePath: string;
  indexPath: string;
  stt: { provider: string; apiKey: string; baseUrl: string; model: string; language: string };
  llm: { provider: string; apiKey: string; baseUrl: string; model: string };
  search: { provider: string; apiKey: string; baseUrl: string };
  pairingTtlMs: number;
  sessionRetentionDays: number;
  storeAudio: boolean;
  storeTranscripts: boolean;
  maxUploadBytes: number;
  maxAudioBytes: number;
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
    projectSourcePath,
    indexPath: path.resolve(env.PROJECT_INDEX_PATH || path.join(projectSourcePath, '.defence-index')),
    stt: {
      provider: env.STT_PROVIDER || 'none', apiKey: env.STT_API_KEY || '',
      baseUrl: env.STT_BASE_URL || 'https://api.groq.com/openai/v1',
      model: env.STT_MODEL || 'whisper-large-v3-turbo', language: env.STT_LANGUAGE || 'auto',
    },
    llm: {
      provider: env.LLM_PROVIDER || 'none', apiKey: env.LLM_API_KEY || '',
      baseUrl: env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1', model: env.LLM_MODEL || '',
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
  };
}

export function publicConfig(config: DefenceConfig) {
  return {
    host: config.host, port: config.port, storeAudio: config.storeAudio,
    capabilities: {
      stt: config.stt.provider !== 'none' && !!config.stt.apiKey,
      llm: config.llm.provider !== 'none' && (!!config.llm.apiKey || config.llm.provider === 'ollama'),
      search: config.search.provider !== 'none' && !!config.search.apiKey,
      localRetrieval: true,
    },
  };
}
