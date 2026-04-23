/**
 * Settings handlers extracted from ipcHandlers.ts.
 * Handles preferences, disguise, overlay, login settings.
 */

import { app } from 'electron'
import type { AppState } from '../main'
import { safeHandle } from './safeHandle'

const sanitizeErrorMessage = (msg: string): string => {
  return msg.replace(/:\s*[\w-]+\*+[\w*]*\.?$/g, '').trim()
}

export function registerSettingsHandlers(appState: AppState): void {
  safeHandle('set-undetectable', async (_, state: boolean) => {
    appState.setUndetectable(state)
    return { success: true }
  })

  safeHandle('get-undetectable', async () => {
    return appState.getUndetectable()
  })

  safeHandle(
    'set-disguise',
    async (_, mode: 'terminal' | 'settings' | 'activity' | 'none') => {
      appState.setDisguise(mode)
      return { success: true }
    },
  )

  safeHandle('get-disguise', async () => {
    return appState.getDisguise()
  })

  safeHandle('set-overlay-mouse-passthrough', async (_, enabled: boolean) => {
    appState.setOverlayMousePassthrough(enabled)
    return { success: true }
  })

  safeHandle('toggle-overlay-mouse-passthrough', async () => {
    const enabled = appState.toggleOverlayMousePassthrough()
    return { success: true, enabled }
  })

  safeHandle('get-overlay-mouse-passthrough', async () => {
    return appState.getOverlayMousePassthrough()
  })

  safeHandle('set-open-at-login', async (_, openAtLogin: boolean) => {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
      path: app.getPath('exe'),
    })
    return { success: true }
  })

  safeHandle('get-open-at-login', async () => {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  })

  safeHandle('get-verbose-logging', async () => {
    return appState.getVerboseLogging()
  })

  safeHandle('set-verbose-logging', async (_, enabled: boolean) => {
    appState.setVerboseLogging(enabled)
    return { success: true }
  })

  safeHandle('get-arch', async () => {
    return process.arch
  })

  safeHandle('toggle-settings-window', (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y)
  })

  safeHandle('close-settings-window', () => {
    appState.settingsWindowHelper.closeWindow()
  })

  safeHandle('get-stored-credentials', async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager')
      const creds = CredentialsManager.getInstance().getAllCredentials()
      const hasKey = (key?: string) => !!(key && key.trim().length > 0)
      return {
        hasGeminiKey: hasKey(creds.geminiApiKey),
        hasGroqKey: hasKey(creds.groqApiKey),
        hasOpenaiKey: hasKey(creds.openaiApiKey),
        hasClaudeKey: hasKey(creds.claudeApiKey),
        hasNativelyKey: hasKey(creds.nativelyApiKey),
        googleServiceAccountPath: creds.googleServiceAccountPath || null,
        sttProvider: creds.sttProvider || 'google',
        groqSttModel: creds.groqSttModel || 'whisper-large-v3-turbo',
        hasSttGroqKey: hasKey(creds.groqSttApiKey),
        hasSttOpenaiKey: hasKey(creds.openAiSttApiKey),
        hasDeepgramKey: hasKey(creds.deepgramApiKey),
        hasElevenLabsKey: hasKey(creds.elevenLabsApiKey),
        hasAzureKey: hasKey(creds.azureApiKey),
        azureRegion: creds.azureRegion || null,
        hasIbmWatsonKey: hasKey(creds.ibmWatsonApiKey),
        ibmWatsonRegion: creds.ibmWatsonRegion || null,
        hasSonioxKey: hasKey(creds.sonioxApiKey),
        hasTavilyKey: hasKey(creds.tavilyApiKey),
        geminiPreferredModel: creds.geminiPreferredModel || null,
        groqPreferredModel: creds.groqPreferredModel || null,
        openaiPreferredModel: creds.openaiPreferredModel || null,
        claudePreferredModel: creds.claudePreferredModel || null,
      }
    } catch (error) {
      return {
        hasGeminiKey: false,
        hasGroqKey: false,
        hasOpenaiKey: false,
        hasClaudeKey: false,
        hasNativelyKey: false,
      }
    }
  })

  safeHandle('get-action-button-mode', async () => {
    const { SettingsManager } = require('../services/SettingsManager')
    return SettingsManager.getInstance().get('actionButtonMode') || 'recap'
  })

  safeHandle('set-action-button-mode', async (_, mode: string) => {
    const { SettingsManager } = require('../services/SettingsManager')
    SettingsManager.getInstance().set('actionButtonMode', mode)
    const { BrowserWindow } = require('electron') as typeof import('electron')
    ;(BrowserWindow.getAllWindows() as any).forEach((win: any) => {
      win.webContents.send('action-button-mode-changed', mode)
    })
    return { success: true }
  })

  safeHandle('get-default-model', async () => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    const model = CredentialsManager.getInstance().getDefaultModel()
    return { model: model || 'gemini-3.1-flash-lite-preview' }
  })

  safeHandle('set-default-model', async (_, model: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setDefaultModel(model)
    const llmHelper = appState.processingHelper.getLLMHelper()
    llmHelper.setModel(model)
    appState.modelSelectorWindowHelper.hideWindow()
    const { BrowserWindow } = require('electron') as typeof import('electron')
    ;(BrowserWindow.getAllWindows() as any).forEach((win: any) => {
      win.webContents.send('model-changed', model)
    })
    return { success: true }
  })

  safeHandle('set-openai-stt-api-key', async (_, key: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setOpenAiSttApiKey(key)
    return { success: true }
  })

  safeHandle('set-groq-stt-api-key', async (_, key: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setGroqSttApiKey(key)
    return { success: true }
  })

  safeHandle('set-groq-stt-model', async (_, model: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setGroqSttModel(model)
    await appState.reconfigureSttProvider()
    return { success: true }
  })

  safeHandle('set-deepgram-api-key', async (_, key: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setDeepgramApiKey(key)
    return { success: true }
  })

  safeHandle('set-elevenlabs-api-key', async (_, key: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setElevenLabsApiKey(key)
    return { success: true }
  })

  safeHandle('set-azure-api-key', async (_, key: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setAzureApiKey(key)
    return { success: true }
  })

  safeHandle('set-azure-region', async (_, region: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setAzureRegion(region)
    await appState.reconfigureSttProvider()
    return { success: true }
  })

  safeHandle('set-ibmwatson-api-key', async (_, key: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setIbmWatsonApiKey(key)
    return { success: true }
  })

  safeHandle('set-soniox-api-key', async (_, key: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setSonioxApiKey(key)
    return { success: true }
  })

  safeHandle('set-tavily-api-key', async (_, key: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setTavilyApiKey(key)
    return { success: true }
  })

  safeHandle('set-stt-provider', async (_, provider: string) => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    CredentialsManager.getInstance().setSttProvider(provider)
    await appState.reconfigureSttProvider()
    return { success: true }
  })

  safeHandle('get-stt-provider', async () => {
    const { CredentialsManager } = require('../services/CredentialsManager')
    return CredentialsManager.getInstance().getSttProvider()
  })

  safeHandle('set-recognition-language', async (_, key: string) => {
    appState.setRecognitionLanguage(key)
    return { success: true }
  })

  safeHandle('get-groq-fast-text-mode', async () => {
    const llmHelper = appState.processingHelper.getLLMHelper()
    return { enabled: llmHelper.getGroqFastTextMode() }
  })

  safeHandle('set-groq-fast-text-mode', async (_, enabled: boolean) => {
    const llmHelper = appState.processingHelper.getLLMHelper()
    llmHelper.setGroqFastTextMode(enabled)
    const { BrowserWindow } = require('electron') as typeof import('electron')
    ;(BrowserWindow.getAllWindows() as any).forEach((win: any) => {
      win.webContents.send('groq-fast-text-changed', enabled)
    })
    return { success: true }
  })

  safeHandle('set-model', async (_, model: string) => {
    const llmHelper = appState.processingHelper.getLLMHelper()
    const { CredentialsManager } = require('../services/CredentialsManager')
    const cm = CredentialsManager.getInstance()
    const curlProviders = cm.getCurlProviders()
    const legacyProviders = cm.getCustomProviders() || []
    const allProviders = [...curlProviders, ...legacyProviders]
    llmHelper.setModel(model, allProviders)
    appState.modelSelectorWindowHelper.hideWindow()
    const { BrowserWindow } = require('electron') as typeof import('electron')
    ;(BrowserWindow.getAllWindows() as any).forEach((win: any) => {
      win.webContents.send('model-changed', model)
    })
    return { success: true }
  })

  safeHandle(
    'test-llm-connection',
    async (
      _,
      provider: 'gemini' | 'groq' | 'openai' | 'claude',
      apiKey?: string,
    ) => {
      console.log(
        `[IPC] Received test-llm-connection request for provider: ${provider}`,
      )
      try {
        if (!apiKey || !apiKey.trim()) {
          const {
            CredentialsManager,
          } = require('../services/CredentialsManager')
          const creds = CredentialsManager.getInstance()
          if (provider === 'gemini') apiKey = creds.getGeminiApiKey()
          else if (provider === 'groq') apiKey = creds.getGroqApiKey()
          else if (provider === 'openai') apiKey = creds.getOpenaiApiKey()
          else if (provider === 'claude') apiKey = creds.getClaudeApiKey()
        }
        if (!apiKey || !apiKey.trim()) {
          return { success: false, error: 'No API key provided' }
        }
        const axios = require('axios')
        let response
        if (provider === 'gemini') {
          response = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent',
            {
              contents: [{ parts: [{ text: 'Hello' }] }],
            },
            { headers: { 'x-goog-api-key': apiKey }, timeout: 15000 },
          )
        } else if (provider === 'groq') {
          response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              model: 'llama-3.3-70b-versatile',
              messages: [{ role: 'user', content: 'Hello' }],
            },
            { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 },
          )
        } else if (provider === 'openai') {
          response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: 'Hello' }],
            },
            { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 },
          )
        } else if (provider === 'claude') {
          response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
              model: 'claude-sonnet-4-6',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'Hello' }],
            },
            {
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              timeout: 15000,
            },
          )
        }
        if (response && (response.status === 200 || response.status === 201)) {
          return { success: true, error: null }
        } else {
          return { success: false, error: 'Unexpected response' }
        }
      } catch (error: any) {
        console.error('LLM connection test failed:', error)
        const rawMsg =
          error?.response?.data?.error?.message ||
          error?.response?.data?.message ||
          (error.response?.data?.error?.type
            ? `${error.response.data.error.type}: ${error.response.data.error.message}`
            : error.message) ||
          'Connection failed'
        const msg = sanitizeErrorMessage(rawMsg)
        return { success: false, error: msg }
      }
    },
  )

  safeHandle(
    'test-stt-connection',
    async (
      _,
      provider:
        | 'groq'
        | 'openai'
        | 'deepgram'
        | 'elevenlabs'
        | 'azure'
        | 'ibmwatson'
        | 'soniox',
      apiKey: string,
      region?: string,
    ) => {
      console.log(
        `[IPC] Received test - stt - connection request for provider: ${provider} `,
      )
      try {
        if (provider === 'deepgram') {
          const WebSocket = require('ws')
          return new Promise<{ success: boolean; error?: string }>(
            (resolve) => {
              const ws = new WebSocket(
                'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1',
                {
                  headers: { Authorization: `Token ${apiKey}` },
                },
              )
              const timeout = setTimeout(() => {
                ws.close()
                resolve({ success: false, error: 'Connection timed out' })
              }, 15000)
              ws.on('open', () => {
                clearTimeout(timeout)
                try {
                  ws.send(JSON.stringify({ type: 'CloseStream' }))
                } catch {}
                ws.close()
                resolve({ success: true })
              })
              ws.on('error', (err: any) => {
                clearTimeout(timeout)
                resolve({
                  success: false,
                  error: err.message || 'Connection failed',
                })
              })
            },
          )
        }
        if (provider === 'soniox') {
          const WebSocket = require('ws')
          return new Promise<{ success: boolean; error?: string }>(
            (resolve) => {
              const ws = new WebSocket(
                'wss://stt-rt.soniox.com/transcribe-websocket',
              )
              const timeout = setTimeout(() => {
                ws.close()
                resolve({ success: false, error: 'Connection timed out' })
              }, 15000)
              ws.on('open', () => {
                ws.send(
                  JSON.stringify({
                    api_key: apiKey,
                    model: 'stt-rt-v4',
                    audio_format: 'pcm_s16le',
                    sample_rate: 16000,
                    num_channels: 1,
                  }),
                )
              })
              ws.on('message', (msg: any) => {
                clearTimeout(timeout)
                try {
                  const res = JSON.parse(msg.toString())
                  if (res.error_code)
                    resolve({
                      success: false,
                      error: `${res.error_code}: ${res.error_message}`,
                    })
                  else resolve({ success: true })
                } catch {
                  resolve({ success: true })
                }
                ws.close()
              })
              ws.on('error', (err: any) => {
                clearTimeout(timeout)
                resolve({
                  success: false,
                  error: err.message || 'Connection failed',
                })
              })
            },
          )
        }
        const axios = require('axios')
        const FormData = require('form-data')
        const numSamples = 8000
        const pcmData = Buffer.alloc(numSamples * 2)
        const wavHeader = Buffer.alloc(44)
        wavHeader.write('RIFF', 0)
        wavHeader.writeUInt32LE(36 + pcmData.length, 4)
        wavHeader.write('WAVE', 8)
        wavHeader.write('fmt ', 12)
        wavHeader.writeUInt32LE(16, 16)
        wavHeader.writeUInt16LE(1, 20)
        wavHeader.writeUInt16LE(1, 22)
        wavHeader.writeUInt32LE(16000, 24)
        wavHeader.writeUInt32LE(32000, 28)
        wavHeader.writeUInt16LE(2, 32)
        wavHeader.writeUInt16LE(16, 34)
        wavHeader.write('data', 36)
        wavHeader.writeUInt32LE(pcmData.length, 40)
        const testWav = Buffer.concat([wavHeader, pcmData])
        if (provider === 'elevenlabs') {
          try {
            await axios.get('https://api.elevenlabs.io/v1/voices', {
              headers: { 'xi-api-key': apiKey },
              timeout: 10000,
            })
          } catch (elErr: any) {
            const elStatus = elErr?.response?.data?.detail?.status
            if (elStatus === 'invalid_api_key') throw elErr
          }
        } else if (provider === 'azure') {
          const azureRegion = region || 'eastus'
          await axios.post(
            `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
            testWav,
            {
              headers: {
                'Ocp-Apim-Subscription-Key': apiKey,
                'Content-Type': 'audio/wav',
              },
              timeout: 15000,
            },
          )
        } else if (provider === 'ibmwatson') {
          const ibmRegion = region || 'us-south'
          await axios.post(
            `https://api.${ibmRegion}.speech-to-text.watson.cloud.ibm.com/v1/recognize`,
            testWav,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`,
                'Content-Type': 'audio/wav',
              },
              timeout: 15000,
            },
          )
        } else {
          const endpoint =
            provider === 'groq'
              ? 'https://api.groq.com/openai/v1/audio/transcriptions'
              : 'https://api.openai.com/v1/audio/transcriptions'
          const model =
            provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1'
          const form = new FormData()
          form.append('file', testWav, {
            filename: 'test.wav',
            contentType: 'audio/wav',
          })
          form.append('model', model)
          await axios.post(endpoint, form, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              ...form.getHeaders(),
            },
            timeout: 15000,
          })
        }
        return { success: true }
      } catch (error: any) {
        const respData = error?.response?.data
        const rawMsg =
          respData?.error?.message ||
          respData?.detail?.message ||
          respData?.message ||
          error.message ||
          'Connection failed'
        const msg = sanitizeErrorMessage(rawMsg)
        console.error('STT connection test failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  safeHandle('get-input-devices', async () => {
    const { AudioDevices } = require('../audio/AudioDevices')
    return AudioDevices.getInputDevices()
  })

  safeHandle('get-output-devices', async () => {
    const { AudioDevices } = require('../audio/AudioDevices')
    return AudioDevices.getOutputDevices()
  })

  safeHandle(
    'set-provider-preferred-model',
    async (
      _,
      provider: 'gemini' | 'groq' | 'openai' | 'claude',
      modelId: string,
    ) => {
      try {
        const { CredentialsManager } = require('../services/CredentialsManager')
        CredentialsManager.getInstance().setPreferredModel(provider, modelId)
        return { success: true }
      } catch (error: any) {
        console.error('[IPC] set-provider-preferred-model error:', error)
        return { success: false, error: error.message }
      }
    },
  )

  safeHandle(
    'fetch-provider-models',
    async (
      _,
      provider: 'gemini' | 'groq' | 'openai' | 'claude',
      apiKey?: string,
    ) => {
      try {
        let key = apiKey?.trim()
        if (!key) {
          const {
            CredentialsManager,
          } = require('../services/CredentialsManager')
          const cm = CredentialsManager.getInstance()
          if (provider === 'gemini') key = cm.getGeminiApiKey()
          else if (provider === 'groq') key = cm.getGroqApiKey()
          else if (provider === 'openai') key = cm.getOpenaiApiKey()
          else if (provider === 'claude') key = cm.getClaudeApiKey()
        }
        if (!key) {
          return { success: false, error: 'No API key available' }
        }
        const { fetchProviderModels } = require('../utils/modelFetcher')
        const models = await fetchProviderModels(provider, key)
        return { success: true, models }
      } catch (error: any) {
        const msg =
          error?.response?.data?.error?.message ||
          error.message ||
          'Failed to fetch models'
        return { success: false, error: msg }
      }
    },
  )
}
