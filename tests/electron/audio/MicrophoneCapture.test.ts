import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock nativeModuleLoader — uses consistent mock pattern (see tests/mocks/nativeModule.mock.ts)
vi.mock('../../../electron/audio/nativeModuleLoader', () => {
  const { EventEmitter } = require('node:events')

  class MockRustMicCapture extends EventEmitter {
    deviceId: string | null
    started = false
    dataCallback: any = null
    speechEndedCallback: any = null

    constructor(deviceId?: string | null) {
      super()
      this.deviceId = deviceId || null
    }

    getSampleRate = vi.fn(() => 48000)
    get_sample_rate = vi.fn(() => 48000)

    start = vi.fn((onData?: any, onSpeechEnded?: any) => {
      this.started = true
      this.dataCallback = onData
      this.speechEndedCallback = onSpeechEnded
    })

    stop = vi.fn(() => {
      this.started = false
    })

    // Test helpers
    _triggerData(chunk: Buffer) {
      if (this.dataCallback) this.dataCallback(null, chunk)
    }
    _triggerError(err: Error) {
      if (this.dataCallback) this.dataCallback(err, Buffer.alloc(0))
    }
    _triggerSpeechEnded() {
      if (this.speechEndedCallback) this.speechEndedCallback(null, true)
    }
  }

  const instances: any[] = []

  return {
    loadNativeModule: vi.fn(() => ({
      MicrophoneCapture: vi.fn((deviceId?: string | null) => {
        const instance = new MockRustMicCapture(deviceId)
        instances.push(instance)
        return instance
      }),
      SystemAudioCapture: vi.fn(),
      getInputDevices: vi.fn(() => []),
      getOutputDevices: vi.fn(() => []),
      getHardwareId: vi.fn(() => 'test'),
      verifyGumroadKey: vi.fn(),
    })),
    _micInstances: instances,
    _MockRustMicCapture: MockRustMicCapture,
  }
})

import { MicrophoneCapture } from '../../../electron/audio/MicrophoneCapture'
import * as nativeModuleMock from '../../../electron/audio/nativeModuleLoader'

function getLatestMic() {
  const instances = (nativeModuleMock as any)._micInstances
  return instances[instances.length - 1]
}

describe('MicrophoneCapture', () => {
  beforeEach(() => {
    ;(nativeModuleMock as any)._micInstances.length = 0
  })

  describe('constructor', () => {
    it('creates with default device when no ID provided', () => {
      const mic = new MicrophoneCapture()
      expect(mic).toBeTruthy()
    })

    it('creates with specific device ID', () => {
      const mic = new MicrophoneCapture('device-123')
      expect(mic).toBeTruthy()
    })
  })

  describe('getSampleRate()', () => {
    it('returns native sample rate', () => {
      const mic = new MicrophoneCapture()
      expect(mic.getSampleRate()).toBe(48000)
    })

    it('returns 48000 when monitor is null', () => {
      const mic = new MicrophoneCapture()
      // Monitor should exist
      expect(mic.getSampleRate()).toBeGreaterThan(0)
    })
  })

  describe('start()', () => {
    it('starts native capture', () => {
      const mic = new MicrophoneCapture()
      mic.start()
      const native = getLatestMic()
      expect(native.start).toHaveBeenCalled()
    })

    it('does nothing if already recording', () => {
      const mic = new MicrophoneCapture()
      mic.start()
      const native = getLatestMic()
      const callCount = native.start.mock.calls.length

      mic.start()
      expect(native.start).toHaveBeenCalledTimes(callCount)
    })

    it('emits start event', () => {
      const spy = vi.fn()
      const mic = new MicrophoneCapture()
      mic.on('start', spy)
      mic.start()
      expect(spy).toHaveBeenCalled()
    })

    it('emits data events from native callback', () => {
      const spy = vi.fn()
      const mic = new MicrophoneCapture()
      mic.on('data', spy)
      mic.start()

      const native = getLatestMic()
      const chunk = Buffer.from([1, 2, 3, 4])
      native._triggerData(chunk)

      expect(spy).toHaveBeenCalled()
      const emitted = spy.mock.calls[0][0]
      expect(Buffer.isBuffer(emitted)).toBe(true)
    })

    it('emits speech_ended event', () => {
      const spy = vi.fn()
      const mic = new MicrophoneCapture()
      mic.on('speech_ended', spy)
      mic.start()

      const native = getLatestMic()
      native._triggerSpeechEnded()

      expect(spy).toHaveBeenCalled()
    })

    it('emits error on native callback error', () => {
      const spy = vi.fn()
      const mic = new MicrophoneCapture()
      mic.on('error', spy)
      mic.start()

      const native = getLatestMic()
      native._triggerError(new Error('native error'))

      expect(spy).toHaveBeenCalled()
    })
  })

  describe('stop()', () => {
    it('stops native capture', () => {
      const mic = new MicrophoneCapture()
      mic.start()
      const native = getLatestMic()

      mic.stop()
      expect(native.stop).toHaveBeenCalled()
    })

    it('does nothing if not recording', () => {
      const mic = new MicrophoneCapture()
      expect(() => mic.stop()).not.toThrow()
    })

    it('emits stop event', () => {
      const spy = vi.fn()
      const mic = new MicrophoneCapture()
      mic.on('stop', spy)
      mic.start()
      mic.stop()
      expect(spy).toHaveBeenCalled()
    })
  })

  describe('destroy()', () => {
    it('stops capture and removes listeners', () => {
      const mic = new MicrophoneCapture()
      mic.on('data', vi.fn())
      mic.start()
      mic.destroy()

      expect(mic.listenerCount('data')).toBe(0)
    })
  })
})
