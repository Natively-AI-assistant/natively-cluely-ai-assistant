/**
 * Mock for @deepgram/sdk — replaces the real SDK with an EventEmitter-based fake.
 * The SDK is used via dynamic require() in the source, so we need a CJS-compatible mock.
 */
import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

export const mockInstances: any[] = []

export const LiveTranscriptionEvents = {
  Open: 'open',
  Transcript: 'transcript',
  Error: 'error',
  Close: 'close',
}

class FakeLive extends EventEmitter {
  readyState = 1 // OPEN
  requestClose = vi.fn(() => {
    this.readyState = 2
    this.emit('close', { code: 1000, reason: 'Closed' })
  })
  send = vi.fn((_data: any) => {})
  keepAlive = vi.fn()

  constructor() {
    super()
    // Simulate async open
    setTimeout(() => {
      this.readyState = 1
      this.emit('open')
    }, 5)
  }
}

export function createClient(apiKey: string) {
  return {
    listen: {
      live: (opts: any) => {
        const live = new FakeLive()
        ;(live as any).url =
          `wss://api.deepgram.com/v1/listen?${new URLSearchParams(opts as any).toString()}`
        ;(live as any).headers = { Authorization: `Token ${apiKey}` }
        ;(live as any)._opts = opts
        mockInstances.push(live)
        return live
      },
    },
  }
}
