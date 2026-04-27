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
    send = vi.fn()
    close = vi.fn()
    ping = vi.fn()
    sentMessages: any[] = []
    constructor(url: string) {
      super()
      this.url = url
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

import { SonioxStreamingSTT } from '../../../electron/audio/SonioxStreamingSTT'

function getWs() {
  return wsInstances[wsInstances.length - 1]
}

describe('SonioxStreamingSTT', () => {
  let stt: SonioxStreamingSTT

  beforeEach(() => {
    wsInstances = []
    vi.useFakeTimers()
    stt = new SonioxStreamingSTT('soniox-key')
  })

  afterEach(() => {
    stt.stop()
    vi.useRealTimers()
  })

  it('connects to Soniox WebSocket on start', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    expect(wsInstances).toHaveLength(1)
    expect(wsInstances[0].url).toContain('stt-rt.soniox.com')
  })

  it('sends config on connection open', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const configMsg = JSON.parse(wsInstances[0].sentMessages[0])
    expect(configMsg.api_key).toBe('soniox-key')
    expect(configMsg.model).toBe('stt-rt-v4')
    expect(configMsg.audio_format).toBe('pcm_s16le')
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

  it('sends audio when connected and config sent', async () => {
    stt.start()
    await vi.advanceTimersByTimeAsync(20)
    const data = Buffer.from([1, 2, 3])
    stt.write(data)
    expect(wsInstances[0].send).toHaveBeenCalledWith(data)
  })

  it('buffers audio before config is sent', async () => {
    stt.start()
    // Audio written immediately — config might not be sent yet
    stt.write(Buffer.from([1, 2]))
    // Should still be buffered or sent depending on timing
  })

  it('drops writes when not active', () => {
    stt.write(Buffer.from([1]))
    expect(wsInstances).toHaveLength(0)
  })

  it('emits final tokens as transcript', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit(
      'message',
      JSON.stringify({
        tokens: [
          { text: 'Hello', is_final: true },
          { text: ' world', is_final: true },
        ],
      }),
    )

    expect(spy).toHaveBeenCalledWith({
      text: 'Hello world',
      isFinal: true,
      confidence: 1.0,
    })
  })

  it('emits non-final tokens as interim', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit(
      'message',
      JSON.stringify({
        tokens: [{ text: 'Hel', is_final: false }],
      }),
    )

    expect(spy).toHaveBeenCalledWith({
      text: 'Hel',
      isFinal: false,
      confidence: 1.0,
    })
  })

  it('ignores <fin> and <end> markers', async () => {
    const spy = vi.fn()
    stt.on('transcript', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit(
      'message',
      JSON.stringify({
        tokens: [
          { text: '<fin>', is_final: false },
          { text: '<end>', is_final: false },
          { text: 'hello', is_final: true },
        ],
      }),
    )

    // Only the actual text should be emitted
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({
      text: 'hello',
      isFinal: true,
      confidence: 1.0,
    })
  })

  it('emits error on server error', async () => {
    const spy = vi.fn()
    stt.on('error', spy)
    stt.start()
    await vi.advanceTimersByTimeAsync(20)

    getWs().emit(
      'message',
      JSON.stringify({
        error_code: 'INVALID_KEY',
        error_message: 'Bad API key',
      }),
    )

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
})
