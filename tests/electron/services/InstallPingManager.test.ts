import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

// Use vi.hoisted to create mocks that can be referenced in vi.mock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { mockExistsSync, mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
    mockExistsSync: vi.fn(() => false) as any,
    mockReadFileSync: vi.fn(() => '') as any,
    mockWriteFileSync: vi.fn() as any,
}))

// Mock electron and fs modules before importing InstallPingManager
vi.mock('electron', () => createElectronMock({
    app: {
        getPath: vi.fn(() => '/tmp/userdata'),
    },
}))

// Mock process.platform (Node.js global, not part of electron mock)
Object.defineProperty(process, 'platform', {
    value: 'darwin',
})
vi.mock('fs', () => ({
    __esModule: true,
    default: {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
        writeFileSync: mockWriteFileSync,
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
}))
vi.mock('path', () => {
    const actualPath = require('path')
    return {
        __esModule: true,
        default: {
            ...actualPath,
            join: (...args: string[]) => args.join('/'),
        },
        ...actualPath,
        join: (...args: string[]) => args.join('/'),
    }
})
vi.mock('uuid', () => ({
    v4: vi.fn(() => 'test-uuid'),
}))

// Mock AbortController and fetch
vi.mock('node:events', () => ({}))
global.AbortController = class AbortController {
    signal: AbortSignal = {
        aborted: false,
        onabort: null,
        reason: undefined,
        throwIfAborted: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
    }
    abort() {}
}
global.fetch = vi.fn()

import { getOrCreateInstallId, sendAnonymousInstallPing } from '../../../electron/services/InstallPingManager'

describe('InstallPingManager', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetAllMocks()
        // Reset default mock implementations
        mockExistsSync.mockReturnValue(false)
        mockReadFileSync.mockReturnValue('')
        mockWriteFileSync.mockClear()
    })

    describe('getOrCreateInstallId', () => {
        it('should return existing install ID if present', () => {
            mockExistsSync.mockReturnValueOnce(true)
            mockReadFileSync.mockReturnValueOnce('existing-uuid')
            
            const id = getOrCreateInstallId()
            expect(id).toBe('existing-uuid')
            expect(mockWriteFileSync).not.toHaveBeenCalled()
        })

        it('should create new install ID if none exists', () => {
            mockExistsSync.mockReturnValueOnce(false)
            mockReadFileSync.mockReturnValueOnce('')
            
            const id = getOrCreateInstallId()
            expect(id).toBe('test-uuid')
            expect(mockWriteFileSync).toHaveBeenCalledWith(
                expect.any(String),
                'test-uuid',
                'utf-8'
            )
        })

        it('should handle errors gracefully', () => {
            mockExistsSync.mockReturnValueOnce(true)
            mockReadFileSync.mockImplementationOnce(() => { throw new Error('Read error') })
            
            const id = getOrCreateInstallId()
            expect(id).toBe('test-uuid') // Should fall back to generating new UUID
        })
    })

    describe('sendAnonymousInstallPing', () => {
        it('should send install ping when not already sent', async () => {
            mockExistsSync
                .mockReturnValueOnce(false) // Install ID doesn't exist
                .mockReturnValueOnce(false) // Ping not sent
            mockReadFileSync.mockReturnValueOnce('') // For install ID read
            
            const mockResponse = { ok: true }
            global.fetch = vi.fn().mockResolvedValue(mockResponse)
            
            await sendAnonymousInstallPing()
            
            expect(fetch).toHaveBeenCalledWith(
                'https://divine-sun-927d.natively.workers.dev',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                })
            )
        })

        it('should skip sending if ping already sent', async () => {
            mockExistsSync
                .mockReturnValueOnce(true)  // hasInstallPingBeenSent: ping sent file exists
                .mockReturnValueOnce(true)  // getOrCreateInstallId: install ID file exists
            mockReadFileSync
                .mockReturnValueOnce('true') // hasInstallPingBeenSent: ping sent value
                .mockReturnValueOnce('existing-id') // getOrCreateInstallId: existing ID

            await sendAnonymousInstallPing()

            expect(fetch).not.toHaveBeenCalled()
            expect(mockWriteFileSync).not.toHaveBeenCalledWith(
                expect.stringContaining('install_ping_sent'),
                'true',
                'utf-8'
            )
        })

        it('should handle network errors gracefully', async () => {
            mockExistsSync
                .mockReturnValueOnce(false) // Install ID doesn't exist
                .mockReturnValueOnce(false) // Ping not sent
            mockReadFileSync.mockReturnValueOnce('') // For install ID read

            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

            await expect(sendAnonymousInstallPing()).resolves.not.toThrow()

            expect(fetch).toHaveBeenCalled()
            expect(mockWriteFileSync).not.toHaveBeenCalledWith(
                expect.stringContaining('install_ping_sent'),
                'true',
                'utf-8'
            )
        })

        it('should handle non-ok responses gracefully', async () => {
            mockExistsSync
                .mockReturnValueOnce(false) // Install ID doesn't exist
                .mockReturnValueOnce(false) // Ping not sent
            mockReadFileSync.mockReturnValueOnce('') // For install ID read

            const mockResponse = { ok: false, status: 500 }
            global.fetch = vi.fn().mockResolvedValue(mockResponse)

            await expect(sendAnonymousInstallPing()).resolves.not.toThrow()

            expect(fetch).toHaveBeenCalled()
            expect(mockWriteFileSync).not.toHaveBeenCalledWith(
                expect.stringContaining('install_ping_sent'),
                'true',
                'utf-8'
            )
        })
    })
})
