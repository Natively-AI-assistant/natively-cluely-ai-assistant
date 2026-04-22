export interface MockSettings {
  sttProvider: string
  llmProvider: string
  ollamaModel: string
  theme: string
  language: string
  groqFastTextMode: boolean
}

export const mockSettings: MockSettings = {
  sttProvider: 'google',
  llmProvider: 'ollama',
  ollamaModel: 'llama3',
  theme: 'system',
  language: 'en',
  groqFastTextMode: false,
}

export function createMockSettings(
  overrides: Partial<MockSettings> = {},
): MockSettings {
  return { ...mockSettings, ...overrides }
}
