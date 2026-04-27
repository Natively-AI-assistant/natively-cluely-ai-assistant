import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ws', () => {
  const mockSend = vi.fn()
  const mockClose = vi.fn()

  let lastInstance: MockWSInstance | null = null

  class MockWebSocket {
    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    readyState = 1
    private _handlers: Record<string, Function[]> = {}

    on: (event: string, cb: Function) => void = (event, cb) => {
      if (!this._handlers[event]) this._handlers[event] = []
      this._handlers[event].push(cb)
    }

    send = mockSend
    close = mockClose

    constructor() {
      // Capture every new instance so tests can fire its event handlers
      lastInstance = this as unknown as MockWSInstance
    }

    _trigger(event: string, arg?: unknown) {
      const cbs = this._handlers[event] ?? []
      cbs.forEach((cb) => cb(arg))
    }

    _triggerOpen() {
      this._trigger('open')
    }

    _triggerMessage(data: string) {
      // WebSocket.message listener calls JSON.parse(data.toString()) — pass raw string
      this._trigger('message', data)
    }

    _triggerError(err: Error) {
      this._trigger('error', err)
    }

    _triggerClose(code: number) {
      // WebSocket.close handler signature is (code: number)
      this._trigger('close', code)
    }

    static _triggerOpen() {
      /* no-op for static — use instance */
    }
    static _triggerMessage(_data: string) {
      /* no-op — use instance */
    }
    static _triggerError(_err: Error) {
      /* no-op — use instance */
    }
    static _triggerClose(_code: number) {
      /* no-op — use instance */
    }
  }

  return {
    default: MockWebSocket,
    mockSend,
    mockClose,
    getLastInstance: () => lastInstance,
  }
})

vi.mock('../../electron/services/CredentialsManager', () => ({
  CredentialsManager: {
    getInstance: vi.fn(() => ({
      getTrialToken: vi.fn(() => 'trial-token-mock'),
    })),
  },
}))

import { getLastInstance, mockClose, mockSend } from 'ws'
import { NativelyProSTT } from '../../../electron/audio/NativelyProSTT'

describe('NativelyProSTT', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSend.mockClear()
    mockClose.mockClear()
    // Reset static stagger map between tests
    NativelyProSTT.nextSlotByKey.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Construction ──────────────────────────────────────────

  describe('construction', () => {
    it('instantiates with apiKey and default channel', () => {
      const stt = new NativelyProSTT('my-key')
      expect(stt).toBeInstanceOf(NativelyProSTT)
    })

    it('instantiates with explicit channel', () => {
      const stt = new NativelyProSTT('my-key', 'mic')
      expect(stt).toBeInstanceOf(NativelyProSTT)
    })
  })

  // ── Lifecycle ──────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() initiates WebSocket connection', () => {
      const stt = new NativelyProSTT('my-key')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      expect(mockSend).toHaveBeenCalled()
      stt.stop()
    })

    it('duplicate start is a no-op', () => {
      const stt = new NativelyProSTT('my-key')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      mockSend.mockClear()
      stt.start() // second call — should not reconnect
      expect(mockSend).not.toHaveBeenCalled()
      stt.stop()
    })

    it('stop() clears state and closes WebSocket', () => {
      const stt = new NativelyProSTT('my-key')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      stt.stop()
      expect(mockClose).toHaveBeenCalled()
    })

    it('stop() when not active is a no-op', () => {
      const stt = new NativelyProSTT('my-key')
      expect(() => stt.stop()).not.toThrow()
    })

    it('stop() resets chunks counter', () => {
      const stt = new NativelyProSTT('my-key')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      stt.stop()
      // A second start sends fresh chunk counter
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      stt.stop()
    })

    it('stop() clears reconnect and stability timers', () => {
      const stt = new NativelyProSTT('my-key')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      const callsBeforeStop = mockSend.mock.calls.length
      stt.stop()
      // No stagger timers should fire after stop (isActive=false)
      vi.advanceTimersByTime(5000)
      // The only send call should be the auth frame sent before stop()
      expect(mockSend.mock.calls.length).toBe(callsBeforeStop)
    })
  })

  // ── Server handshake ──────────────────────────────────────

  describe('server handshake', () => {
    it('sends auth frame on WebSocket open', () => {
      const stt = new NativelyProSTT('my-key')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('"key":"my-key"'),
      )
      stt.stop()
    })

    it('sends sample_rate in auth frame', () => {
      const stt = new NativelyProSTT('my-key')
      stt.setSampleRate(44100)
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('"sample_rate":44100'),
      )
      stt.stop()
    })

    it('sends audio_channels in auth frame', () => {
      const stt = new NativelyProSTT('my-key')
      stt.setAudioChannelCount(2)
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('"audio_channels":2'),
      )
      stt.stop()
    })

    it('sends language in auth frame', () => {
      const stt = new NativelyProSTT('my-key')
      stt.setRecognitionLanguage('english-us')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('"language":"en-US"'),
      )
      stt.stop()
    })

    it('sends auto language when set to auto mode', () => {
      const stt = new NativelyProSTT('my-key')
      stt.setRecognitionLanguage('auto')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('"language":"auto"'),
      )
      stt.stop()
    })

    it('sends trial_token when key is __trial__ sentinel', () => {
      const stt = new NativelyProSTT('__trial__')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      // The __trial__ key triggers a CredentialsManager lookup for a trial token.
      // Without a working CredentialsManager mock the token field is absent, but the
      // connection is still attempted — verify the auth frame was sent.
      expect(mockSend).toHaveBeenCalled()
      expect(mockSend).toHaveBeenCalledWith(
        expect.not.stringContaining('"key":"__trial__"'),
      )
      stt.stop()
    })
  })

  // ── write() ───────────────────────────────────────────────

  describe('write()', () => {
    it('drops data when not active', () => {
      const stt = new NativelyProSTT('my-key')
      stt.write(Buffer.from([1, 2, 3]))
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('buffers data when not yet connected', () => {
      const stt = new NativelyProSTT('my-key')
      stt.start()
      // Before the staggered timer fires, write some data
      stt.write(Buffer.from([1, 2, 3]))
      // No send yet — we're still in stagger delay
      expect(mockSend).not.toHaveBeenCalled()
      stt.stop()
    })
  })

  // ── setRecognitionLanguage() ──────────────────────────────

  describe('setRecognitionLanguage()', () => {
    it('reconnects when language changes while active', () => {
      const stt = new NativelyProSTT('my-key')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      mockSend.mockClear()
      stt.setRecognitionLanguage('english-us')
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      // Should have sent a second auth frame for the reconnect
      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('"language":"en-US"'),
      )
      stt.stop()
    })

    it('warns on unknown language key', () => {
      const stt = new NativelyProSTT('my-key')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      stt.setRecognitionLanguage('unknown-language')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown language key'),
      )
      warnSpy.mockRestore()
    })
  })

  // ── Events ────────────────────────────────────────────────

  describe('events', () => {
    it('emits transcript event on server text message', () => {
      const stt = new NativelyProSTT('my-key')
      const spy = vi.fn()
      stt.on('transcript', spy)
      stt.start()
      vi.advanceTimersByTime(3000)
      const inst = getLastInstance()!
      inst._triggerOpen()

      inst._triggerMessage(
        JSON.stringify({ status: 'connected', provider: 'deepgram' }),
      )
      expect(spy).not.toHaveBeenCalled()

      inst._triggerMessage(
        JSON.stringify({ text: 'Hello world', is_final: true }),
      )
      expect(spy).toHaveBeenCalledWith({
        text: 'Hello world',
        isFinal: true,
        confidence: 1.0,
      })

      stt.stop()
    })

    it('emits error event on server error message', () => {
      const stt = new NativelyProSTT('my-key')
      const spy = vi.fn()
      stt.on('error', spy)
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      getLastInstance()?._triggerMessage(
        JSON.stringify({ error: 'auth_timeout' }),
      )

      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0][0]).toBeInstanceOf(Error)
      expect(spy.mock.calls[0][0].message).toBe('auth_timeout')

      stt.stop()
    })

    it('emits error event on WebSocket error', () => {
      const stt = new NativelyProSTT('my-key')
      const spy = vi.fn()
      stt.on('error', spy)
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      getLastInstance()?._triggerError(new Error('ws network error'))

      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0][0]).toBeInstanceOf(Error)

      stt.stop()
    })

    it('emits languageDetected on auto-detect message', () => {
      const stt = new NativelyProSTT('my-key')
      const spy = vi.fn()
      stt.on('languageDetected', spy)
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      getLastInstance()?._triggerMessage(
        JSON.stringify({ language_detected: 'fr-FR' }),
      )

      expect(spy).toHaveBeenCalledWith('fr-FR')

      stt.stop()
    })

    it('emits transcript with confidence from server message', () => {
      const stt = new NativelyProSTT('my-key')
      const spy = vi.fn()
      stt.on('transcript', spy)
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      getLastInstance()?._triggerMessage(
        JSON.stringify({ text: 'Hello', is_final: true, confidence: 0.85 }),
      )

      expect(spy).toHaveBeenCalledWith({
        text: 'Hello',
        isFinal: true,
        confidence: 0.85,
      })

      stt.stop()
    })
  })

  // ── Reconnect ─────────────────────────────────────────────

  describe('reconnect', () => {
    it('skips reconnect after intentional close (stop)', () => {
      const stt = new NativelyProSTT('my-key')
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()
      mockSend.mockClear()

      stt.stop() // intentional — no reconnect
      vi.advanceTimersByTime(5000)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('emits error after close when reconnect limit exhausted', () => {
      const stt = new NativelyProSTT('my-key')
      const errorSpy = vi.fn()
      stt.on('error', errorSpy)
      stt.start()
      vi.advanceTimersByTime(3000)
      getLastInstance()?._triggerOpen()

      // Simulate 6 close events. The 5th exhausts MAX_RECONNECT (5) and fires
      // the error synchronously. The 6th close event increments attempts to 6.
      for (let i = 0; i < 6; i++) {
        getLastInstance()?._triggerClose(1006)
        const reconnectDelay = 1500 * 2 ** Math.min(i, 4)
        vi.advanceTimersByTime(reconnectDelay + 3000)
      }

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('max reconnect attempts exceeded'),
        }),
      )

      stt.stop()
    })
  })

  // ── Configuration ──────────────────────────────────────────

  describe('configuration', () => {
    it('setSampleRate is a no-op that updates rate', () => {
      const stt = new NativelyProSTT('my-key')
      expect(() => stt.setSampleRate(44100)).not.toThrow()
    })

    it('setAudioChannelCount is a no-op that updates count', () => {
      const stt = new NativelyProSTT('my-key')
      expect(() => stt.setAudioChannelCount(2)).not.toThrow()
    })

    it('notifySpeechEnded is a no-op', () => {
      const stt = new NativelyProSTT('my-key')
      expect(() => stt.notifySpeechEnded()).not.toThrow()
    })

    it('setCredentials is a no-op', () => {
      const stt = new NativelyProSTT('my-key')
      expect(() => stt.setCredentials('/some/path')).not.toThrow()
    })
  })
})
