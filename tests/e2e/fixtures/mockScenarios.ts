import {
  mockEmptyMeetings,
  mockMeetings,
  mockSingleMeeting,
} from '../data/meetings'
import {
  mockEmptyModels,
  mockOllamaModelNames,
  mockProviderModels,
} from '../data/models'
import { mockDefaultSettings } from '../data/settings'
import type { MockScenario } from './electronMocks'

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
  profile: {
    id: 'test-profile',
    name: 'Test User',
    headline: 'Senior Full-Stack Engineer',
    summary:
      'Experienced software engineer with 8+ years building scalable web applications and distributed systems. Passionate about developer tooling and AI-assisted workflows.',
    experience: [
      {
        company: 'TechCorp Inc.',
        role: 'Senior Software Engineer',
        start_date: '2021-03-01',
        end_date: null,
        bullets: [
          'Led migration of monolith to microservices, reducing deploy time by 60%',
          'Designed and implemented real-time collaboration features using WebSockets',
          'Mentored 4 junior engineers through code reviews and pair programming sessions',
        ],
      },
      {
        company: 'StartupXYZ',
        role: 'Software Engineer',
        start_date: '2018-06-01',
        end_date: '2021-02-28',
        bullets: [
          'Built RESTful APIs serving 2M+ daily requests with Node.js and PostgreSQL',
          'Implemented CI/CD pipelines reducing integration errors by 40%',
          'Contributed to open-source charting library with 1.2k GitHub stars',
        ],
      },
    ],
    projects: [
      {
        name: 'OpenTask',
        description:
          'Open-source task management platform with real-time sync, markdown support, and keyboard-driven navigation for power users.',
        technologies: [
          'React',
          'TypeScript',
          'WebSocket',
          'PostgreSQL',
          'Redis',
        ],
        url: 'https://github.com/testuser/opentask',
      },
      {
        name: 'DevMetrics CLI',
        description:
          'CLI tool that aggregates GitHub, Linear, and Figma data to produce engineering velocity reports for team leads.',
        technologies: ['Node.js', 'TypeScript', 'Commander.js', 'GitHub API'],
        url: 'https://github.com/testuser/devmetrics',
      },
    ],
    education: [
      {
        institution: 'State University',
        degree: 'Bachelor of Science',
        field: 'Computer Science',
        start_date: '2014-09-01',
        end_date: '2018-05-15',
        gpa: '3.8',
      },
    ],
  },
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
