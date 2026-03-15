/** Providers that support dynamic model fetching via API key */
export type FetchableProvider = 'gemini' | 'groq' | 'openai' | 'claude';

/** All LLM providers (including credential-based ones like Bedrock) */
export type LLMProvider = FetchableProvider | 'bedrock';

/** Keys in StoredCredentials for preferred model per provider */
export type PreferredModelKey =
  | 'geminiPreferredModel'
  | 'groqPreferredModel'
  | 'openaiPreferredModel'
  | 'claudePreferredModel'
  | 'bedrockPreferredModel';
