export interface MockCredentials {
  hasGeminiKey: boolean
  hasGroqKey: boolean
  hasOpenaiKey: boolean
  hasClaudeKey: boolean
  hasNativelyKey: boolean
  sttProvider: string
  hasSttGroqKey: boolean
  hasSttOpenaiKey: boolean
  hasDeepgramKey: boolean
  hasElevenLabsKey: boolean
  hasAzureKey: boolean
  azureRegion: string
  hasIbmWatsonKey: boolean
  ibmWatsonRegion: string
  hasSonioxKey: boolean
  googleServiceAccountPath: string | null
}

export const mockCredentials: MockCredentials = {
  hasGeminiKey: false,
  hasGroqKey: false,
  hasOpenaiKey: false,
  hasClaudeKey: false,
  hasNativelyKey: false,
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
  googleServiceAccountPath: null,
}

export function createMockCredentials(
  overrides: Partial<MockCredentials> = {},
): MockCredentials {
  return { ...mockCredentials, ...overrides }
}
