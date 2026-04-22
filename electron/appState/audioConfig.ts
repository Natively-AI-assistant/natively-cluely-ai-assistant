/**
 * STT provider selection logic extracted from AppState.
 * Pure functions — returns provider configuration without instantiating providers.
 */

export interface SttCredentials {
  gemini?: string;
  groq?: string;
  openai?: string;
  deepgram?: string;
  soniox?: string;
  elevenlabs?: string;
  natively?: string;
  azure?: { key: string; region: string };
  ibm?: { key: string; region: string };
  groqSttModel?: string;
}

export interface SttProviderConfig {
  providerName: string;
  apiKey: string | null;
  region?: string;
  modelOverride?: string;
}

/**
 * Determines the STT provider configuration based on provider name and available credentials.
 * Returns a config object describing which provider to use and with what credentials.
 * Does NOT instantiate the provider — that's the caller's responsibility.
 */
export function selectSttProvider(provider: string, credentials: SttCredentials): SttProviderConfig {
  switch (provider) {
    case 'natively':
      return {
        providerName: 'natively',
        apiKey: credentials.natively || null,
      };

    case 'deepgram':
      return {
        providerName: 'deepgram',
        apiKey: credentials.deepgram || null,
      };

    case 'soniox':
      return {
        providerName: 'soniox',
        apiKey: credentials.soniox || null,
      };

    case 'elevenlabs':
      return {
        providerName: 'elevenlabs',
        apiKey: credentials.elevenlabs || null,
      };

    case 'openai':
      return {
        providerName: 'openai',
        apiKey: credentials.openai || null,
      };

    case 'groq':
      return {
        providerName: 'groq',
        apiKey: credentials.groq || null,
        modelOverride: credentials.groqSttModel,
      };

    case 'azure':
      return {
        providerName: 'azure',
        apiKey: credentials.azure?.key || null,
        region: credentials.azure?.region,
      };

    case 'ibmwatson':
      return {
        providerName: 'ibmwatson',
        apiKey: credentials.ibm?.key || null,
        region: credentials.ibm?.region,
      };

    default:
      // google (default)
      return {
        providerName: 'google',
        apiKey: null,
      };
  }
}

/**
 * Extracts the API key for a given STT provider from credentials.
 * Returns null if the provider doesn't need a key (google) or key is missing.
 */
export function getSttApiKey(provider: string, credentials: SttCredentials): string | null {
  const config = selectSttProvider(provider, credentials);
  return config.apiKey;
}
