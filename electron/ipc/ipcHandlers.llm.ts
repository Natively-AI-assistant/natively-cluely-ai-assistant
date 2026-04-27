/**
 * LLM handlers extracted from ipcHandlers.ts.
 * Handles LLM provider switching, API keys, custom/curl providers, Ollama.
 */

import * as path from 'node:path'
import { app } from 'electron'
import type { AppState } from '../main'
import { safeHandle } from './safeHandle'

const _usageCache = new Map<string, { data: unknown; ts: number }>();
const USAGE_CACHE_TTL_MS = 60_000;

export function registerLLMHandlers(appState: AppState): void {
  safeHandle('get-current-llm-config', async () => {
    const llmHelper = appState.processingHelper.getLLMHelper()
    return {
      provider: llmHelper.getCurrentProvider(),
      model: llmHelper.getCurrentModel(),
      isOllama: llmHelper.isUsingOllama(),
    }
  })

  safeHandle('reset-intelligence', async () => {
    const intManager = appState.getIntelligenceManager()
    try {
      const result = await intManager.reset()
      return { success: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  safeHandle('get-intelligence-context', async () => {
    const intManager = appState.getIntelligenceManager()
    return {
      context: intManager.getFormattedContext(),
      lastAssistantMessage: intManager.getLastAssistantMessage(),
      activeMode: intManager.getActiveMode(),
    }
  })

  safeHandle('generate-recap', async () => {
    const intManager = appState.getIntelligenceManager()
    const result = await intManager.runRecap()
    return { summary: result || '' }
  })

  safeHandle(
    'generate-follow-up',
    async (_, intent: string, userRequest?: string) => {
      const intManager = appState.getIntelligenceManager()
      const result = await intManager.runFollowUp(intent, userRequest)
      return { refined: result || '', intent }
    },
  )

  safeHandle('generate-followup-email', async (_, input: any) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      const {
        FOLLOWUP_EMAIL_PROMPT,
        GROQ_FOLLOWUP_EMAIL_PROMPT,
      } = require('../llm/prompts')
      const { buildFollowUpEmailPromptInput } = require('../utils/emailUtils')
      const contextString = buildFollowUpEmailPromptInput(input)
      const geminiPrompt = `${FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`
      const groqPrompt = `${GROQ_FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`
      const emailBody = await llmHelper.chatWithGemini(
        geminiPrompt,
        undefined,
        undefined,
        true,
        groqPrompt,
      )
      return { email: emailBody }
    } catch (error: any) {
      return { email: '', error: error.message }
    }
  })

  safeHandle(
    'generate-what-to-say',
    async (_, question?: string, imagePaths?: string[]) => {
      try {
        const intManager = appState.getIntelligenceManager()
        let images = imagePaths
        if (!images || images.length === 0) {
          images = appState.getScreenshotQueue()
        }
        const result = await intManager.runWhatShouldISay(question, 0.8, images)
        return { answer: result || '', question: question || 'unknown' }
      } catch (error: any) {
        return {
          answer: '',
          question: question || 'unknown',
          error: error.message,
        }
      }
    },
  )

  safeHandle('generate-assist', async () => {
    try {
      const intManager = appState.getIntelligenceManager()
      const result = await intManager.runAssistMode()
      return { insight: result }
    } catch (error: any) {
      return { insight: '', error: error.message }
    }
  })

  safeHandle(
    'generate-brainstorm',
    async (_, imagePaths?: string[], problemStatement?: string) => {
      const intManager = appState.getIntelligenceManager()
      let images = imagePaths
      if (!images || images.length === 0) {
        images = appState.getScreenshotQueue()
      }
      const result = await intManager.runBrainstorm(images, problemStatement)
      return { script: result }
    },
  )

  safeHandle('generate-clarify', async () => {
    try {
      const intManager = appState.getIntelligenceManager()
      const result = await intManager.runClarify()
      if (!result) {
        const mainWindow = appState.getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('intelligence-error', {
            error: 'Could not generate clarification',
            mode: 'clarify',
          })
        }
      }
      return { clarification: result }
    } catch (error: any) {
      return { clarification: '', error: error.message }
    }
  })

  safeHandle(
    'generate-code-hint',
    async (_, imagePaths?: string[], problemStatement?: string) => {
      const intManager = appState.getIntelligenceManager()
      let images = imagePaths
      if (!images || images.length === 0) {
        images = appState.getScreenshotQueue()
      }
      const result = await intManager.runCodeHint(images, problemStatement)
      return { hint: result }
    },
  )

  safeHandle('generate-follow-up-questions', async () => {
    try {
      const intManager = appState.getIntelligenceManager()
      const result = await intManager.runFollowUpQuestions()
      return { questions: result || '' }
    } catch (error: any) {
      return { questions: '', error: error.message }
    }
  })

  safeHandle(
    'extract-emails-from-transcript',
    async (_, transcript: Array<{ text: string }>) => {
      try {
        const { extractEmailsFromTranscript } = require('../utils/emailUtils')
        return { emails: extractEmailsFromTranscript(transcript) }
      } catch (error: any) {
        return { emails: [], error: error.message }
      }
    },
  )

  safeHandle('get-available-ollama-models', async () => {
    const llmHelper = appState.processingHelper.getLLMHelper()
    const models = await llmHelper.getOllamaModels()
    return models
  })

  safeHandle('switch-to-ollama', async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      await llmHelper.switchToOllama(model, url)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  safeHandle('force-restart-ollama', async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      const success = await llmHelper.forceRestartOllama()
      return { success }
    } catch (error: any) {
      console.error('Error force restarting Ollama:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('restart-ollama', async () => {
    try {
      await appState.processingHelper.getLLMHelper().forceRestartOllama()
      return true
    } catch (error: any) {
      console.error('[IPC restart-ollama] Failed to restart:', error)
      return false
    }
  })

  safeHandle('ensure-ollama-running', async () => {
    try {
      const { OllamaManager } = require('../services/OllamaManager')
      await OllamaManager.getInstance().init()
      return { success: true }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  })

  safeHandle(
    'switch-to-gemini',
    async (_, apiKey?: string, modelId?: string) => {
      try {
        const llmHelper = appState.processingHelper.getLLMHelper()
        await llmHelper.switchToGemini(apiKey, modelId)
        if (apiKey) {
          const {
            CredentialsManager,
          } = require('../services/CredentialsManager')
          CredentialsManager.getInstance().setGeminiApiKey(apiKey)
        }
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    },
  )

  safeHandle('set-gemini-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      CredentialsManager.getInstance().setGeminiApiKey(apiKey)
      const llmHelper = appState.processingHelper.getLLMHelper()
      llmHelper.setApiKey(apiKey)
      appState.getIntelligenceManager().resetEngine()
      appState.getIntelligenceManager().initializeLLMs()
      return { success: true }
    } catch (error: any) {
      console.error('Error saving Gemini API key:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('set-groq-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      CredentialsManager.getInstance().setGroqApiKey(apiKey)
      const llmHelper = appState.processingHelper.getLLMHelper()
      llmHelper.setGroqApiKey(apiKey)
      appState.getIntelligenceManager().resetEngine()
      appState.getIntelligenceManager().initializeLLMs()
      return { success: true }
    } catch (error: any) {
      console.error('Error saving Groq API key:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('set-openai-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      CredentialsManager.getInstance().setOpenaiApiKey(apiKey)
      const llmHelper = appState.processingHelper.getLLMHelper()
      llmHelper.setOpenaiApiKey(apiKey)
      appState.getIntelligenceManager().resetEngine()
      appState.getIntelligenceManager().initializeLLMs()
      return { success: true }
    } catch (error: any) {
      console.error('Error saving OpenAI API key:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('set-claude-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      CredentialsManager.getInstance().setClaudeApiKey(apiKey)
      const llmHelper = appState.processingHelper.getLLMHelper()
      llmHelper.setClaudeApiKey(apiKey)
      appState.getIntelligenceManager().resetEngine()
      appState.getIntelligenceManager().initializeLLMs()
      return { success: true }
    } catch (error: any) {
      console.error('Error saving Claude API key:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('set-natively-api-key', async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      CredentialsManager.getInstance().setNativelyApiKey(apiKey)
      return { success: true }
    } catch (error: any) {
      console.error('Error saving Natively API key:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('get-natively-usage', async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      const key = CredentialsManager.getInstance().getNativelyApiKey()
      if (!key) return { ok: false, error: 'no_key' }

      const cached = _usageCache.get(key)
      if (cached && Date.now() - cached.ts < USAGE_CACHE_TTL_MS) {
        return cached.data
      }

      const res = await fetch('https://api.natively.software/v1/usage', {
        headers: { 'x-natively-key': key },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as any
        return { ok: false, error: body.error || 'request_failed', status: res.status }
      }
      const data = await res.json() as any
      const result = { ok: true, ...data }

      _usageCache.set(key, { data: result, ts: Date.now() })
      return result
    } catch (error: any) {
      return { ok: false, error: error.message || 'network_error' }
    }
  })

  safeHandle('invalidate-natively-usage-cache', () => {
    _usageCache.clear()
    return { ok: true }
  })

  safeHandle('get-custom-providers', async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      const cm = CredentialsManager.getInstance()
      const curlProviders = cm.getCurlProviders()
      const legacyProviders = cm.getCustomProviders() || []
      return [...curlProviders, ...legacyProviders]
    } catch (error: any) {
      console.error('Error getting custom providers:', error)
      return []
    }
  })

  safeHandle('save-custom-provider', async (_, provider: unknown) => {
    try {
      if (
        typeof provider !== 'object' ||
        provider === null ||
        typeof (provider as any).id !== 'string' ||
        typeof (provider as any).name !== 'string' ||
        typeof (provider as any).curlCommand !== 'string'
      ) {
        console.error(
          '[IPC] save-custom-provider: invalid payload shape',
          typeof provider,
        )
        return { success: false, error: 'Invalid provider payload' }
      }

      const curlCmd: string = (provider as any).curlCommand
      if (!curlCmd.includes('{{TEXT}}')) {
        return {
          success: false,
          error: 'curlCommand must contain {{TEXT}} placeholder for the prompt',
        }
      }

      const { CredentialsManager } = require('../services/CredentialsManager')
      CredentialsManager.getInstance().saveCurlProvider(provider)
      return { success: true }
    } catch (error: any) {
      console.error('Error saving custom provider:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('delete-custom-provider', async (_, id: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      CredentialsManager.getInstance().deleteCurlProvider(id)
      CredentialsManager.getInstance().deleteCustomProvider(id)
      return { success: true }
    } catch (error: any) {
      console.error('Error deleting custom provider:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('switch-to-custom-provider', async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      const cm = CredentialsManager.getInstance()
      const provider = [
        ...(cm.getCurlProviders() || []),
        ...(cm.getCustomProviders() || []),
      ].find((p: any) => p.id === providerId)

      if (!provider) {
        throw new Error('Provider not found')
      }

      const llmHelper = appState.processingHelper.getLLMHelper()
      await llmHelper.switchToCustom(provider)
      appState.getIntelligenceManager().initializeLLMs()
      return { success: true }
    } catch (error: any) {
      console.error('Error switching to custom provider:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('get-curl-providers', async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      return CredentialsManager.getInstance().getCurlProviders()
    } catch (error: any) {
      console.error('Error getting curl providers:', error)
      return []
    }
  })

  safeHandle('save-curl-provider', async (_, provider: any) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      CredentialsManager.getInstance().saveCurlProvider(provider)
      return { success: true }
    } catch (error: any) {
      console.error('Error saving curl provider:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('delete-curl-provider', async (_, id: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      CredentialsManager.getInstance().deleteCurlProvider(id)
      return { success: true }
    } catch (error: any) {
      console.error('Error deleting curl provider:', error)
      return { success: false, error: error.message }
    }
  })

  safeHandle('switch-to-curl-provider', async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      const provider = CredentialsManager.getInstance()
        .getCurlProviders()
        .find((p: any) => p.id === providerId)

      if (!provider) {
        throw new Error('Provider not found')
      }

      const llmHelper = appState.processingHelper.getLLMHelper()
      await llmHelper.switchToCurl(provider)
      appState.getIntelligenceManager().initializeLLMs()
      return { success: true }
    } catch (error: any) {
      console.error('Error switching to curl provider:', error)
      return { success: false, error: error.message }
    }
  })

  // Chat handlers
  safeHandle(
    'generate-suggestion',
    async (event, context: string, lastQuestion: string) => {
      try {
        const suggestion = await appState.processingHelper
          .getLLMHelper()
          .generateSuggestion(context, lastQuestion)
        return { suggestion }
      } catch (error: any) {
        throw error
      }
    },
  )

  safeHandle(
    'gemini-chat',
    async (
      event,
      message: string,
      imagePaths?: string[],
      context?: string,
      options?: { skipSystemPrompt?: boolean },
    ) => {
      try {
        const result = await appState.processingHelper
          .getLLMHelper()
          .chatWithGemini(
            message,
            imagePaths,
            context,
            options?.skipSystemPrompt,
          )
        console.log(
          `[IPC] gemini - chat response: `,
          result ? result.substring(0, 50) : '(empty)',
        )

        if (!result || result.trim().length === 0) {
          console.warn(
            '[IPC] Empty response from LLM, not updating IntelligenceManager',
          )
          return "I apologize, but I couldn't generate a response. Please try again."
        }

        const intelligenceManager = appState.getIntelligenceManager()
        intelligenceManager.addTranscript(
          {
            text: message,
            speaker: 'user',
            timestamp: Date.now(),
            final: true,
          },
          true,
        )

        console.log(
          `[IPC] Updating IntelligenceManager with assistant message...`,
        )
        intelligenceManager.addAssistantMessage(result)
        console.log(
          `[IPC] Updated IntelligenceManager.Last message: `,
          intelligenceManager.getLastAssistantMessage()?.substring(0, 50),
        )

        intelligenceManager.logUsage('chat', message, result)
        return result
      } catch (error: any) {
        throw error
      }
    },
  )

  // Streaming chat
  let _chatStreamId = 0

  safeHandle(
    'gemini-chat-stream',
    async (
      event,
      message: string,
      imagePaths?: string[],
      context?: string,
      options?: { skipSystemPrompt?: boolean },
    ) => {
      try {
        console.log(
          '[IPC] gemini-chat-stream started using LLMHelper.streamChat',
        )
        const llmHelper = appState.processingHelper.getLLMHelper()
        const myStreamId = ++_chatStreamId

        const intelligenceManager = appState.getIntelligenceManager()
        intelligenceManager.addTranscript(
          {
            text: message,
            speaker: 'user',
            timestamp: Date.now(),
            final: true,
          },
          true,
        )

        let fullResponse = ''

        if (!context) {
          try {
            const autoContext = intelligenceManager.getFormattedContext(100)
            if (autoContext && autoContext.trim().length > 0) {
              context = autoContext
              console.log(
                `[IPC] Auto - injected 100s context for gemini - chat - stream(${context.length} chars)`,
              )
            }
          } catch (ctxErr) {
            console.warn('[IPC] Failed to auto-inject context:', ctxErr)
          }
        }

        try {
          const stream = llmHelper.streamChat(
            message,
            imagePaths,
            context,
            options?.skipSystemPrompt ? '' : undefined,
          )

          for await (const token of stream) {
            if (_chatStreamId !== myStreamId) {
              console.log(
                `[IPC] gemini-chat-stream ${myStreamId} superseded by ${_chatStreamId}, stopping.`,
              )
              return null
            }
            event.sender.send('gemini-stream-token', token)
            fullResponse += token
          }

          if (_chatStreamId === myStreamId) {
            event.sender.send('gemini-stream-done')
            if (fullResponse.trim().length > 0) {
              intelligenceManager.addAssistantMessage(fullResponse)
              intelligenceManager.logUsage('chat', message, fullResponse)
            }
          }
        } catch (streamError: any) {
          console.error('[IPC] Streaming error:', streamError)
          if (_chatStreamId === myStreamId) {
            event.sender.send(
              'gemini-stream-error',
              streamError.message || 'Unknown streaming error',
            )
          }
        }

        return null
      } catch (error: any) {
        console.error('[IPC] Error in gemini-chat-stream setup:', error)
        throw error
      }
    },
  )

  safeHandle('analyze-image-file', async (event, filePath: string) => {
    const userDataDir = app.getPath('userData')
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn(
        '[IPC] analyze-image-file: path outside userData rejected:',
        filePath,
      )
      throw new Error('Path not allowed')
    }
    try {
      const result = await appState.processingHelper
        .getLLMHelper()
        .analyzeImageFiles([resolved])
      return result
    } catch (error: any) {
      throw error
    }
  })
}
