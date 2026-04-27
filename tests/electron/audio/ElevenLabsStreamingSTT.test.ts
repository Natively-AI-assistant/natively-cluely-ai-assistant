import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let wsInstances: any[] = []

vi.mock('ws', () => {
  const { EventEmitter } = require('node:events')
  class FakeWs extends EventEmitter {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readyState = 0
    url: string
    headers: Record<string, any>
    send = vi.fn()
    close = vi.fn()
    ping = vi.fn()
    sentMessages: any[] = []
    constructor(url: string, opts?: any) {
      super()
      this.url = url
      this.headers = opts?.headers || {}
      this.send = vi.fn((data: any) => this.sentMessages.push(data))
      wsInstances.push(this)
      setTimeout(() => {
        if (this.readyState === 0) {
          this.readyState = 1
          this.emit('open')
        }
      }, 5)
    }
  }
  return { default: FakeWs }
})

// Mock fs for debug stream
vi.mock('fs', () => ({
  createWriteStream: vi.fn(() => ({ write: vi.fn(), end: vi.fn() })),
  default: {
    createWriteStream: vi.fn(() => ({ write: vi.fn(), end: vi.fn() })),
  },
}))

import { ElevenLabsStreamingSTT } from '../../../electron/audio/ElevenLabsStreamingSTT'

function getWs() {
  return wsInstances[wsInstances.length - 1]
}

describe('ElevenLabsStreamingSTT', () => {
  let stt: ElevenLabsStreamingSTT

  beforeEach(() => {
    wsInstances = []
    vi.useFakeTimers()
    stt = new ElevenLabsStreamingSTT('test-key')
  })

  afterEach(() => {
    stt.stop()
    vi.useRealTimers()
  })

  it('connects to ElevenLabs WebSocket on start', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(wsInstances).toHaveLength(1)
    expect(wsInstances[0].url).toContain('api.elevenlabs.io')
    expect(wsInstances[0].url).toContain('scribe_v2_realtime')
  })

  it('passes xi-api-key header', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(wsInstances[0].headers['xi-api-key']).toBe('test-key')
  })

  it('does nothing on duplicate start', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(wsInstances).toHaveLength(1)
  })

  it('closes connection on stop', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    stt.stop()
    expect(wsInstances[0].close).toHaveBeenCalled()
  })

  it('stop when not active does not throw', () => {
    expect(() => stt.stop()).not.toThrow()
  })

  it('buffers audio when session not ready', async () => {
    stt.start()
    // Don't emit session_started yet
    stt.write(Buffer.from([1, 2, 3, 4]))
    // Audio should be buffered
    expect(getWs().send).not.toHaveBeenCalled()
  })

  it('drops writes when not active', () => {
    stt.write(Buffer.from([1]))
    expect(wsInstances).toHaveLength(0)
  })

  it('emits partial_transcript as interim', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit(
      'message',
      JSON.stringify({
        type: 'partial_transcript',
        text: 'Hello',
      }),
    )

    expect(spy).toHaveBeenCalledWith({
      text: 'Hello',
      isFinal: false,
      confidence: 1.0,
    })
  })

  it('emits committed_transcript as final', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit(
      'message',
      JSON.stringify({
        type: 'committed_transcript',
        text: 'Hello world',
      }),
    )

    expect(spy).toHaveBeenCalledWith({
      text: 'Hello world',
      isFinal: true,
      confidence: 1.0,
    })
  })

  it('handles auth_error without reconnection', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit(
      'message',
      JSON.stringify({
        type: 'auth_error',
        error: 'Invalid API key',
      }),
    )

    // Should close and not reconnect
    await vi.advanceTimersByTimeAsync(5000)
    expect(wsInstances).toHaveLength(1)
  })

  it('emits error on server error', async () => {
    const spy = vi.fn()
    stt.on('error', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit('message', JSON.stringify({ error: 'Something went wrong' }))
    expect(spy).toHaveBeenCalled()
  })

  it('reconnects on unexpected close', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const count = wsInstances.length

    getWs().readyState = 3
    getWs().emit('close', 1006, Buffer.from(''))
    await vi.advanceTimersByTimeAsync(1100)

    expect(wsInstances.length).toBeGreaterThan(count)
  })

  it('does not reconnect on graceful close', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const count = wsInstances.length

    getWs().readyState = 3
    getWs().emit('close', 1000, Buffer.from(''))
    await vi.advanceTimersByTimeAsync(5000)

    expect(wsInstances).toHaveLength(count)
  })

  it('reconnects on language change while active', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const count = wsInstances.length

    stt.setRecognitionLanguage('spanish')
    await vi.advanceTimersByTimeAsync(20)

    expect(wsInstances.length).toBeGreaterThan(count)
  })
})
