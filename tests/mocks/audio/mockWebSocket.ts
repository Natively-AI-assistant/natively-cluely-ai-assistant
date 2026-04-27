/**
 * Mock WebSocket for STT provider testing.
 *
 * Simulates the `ws` module's WebSocket class with:
 * - readyState lifecycle (CONNECTING → OPEN → CLOSING → CLOSED)
 * - Event handlers (onopen, onclose, onmessage, onerror)
 * - send() and close() as vi.fn() spies
 * - Factory function for easy per-test setup
 */

import { type Mock, vi } from 'vitest'

// WebSocket readyState constants (matching the `ws` module)
export const READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const

export interface MockWebSocketOptions {
  /** Auto-transition to OPEN after N ms (default: 10) */
  autoOpenDelay?: number
  /** Simulate an error on connect */
  connectError?: Error
  /** Custom message handler responses keyed by message type */
  messageResponses?: Record<string, any>
}

type EventHandler = (...args: any[]) => void

export class MockWebSocket {
  public readyState: number = READY_STATE.CONNECTING
  public url: string
  public protocols?: string | string[]
  public headers: Record<string, string>

  // Event handler properties (ws-style)
  public onopen: EventHandler | null = null
  public onclose: EventHandler | null = null
  public onmessage: EventHandler | null = null
  public onerror: EventHandler | null = null

  // vi.fn() spies for assertions
  public send: Mock
  public close: Mock
  public ping: Mock
  public pong: Mock

  // Internal listeners for addEventListener/removeEventListener style
  private listeners: Map<string, Set<EventHandler>> = new Map()

  // Store sent messages for test assertions
  public sentMessages: any[] = []

  // Control the mock behavior
  private options: MockWebSocketOptions
  private openTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    url: string,
    protocols?: string | string[] | Record<string, any>,
    options?: MockWebSocketOptions,
  ) {
    this.url = url
    this.options = options || {}

    if (typeof protocols === 'string' || Array.isArray(protocols)) {
      this.protocols = protocols
    } else if (protocols && typeof protocols === 'object') {
      this.headers = protocols.headers || {}
    }
    this.headers = this.headers || {}

    // Create vi.fn() spies
    this.send = vi.fn((data: any) => {
      this.sentMessages.push(data)
    })

    this.close = vi.fn((code?: number, reason?: string) => {
      this.readyState = READY_STATE.CLOSING
      // Simulate async close
      queueMicrotask(() => {
        this.readyState = READY_STATE.CLOSED
        this._emit(
          'close',
          code ?? 1000,
          reason ? Buffer.from(reason) : Buffer.from(''),
        )
      })
    })

    this.ping = vi.fn()
    this.pong = vi.fn()

    // Auto-open after delay
    const delay = this.options.autoOpenDelay ?? 10
    if (delay >= 0 && !this.options.connectError) {
      this.openTimer = setTimeout(() => this._simulateOpen(), delay)
    } else if (this.options.connectError) {
      this.openTimer = setTimeout(
        () => this._simulateError(this.options.connectError!),
        delay,
      )
    }
  }

  /** Simulate the connection opening */
  public _simulateOpen(): void {
    if (this.readyState !== READY_STATE.CONNECTING) return
    this.readyState = READY_STATE.OPEN
    this._emit('open')
  }

  /** Simulate receiving a message */
  public _simulateMessage(data: string | Buffer | object): void {
    const payload =
      typeof data === 'object' && !Buffer.isBuffer(data)
        ? JSON.stringify(data)
        : data
    this._emit('message', payload)
  }

  /** Simulate an error */
  public _simulateError(err: Error): void {
    this._emit('error', err)
  }

  /** Simulate the connection closing */
  public _simulateClose(code: number = 1000, reason: string = ''): void {
    this.readyState = READY_STATE.CLOSED
    this._emit('close', code, Buffer.from(reason))
  }

  // addEventListener / removeEventListener (some ws consumers use this)
  public addEventListener(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)?.add(handler)
  }

  public removeEventListener(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler)
  }

  public removeAllListeners(): void {
    this.listeners.clear()
    this.onopen = null
    this.onclose = null
    this.onmessage = null
    this.onerror = null
  }

  /** Internal: emit to both property-style and addEventListener-style listeners */
  private _emit(event: string, ...args: any[]): void {
    // Property-style
    const propHandler = (this as any)[`on${event}`]
    if (typeof propHandler === 'function') {
      propHandler(...args)
    }
    // addEventListener-style
    this.listeners.get(event)?.forEach((h) => h(...args))
  }

  /** Cleanup timers */
  public _cleanup(): void {
    if (this.openTimer) {
      clearTimeout(this.openTimer)
      this.openTimer = null
    }
  }
}
// Wire static readyState constants onto the class (matching `ws` WebSocket)
;(MockWebSocket as any).CONNECTING = READY_STATE.CONNECTING
;(MockWebSocket as any).OPEN = READY_STATE.OPEN
;(MockWebSocket as any).CLOSING = READY_STATE.CLOSING
;(MockWebSocket as any).CLOSED = READY_STATE.CLOSED

/**
 * Factory function to create a MockWebSocket constructor with default options.
 * Use with vi.mock('ws', () => ({ default: createMockWebSocket() }))
 */
export function createMockWebSocket(defaults?: MockWebSocketOptions) {
  const instances: MockWebSocket[] = []

  const MockWsConstructor = vi.fn(
    (url: string, protocols?: any, options?: any) => {
      const instance = new MockWebSocket(url, protocols, {
        ...defaults,
        ...options,
      })
      instances.push(instance)
      return instance
    },
  )

  // Attach static constants (cast to any to bypass vi.fn() type restrictions)
  ;(MockWsConstructor as any).CONNECTING = READY_STATE.CONNECTING
  ;(MockWsConstructor as any).OPEN = READY_STATE.OPEN
  ;(MockWsConstructor as any).CLOSING = READY_STATE.CLOSING
  ;(MockWsConstructor as any).CLOSED = READY_STATE.CLOSED

  return {
    WebSocket: MockWsConstructor,
    instances,
    /** Get the most recently created instance */
    latestInstance: () => instances[instances.length - 1] ?? null,
    /** Reset all instances */
    reset: () => {
      instances.forEach((i) => i._cleanup())
      instances.length = 0
      MockWsConstructor.mockClear()
    },
  }
}

export default MockWebSocket
