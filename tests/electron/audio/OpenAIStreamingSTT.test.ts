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
    removeAllListeners() {
      super.removeAllListeners()
    }
  }
  return { default: FakeWs }
})

// Mock axios for REST fallback
vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: { text: 'mock transcript' } }),
  },
}))

// Mock form-data
vi.mock('form-data', () => {
  function MockFormData(this: any) {
    this.append = vi.fn()
    this.getHeaders = vi.fn(() => ({ 'content-type': 'multipart/form-data' }))
  }
  return { default: MockFormData }
})

import { OpenAIStreamingSTT } from '../../../electron/audio/OpenAIStreamingSTT'

function getWs() {
  return wsInstances[wsInstances.length - 1]
}

describe('OpenAIStreamingSTT', () => {
  let stt: OpenAIStreamingSTT

  beforeEach(() => {
    wsInstances = []
    vi.useFakeTimers()
    stt = new OpenAIStreamingSTT('openai-key')
  })

  afterEach(() => {
    stt.stop()
    vi.useRealTimers()
  })

  it('connects to OpenAI Realtime WebSocket on start', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(wsInstances).toHaveLength(1)
    expect(wsInstances[0].url).toContain('api.openai.com/v1/realtime')
  })

  it('passes Bearer auth and OpenAI-Beta header', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(wsInstances[0].headers.Authorization).toBe('Bearer openai-key')
    expect(wsInstances[0].headers['OpenAI-Beta']).toBe('realtime=v1')
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

  it('drops writes when not active', () => {
    stt.write(Buffer.from([1]))
    expect(wsInstances).toHaveLength(0)
  })

  it('buffers audio before session is ready', async () => {
    stt.start()
    // Session not ready yet — audio goes to ring buffer
    stt.write(Buffer.from([1, 2, 3, 4]))
    await vi.advanceTimersByTimeAsync(20)
    // After WS opens, session.created still needed
  })

  it('emits transcript for text delta (interim)', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    // Simulate session created
    getWs().emit(
      'message',
      JSON.stringify({ type: 'transcription_session.created' }),
    )
    await vi.advanceTimersByTimeAsync(10)

    getWs().emit(
      'message',
      JSON.stringify({
        type: 'transcript.text.delta',
        delta: 'Hello',
      }),
    )

    expect(spy).toHaveBeenCalledWith({
      text: 'Hello',
      isFinal: false,
      confidence: 1.0,
    })
  })

  it('emits transcript for text done (final)', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit('message', JSON.stringify({ type: 'session.created' }))
    await vi.advanceTimersByTimeAsync(10)

    getWs().emit(
      'message',
      JSON.stringify({
        type: 'transcript.text.done',
        text: 'Hello world',
      }),
    )

    expect(spy).toHaveBeenCalledWith({
      text: 'Hello world',
      isFinal: true,
      confidence: 1.0,
    })
  })

  it('emits error on server error message', async () => {
    const spy = vi.fn()
    stt.on('error', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit(
      'message',
      JSON.stringify({
        type: 'error',
        error: { message: 'Rate limited' },
      }),
    )

    expect(spy).toHaveBeenCalled()
  })

  it('handles malformed JSON gracefully', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(() => getWs().emit('message', 'bad json')).not.toThrow()
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

  it('does not reconnect after stop', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    stt.stop()
    const count = wsInstances.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(wsInstances).toHaveLength(count)
  })
})
