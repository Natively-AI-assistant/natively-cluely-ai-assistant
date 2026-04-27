/**
 * Mock for `ws` module — the underlying WebSocket library that @deepgram/sdk
 * uses internally. By mocking `ws`, we intercept the SDK's WebSocket creation
 * regardless of whether the SDK uses raw `ws` or its own wrapper.
 */
import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

const instances: any[] = []

export { instances }

export class WebSocket extends EventEmitter {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState: number = WebSocket.CONNECTING
  url: string
  send = vi.fn((_data: any) => {})
  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = WebSocket.CLOSED
    this.emit('close', code ?? 1000, reason ?? '')
  })
  terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSED
    this.emit('close', 1006, 'Terminated')
  })
  ping = vi.fn()
  pong = vi.fn()

  constructor(url: string) {
    super()
    this.url = url
    instances.push(this)

    // Simulate async open
    setTimeout(() => {
      this.readyState = WebSocket.OPEN
      this.emit('open')
    }, 5)
  }
}
