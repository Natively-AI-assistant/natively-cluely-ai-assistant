import { vi } from 'vitest'

/**
 * Centralized vi.mock factories for integration tests.
 * Import this module at the top of test files BEFORE any other imports
 * to ensure vi.mock hoisting works correctly.
 *
 * Usage:
 *   import './__helpers__/shared-mocks'
 *   // vi.mock calls are hoisted automatically
 */

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData')
        return (global as any).__NATIVELY_TEST_USER_DATA__
      return '/tmp/test-userdata'
    }),
    isReady: vi.fn(() => true),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    getAppPath: vi.fn(() => '/tmp/test'),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}))

vi.mock('sqlite-vec', () => ({
  getLoadablePath: vi.fn(() => '/tmp/vec0.dylib'),
}))

vi.mock('../../electron/services/ModelVersionManager', () => ({
  ModelVersionManager: class {
    setApiKeys = vi.fn()
    initialize = vi.fn().mockResolvedValue(undefined)
    getSummary = vi.fn().mockReturnValue('Mock summary')
    stopScheduler = vi.fn()
    getAllVisionTiers = vi.fn().mockReturnValue([])
    getTextTieredModels = vi.fn().mockReturnValue({ tier1: 'gpt-4o-mini' })
    onModelError = vi.fn().mockResolvedValue(undefined)
  },
  ModelFamily: {
    OPENAI: 'openai',
    GEMINI_FLASH: 'gemini_flash',
    GEMINI_PRO: 'gemini_pro',
    CLAUDE: 'claude',
    GROQ_LLAMA: 'groq_llama',
  },
  TextModelFamily: {
    OPENAI: 'text_openai',
    GEMINI_FLASH: 'text_gemini_flash',
    GEMINI_PRO: 'text_gemini_pro',
    CLAUDE: 'text_claude',
    GROQ: 'text_groq',
  },
}))

vi.mock('../../electron/services/RateLimiter', () => ({
  createProviderRateLimiters: vi.fn(() => ({
    gemini: { acquire: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
    openai: { acquire: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
    claude: { acquire: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
    groq: { acquire: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
  })),
}))

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: async () => ({
          choices: [{ message: { content: 'Mock OpenAI response' } }],
        }),
      },
    }
  },
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = {
      create: async () => ({
        content: [{ type: 'text', text: 'Mock Claude response' }],
      }),
    }
  },
}))

vi.mock('../../electron/services/CredentialsManager', () => ({
  CredentialsManager: class {
    static getInstance() {
      return { getNativelyApiKey: () => null }
    }
  },
  CustomProvider: class {},
  CurlProvider: class {},
}))
