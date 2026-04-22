/**
 * Tests for LLM IPC handlers - verifying actual handler behavior.
 * 
 * ECORE-04 Gap: Previous tests only verified handlers were registered with ipcMain.handle,
 * not that invoking them produces correct results.
 * 
 * These tests verify handler invocation and response behavior for handlers
 * that don't require external module mocking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { registerLLMHandlers } from '../../../electron/ipc/ipcHandlers.llm';

describe('ipcHandlers.llm - handler behavior tests', () => {
  let mockAppState: any;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create mock LLMHelper
    const mockLlmHelper = {
      getCurrentProvider: vi.fn(() => 'gemini'),
      getCurrentModel: vi.fn(() => 'gemini-3.1-flash'),
      isUsingOllama: vi.fn(() => false),
      getOllamaModels: vi.fn(() => Promise.resolve(['llama3.1', 'mistral'])),
      switchToOllama: vi.fn(() => Promise.resolve()),
      forceRestartOllama: vi.fn(() => Promise.resolve(true)),
      switchToGemini: vi.fn(() => Promise.resolve()),
      setApiKey: vi.fn(),
      setGroqApiKey: vi.fn(),
      setOpenaiApiKey: vi.fn(),
      setClaudeApiKey: vi.fn(),
      switchToCustom: vi.fn(() => Promise.resolve()),
      switchToCurl: vi.fn(() => Promise.resolve()),
      generateSuggestion: vi.fn(() => Promise.resolve('suggestion')),
      chatWithGemini: vi.fn(() => Promise.resolve('response')),
      streamChat: vi.fn(() => ({ [Symbol.asyncIterator]: () => ({}) })),
      analyzeImageFiles: vi.fn(() => Promise.resolve({ analysis: 'test' })),
    };

    // Create mock IntelligenceManager
    const mockIntelligenceManager = {
      resetEngine: vi.fn(),
      initializeLLMs: vi.fn(),
      addTranscript: vi.fn(),
      addAssistantMessage: vi.fn(),
      getFormattedContext: vi.fn(() => ''),
      logUsage: vi.fn(),
      getLastAssistantMessage: vi.fn(() => ''),
    };

    mockAppState = {
      processingHelper: {
        getLLMHelper: vi.fn(() => mockLlmHelper),
      },
      getIntelligenceManager: vi.fn(() => mockIntelligenceManager),
    };

    // Capture registered handlers
    handlers = new Map();
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, fn: Function) => {
      handlers.set(channel, fn);
    });

    // Register handlers
    registerLLMHandlers(mockAppState);
  });

  describe('get-current-llm-config', () => {
    it('returns provider, model, and Ollama status', async () => {
      const handler = handlers.get('get-current-llm-config')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result).toEqual({
        provider: 'gemini',
        model: 'gemini-3.1-flash',
        isOllama: false,
      });
    });

    it('returns correct provider via LLMHelper', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.getCurrentProvider.mockReturnValueOnce('openai');
      llmHelper.getCurrentModel.mockReturnValueOnce('gpt-4');
      llmHelper.isUsingOllama.mockReturnValueOnce(false);

      const handler = handlers.get('get-current-llm-config')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
      expect(result.isOllama).toBe(false);
    });

    it('returns correct isUsingOllama status', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.isUsingOllama.mockReturnValueOnce(true);

      const handler = handlers.get('get-current-llm-config')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result.isOllama).toBe(true);
    });
  });

  describe('get-available-ollama-models', () => {
    it('returns array of Ollama models', async () => {
      const handler = handlers.get('get-available-ollama-models')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result).toEqual(['llama3.1', 'mistral']);
    });

    it('returns empty array when no models available', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.getOllamaModels.mockResolvedValueOnce([]);

      const handler = handlers.get('get-available-ollama-models')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result).toEqual([]);
    });
  });

  describe('switch-to-ollama', () => {
    it('returns success when switching with model and URL', async () => {
      const handler = handlers.get('switch-to-ollama')!;
      const result = await handler({} as IpcMainInvokeEvent, 'llama3.1', 'http://localhost:11434');
      
      expect(result).toEqual({ success: true });
    });

    it('returns success when switching with just model', async () => {
      const handler = handlers.get('switch-to-ollama')!;
      const result = await handler({} as IpcMainInvokeEvent, 'llama3.1');
      
      expect(result).toEqual({ success: true });
    });

    it('returns error when switching fails', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.switchToOllama.mockRejectedValueOnce(new Error('Connection failed'));

      const handler = handlers.get('switch-to-ollama')!;
      const result = await handler({} as IpcMainInvokeEvent, 'llama3.1');
      
      expect(result).toEqual({ success: false, error: 'Connection failed' });
    });

    it('returns error when Ollama is not running', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.switchToOllama.mockRejectedValueOnce(new Error('Not running'));

      const handler = handlers.get('switch-to-ollama')!;
      const result = await handler({} as IpcMainInvokeEvent, 'llama3.1', 'http://localhost:11434');
      
      expect(result).toEqual({ success: false, error: 'Not running' });
    });
  });

  describe('generate-suggestion', () => {
    it('returns suggestion object with text', async () => {
      const handler = handlers.get('generate-suggestion')!;
      const result = await handler({} as IpcMainInvokeEvent, 'context here', 'last question');
      
      expect(result).toEqual({ suggestion: 'suggestion' });
    });

    it('returns custom suggestion when provided by LLM', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.generateSuggestion.mockResolvedValueOnce('custom suggestion text');

      const handler = handlers.get('generate-suggestion')!;
      const result = await handler({} as IpcMainInvokeEvent, 'context', 'question');
      
      expect(result).toEqual({ suggestion: 'custom suggestion text' });
    });

    it('passes context and lastQuestion to LLMHelper', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();

      const handler = handlers.get('generate-suggestion')!;
      await handler({} as IpcMainInvokeEvent, 'my context', 'my question?');
      
      expect(llmHelper.generateSuggestion).toHaveBeenCalledWith('my context', 'my question?');
    });
  });

  describe('force-restart-ollama', () => {
    it('returns success when restart succeeds', async () => {
      const handler = handlers.get('force-restart-ollama')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result).toEqual({ success: true });
    });

    it('returns error when restart fails', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.forceRestartOllama.mockRejectedValueOnce(new Error('Not running'));

      const handler = handlers.get('force-restart-ollama')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result).toEqual({ success: false, error: 'Not running' });
    });

    it('returns error when Ollama is not installed', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.forceRestartOllama.mockRejectedValueOnce(new Error('Ollama not found'));

      const handler = handlers.get('force-restart-ollama')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result).toEqual({ success: false, error: 'Ollama not found' });
    });
  });

  describe('restart-ollama', () => {
    it('returns true when restart succeeds', async () => {
      const handler = handlers.get('restart-ollama')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result).toBe(true);
    });

    it('returns false when restart fails', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.forceRestartOllama.mockRejectedValueOnce(new Error('Failed'));

      const handler = handlers.get('restart-ollama')!;
      const result = await handler({} as IpcMainInvokeEvent);
      
      expect(result).toBe(false);
    });

    it('calls forceRestartOllama on LLMHelper', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();

      const handler = handlers.get('restart-ollama')!;
      await handler({} as IpcMainInvokeEvent);
      
      expect(llmHelper.forceRestartOllama).toHaveBeenCalled();
    });
  });

  describe('gemini-chat', () => {
    it('returns chat response', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.chatWithGemini.mockResolvedValueOnce('Hello, how can I help?');

      const handler = handlers.get('gemini-chat')!;
      const result = await handler({} as IpcMainInvokeEvent, 'Hello');
      
      expect(result).toBe('Hello, how can I help?');
    });

    it('adds transcript and assistant message to IntelligenceManager', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.chatWithGemini.mockResolvedValueOnce('response');

      const handler = handlers.get('gemini-chat')!;
      await handler({} as IpcMainInvokeEvent, 'Hello');
      
      expect(mockAppState.getIntelligenceManager().addTranscript).toHaveBeenCalled();
      expect(mockAppState.getIntelligenceManager().addAssistantMessage).toHaveBeenCalledWith('response');
    });

    it('returns fallback message on empty response', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.chatWithGemini.mockResolvedValueOnce('');

      const handler = handlers.get('gemini-chat')!;
      const result = await handler({} as IpcMainInvokeEvent, 'Hello');
      
      expect(result).toBe('I apologize, but I couldn\'t generate a response. Please try again.');
    });

    it('passes context and imagePaths to LLMHelper', async () => {
      const llmHelper = mockAppState.processingHelper.getLLMHelper();
      llmHelper.chatWithGemini.mockResolvedValueOnce('response');

      const handler = handlers.get('gemini-chat')!;
      await handler({} as IpcMainInvokeEvent, 'Hello', ['/path/to/image.png'], 'context here');
      
      expect(llmHelper.chatWithGemini).toHaveBeenCalledWith('Hello', ['/path/to/image.png'], 'context here', undefined);
    });
  });
});
