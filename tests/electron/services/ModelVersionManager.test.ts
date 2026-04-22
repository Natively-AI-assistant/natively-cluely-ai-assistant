import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { createElectronMock } from '../../mocks/electron.mock'

// Mock electron and fs modules before importing ModelVersionManager
vi.mock('electron', () => createElectronMock({
    app: {
        getPath: vi.fn(() => '/tmp/userdata'),
        isReady: vi.fn(() => true),
        getVersion: vi.fn(() => '1.0.0'),
    },
}))
vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(() => ''),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
        renameSync: vi.fn(),
    },
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
}))
vi.mock('path', () => ({
    default: {
        join: (...args: string[]) => args.join('/'),
        dirname: (path: string) => path.split('/').slice(0, -1).join('/'),
    },
    join: (...args: string[]) => args.join('/'),
    dirname: (path: string) => path.split('/').slice(0, -1).join('/'),
}))

// Mock uuid
vi.mock('uuid', () => ({
    v4: vi.fn(() => 'test-uuid'),
}))

import { ModelVersionManager, ModelFamily, TextModelFamily, parseModelVersion, compareVersions, versionDistance, classifyModel, classifyTextModel } from '../../../electron/services/ModelVersionManager'

describe('ModelVersionManager', () => {
    let manager: ModelVersionManager

    beforeEach(() => {
        manager = new ModelVersionManager()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    describe('constructor', () => {
        it('should create an instance', () => {
            expect(manager).toBeInstanceOf(ModelVersionManager)
        })
    })

    describe('parseModelVersion', () => {
        it('should parse dotted version format', () => {
            const version = parseModelVersion('gpt-5.4')
            expect(version).toEqual({
                major: 5,
                minor: 4,
                patch: 0,
                raw: 'gpt-5.4'
            })
        })

        it('should parse Claude-style version', () => {
            const version = parseModelVersion('claude-sonnet-4-6')
            expect(version).toEqual({
                major: 4,
                minor: 6,
                patch: 0,
                raw: 'claude-sonnet-4-6'
            })
        })

        it('should parse Llama-style version', () => {
            const version = parseModelVersion('meta-llama/llama-4-scout-17b-16e-instruct')
            expect(version).toEqual({
                major: 4,
                minor: 0,
                patch: 0,
                raw: 'meta-llama/llama-4-scout-17b-16e-instruct'
            })
        })

        it('should return null for unparseable version', () => {
            const version = parseModelVersion('unknown-model-format')
            expect(version).toBeNull()
        })

        it('should parse Gemini flash lite preview', () => {
            const version = parseModelVersion('gemini-3.1-flash-lite-preview')
            expect(version).toEqual({
                major: 3,
                minor: 1,
                patch: 0,
                raw: 'gemini-3.1-flash-lite-preview'
            })
        })

        it('should parse Gemini pro preview', () => {
            const version = parseModelVersion('gemini-3.1-pro-preview')
            expect(version).toEqual({
                major: 3,
                minor: 1,
                patch: 0,
                raw: 'gemini-3.1-pro-preview'
            })
        })
    })

    describe('compareVersions', () => {
        it('should return negative when a < b', () => {
            const a = { major: 3, minor: 1, patch: 0, raw: 'gpt-3.1' }
            const b = { major: 4, minor: 0, patch: 0, raw: 'gpt-4.0' }
            expect(compareVersions(a, b)).toBeLessThan(0)
        })

        it('should return positive when a > b', () => {
            const a = { major: 4, minor: 0, patch: 0, raw: 'gpt-4.0' }
            const b = { major: 3, minor: 1, patch: 0, raw: 'gpt-3.1' }
            expect(compareVersions(a, b)).toBeGreaterThan(0)
        })

        it('should return 0 when versions are equal', () => {
            const a = { major: 3, minor: 1, patch: 0, raw: 'gpt-3.1' }
            const b = { major: 3, minor: 1, patch: 0, raw: 'claude-3.1' }
            expect(compareVersions(a, b)).toBe(0)
        })

        it('should compare patch versions', () => {
            const a = { major: 3, minor: 1, patch: 1, raw: 'v3.1.1' }
            const b = { major: 3, minor: 1, patch: 0, raw: 'v3.1.0' }
            expect(compareVersions(a, b)).toBeGreaterThan(0)
        })
    })

    describe('versionDistance', () => {
        it('should calculate minor version distance correctly', () => {
            const older = { major: 3, minor: 1, patch: 0, raw: '3.1' }
            const newer = { major: 3, minor: 3, patch: 0, raw: '3.3' }
            expect(versionDistance(older, newer)).toBe(2)
        })

        it('should count major jump as 10 minor versions', () => {
            const older = { major: 3, minor: 1, patch: 0, raw: '3.1' }
            const newer = { major: 4, minor: 0, patch: 0, raw: '4.0' }
            // Formula: (4-3)*10 + (0-1) = 10 - 1 = 9
            expect(versionDistance(older, newer)).toBe(9)
        })

        it('should handle major jump with positive minor delta', () => {
            const older = { major: 3, minor: 5, patch: 0, raw: '3.5' }
            const newer = { major: 4, minor: 2, patch: 0, raw: '4.2' }
            // Formula: (4-3)*10 + (2-5) = 10 - 3 = 7
            expect(versionDistance(older, newer)).toBe(7)
        })

        it('should return small distance for patch-level changes', () => {
            const older = { major: 3, minor: 1, patch: 0, raw: '3.1.0' }
            const newer = { major: 3, minor: 1, patch: 1, raw: '3.1.1' }
            expect(versionDistance(older, newer)).toBe(0.1)
        })
    })

    describe('classifyModel', () => {
        it('should classify OpenAI GPT models', () => {
            expect(classifyModel('gpt-4')).toBe(ModelFamily.OPENAI)
            expect(classifyModel('gpt-5.4')).toBe(ModelFamily.OPENAI)
            expect(classifyModel('gpt-4-turbo')).toBe(ModelFamily.OPENAI)
        })

        it('should classify Gemini Flash models', () => {
            expect(classifyModel('gemini-3.1-flash-lite-preview')).toBe(ModelFamily.GEMINI_FLASH)
            expect(classifyModel('gemini-2.0-flash')).toBe(ModelFamily.GEMINI_FLASH)
        })

        it('should classify Gemini Pro models', () => {
            expect(classifyModel('gemini-3.1-pro-preview')).toBe(ModelFamily.GEMINI_PRO)
            expect(classifyModel('gemini-2.0-pro')).toBe(ModelFamily.GEMINI_PRO)
        })

        it('should classify Claude models', () => {
            expect(classifyModel('claude-sonnet-4-6')).toBe(ModelFamily.CLAUDE)
            expect(classifyModel('claude-opus-4-2')).toBe(ModelFamily.CLAUDE)
            expect(classifyModel('claude-haiku-3-5')).toBe(ModelFamily.CLAUDE)
        })

        it('should classify Groq Llama Scout models', () => {
            expect(classifyModel('meta-llama/llama-4-scout-17b-16e-instruct')).toBe(ModelFamily.GROQ_LLAMA)
        })

        it('should return null for unknown models', () => {
            expect(classifyModel('unknown-model')).toBeNull()
        })
    })

    describe('classifyTextModel', () => {
        it('should classify OpenAI text models', () => {
            expect(classifyTextModel('gpt-4')).toBe(TextModelFamily.OPENAI)
            expect(classifyTextModel('gpt-3.5-turbo')).toBe(TextModelFamily.OPENAI)
        })

        it('should classify Groq text models broadly', () => {
            expect(classifyTextModel('llama-3.3-70b-versatile')).toBe(TextModelFamily.GROQ)
            expect(classifyTextModel('mixtral-8x7b-32768')).toBe(TextModelFamily.GROQ)
            expect(classifyTextModel('gemma2-9b-it')).toBe(TextModelFamily.GROQ)
        })

        it('should classify Claude text models', () => {
            expect(classifyTextModel('claude-sonnet-4-6')).toBe(TextModelFamily.CLAUDE)
        })
    })

    describe('getTieredModels', () => {
        it('should return baseline models when no persisted state', () => {
            const tiers = manager.getTieredModels(ModelFamily.OPENAI)
            expect(tiers).toEqual({
                tier1: 'gpt-5.4',
                tier2: 'gpt-5.4',
                tier3: 'gpt-5.4'
            })
        })

        it('should return correct tiers for all vision families', () => {
            const tiers = manager.getAllVisionTiers()
            expect(tiers).toHaveLength(5) // OPENAI, GEMINI_FLASH, GEMINI_PRO, CLAUDE, GROQ_LLAMA
            expect(tiers[0]).toHaveProperty('family', ModelFamily.OPENAI)
            expect(tiers[0]).toHaveProperty('tier1', 'gpt-5.4')
        })
    })

    describe('getAllTextTiers', () => {
        it('should return tiers for all text providers', () => {
            const tiers = manager.getAllTextTiers()
            expect(tiers).toHaveLength(5) // GROQ, OPENAI, CLAUDE, GEMINI_FLASH, GEMINI_PRO
            expect(tiers[0]).toHaveProperty('family', TextModelFamily.GROQ)
            expect(tiers[0]).toHaveProperty('tier1', 'llama-3.3-70b-versatile')
        })
    })

    describe('setApiKeys', () => {
        it('should set API keys for providers', () => {
            manager.setApiKeys({
                openai: 'test-openai-key',
                gemini: 'test-gemini-key',
                claude: 'test-claude-key',
                groq: 'test-groq-key',
            })
            
            // Access private properties for testing (not ideal but necessary for verification)
            // @ts-ignore
            expect(manager.openaiApiKey).toBe('test-openai-key')
            // @ts-ignore
            expect(manager.geminiApiKey).toBe('test-gemini-key')
            // @ts-ignore
            expect(manager.claudeApiKey).toBe('test-claude-key')
            // @ts-ignore
            expect(manager.groqApiKey).toBe('test-groq-key')
        })

        it('should allow null values to clear keys', () => {
            manager.setApiKeys({
                openai: 'test-key',
                gemini: null,
            })
            
            // @ts-ignore
            expect(manager.openaiApiKey).toBe('test-key')
            // @ts-ignore
            expect(manager.geminiApiKey).toBeNull()
        })
    })

    describe('initialize', () => {
        it('should attempt discovery if needed', async () => {
            // Mock fs.existsSync to return false (no persisted state)
            vi.mocked(fs.existsSync).mockReturnValueOnce(false)
            
            await manager.initialize()
            
            // Should have tried to persist state (create directories)
            expect(fs.mkdirSync).toHaveBeenCalled()
        })

        it('should skip discovery if recently run', async () => {
            const recentTimestamp = Date.now() - (24 * 60 * 60 * 1000)
            // @ts-ignore
            manager.state.lastDiscoveryTimestamp = recentTimestamp
            
            vi.mocked(fs.existsSync).mockReturnValue(true)
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                schemaVersion: 3,
                families: {},
                lastDiscoveryTimestamp: recentTimestamp,
                discoveryFailureCounts: {}
            }))
            
            vi.clearAllMocks()
            await manager.initialize()
            
            expect(fs.writeFileSync).not.toHaveBeenCalled()
        })
    })

    describe('rollback', () => {
        it('should rollback to previous tier1 if available', () => {
            // Set up state with previous tier1
            // @ts-ignore - accessing private state
            manager.state.families[ModelFamily.OPENAI] = {
                baseline: 'gpt-5.4',
                tier1: 'gpt-5.4',
                latest: 'gpt-5.5',
                latestVersion: parseModelVersion('gpt-5.5'),
                tier1Version: parseModelVersion('gpt-5.4'),
                previousTier1: 'gpt-4',
                previousLatest: null
            }
            
            const result = manager.rollback(ModelFamily.OPENAI)
            
            expect(result).toBe(true)
            // @ts-ignore - accessing private state
            expect(manager.state.families[ModelFamily.OPENAI].tier1).toBe('gpt-4')
        })

        it('should rollback to previous latest if available', () => {
            // @ts-ignore - accessing private state
            manager.state.families[ModelFamily.GEMINI_FLASH] = {
                baseline: 'gemini-3.1-flash-lite-preview',
                tier1: 'gemini-3.2-flash-lite-preview',
                latest: 'gemini-3.3-flash-preview',
                latestVersion: parseModelVersion('gemini-3.3-flash-preview'),
                tier1Version: parseModelVersion('gemini-3.2-flash-lite-preview'),
                previousTier1: null,
                previousLatest: 'gemini-3.2-flash-preview'
            }
            
            const result = manager.rollback(ModelFamily.GEMINI_FLASH)
            
            expect(result).toBe(true)
            // @ts-ignore - accessing private state
            expect(manager.state.families[ModelFamily.GEMINI_FLASH].latest).toBe('gemini-3.2-flash-preview')
        })

        it('should return false if nothing to rollback', () => {
            // @ts-ignore - accessing private state
            manager.state.families[ModelFamily.CLAUDE] = {
                baseline: 'claude-sonnet-4-6',
                tier1: 'claude-sonnet-4-6',
                latest: 'claude-sonnet-4-6',
                latestVersion: parseModelVersion('claude-sonnet-4-6'),
                tier1Version: parseModelVersion('claude-sonnet-4-6'),
                previousTier1: null,
                previousLatest: null
            }
            
            const result = manager.rollback(ModelFamily.CLAUDE)
            
            expect(result).toBe(false)
        })

        it('should return false for unknown family', () => {
            const result = manager.rollback('unknown-family' as any)
            expect(result).toBe(false)
        })
    })

    describe('getSummary', () => {
        it('should return a summary string', () => {
            const summary = manager.getSummary()
            expect(typeof summary).toBe('string')
            expect(summary).toContain('[ModelVersionManager] Current Model Tiers:')
        })

        it('should include vision tiers in summary', () => {
            const summary = manager.getSummary()
            expect(summary).toContain('--- Vision ---')
        })

        it('should include text tiers in summary', () => {
            const summary = manager.getSummary()
            expect(summary).toContain('--- Text ---')
        })

        it('should include last discovery timestamp', () => {
            const summary = manager.getSummary()
            expect(summary).toContain('Last discovery:')
        })
    })

    describe('stopScheduler', () => {
        it('should clear discovery timer', async () => {
            await manager.initialize()
            manager.stopScheduler()
            // @ts-ignore
            expect(manager.discoveryTimer).toBeNull()
        })
    })

    describe('version migration behavior', () => {
        it('should update tiers when a new model is discovered', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [{ id: 'gpt-5.5' }] })
            })
            vi.stubGlobal('fetch', fetchMock)
            manager.setApiKeys({ openai: 'test-key' })
            
            await (manager as any).runDiscoveryAndUpgrade()
            
            const tiers = manager.getTieredModels(ModelFamily.OPENAI)
            expect(tiers.tier2).toBe('gpt-5.5')
            vi.unstubAllGlobals()
        })

        it('should return false from rollback when no previous state exists', () => {
            const result = manager.rollback(ModelFamily.CLAUDE)
            expect(result).toBe(false)
        })
    })

    describe('discovery rate limiting', () => {
        it('should skip discovery for provider exceeding failure threshold', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [{ id: 'gpt-5.5' }] })
            })
            vi.stubGlobal('fetch', fetchMock)
            manager.setApiKeys({ openai: 'test-key' })
            // @ts-ignore
            manager.state.discoveryFailureCounts['openai'] = 3
            // @ts-ignore
            manager.state.lastDiscoveryTimestamp = Date.now() - 1000
            
            await (manager as any).runDiscoveryAndUpgrade()
            
            expect(fetchMock).not.toHaveBeenCalled()
            vi.unstubAllGlobals()
        })
    })

    describe('state persistence', () => {
        it('should persist state to disk after discovery', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [{ id: 'gpt-5.5' }] })
            })
            vi.stubGlobal('fetch', fetchMock)
            manager.setApiKeys({ openai: 'test-key' })
            
            await (manager as any).runDiscoveryAndUpgrade()
            
            expect(fs.writeFileSync).toHaveBeenCalled()
            expect(fs.renameSync).toHaveBeenCalled()
            vi.unstubAllGlobals()
        })

        it('should load previously persisted state', () => {
            const recentTimestamp = Date.now() - (24 * 60 * 60 * 1000)
            vi.mocked(fs.existsSync).mockReturnValue(true)
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                schemaVersion: 3,
                families: {
                    openai: {
                        baseline: 'gpt-5.4',
                        tier1: 'gpt-5.3',
                        latest: 'gpt-5.3',
                        latestVersion: { major: 5, minor: 3, patch: 0, raw: 'gpt-5.3' },
                        tier1Version: { major: 5, minor: 3, patch: 0, raw: 'gpt-5.3' },
                        previousTier1: null,
                        previousLatest: null
                    }
                },
                lastDiscoveryTimestamp: recentTimestamp,
                discoveryFailureCounts: {}
            }))
            
            const loaded = new ModelVersionManager()
            const tiers = loaded.getTieredModels(ModelFamily.OPENAI)
            expect(tiers.tier1).toBe('gpt-5.3')
        })
    })
})
