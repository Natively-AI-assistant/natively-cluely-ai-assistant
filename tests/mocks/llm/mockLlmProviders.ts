import { vi } from 'vitest'

export interface MockStreamConfig {
  chunks?: string[]
  error?: Error
  delay?: number
}

export interface MockApiConfig {
  response?: string
  error?: Error
  delay?: number
}

export interface LLMProviderMock {
  client: any
  generateContent: ReturnType<typeof vi.fn>
  generateStream: ReturnType<typeof vi.fn>
}

export function createMockGoogleGenAI(
  config: { response?: string; streamChunks?: string[] } = {},
) {
  const mockResponse = {
    text: config.response || 'Mocked response',
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          parts: [{ text: config.response || 'Mocked response' }],
        },
      },
    ],
  }

  const mockStreamChunks = config.streamChunks || [
    'Mocked ',
    'chunk ',
    'response',
  ]

  const mockGenerateContent = vi.fn().mockResolvedValue(mockResponse)

  const mockStreamGenerator = vi.fn(async function* () {
    for (const chunk of mockStreamChunks) {
      yield {
        text: chunk,
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: chunk }] },
          },
        ],
      }
    }
  })

  const mockClient = {
    models: {
      generateContent: mockGenerateContent,
      streamGenerateContent: mockStreamGenerator,
    },
  }

  return {
    client: mockClient,
    generateContent: mockGenerateContent,
    generateStream: mockStreamGenerator,
  }
}

export function createMockGroqClient(config: MockStreamConfig = {}) {
  const chunks = config.chunks || ['Mocked ', 'Groq ', 'response']

  const mockCreate = vi.fn((_params: any) => {
    return {
      choices: [
        {
          message: {
            content: chunks.join(''),
          },
        },
      ],
    }
  })

  const mockClient = {
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }

  return {
    client: mockClient,
    create: mockCreate,
  }
}

export function createMockOpenAIClient(config: MockStreamConfig = {}) {
  const chunks = config.chunks || ['Mocked ', 'OpenAI ', 'response']

  const mockCreate = vi.fn((_params: any) => {
    return {
      choices: [
        {
          message: {
            content: chunks.join(''),
          },
        },
      ],
    }
  })

  const mockClient = {
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }

  return {
    client: mockClient,
    create: mockCreate,
  }
}

export function createMockAnthropicClient(config: MockStreamConfig = {}) {
  const chunks = config.chunks || ['Mocked ', 'Anthropic ', 'response']

  const mockCreate = vi.fn((_params: any) => {
    return {
      content: [
        {
          type: 'text',
          text: chunks.join(''),
        },
      ],
    }
  })

  const mockClient = {
    messages: {
      create: mockCreate,
    },
  }

  return {
    client: mockClient,
    create: mockCreate,
  }
}

export function createMockStreamResponse(
  chunks: string[],
  config: { delay?: number } = {},
) {
  const { delay = 0 } = config

  async function* generator(): AsyncGenerator<string> {
    for (const chunk of chunks) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      yield chunk
    }
  }

  return generator()
}

export function createMockApiResponse(
  text: string,
  config: { delay?: number } = {},
) {
  const { delay = 0 } = config

  return {
    text,
    asyncText: async () => {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      return text
    },
  }
}

export function createMockLlmProvider(
  config: {
    provider?: 'google' | 'groq' | 'openai' | 'anthropic' | 'ollama'
    response?: string
    streamChunks?: string[]
    error?: Error
  } = {},
) {
  const {
    provider = 'google',
    response = 'Mocked LLM response',
    streamChunks = ['Mocked ', 'LLM ', 'response'],
  } = config

  switch (provider) {
    case 'google':
      return createMockGoogleGenAI({ response, streamChunks })
    case 'groq':
      return createMockGroqClient({ chunks: streamChunks })
    case 'openai':
      return createMockOpenAIClient({ chunks: streamChunks })
    case 'anthropic':
      return createMockAnthropicClient({ chunks: streamChunks })
    default:
      return createMockGoogleGenAI({ response, streamChunks })
  }
}

export function createLLMHelperMock(
  overrides: {
    mockClients?: {
      google?: ReturnType<typeof createMockGoogleGenAI>
      groq?: ReturnType<typeof createMockGroqClient>
      openai?: ReturnType<typeof createMockOpenAIClient>
      anthropic?: ReturnType<typeof createMockAnthropicClient>
    }
    streamChunks?: string[]
  } = {},
) {
  const { mockClients = {}, streamChunks = ['Test ', 'response ', 'chunk'] } =
    overrides

  const google = mockClients.google || createMockGoogleGenAI({ streamChunks })
  const groq =
    mockClients.groq || createMockGroqClient({ chunks: streamChunks })
  const openai =
    mockClients.openai || createMockOpenAIClient({ chunks: streamChunks })
  const anthropic =
    mockClients.anthropic || createMockAnthropicClient({ chunks: streamChunks })

  const mockHelper = {
    client: google.client,
    groqClient: groq.client,
    openaiClient: openai.client,
    claudeClient: anthropic.client,
    useOllama: false,
    currentModelId: 'gemini-3.1-flash',
    aiResponseLanguage: 'English',

    streamChat: vi.fn(async function* () {
      for (const chunk of streamChunks) {
        yield chunk
      }
    }),

    chatWithGemini: vi.fn(async () => streamChunks.join('')),
    generateWithFlash: vi.fn(async () => streamChunks.join('')),
    generateWithPro: vi.fn(async () => streamChunks.join('')),
    generateContent: vi.fn(async () => streamChunks.join('')),

    setApiKey: vi.fn(),
    setGroqApiKey: vi.fn(),
    setOpenaiApiKey: vi.fn(),
    setClaudeApiKey: vi.fn(),
    setModel: vi.fn(),
    setAiResponseLanguage: vi.fn(),
    setSttLanguage: vi.fn(),

    getAiResponseLanguage: vi.fn(() => 'English'),
    getGroqFastTextMode: vi.fn(() => false),

    scrubKeys: vi.fn(),
    initModelVersionManager: vi.fn(),

    rateLimiters: {
      gemini: { acquire: vi.fn(() => Promise.resolve()) },
      groq: { acquire: vi.fn(() => Promise.resolve()) },
      openai: { acquire: vi.fn(() => Promise.resolve()) },
      claude: { acquire: vi.fn(() => Promise.resolve()) },
    },
  }

  return {
    mockHelper,
    google,
    groq,
    openai,
    anthropic,
  }
}

export function resetLlmMocks(...mocks: any[]) {
  for (const mock of mocks) {
    if (mock && typeof mock === 'object') {
      for (const key of Object.keys(mock)) {
        const value = mock[key]
        if (value && typeof value.mockClear === 'function') {
          value.mockClear()
        }
      }
    }
  }
}

/**
 * Create a mock LLMHelper specifically for testing AnswerLLM, AssistLLM,
 * and other consumer classes. Returns a mock with streamChat (async generator)
 * and chat (async function) methods, plus helpers to configure responses.
 */
export function createMockLlmHelperForTests(
  config: {
    chatResponse?: string
    streamChunks?: string[]
    chatError?: Error
    streamError?: Error
  } = {},
) {
  const {
    chatResponse = 'Default mock response',
    streamChunks = ['Hello ', 'world'],
    chatError,
    streamError,
  } = config

  const mockChat = vi.fn(async () => {
    if (chatError) throw chatError
    return chatResponse
  })

  const mockStreamChat = vi.fn(async function* () {
    if (streamError) throw streamError
    for (const chunk of streamChunks) {
      yield chunk
    }
  })

  const mockHelper = {
    chat: mockChat,
    streamChat: mockStreamChat,
    currentModelId: 'gemini-3.1-flash',
    aiResponseLanguage: 'English',

    // reconfigure at runtime
    setChatResponse: (resp: string) => {
      mockChat.mockResolvedValue(resp)
    },
    setStreamChunks: (chunks: string[]) => {
      mockStreamChat.mockImplementation(async function* () {
        for (const chunk of chunks) {
          yield chunk
        }
      })
    },
    setChatError: (err: Error) => {
      mockChat.mockRejectedValue(err)
    },
    setStreamError: (err: Error) => {
      mockStreamChat.mockImplementation(async function* () {
        throw err
      })
    },
  }

  return {
    mockHelper,
    mockChat,
    mockStreamChat,
  }
}
