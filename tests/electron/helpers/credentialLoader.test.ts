/**
 * Tests for credentialLoader helper.
 *
 * Tests the loadStoredCredentials function which:
 * - Loads API keys from CredentialsManager into LLMHelper
 * - Initializes IntelligenceManager and RAGManager
 * - Loads default model and language settings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to create mock objects before module evaluation
const mockCredentialsManagerInstance = vi.hoisted(() => ({
  getGeminiApiKey: vi.fn(() => 'test-gemini-key'),
  getGroqApiKey: vi.fn(() => 'test-groq-key'),
  getOpenaiApiKey: vi.fn(() => 'test-openai-key'),
  getClaudeApiKey: vi.fn(() => 'test-claude-key'),
  getDefaultModel: vi.fn(() => 'gemini-3.1-flash'),
  getCustomProviders: vi.fn(() => []),
  getCurlProviders: vi.fn(() => []),
  getSttLanguage: vi.fn(() => 'en'),
  getAiResponseLanguage: vi.fn(() => 'es'),
}));

const mockLlmHelper = vi.hoisted(() => ({
  setApiKey: vi.fn(),
  setGroqApiKey: vi.fn(),
  setOpenaiApiKey: vi.fn(),
  setClaudeApiKey: vi.fn(),
  setModel: vi.fn(),
  setSttLanguage: vi.fn(),
  setAiResponseLanguage: vi.fn(),
  initModelVersionManager: vi.fn().mockResolvedValue(undefined),
}));

// Mock LLMHelper
vi.mock('../../../electron/LLMHelper', () => ({
  LLMHelper: vi.fn(),
}));

// Mock CredentialsManager
vi.mock('../../../electron/services/CredentialsManager', () => ({
  CredentialsManager: {
    getInstance: vi.fn(() => mockCredentialsManagerInstance),
  },
}));

// Import after mocks are set up
import { loadStoredCredentials } from '../../../electron/helpers/credentialLoader';

describe('credentialLoader', () => {
  let mockIntelligenceManager: { initializeLLMs: ReturnType<typeof vi.fn> };
  let mockRAGManager: {
    initializeEmbeddings: ReturnType<typeof vi.fn>;
    retryPendingEmbeddings: ReturnType<typeof vi.fn>;
    ensureDemoMeetingProcessed: ReturnType<typeof vi.fn>;
    cleanupStaleQueueItems: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset all mocks
    mockLlmHelper.setApiKey.mockClear();
    mockLlmHelper.setGroqApiKey.mockClear();
    mockLlmHelper.setOpenaiApiKey.mockClear();
    mockLlmHelper.setClaudeApiKey.mockClear();
    mockLlmHelper.setModel.mockClear();
    mockLlmHelper.setSttLanguage.mockClear();
    mockLlmHelper.setAiResponseLanguage.mockClear();
    mockLlmHelper.initModelVersionManager.mockClear().mockResolvedValue(undefined);

    // Reset CredentialsManager mock to default values
    mockCredentialsManagerInstance.getGeminiApiKey.mockReturnValue('test-gemini-key');
    mockCredentialsManagerInstance.getGroqApiKey.mockReturnValue('test-groq-key');
    mockCredentialsManagerInstance.getOpenaiApiKey.mockReturnValue('test-openai-key');
    mockCredentialsManagerInstance.getClaudeApiKey.mockReturnValue('test-claude-key');
    mockCredentialsManagerInstance.getDefaultModel.mockReturnValue('gemini-3.1-flash');
    mockCredentialsManagerInstance.getCustomProviders.mockReturnValue([]);
    mockCredentialsManagerInstance.getCurlProviders.mockReturnValue([]);
    mockCredentialsManagerInstance.getSttLanguage.mockReturnValue('en');
    mockCredentialsManagerInstance.getAiResponseLanguage.mockReturnValue('es');

    // Setup managers - use vi.fn() directly to get fresh mocks
    mockIntelligenceManager = {
      initializeLLMs: vi.fn(),
    };

    mockRAGManager = {
      initializeEmbeddings: vi.fn(),
      retryPendingEmbeddings: vi.fn().mockResolvedValue(undefined),
      ensureDemoMeetingProcessed: vi.fn().mockResolvedValue(undefined),
      cleanupStaleQueueItems: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper function inside describe block so it can access let variables
  function createAppState() {
    return {
      getIntelligenceManager: () => mockIntelligenceManager,
      getRAGManager: () => mockRAGManager,
    };
  }

  describe('loadStoredCredentials', () => {
    it('is a function', () => {
      expect(typeof loadStoredCredentials).toBe('function');
    });

    describe('API key loading', () => {
      it('loads Gemini API key when available', () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setApiKey).toHaveBeenCalledWith('test-gemini-key');
      });

      it('loads Groq API key when available', () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setGroqApiKey).toHaveBeenCalledWith('test-groq-key');
      });

      it('loads OpenAI API key when available', () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setOpenaiApiKey).toHaveBeenCalledWith('test-openai-key');
      });

      it('loads Claude API key when available', () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setClaudeApiKey).toHaveBeenCalledWith('test-claude-key');
      });

      it('does not load Gemini key when not available', () => {
        mockCredentialsManagerInstance.getGeminiApiKey.mockReturnValue(null);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setApiKey).not.toHaveBeenCalled();
      });

      it('does not load Groq key when not available', () => {
        mockCredentialsManagerInstance.getGroqApiKey.mockReturnValue(null);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setGroqApiKey).not.toHaveBeenCalled();
      });

      it('does not load OpenAI key when not available', () => {
        mockCredentialsManagerInstance.getOpenaiApiKey.mockReturnValue(null);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setOpenaiApiKey).not.toHaveBeenCalled();
      });

      it('does not load Claude key when not available', () => {
        mockCredentialsManagerInstance.getClaudeApiKey.mockReturnValue(null);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setClaudeApiKey).not.toHaveBeenCalled();
      });
    });

    describe('manager initialization', () => {
      it('initializes IntelligenceManager after loading keys', () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockIntelligenceManager.initializeLLMs).toHaveBeenCalled();
      });

      it('initializes RAGManager when available', () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockRAGManager.initializeEmbeddings).toHaveBeenCalled();
      });

      it('initializes RAGManager with both keys when available', () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockRAGManager.initializeEmbeddings).toHaveBeenCalledWith({
          openaiKey: 'test-openai-key',
          geminiKey: 'test-gemini-key',
        });
      });

      it('initializes RAGManager with only openaiKey when gemini is null', () => {
        mockCredentialsManagerInstance.getGeminiApiKey.mockReturnValue(null);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockRAGManager.initializeEmbeddings).toHaveBeenCalledWith({
          openaiKey: 'test-openai-key',
          geminiKey: undefined,
        });
      });

      it('initializes RAGManager with only geminiKey when openai is null', () => {
        mockCredentialsManagerInstance.getOpenaiApiKey.mockReturnValue(null);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockRAGManager.initializeEmbeddings).toHaveBeenCalledWith({
          openaiKey: undefined,
          geminiKey: 'test-gemini-key',
        });
      });

      it('retries pending embeddings after initializing', async () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        // Wait for async operations
        await vi.waitFor(() => {
          expect(mockRAGManager.retryPendingEmbeddings).toHaveBeenCalled();
        });
      });

      it('ensures demo meeting is processed', async () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        await vi.waitFor(() => {
          expect(mockRAGManager.ensureDemoMeetingProcessed).toHaveBeenCalled();
        });
      });

      it('cleans up stale queue items', () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockRAGManager.cleanupStaleQueueItems).toHaveBeenCalled();
      });

      it('does not fail when RAGManager is null', () => {
        const appState = {
          getIntelligenceManager: () => mockIntelligenceManager,
          getRAGManager: () => null as any,
        };
        // Should not throw
        expect(() => loadStoredCredentials(mockLlmHelper as any, appState)).not.toThrow();
      });
    });

    describe('default model loading', () => {
      it('loads default model when available', () => {
        mockCredentialsManagerInstance.getDefaultModel.mockReturnValue('gemini-3.1-flash-lite');
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setModel).toHaveBeenCalled();
      });

      it('passes custom and curl providers to setModel', () => {
        const customProviders = [{ name: 'custom', endpoint: 'http://custom' }];
        const curlProviders = [{ name: 'curl', endpoint: 'http://curl' }];
        mockCredentialsManagerInstance.getCustomProviders.mockReturnValue(customProviders);
        mockCredentialsManagerInstance.getCurlProviders.mockReturnValue(curlProviders);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setModel).toHaveBeenCalledWith(
          'gemini-3.1-flash',
          expect.arrayContaining([...customProviders, ...curlProviders])
        );
      });

      it('does not call setModel when no default model', () => {
        mockCredentialsManagerInstance.getDefaultModel.mockReturnValue(null);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setModel).not.toHaveBeenCalled();
      });
    });

    describe('language loading', () => {
      it('loads STT language when available', () => {
        mockCredentialsManagerInstance.getSttLanguage.mockReturnValue('fr');
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setSttLanguage).toHaveBeenCalledWith('fr');
      });

      it('loads AI response language when available', () => {
        mockCredentialsManagerInstance.getAiResponseLanguage.mockReturnValue('de');
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setAiResponseLanguage).toHaveBeenCalledWith('de');
      });

      it('does not load STT language when not available', () => {
        mockCredentialsManagerInstance.getSttLanguage.mockReturnValue(null);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setSttLanguage).not.toHaveBeenCalled();
      });

      it('does not load AI response language when not available', () => {
        mockCredentialsManagerInstance.getAiResponseLanguage.mockReturnValue(null);
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        expect(mockLlmHelper.setAiResponseLanguage).not.toHaveBeenCalled();
      });
    });

    describe('model version manager initialization', () => {
      it('initializes model version manager', async () => {
        const appState = createAppState();
        loadStoredCredentials(mockLlmHelper as any, appState);
        // The init is non-blocking, so we just verify the call was made
        await vi.waitFor(() => {
          expect(mockLlmHelper.initModelVersionManager).toHaveBeenCalled();
        });
      });

      it('handles model version manager errors gracefully', async () => {
        mockLlmHelper.initModelVersionManager.mockRejectedValueOnce(new Error('Non-critical error'));
        const appState = createAppState();
        // Should not throw
        expect(() => loadStoredCredentials(mockLlmHelper as any, appState)).not.toThrow();
      });
    });
  });
});