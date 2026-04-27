import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { createElectronMock, resetElectronMock } from './mocks/electron.mock'
import { server } from './msw/server'

// Install shared electron mock for all electron tests
vi.mock('electron', () => createElectronMock())

// Mock path module to avoid disk I/O in tests
vi.mock('path', () => ({
  default: {
    join: (...args: string[]) => args.join('/'),
  },
}))

// MSW: intercept HTTP calls in node environment
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => {
  server.resetHandlers()
  resetElectronMock()
})
afterAll(() => server.close())
