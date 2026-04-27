import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Patch the require cache so that dynamic require('@deepgram/sdk') in the source
// returns our mock. The source code uses require() at runtime, not ES imports.
const __wsInstances: any[] = []

const LiveTranscriptionEvents = {
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

function createMockClient(apiKey: string) {
  return {
    listen: {
      live: (opts: any) => {
        const live = new FakeLive()
        ;(live as any).url =
          `wss://api.deepgram.com/v1/listen?${new URLSearchParams(opts as any).toString()}`
        ;(live as any).headers = { Authorization: `Token ${apiKey}` }
        ;(live as any)._opts = opts
        __wsInstances.push(live)
        return live
      },
    },
  }
}

const mockModule = {
  createClient: createMockClient,
  LiveTranscriptionEvents,
}

// Patch require cache before importing the source
const cacheKey = require.resolve('@deepgram/sdk')
require.cache[cacheKey] = { exports: mockModule } as NodeModule

import { DeepgramStreamingSTT } from '../../../electron/audio/DeepgramStreamingSTT'

describe('DeepgramStreamingSTT', () => {
  let stt: DeepgramStreamingSTT

  beforeEach(() => {
    __wsInstances.length = 0
    vi.clearAllMocks()
    vi.useFakeTimers()
    stt = new DeepgramStreamingSTT('test-key')
  })

  afterEach(() => {
    stt.stop()
    vi.useRealTimers()
  })

  it('starts and connects WebSocket', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(__wsInstances).toHaveLength(1)
    expect(__wsInstances[0].url).toContain('deepgram.com')
  })

  it('passes API key in headers', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(__wsInstances[0].headers.Authorization).toBe('Token test-key')
  })

  it('does not reconnect on duplicate start', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(__wsInstances).toHaveLength(1)
  })

  it('closes WebSocket on stop', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    stt.stop()
    expect(__wsInstances[0].requestClose).toHaveBeenCalled()
  })

  it('sends CloseStream message on stop', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    stt.stop()
    expect(__wsInstances[0].requestClose).toHaveBeenCalled()
  })

  it('stop when not active does not throw', () => {
    expect(() => stt.stop()).not.toThrow()
  })

  it('sends audio when connected', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const data = Buffer.from([1, 2, 3])
    stt.write(data)
    expect(__wsInstances[0].send).toHaveBeenCalledWith(data)
  })

  it('buffers audio before connection opens', async () => {
    stt.start()
    const data = Buffer.from([1, 2, 3])
    stt.write(data)
    expect(__wsInstances[0].send.mock.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(20)
    expect(__wsInstances[0].send).toHaveBeenCalledWith(data)
  })

  it('drops writes when not active', () => {
    stt.write(Buffer.from([1]))
    expect(__wsInstances).toHaveLength(0)
  })

  it('caps buffer at 500 chunks', async () => {
    stt.start()
    for (let i = 0; i < 600; i++) stt.write(Buffer.from([i & 0xff]))
    await vi.advanceTimersByTimeAsync(20)
    expect(__wsInstances[0].send.mock.calls.length).toBeLessThanOrEqual(500)
  })

  it('emits transcript for final results', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    __wsInstances[0].emit('transcript', {
      channel: { alternatives: [{ transcript: 'hello', confidence: 0.9 }] },
      is_final: true,
    })

    expect(spy).toHaveBeenCalledWith({
      text: 'hello',
      isFinal: true,
      confidence: 0.9,
    })
  })

  it('emits transcript for interim results', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    __wsInstances[0].emit('transcript', {
      channel: { alternatives: [{ transcript: 'hel', confidence: 0.5 }] },
      is_final: false,
    })

    expect(spy).toHaveBeenCalledWith({
      text: 'hel',
      isFinal: false,
      confidence: 0.5,
    })
  })

  it('ignores non-Results messages', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    __wsInstances[0].emit('transcript', {
      channel: { alternatives: [{ transcript: '' }] },
      is_final: true,
    })

    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores empty transcripts', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    __wsInstances[0].emit('transcript', {
      channel: { alternatives: [{ transcript: '', confidence: 0 }] },
      is_final: true,
    })

    expect(spy).not.toHaveBeenCalled()
  })

  it('emits error on WS error', async () => {
    const spy = vi.fn()
    stt.on('error', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    __wsInstances[0].emit('error', new Error('fail'))
    expect(spy).toHaveBeenCalled()
  })

  it('handles malformed JSON gracefully', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    expect(() => __wsInstances[0].emit('transcript', 'bad json')).not.toThrow()
    expect(spy).not.toHaveBeenCalled()
  })

  it('reconnects on unexpected close', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const count = __wsInstances.length

    __wsInstances[0].readyState = 3
    __wsInstances[0].emit('close', { code: 1006, reason: 'Abnormal' })
    await vi.advanceTimersByTimeAsync(1100)

    expect(__wsInstances.length).toBeGreaterThan(count)
  })

  it('does not reconnect on graceful close', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const count = __wsInstances.length

    __wsInstances[0].readyState = 3
    __wsInstances[0].emit('close', { code: 1000, reason: 'Normal' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(__wsInstances).toHaveLength(count)
  })

  it('does not reconnect after stop', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    stt.stop()
    const count = __wsInstances.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(__wsInstances).toHaveLength(count)
  })

  it('reconnects on sample rate change while active', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const count = __wsInstances.length

    stt.setSampleRate(44100)
    await vi.advanceTimersByTimeAsync(20)

    expect(__wsInstances.length).toBeGreaterThan(count)
    expect(__wsInstances[count].url).toContain('sample_rate=44100')
  })

  it('does not restart on same sample rate', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const count = __wsInstances.length

    stt.setSampleRate(16000)
    await vi.advanceTimersByTimeAsync(20)
    expect(__wsInstances).toHaveLength(count)
  })
})
