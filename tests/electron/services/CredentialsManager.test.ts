import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

// Mock electron and fs modules before importing CredentialsManager
vi.mock('electron', () => createElectronMock({
    app: {
        getPath: vi.fn(() => '/tmp/userdata'),
    },
    safeStorage: {
        encryptString: vi.fn(() => Buffer.from('encrypted')),
        decryptString: vi.fn(() => '{"geminiApiKey":"test-key"}'),
    },
}))

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
    },
}))

vi.mock('path', () => ({
    default: {
        join: (...args: string[]) => args.join('/'),
    },
}))

import { CredentialsManager } from '../../../electron/services/CredentialsManager'

describe('CredentialsManager', () => {
    let credentialsManager: CredentialsManager

    beforeEach(() => {
        vi.clearAllMocks()
        // Reset the singleton instance
        ;(CredentialsManager as any).instance = undefined
        credentialsManager = CredentialsManager.getInstance()
        credentialsManager.init()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    describe('getInstance', () => {
        it('should return the same instance on multiple calls', () => {
            const instance1 = CredentialsManager.getInstance()
            const instance2 = CredentialsManager.getInstance()
            expect(instance1).toBe(instance2)
        })
    })

    describe('API Key Getters and Setters', () => {
        it('should get and set Gemini API key', () => {
            credentialsManager.setGeminiApiKey('gemini-test-key')
            expect(credentialsManager.getGeminiApiKey()).toBe('gemini-test-key')
        })

        it('should get and set Groq API key', () => {
            credentialsManager.setGroqApiKey('groq-test-key')
            expect(credentialsManager.getGroqApiKey()).toBe('groq-test-key')
        })

        it('should get and set OpenAI API key', () => {
            credentialsManager.setOpenaiApiKey('openai-test-key')
            expect(credentialsManager.getOpenaiApiKey()).toBe('openai-test-key')
        })

        it('should get and set Claude API key', () => {
            credentialsManager.setClaudeApiKey('claude-test-key')
            expect(credentialsManager.getClaudeApiKey()).toBe('claude-test-key')
        })

        it('should return undefined for unset API keys', () => {
            expect(credentialsManager.getGeminiApiKey()).toBeUndefined()
            expect(credentialsManager.getGroqApiKey()).toBeUndefined()
            expect(credentialsManager.getOpenaiApiKey()).toBeUndefined()
            expect(credentialsManager.getClaudeApiKey()).toBeUndefined()
        })
    })

    describe('STT Provider Settings', () => {
        it('should get and set STT provider', () => {
            credentialsManager.setSttProvider('deepgram')
            expect(credentialsManager.getSttProvider()).toBe('deepgram')
        })

        it('should return none as default STT provider', () => {
            expect(credentialsManager.getSttProvider()).toBe('none')
        })

        it('should get and set Deepgram API key', () => {
            credentialsManager.setDeepgramApiKey('deepgram-test-key')
            expect(credentialsManager.getDeepgramApiKey()).toBe('deepgram-test-key')
        })

        it('should get and set Groq STT API key', () => {
            credentialsManager.setGroqSttApiKey('groq-stt-test-key')
            expect(credentialsManager.getGroqSttApiKey()).toBe('groq-stt-test-key')
        })

        it('should get and set Groq STT model with default', () => {
            expect(credentialsManager.getGroqSttModel()).toBe('whisper-large-v3-turbo')
            credentialsManager.setGroqSttModel('whisper-large-v3')
            expect(credentialsManager.getGroqSttModel()).toBe('whisper-large-v3')
        })

        it('should get and set OpenAI STT API key', () => {
            credentialsManager.setOpenAiSttApiKey('openai-stt-test-key')
            expect(credentialsManager.getOpenAiSttApiKey()).toBe('openai-stt-test-key')
        })

        it('should get and set ElevenLabs API key', () => {
            credentialsManager.setElevenLabsApiKey('elevenlabs-test-key')
            expect(credentialsManager.getElevenLabsApiKey()).toBe('elevenlabs-test-key')
        })

        it('should get and set Azure API key and region', () => {
            credentialsManager.setAzureApiKey('azure-test-key')
            credentialsManager.setAzureRegion('westus2')
            expect(credentialsManager.getAzureApiKey()).toBe('azure-test-key')
            expect(credentialsManager.getAzureRegion()).toBe('westus2')
        })

        it('should return eastus as default Azure region', () => {
            expect(credentialsManager.getAzureRegion()).toBe('eastus')
        })

        it('should get and set IBM Watson API key and region', () => {
            credentialsManager.setIbmWatsonApiKey('ibm-test-key')
            credentialsManager.setIbmWatsonRegion('us-east')
            expect(credentialsManager.getIbmWatsonApiKey()).toBe('ibm-test-key')
            expect(credentialsManager.getIbmWatsonRegion()).toBe('us-east')
        })

        it('should return us-south as default IBM Watson region', () => {
            expect(credentialsManager.getIbmWatsonRegion()).toBe('us-south')
        })

        it('should get and set Soniox API key', () => {
            credentialsManager.setSonioxApiKey('soniox-test-key')
            expect(credentialsManager.getSonioxApiKey()).toBe('soniox-test-key')
        })
    })

    describe('Language Settings', () => {
        it('should get and set STT language with default', () => {
            expect(credentialsManager.getSttLanguage()).toBe('english-us')
            credentialsManager.setSttLanguage('spanish-mx')
            expect(credentialsManager.getSttLanguage()).toBe('spanish-mx')
        })

        it('should get and set AI response language with default', () => {
            expect(credentialsManager.getAiResponseLanguage()).toBe('auto')
            credentialsManager.setAiResponseLanguage('Spanish')
            expect(credentialsManager.getAiResponseLanguage()).toBe('Spanish')
        })
    })

    describe('Default Model', () => {
        it('should get and set default model', () => {
            expect(credentialsManager.getDefaultModel()).toBe('gemini-3.1-flash-lite-preview')
            credentialsManager.setDefaultModel('gpt-4o')
            expect(credentialsManager.getDefaultModel()).toBe('gpt-4o')
        })
    })

    describe('Preferred Models', () => {
        it('should get and set preferred model per provider', () => {
            credentialsManager.setPreferredModel('gemini', 'gemini-2.0-flash')
            credentialsManager.setPreferredModel('openai', 'gpt-4o')
            expect(credentialsManager.getPreferredModel('gemini')).toBe('gemini-2.0-flash')
            expect(credentialsManager.getPreferredModel('openai')).toBe('gpt-4o')
        })

        it('should return undefined for unset preferred models', () => {
            expect(credentialsManager.getPreferredModel('gemini')).toBeUndefined()
            expect(credentialsManager.getPreferredModel('groq')).toBeUndefined()
        })
    })

    describe('Custom Providers', () => {
        it('should save and retrieve custom providers', () => {
            const provider = { id: 'custom-1', name: 'Custom Provider', curlCommand: 'curl test' }
            credentialsManager.saveCustomProvider(provider)
            const providers = credentialsManager.getCustomProviders()
            expect(providers).toHaveLength(1)
            expect(providers[0].id).toBe('custom-1')
        })

        it('should update existing custom provider', () => {
            const provider1 = { id: 'custom-1', name: 'Provider 1', curlCommand: 'curl test1' }
            const provider2 = { id: 'custom-1', name: 'Provider 1 Updated', curlCommand: 'curl test2' }
            credentialsManager.saveCustomProvider(provider1)
            credentialsManager.saveCustomProvider(provider2)
            const providers = credentialsManager.getCustomProviders()
            expect(providers).toHaveLength(1)
            expect(providers[0].name).toBe('Provider 1 Updated')
        })

        it('should delete custom provider', () => {
            const provider = { id: 'custom-1', name: 'Custom Provider', curlCommand: 'curl test' }
            credentialsManager.saveCustomProvider(provider)
            expect(credentialsManager.getCustomProviders()).toHaveLength(1)
            credentialsManager.deleteCustomProvider('custom-1')
            expect(credentialsManager.getCustomProviders()).toHaveLength(0)
        })
    })

    describe('Curl Providers', () => {
        it('should save and retrieve curl providers', () => {
            const provider = { id: 'curl-1', name: 'Curl Provider', curlCommand: 'curl test', responsePath: 'data' }
            credentialsManager.saveCurlProvider(provider)
            const providers = credentialsManager.getCurlProviders()
            expect(providers).toHaveLength(1)
            expect(providers[0].id).toBe('curl-1')
        })

        it('should delete curl provider', () => {
            const provider = { id: 'curl-1', name: 'Curl Provider', curlCommand: 'curl test', responsePath: 'data' }
            credentialsManager.saveCurlProvider(provider)
            expect(credentialsManager.getCurlProviders()).toHaveLength(1)
            credentialsManager.deleteCurlProvider('curl-1')
            expect(credentialsManager.getCurlProviders()).toHaveLength(0)
        })
    })

    describe('Google Service Account', () => {
        it('should get and set Google service account path', () => {
            credentialsManager.setGoogleServiceAccountPath('/path/to/service-account.json')
            expect(credentialsManager.getGoogleServiceAccountPath()).toBe('/path/to/service-account.json')
        })
    })

    describe('Natively API Key', () => {
        it('should get and set Natively API key', () => {
            credentialsManager.setNativelyApiKey('natively-test-key')
            expect(credentialsManager.getNativelyApiKey()).toBe('natively-test-key')
        })
    })

    describe('Tavily API Key', () => {
        it('should get and set Tavily API key', () => {
            credentialsManager.setTavilyApiKey('tavily-test-key')
            expect(credentialsManager.getTavilyApiKey()).toBe('tavily-test-key')
        })

        it('should handle empty string as undefined for Tavily', () => {
            credentialsManager.setTavilyApiKey('')
            expect(credentialsManager.getTavilyApiKey()).toBeUndefined()
        })

        it('should handle whitespace-only string as undefined for Tavily', () => {
            credentialsManager.setTavilyApiKey('   ')
            expect(credentialsManager.getTavilyApiKey()).toBeUndefined()
        })
    })

    describe('getAllCredentials', () => {
        it('should return a copy of all credentials', () => {
            credentialsManager.setGeminiApiKey('test-key')
            const all = credentialsManager.getAllCredentials()
            expect(all.geminiApiKey).toBe('test-key')
            // Ensure it's a copy, not the original
            all.geminiApiKey = 'modified'
            expect(credentialsManager.getGeminiApiKey()).toBe('test-key')
        })
    })

    describe('clearAll', () => {
        it('should clear all credentials from memory and disk', () => {
            credentialsManager.setGeminiApiKey('test-key')
            credentialsManager.clearAll()
            expect(credentialsManager.getGeminiApiKey()).toBeUndefined()
        })
    })

    describe('scrubMemory', () => {
        it('should overwrite and clear all credentials from memory', () => {
            credentialsManager.setGeminiApiKey('test-key')
            credentialsManager.setGroqApiKey('groq-key')
            credentialsManager.scrubMemory()
            // After scrub, credentials should be empty
            const all = credentialsManager.getAllCredentials()
            expect(Object.keys(all).length).toBe(0)
        })
    })

    describe('singleton pattern', () => {
        it('maintains singleton behavior', () => {
            const instance1 = CredentialsManager.getInstance()
            const instance2 = CredentialsManager.getInstance()
            expect(instance1).toBe(instance2)
        })
    })
})
