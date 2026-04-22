// tests/e2e/data/settings.ts
export interface E2EMockSettings {
  theme: string
  opacity: number
  undetectable: boolean
  openAtLogin: boolean
  actionButtonMode: 'recap' | 'brainstorm'
  recognitionLanguage: string
  aiResponseLanguage: string
  sttProvider: string
  disguise: 'none' | 'terminal' | 'settings' | 'activity'
}

export const mockDefaultSettings: E2EMockSettings = {
  theme: 'dark',
  opacity: 100,
  undetectable: false,
  openAtLogin: false,
  actionButtonMode: 'recap',
  recognitionLanguage: 'en-US',
  aiResponseLanguage: 'en',
  sttProvider: 'google',
  disguise: 'none',
}

export function mockSettingsWithOverrides(overrides: Partial<E2EMockSettings>): E2EMockSettings {
  return {
    ...mockDefaultSettings,
    ...overrides,
  }
}
