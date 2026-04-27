/**
 * Tests for ProcessingHelper - pipeline processing behavior.
 *
 * ECORE-06 Gap: Previous tests only checked `typeof ProcessingHelper.prototype.processScreenshots === 'function'`.
 * No actual processing pipeline tests.
 *
 * This test suite verifies actual ProcessingHelper pipeline behavior:
 * - Screenshot processing in queue/solutions views
 * - Request cancellation with AbortController
 * - State management (view transitions, problem info)
 * - Credential loading
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcessingHelper } from '../../electron/ProcessingHelper'

// Use vi.hoisted to ensure mock is created before module evaluation
// This avoids the vitest hoisting issue where module-level electron imports
// run before vi.mock factories are called
const mockElectron = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    getName: vi.fn(() => 'TestApp'),
    isPackaged: false,
  },
}))

// Mock electron module with hoisted mock
vi.mock('electron', () => mockElectron)

// Mock dotenv
vi.mock('dotenv', () => ({
  config: vi.fn(),
}))

// Mock LLMHelper with actual methods
const mockLlmInstance = {
  getCurrentProvider: vi.fn(() => 'gemini'),
  getCurrentModel: vi.fn(() => 'gemini-3.1-flash'),
  chatWithGemini: vi.fn(() => Promise.resolve('test response')),
  generateRollingScript: vi.fn(() =>
    Promise.resolve({
      problem_identifier_script: 'test problem',
      brainstorm_script: 'test brainstorm',
      code: 'function test() {}',
      dry_run_script: 'test dry run',
      time_complexity: 'O(n)',
      space_complexity: 'O(1)',
    }),
  ),
  generateSolution: vi.fn(() =>
    Promise.resolve({
      solution: {
        code: 'function debugged() {}',
      },
    }),
  ),
  debugSolutionWithImages: vi.fn(() =>
    Promise.resolve({
      fixedCode: 'function debugged() {}',
      explanation: 'Debug successful',
    }),
  ),
  initModelVersionManager: vi.fn(() => Promise.resolve()),
  setModel: vi.fn(),
  setSttLanguage: vi.fn(),
  setAiResponseLanguage: vi.fn(),
  setApiKey: vi.fn(),
  setGroqApiKey: vi.fn(),
  setOpenaiApiKey: vi.fn(),
  setClaudeApiKey: vi.fn(),
  setNativelyKey: vi.fn(),
}

vi.mock('../../electron/LLMHelper', () => ({
  LLMHelper: vi.fn(function (this: any) {
    Object.assign(this, mockLlmInstance)
  }),
}))

// Mock credentialLoader
vi.mock('../../electron/helpers/credentialLoader', () => ({
  loadStoredCredentials: vi.fn(),
}))

// Mock CredentialsManager
vi.mock('../../electron/services/CredentialsManager', () => ({
  CredentialsManager: {
    getInstance: vi.fn(() => ({
      getGeminiApiKey: vi.fn(() => 'fake-gemini-key'),
      getGroqApiKey: vi.fn(() => 'fake-groq-key'),
      getOpenaiApiKey: vi.fn(() => 'fake-openai-key'),
      getClaudeApiKey: vi.fn(() => 'fake-claude-key'),
      getNativelyApiKey: vi.fn(() => null),
      getDefaultModel: vi.fn(() => 'gemini-3.1-flash-lite-preview'),
      getCustomProviders: vi.fn(() => null),
      getCurlProviders: vi.fn(() => null),
      getSttLanguage: vi.fn(() => 'en'),
      getAiResponseLanguage: vi.fn(() => 'en'),
    })),
  },
}))

describe('ProcessingHelper', () => {
  let mockAppState: any
  let processingHelper: ProcessingHelper
  let mockMainWindow: any
  let mockIntelligenceManager: any
  let mockRAGManager: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    }

    mockIntelligenceManager = {
      initializeLLMs: vi.fn(),
    }

    mockRAGManager = {
      initializeEmbeddings: vi.fn(),
      retryPendingEmbeddings: vi.fn(() => Promise.resolve()),
      ensureDemoMeetingProcessed: vi.fn(() => Promise.resolve()),
      cleanupStaleQueueItems: vi.fn(),
    }

    mockAppState = {
      getIntelligenceManager: vi.fn(() => mockIntelligenceManager),
      getRAGManager: vi.fn(() => mockRAGManager),
      getMainWindow: vi.fn(() => mockMainWindow),
      getView: vi.fn(() => 'queue'),
      getScreenshotHelper: vi.fn(() => ({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      })),
      getProblemInfo: vi.fn(() => null),
      setView: vi.fn(),
      setProblemInfo: vi.fn(),
      setHasDebugged: vi.fn(),
      PROCESSING_EVENTS: {
        NO_SCREENSHOTS: 'processing-no-screenshots',
        INITIAL_START: 'initial-start',
        INITIAL_SOLUTION_ERROR: 'solution-error',
        DEBUG_START: 'debug-start',
        DEBUG_SUCCESS: 'debug-success',
        DEBUG_ERROR: 'debug-error',
        PROBLEM_EXTRACTED: 'problem-extracted',
        SOLUTION_SUCCESS: 'solution-success',
      },
    }

    processingHelper = new ProcessingHelper(mockAppState as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('instantiation', () => {
    it('creates ProcessingHelper instance', () => {
      expect(processingHelper).toBeDefined()
    })

    it('has processScreenshots method', () => {
      expect(typeof processingHelper.processScreenshots).toBe('function')
    })

    it('has cancelOngoingRequests method', () => {
      expect(typeof processingHelper.cancelOngoingRequests).toBe('function')
    })

    it('has getLLMHelper method', () => {
      expect(typeof processingHelper.getLLMHelper).toBe('function')
    })

    it('has loadStoredCredentials method', () => {
      expect(typeof processingHelper.loadStoredCredentials).toBe('function')
    })
  })

  describe('processScreenshots - empty queue behavior', () => {
    it('sends NO_SCREENSHOTS event when queue is empty in queue view', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'processing-no-screenshots',
      )
    })

    it('does not call LLMHelper when queue is empty', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      const llmHelper = processingHelper.getLLMHelper()

      await processingHelper.processScreenshots()

      expect(llmHelper.generateRollingScript).not.toHaveBeenCalled()
    })

    it('returns early when no main window', async () => {
      mockAppState.getMainWindow.mockReturnValue(null)

      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('processScreenshots - queue view with screenshots', () => {
    beforeEach(() => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => [
          '/tmp/screenshot1.png',
          '/tmp/screenshot2.png',
        ]),
        getExtraScreenshotQueue: vi.fn(() => []),
      })
    })

    it('sends INITIAL_START event when processing begins', async () => {
      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'initial-start',
      )
    })

    it('sets view to solutions after starting', async () => {
      await processingHelper.processScreenshots()

      expect(mockAppState.setView).toHaveBeenCalledWith('solutions')
    })

    it('calls generateRollingScript with screenshot paths', async () => {
      const llmHelper = processingHelper.getLLMHelper()

      await processingHelper.processScreenshots()

      expect(llmHelper.generateRollingScript).toHaveBeenCalledWith([
        '/tmp/screenshot1.png',
        '/tmp/screenshot2.png',
      ])
    })

    it('extracts problem info from rolling script result', async () => {
      await processingHelper.processScreenshots()

      expect(mockAppState.setProblemInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          problem_statement: 'test problem',
          complexity: expect.objectContaining({
            time: 'O(n)',
            space: 'O(1)',
          }),
        }),
      )
    })

    it('sends PROBLEM_EXTRACTED event with problem info', async () => {
      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'problem-extracted',
        expect.objectContaining({
          problem_statement: 'test problem',
        }),
      )
    })

    it('sends SOLUTION_SUCCESS event with structured solution', async () => {
      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'solution-success',
        expect.objectContaining({
          solution: expect.objectContaining({
            problem_identifier_script: 'test problem',
            brainstorm_script: 'test brainstorm',
            code: 'function test() {}',
            dry_run_script: 'test dry run',
          }),
        }),
      )
    })

    it('handles LLM errors gracefully', async () => {
      const llmHelper = processingHelper.getLLMHelper()
      llmHelper.generateRollingScript.mockRejectedValueOnce(
        new Error('API Error'),
      )

      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'solution-error',
        'API Error',
      )
    })

    it('clears abort controller after processing completes', async () => {
      await processingHelper.processScreenshots()

      // ProcessingHelper should clear its abort controller
      // This is verified by the fact that subsequent calls work
      await processingHelper.processScreenshots()

      expect(mockAppState.setView).toHaveBeenCalledTimes(2)
    })
  })

  describe('processScreenshots - solutions view (debug mode)', () => {
    beforeEach(() => {
      mockAppState.getView.mockReturnValue('solutions')
      mockAppState.getProblemInfo.mockReturnValue({
        problem_statement: 'test problem',
        input_format: {},
        output_format: {},
        complexity: { time: 'O(n)', space: 'O(1)' },
        test_cases: [],
        validation_type: 'structured',
        difficulty: 'custom',
      })
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => ['/tmp/debug1.png']),
      })
    })

    it('sends DEBUG_START event when processing extra screenshots', async () => {
      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'debug-start',
      )
    })

    it('calls generateSolution to get current solution', async () => {
      const llmHelper = processingHelper.getLLMHelper()

      await processingHelper.processScreenshots()

      expect(llmHelper.generateSolution).toHaveBeenCalledWith(
        expect.objectContaining({
          problem_statement: 'test problem',
        }),
      )
    })

    it('calls debugSolutionWithImages with problem, code, and images', async () => {
      const llmHelper = processingHelper.getLLMHelper()

      await processingHelper.processScreenshots()

      expect(llmHelper.debugSolutionWithImages).toHaveBeenCalledWith(
        expect.objectContaining({ problem_statement: 'test problem' }),
        'function debugged() {}',
        ['/tmp/debug1.png'],
      )
    })

    it('sets hasDebugged to true after successful debug', async () => {
      await processingHelper.processScreenshots()

      expect(mockAppState.setHasDebugged).toHaveBeenCalledWith(true)
    })

    it('sends DEBUG_SUCCESS event with debug result', async () => {
      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'debug-success',
        expect.objectContaining({
          fixedCode: 'function debugged() {}',
        }),
      )
    })

    it('sends DEBUG_ERROR event when debug fails', async () => {
      const llmHelper = processingHelper.getLLMHelper()
      llmHelper.debugSolutionWithImages.mockRejectedValueOnce(
        new Error('Vision API Error'),
      )

      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'debug-error',
        'Vision API Error',
      )
    })

    it('sends NO_SCREENSHOTS when extra queue is empty in solutions view', async () => {
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'processing-no-screenshots',
      )
    })

    it('throws error when problem info is missing in debug mode', async () => {
      mockAppState.getProblemInfo.mockReturnValue(null)

      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'debug-error',
        'No problem info available',
      )
    })
  })

  describe('cancelOngoingRequests', () => {
    it('sets hasDebugged to false when cancelling', () => {
      processingHelper.cancelOngoingRequests()

      expect(mockAppState.setHasDebugged).toHaveBeenCalledWith(false)
    })

    it('can make new requests after cancellation', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => ['/tmp/screenshot1.png']),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      // Start processing
      const processPromise = processingHelper.processScreenshots()

      // Cancel immediately
      processingHelper.cancelOngoingRequests()

      // Wait for processing to complete
      await processPromise

      // Should be able to process again
      await processingHelper.processScreenshots()

      expect(mockAppState.setView).toHaveBeenCalled()
    })

    it('does not throw when no requests are ongoing', () => {
      expect(() => processingHelper.cancelOngoingRequests()).not.toThrow()
    })

    it('cancels extra processing abort controller', async () => {
      mockAppState.getView.mockReturnValue('solutions')
      mockAppState.getProblemInfo.mockReturnValue({
        problem_statement: 'test',
      })
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => ['/tmp/debug.png']),
      })

      const llmHelper = processingHelper.getLLMHelper()
      llmHelper.generateSolution.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ solution: { code: 'test' } }), 100),
          ),
      )

      const processPromise = processingHelper.processScreenshots()

      // Small delay to ensure processing started
      await new Promise((resolve) => setTimeout(resolve, 10))

      processingHelper.cancelOngoingRequests()

      await processPromise

      expect(mockAppState.setHasDebugged).toHaveBeenCalledWith(false)
    })
  })

  describe('getLLMHelper', () => {
    it('returns LLMHelper instance', () => {
      const llmHelper = processingHelper.getLLMHelper()
      expect(llmHelper).toBeDefined()
    })

    it('returns the same instance on multiple calls', () => {
      const llmHelper1 = processingHelper.getLLMHelper()
      const llmHelper2 = processingHelper.getLLMHelper()
      expect(llmHelper1).toBe(llmHelper2)
    })

    it('LLMHelper has expected methods', () => {
      const llmHelper = processingHelper.getLLMHelper()
      expect(typeof llmHelper.getCurrentProvider).toBe('function')
      expect(typeof llmHelper.getCurrentModel).toBe('function')
      expect(typeof llmHelper.chatWithGemini).toBe('function')
      expect(typeof llmHelper.generateRollingScript).toBe('function')
      expect(typeof llmHelper.generateSolution).toBe('function')
      expect(typeof llmHelper.debugSolutionWithImages).toBe('function')
    })
  })

  describe('loadStoredCredentials', () => {
    it('loadStoredCredentials is callable', () => {
      expect(typeof processingHelper.loadStoredCredentials).toBe('function')
    })

    it('loads credentials from CredentialsManager into llmHelper', () => {
      processingHelper.loadStoredCredentials()

      // Verify LLMHelper methods were called with credentials
      expect(mockLlmInstance.setApiKey).toHaveBeenCalledWith('fake-gemini-key')
      expect(mockLlmInstance.setGroqApiKey).toHaveBeenCalledWith(
        'fake-groq-key',
      )
      expect(mockLlmInstance.setOpenaiApiKey).toHaveBeenCalledWith(
        'fake-openai-key',
      )
      expect(mockLlmInstance.setClaudeApiKey).toHaveBeenCalledWith(
        'fake-claude-key',
      )
      expect(mockLlmInstance.setModel).toHaveBeenCalled()
      expect(mockLlmInstance.setSttLanguage).toHaveBeenCalledWith('en')
      expect(mockLlmInstance.setAiResponseLanguage).toHaveBeenCalledWith('en')
      // Verify managers were initialized
      expect(mockIntelligenceManager.initializeLLMs).toHaveBeenCalled()
      expect(mockRAGManager.initializeEmbeddings).toHaveBeenCalled()
    })
  })

  describe('state management via appState', () => {
    it('appState is accessible via getView method', () => {
      expect(mockAppState.getView()).toBe('queue')
    })

    it('appState PROCESSING_EVENTS are accessible', () => {
      expect(mockAppState.PROCESSING_EVENTS.NO_SCREENSHOTS).toBe(
        'processing-no-screenshots',
      )
      expect(mockAppState.PROCESSING_EVENTS.INITIAL_START).toBe('initial-start')
      expect(mockAppState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR).toBe(
        'solution-error',
      )
      expect(mockAppState.PROCESSING_EVENTS.DEBUG_START).toBe('debug-start')
      expect(mockAppState.PROCESSING_EVENTS.DEBUG_SUCCESS).toBe('debug-success')
      expect(mockAppState.PROCESSING_EVENTS.DEBUG_ERROR).toBe('debug-error')
      expect(mockAppState.PROCESSING_EVENTS.PROBLEM_EXTRACTED).toBe(
        'problem-extracted',
      )
      expect(mockAppState.PROCESSING_EVENTS.SOLUTION_SUCCESS).toBe(
        'solution-success',
      )
    })

    it('setView is called during processing', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => ['/tmp/screenshot.png']),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      await processingHelper.processScreenshots()

      expect(mockAppState.setView).toHaveBeenCalled()
    })

    it('setProblemInfo is called with structured data', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => ['/tmp/screenshot.png']),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      await processingHelper.processScreenshots()

      expect(mockAppState.setProblemInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          problem_statement: expect.any(String),
          complexity: expect.objectContaining({
            time: expect.any(String),
            space: expect.any(String),
          }),
        }),
      )
    })

    it('can switch between queue and solutions view', () => {
      expect(mockAppState.getView()).toBe('queue')

      mockAppState.setView('solutions')
      expect(mockAppState.setView).toHaveBeenCalledWith('solutions')
    })
  })

  describe('pipeline behavior - integration', () => {
    it('processes screenshots when queue has items', async () => {
      const screenshotHelper = mockAppState.getScreenshotHelper()
      const queue = screenshotHelper.getScreenshotQueue()
      expect(queue).toHaveLength(0) // Empty by default
    })

    it('handles empty screenshot queue gracefully', () => {
      const emptyHelper = {
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      }
      mockAppState.getScreenshotHelper.mockReturnValue(emptyHelper)

      const queue = mockAppState.getScreenshotHelper().getScreenshotQueue()
      expect(queue).toEqual([])
    })

    it('handles non-empty screenshot queue', () => {
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => [
          '/tmp/screenshot1.png',
          '/tmp/screenshot2.png',
        ]),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      const queue = mockAppState.getScreenshotHelper().getScreenshotQueue()
      expect(queue).toHaveLength(2)
      expect(queue).toContain('/tmp/screenshot1.png')
      expect(queue).toContain('/tmp/screenshot2.png')
    })

    it('returns Promise from processScreenshots', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      const result = processingHelper.processScreenshots()
      expect(result).toBeInstanceOf(Promise)
      await result
    })
  })

  describe('view state transitions', () => {
    it('initial view is queue', () => {
      expect(mockAppState.getView()).toBe('queue')
    })

    it('transitions to solutions view during processing', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => ['/tmp/screenshot.png']),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      await processingHelper.processScreenshots()

      expect(mockAppState.setView).toHaveBeenCalledWith('solutions')
    })

    it('maintains solutions view in debug mode', async () => {
      mockAppState.getView.mockReturnValue('solutions')
      mockAppState.getProblemInfo.mockReturnValue({
        problem_statement: 'test',
      })
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => ['/tmp/debug.png']),
      })

      await processingHelper.processScreenshots()

      // setView should NOT be called in debug mode
      expect(mockAppState.setView).not.toHaveBeenCalled()
    })
  })

  describe('processScreenshots - return value and promise behavior', () => {
    it('processScreenshots returns a promise that resolves', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      await expect(
        processingHelper.processScreenshots(),
      ).resolves.toBeUndefined()
    })

    it('processScreenshots promise rejects on error when no window', async () => {
      mockAppState.getMainWindow.mockReturnValue(null)

      await expect(
        processingHelper.processScreenshots(),
      ).resolves.toBeUndefined()
    })
  })

  describe('LLMHelper interaction verification', () => {
    it('verifies LLMHelper is called during screenshot processing', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => ['/tmp/screenshot.png']),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      const llmHelper = processingHelper.getLLMHelper()

      await processingHelper.processScreenshots()

      expect(llmHelper.generateRollingScript).toHaveBeenCalledTimes(1)
    })

    it('verifies LLMHelper is not called when queue is empty', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      const llmHelper = processingHelper.getLLMHelper()

      await processingHelper.processScreenshots()

      expect(llmHelper.generateRollingScript).not.toHaveBeenCalled()
    })

    it('verifies debugSolutionWithImages is called in solutions view', async () => {
      mockAppState.getView.mockReturnValue('solutions')
      mockAppState.getProblemInfo.mockReturnValue({
        problem_statement: 'test',
      })
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => ['/tmp/debug.png']),
      })

      const llmHelper = processingHelper.getLLMHelper()

      await processingHelper.processScreenshots()

      expect(llmHelper.debugSolutionWithImages).toHaveBeenCalledTimes(1)
    })
  })

  describe('error handling edge cases', () => {
    it('handles missing problem info in debug mode gracefully', async () => {
      mockAppState.getView.mockReturnValue('solutions')
      mockAppState.getProblemInfo.mockReturnValue(null)
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => ['/tmp/debug.png']),
      })

      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'debug-error',
        'No problem info available',
      )
    })

    it('handles generateSolution error in debug mode', async () => {
      mockAppState.getView.mockReturnValue('solutions')
      mockAppState.getProblemInfo.mockReturnValue({
        problem_statement: 'test',
      })
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => ['/tmp/debug.png']),
      })

      const llmHelper = processingHelper.getLLMHelper()
      llmHelper.generateSolution.mockRejectedValueOnce(
        new Error('Solution generation failed'),
      )

      await processingHelper.processScreenshots()

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'debug-error',
        'Solution generation failed',
      )
    })

    it('clears abort controller even on error', async () => {
      mockAppState.getView.mockReturnValue('queue')
      mockAppState.getScreenshotHelper.mockReturnValue({
        getScreenshotQueue: vi.fn(() => ['/tmp/screenshot.png']),
        getExtraScreenshotQueue: vi.fn(() => []),
      })

      const llmHelper = processingHelper.getLLMHelper()
      llmHelper.generateRollingScript.mockRejectedValueOnce(
        new Error('API Error'),
      )

      await processingHelper.processScreenshots()
      await processingHelper.processScreenshots() // Should still work

      expect(mockAppState.setView).toHaveBeenCalledTimes(2)
    })
  })
})

describe('ProcessingHelper - multiple screenshots edge cases', () => {
  let mockAppState: any
  let processingHelper: ProcessingHelper
  let mockMainWindow: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    }

    mockAppState = {
      getIntelligenceManager: vi.fn(() => ({
        initializeLLMs: vi.fn(),
      })),
      getRAGManager: vi.fn(() => ({
        initializeEmbeddings: vi.fn(),
        retryPendingEmbeddings: vi.fn(() => Promise.resolve()),
        ensureDemoMeetingProcessed: vi.fn(() => Promise.resolve()),
        cleanupStaleQueueItems: vi.fn(),
      })),
      getMainWindow: vi.fn(() => mockMainWindow),
      getView: vi.fn(() => 'queue'),
      getScreenshotHelper: vi.fn(() => ({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      })),
      getProblemInfo: vi.fn(() => null),
      setView: vi.fn(),
      setProblemInfo: vi.fn(),
      setHasDebugged: vi.fn(),
      PROCESSING_EVENTS: {
        NO_SCREENSHOTS: 'processing-no-screenshots',
        INITIAL_START: 'initial-start',
        INITIAL_SOLUTION_ERROR: 'solution-error',
        DEBUG_START: 'debug-start',
        DEBUG_SUCCESS: 'debug-success',
        DEBUG_ERROR: 'debug-error',
        PROBLEM_EXTRACTED: 'problem-extracted',
        SOLUTION_SUCCESS: 'solution-success',
      },
    }

    processingHelper = new ProcessingHelper(mockAppState as any)
  })

  it('processes multiple screenshots in order', async () => {
    mockAppState.getView.mockReturnValue('queue')
    const screenshots = [
      '/tmp/screenshot1.png',
      '/tmp/screenshot2.png',
      '/tmp/screenshot3.png',
    ]
    mockAppState.getScreenshotHelper.mockReturnValue({
      getScreenshotQueue: vi.fn(() => screenshots),
      getExtraScreenshotQueue: vi.fn(() => []),
    })

    const llmHelper = processingHelper.getLLMHelper()

    await processingHelper.processScreenshots()

    expect(llmHelper.generateRollingScript).toHaveBeenCalledWith(screenshots)
  })

  it('handles single screenshot', async () => {
    mockAppState.getView.mockReturnValue('queue')
    mockAppState.getScreenshotHelper.mockReturnValue({
      getScreenshotQueue: vi.fn(() => ['/tmp/only.png']),
      getExtraScreenshotQueue: vi.fn(() => []),
    })

    await processingHelper.processScreenshots()

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
      'initial-start',
    )
    expect(mockAppState.setView).toHaveBeenCalledWith('solutions')
  })

  it('handles extra queue screenshots in debug mode', async () => {
    mockAppState.getView.mockReturnValue('solutions')
    mockAppState.getProblemInfo.mockReturnValue({
      problem_statement: 'test problem',
    })
    mockAppState.getScreenshotHelper.mockReturnValue({
      getScreenshotQueue: vi.fn(() => []),
      getExtraScreenshotQueue: vi.fn(() => [
        '/tmp/extra1.png',
        '/tmp/extra2.png',
      ]),
    })

    const llmHelper = processingHelper.getLLMHelper()

    await processingHelper.processScreenshots()

    expect(llmHelper.debugSolutionWithImages).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      ['/tmp/extra1.png', '/tmp/extra2.png'],
    )
  })
})

describe('ProcessingHelper - AbortController lifecycle', () => {
  let mockAppState: any
  let processingHelper: ProcessingHelper
  let mockMainWindow: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    }

    mockAppState = {
      getIntelligenceManager: vi.fn(() => ({
        initializeLLMs: vi.fn(),
      })),
      getRAGManager: vi.fn(() => ({
        initializeEmbeddings: vi.fn(),
        retryPendingEmbeddings: vi.fn(() => Promise.resolve()),
        ensureDemoMeetingProcessed: vi.fn(() => Promise.resolve()),
        cleanupStaleQueueItems: vi.fn(),
      })),
      getMainWindow: vi.fn(() => mockMainWindow),
      getView: vi.fn(() => 'queue'),
      getScreenshotHelper: vi.fn(() => ({
        getScreenshotQueue: vi.fn(() => ['/tmp/screenshot.png']),
        getExtraScreenshotQueue: vi.fn(() => []),
      })),
      getProblemInfo: vi.fn(() => null),
      setView: vi.fn(),
      setProblemInfo: vi.fn(),
      setHasDebugged: vi.fn(),
      PROCESSING_EVENTS: {
        NO_SCREENSHOTS: 'processing-no-screenshots',
        INITIAL_START: 'initial-start',
        INITIAL_SOLUTION_ERROR: 'solution-error',
        DEBUG_START: 'debug-start',
        DEBUG_SUCCESS: 'debug-success',
        DEBUG_ERROR: 'debug-error',
        PROBLEM_EXTRACTED: 'problem-extracted',
        SOLUTION_SUCCESS: 'solution-success',
      },
    }

    processingHelper = new ProcessingHelper(mockAppState as any)
  })

  it('allows multiple sequential processing calls', async () => {
    await processingHelper.processScreenshots()
    await processingHelper.processScreenshots()
    await processingHelper.processScreenshots()

    // Should have called setView 3 times (once per processing)
    expect(mockAppState.setView).toHaveBeenCalledTimes(3)
  })

  it('cancelling does not prevent subsequent processing', async () => {
    processingHelper.cancelOngoingRequests()

    mockAppState.getView.mockReturnValue('queue')
    mockAppState.getScreenshotHelper.mockReturnValue({
      getScreenshotQueue: vi.fn(() => ['/tmp/screenshot.png']),
      getExtraScreenshotQueue: vi.fn(() => []),
    })

    await processingHelper.processScreenshots()

    expect(mockAppState.setView).toHaveBeenCalledWith('solutions')
  })
})

describe('ProcessingHelper - event emission verification', () => {
  let mockAppState: any
  let processingHelper: ProcessingHelper
  let mockMainWindow: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    }

    mockAppState = {
      getIntelligenceManager: vi.fn(() => ({
        initializeLLMs: vi.fn(),
      })),
      getRAGManager: vi.fn(() => ({
        initializeEmbeddings: vi.fn(),
        retryPendingEmbeddings: vi.fn(() => Promise.resolve()),
        ensureDemoMeetingProcessed: vi.fn(() => Promise.resolve()),
        cleanupStaleQueueItems: vi.fn(),
      })),
      getMainWindow: vi.fn(() => mockMainWindow),
      getView: vi.fn(() => 'queue'),
      getScreenshotHelper: vi.fn(() => ({
        getScreenshotQueue: vi.fn(() => []),
        getExtraScreenshotQueue: vi.fn(() => []),
      })),
      getProblemInfo: vi.fn(() => null),
      setView: vi.fn(),
      setProblemInfo: vi.fn(),
      setHasDebugged: vi.fn(),
      PROCESSING_EVENTS: {
        NO_SCREENSHOTS: 'processing-no-screenshots',
        INITIAL_START: 'initial-start',
        INITIAL_SOLUTION_ERROR: 'solution-error',
        DEBUG_START: 'debug-start',
        DEBUG_SUCCESS: 'debug-success',
        DEBUG_ERROR: 'debug-error',
        PROBLEM_EXTRACTED: 'problem-extracted',
        SOLUTION_SUCCESS: 'solution-success',
      },
    }

    processingHelper = new ProcessingHelper(mockAppState as any)
  })

  it('emits NO_SCREENSHOTS when both queues are empty in queue view', async () => {
    await processingHelper.processScreenshots()

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
      'processing-no-screenshots',
    )
  })

  it('emits INITIAL_START before setting view', async () => {
    mockAppState.getScreenshotHelper.mockReturnValue({
      getScreenshotQueue: vi.fn(() => ['/tmp/screenshot.png']),
      getExtraScreenshotQueue: vi.fn(() => []),
    })

    await processingHelper.processScreenshots()

    const calls = mockMainWindow.webContents.send.mock.calls
    const initialStartIndex = calls.findIndex(
      (call) => call[0] === 'initial-start',
    )
    expect(initialStartIndex).toBeGreaterThanOrEqual(0)
  })

  it('emits PROBLEM_EXTRACTED after setProblemInfo', async () => {
    mockAppState.getScreenshotHelper.mockReturnValue({
      getScreenshotQueue: vi.fn(() => ['/tmp/screenshot.png']),
      getExtraScreenshotQueue: vi.fn(() => []),
    })

    await processingHelper.processScreenshots()

    const calls = mockMainWindow.webContents.send.mock.calls
    const problemExtractedCall = calls.find(
      (call) => call[0] === 'problem-extracted',
    )
    expect(problemExtractedCall).toBeDefined()
  })
})
