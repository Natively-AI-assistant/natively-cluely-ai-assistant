// tests/integration.setup.ts
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './msw/server'

// MSW: intercept HTTP calls in node environment
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
  // Removed vi.resetModules() — it causes flaky tests by invalidating
  // module caches. Use factory functions and explicit cleanup instead.
})

afterAll(() => {
  server.close()
})
