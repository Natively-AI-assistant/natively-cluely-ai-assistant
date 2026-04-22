import { MockScenario } from './electronMocks'
import {
  mockMeetings,
  mockEmptyMeetings,
  mockSingleMeeting,
} from '../data/meetings'
import {
  mockProviderModels,
  mockOllamaModelNames,
  mockEmptyModels,
} from '../data/models'
import { mockDefaultSettings } from '../data/settings'

const defaultScenario: MockScenario = {
  name: 'default',
  meetings: mockEmptyMeetings,
  settings: mockDefaultSettings,
  models: [],
  providerModels: mockEmptyModels,
  credentials: {
    hasGeminiKey: true,
    hasGroqKey: false,
    hasOpenaiKey: false,
    hasClaudeKey: false,
    hasSttGroqKey: false,
    hasSttOpenaiKey: false,
    hasDeepgramKey: false,
    hasElevenLabsKey: false,
    hasAzureKey: false,
    azureRegion: '',
    hasIbmWatsonKey: false,
    ibmWatsonRegion: '',
    googleServiceAccountPath: null,
    sttProvider: 'google',
  },
  themeMode: { resolved: 'dark', source: 'system' },
  calendarStatus: { connected: false, events: [] },
  profileStatus: { hasProfile: false, profileMode: false },
  profile: null,
  premium: false,
  meetingActive: false,
  undetectable: false,
  openAtLogin: false,
  sttProvider: 'google',
  recognitionLanguage: 'en-US',
  aiResponseLanguage: 'en',
  actionButtonMode: 'recap',
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
}

const withMeetings: MockScenario = {
  ...defaultScenario,
  name: 'withMeetings',
  meetings: mockMeetings,
  models: mockOllamaModelNames,
  providerModels: mockProviderModels,
}

const withSingleMeeting: MockScenario = {
  ...defaultScenario,
  name: 'withSingleMeeting',
  meetings: mockSingleMeeting,
  models: mockOllamaModelNames,
  providerModels: mockProviderModels,
}

const withActiveMeeting: MockScenario = {
  ...withMeetings,
  name: 'withActiveMeeting',
  meetingActive: true,
}

const emptyModels: MockScenario = {
  ...defaultScenario,
  name: 'emptyModels',
  models: [],
  providerModels: mockEmptyModels,
}

const premium: MockScenario = {
  ...defaultScenario,
  name: 'premium',
  meetings: mockMeetings,
  premium: true,
  profileStatus: { hasProfile: true, profileMode: true },
  profile: { id: 'test-profile', name: 'Test User' },
}

export const scenarios: Record<string, MockScenario> = {
  default: defaultScenario,
  withMeetings,
  withSingleMeeting,
  withActiveMeeting,
  emptyModels,
  premium,
}

export type ScenarioName = keyof typeof scenarios
