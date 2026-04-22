import { Page } from '@playwright/test'
import { MockScenario } from './electronMocks'

/**
 * Default mock scenario used when no specific scenario is provided.
 * This eliminates the need to inline addInitScript calls in test files.
 */
export const defaultMockScenario: MockScenario = {
  name: 'default',
  meetings: [],
  settings: {},
  models: [],
  providerModels: [],
  credentials: {},
  meetingActive: false,
  themeMode: { resolved: 'dark', source: 'system' },
  actionButtonMode: 'recap',
  calendarStatus: { connected: false, events: [] },
  profileStatus: { hasProfile: false, profileMode: false },
  premium: false,
  undetectable: false,
  openAtLogin: false,
  sttProvider: 'google',
  recognitionLanguage: 'en-US',
  aiResponseLanguage: 'en',
  disguise: 'none',
  customProviders: [],
  donationStatus: { shown: true },
  meetingHistory: [],
  screenshots: [],
  keybinds: [],
  nativeAudioStatus: { connected: false },
  defaultModel: 'gpt-4',
  currentModel: { id: 'gpt-4', provider: 'openai' },
  sttLanguage: 'en-US',
  profile: null,
}

/**
 * Apply mock scenario to page.
 * Use this instead of inline addInitScript calls in visual.spec.ts and a11y.spec.ts.
 *
 * Example:
 *   await applyMockScenario(page, { meetings: mockMeetings })
 *   await applyMockScenario(page, { premium: true })
 */
export async function applyMockScenario(
  page: Page,
  scenario: Partial<MockScenario> = {},
): Promise<void> {
  const { setupElectronMock } = await import('./electronMocks')
  const merged: MockScenario = { ...defaultMockScenario, ...scenario }
  await setupElectronMock(page, merged)
}
