import fs from 'node:fs'
import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

// Mock electron module using shared factory
vi.mock('electron', () =>
  createElectronMock({
    app: {
      getPath: vi.fn(() => '/tmp/userdata'),
      isReady: vi.fn(() => true),
    },
    safeStorage: {
      encryptString: vi.fn(() => Buffer.from('encrypted')),
      decryptString: vi.fn(() =>
        JSON.stringify({
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          expiryDate: Date.now() + 3600000,
        }),
      ),
      isEncryptionAvailable: vi.fn(() => true),
    },
    shell: { openExternal: vi.fn() },
    net: { request: vi.fn() },
  }),
)

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

// Mock axios for Google Calendar API calls
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}))

// Mock http server for auth flow
vi.mock('http', () => ({
  default: {
    createServer: vi.fn(() => ({
      listen: vi.fn((_port, cb) => cb()),
      close: vi.fn(),
      on: vi.fn((event, handler) => {
        if (event === 'error') handler(new Error('Server error'))
      }),
    })),
  },
}))

import { safeStorage } from 'electron'
import { CalendarManager } from '../../../electron/services/CalendarManager'

describe('CalendarManager', () => {
  let calendarManager: CalendarManager

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset the singleton instance
    ;(CalendarManager as any).instance = undefined
    calendarManager = CalendarManager.getInstance()
    calendarManager.init()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getInstance', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = CalendarManager.getInstance()
      const instance2 = CalendarManager.getInstance()
      expect(instance1).toBe(instance2)
    })
  })

  describe('init', () => {
    it('should initialize without error', () => {
      expect(() => calendarManager.init()).not.toThrow()
    })

    it('should load tokens from storage when available', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(Buffer.from('encrypted'))
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(true)
      vi.mocked(safeStorage.decryptString).mockReturnValueOnce(
        JSON.stringify({
          accessToken: 'loaded-access-token',
          refreshToken: 'loaded-refresh-token',
          expiryDate: Date.now() + 3600000,
        }),
      )

      const cm = CalendarManager.getInstance()
      cm.init()

      expect(safeStorage.decryptString).toHaveBeenCalled()
      const status = cm.getConnectionStatus()
      expect(status.connected).toBe(true)
    })
  })

  describe('getConnectionStatus', () => {
    it('should return disconnected status initially', () => {
      const status = calendarManager.getConnectionStatus()
      expect(status.connected).toBe(false)
    })

    it('should return connected status when tokens exist', () => {
      // Mock tokens exist and are not expired
      vi.mocked(fs.existsSync).mockReturnValueOnce(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(Buffer.from('encrypted'))
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(true)
      vi.mocked(safeStorage.decryptString).mockReturnValueOnce(
        JSON.stringify({
          accessToken: 'valid-token',
          refreshToken: 'valid-refresh',
          expiryDate: Date.now() + 3600000, // Not expired
        }),
      )

      const cm = CalendarManager.getInstance()
      cm.init()

      const status = cm.getConnectionStatus()
      expect(status.connected).toBe(true)
    })
  })

  describe('disconnect', () => {
    it('should clear tokens and set connected to false', async () => {
      await calendarManager.disconnect()

      const statusAfter = calendarManager.getConnectionStatus()
      expect(statusAfter.connected).toBe(false)
    })

    it('should emit connection-changed event', async () => {
      const connectionChangedSpy = vi.fn()
      calendarManager.on('connection-changed', connectionChangedSpy)

      await calendarManager.disconnect()

      expect(connectionChangedSpy).toHaveBeenCalledWith(false)
    })
  })

  describe('event emitter', () => {
    it('should emit events-updated event on refreshState', async () => {
      const eventsUpdatedSpy = vi.fn()
      calendarManager.on('events-updated', eventsUpdatedSpy)

      await calendarManager.refreshState()

      expect(eventsUpdatedSpy).toHaveBeenCalled()
    })
  })

  describe('OAuth flow', () => {
    it('should reject when http server emits error', async () => {
      await expect(calendarManager.startAuthFlow()).rejects.toThrow(
        'Server error',
      )
    })
  })

  describe('token refresh', () => {
    it('should return empty array when not connected', async () => {
      const events = await calendarManager.getUpcomingEvents()
      expect(events).toEqual([])
    })

    it('should disconnect when refresh token fails', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Token expired'))

      const connectionChangedSpy = vi.fn()
      calendarManager.on('connection-changed', connectionChangedSpy)

      ;(calendarManager as any).refreshToken = 'expired-refresh-token'
      ;(calendarManager as any).isConnected = true
      ;(calendarManager as any).accessToken = 'expired-access-token'
      ;(calendarManager as any).expiryDate = Date.now() - 1000

      await calendarManager.getUpcomingEvents()

      const status = calendarManager.getConnectionStatus()
      expect(status.connected).toBe(false)
      expect(connectionChangedSpy).toHaveBeenCalledWith(false)
    })
  })

  describe('event fetching', () => {
    it('should fetch events from Google Calendar API when connected', async () => {
      const mockEvents = [
        {
          id: '1',
          summary: 'Test Meeting',
          start: { dateTime: new Date(Date.now() + 3600000).toISOString() },
          end: { dateTime: new Date(Date.now() + 7200000).toISOString() },
        },
      ]

      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { items: mockEvents },
      })

      ;(calendarManager as any).isConnected = true
      ;(calendarManager as any).accessToken = 'valid-token'
      ;(calendarManager as any).expiryDate = Date.now() + 3600000

      const events = await calendarManager.getUpcomingEvents()

      expect(events).toHaveLength(1)
      expect(events[0].title).toBe('Test Meeting')
      expect(events[0].source).toBe('google')
    })

    it('should clear and re-emit events-updated on refreshState', async () => {
      const eventsUpdatedSpy = vi.fn()
      calendarManager.on('events-updated', eventsUpdatedSpy)

      vi.mocked(axios.get).mockResolvedValueOnce({ data: { items: [] } })

      ;(calendarManager as any).isConnected = true
      ;(calendarManager as any).accessToken = 'valid-token'
      ;(calendarManager as any).expiryDate = Date.now() + 3600000

      await calendarManager.refreshState()

      expect(eventsUpdatedSpy).toHaveBeenCalled()
    })
  })
})
