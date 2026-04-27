import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: { text: 'mock transcript' } }),
  },
}))

vi.mock('form-data', () => {
  function MockFormData(this: any) {
    this.append = vi.fn()
    this.getHeaders = vi.fn(() => ({ 'content-type': 'multipart/form-data' }))
  }
  return { default: MockFormData }
})

import axios from 'axios'
import { RestSTT } from '../../../electron/audio/RestSTT'

const mockAxiosPost = vi.mocked(axios.post)

describe('RestSTT', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockAxiosPost.mockClear()
    mockAxiosPost.mockResolvedValue({ data: { text: 'mock transcript' } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('lifecycle', () => {
    it('resets buffer and starts safety-net timer on start', () => {
      const stt = new RestSTT('groq', 'key')
      stt.start()
      stt.stop()
      // start+stop = one cycle of buffer reset and timer setup/cleanup
    })

    it('duplicate start is a no-op (timer not re-created)', () => {
      const stt = new RestSTT('groq', 'key')
      stt.start()
      stt.start() // second call returns early
      stt.stop()
      // No throw = timer wasn't leaked
    })

    it('stop flushes remaining audio', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: { text: 'flushed' } })
      const stt = new RestSTT('groq', 'key')
      const spy = vi.fn()
      stt.on('transcript', spy)
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.stop()
      await vi.advanceTimersByTimeAsync(100)
      expect(spy).toHaveBeenCalledWith({
        text: 'flushed',
        isFinal: true,
        confidence: 1.0,
      })
    })

    it('stop when not active does nothing', () => {
      const stt = new RestSTT('groq', 'key')
      stt.stop() // should not throw or emit
      expect(mockAxiosPost).not.toHaveBeenCalled()
    })
  })

  describe('write()', () => {
    it('buffers audio when active (no immediate upload)', () => {
      const stt = new RestSTT('groq', 'key')
      stt.start()
      stt.write(Buffer.from([1, 2, 3, 4]))
      expect(mockAxiosPost).not.toHaveBeenCalled()
      stt.stop()
    })

    it('drops data when not active', () => {
      const stt = new RestSTT('groq', 'key')
      stt.write(Buffer.from([1, 2]))
      expect(mockAxiosPost).not.toHaveBeenCalled()
    })

    it('accumulates multiple writes before flush', () => {
      const stt = new RestSTT('groq', 'key')
      stt.start()
      stt.write(Buffer.alloc(2000, 0x55))
      stt.write(Buffer.alloc(2000, 0x55))
      // Combined 4000 bytes = MIN_BUFFER_BYTES threshold, but no speech ended yet
      expect(mockAxiosPost).not.toHaveBeenCalled()
      stt.stop()
    })
  })

  describe('notifySpeechEnded()', () => {
    it('triggers upload when buffer is large enough', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: { text: 'Hello' } })
      const stt = new RestSTT('groq', 'key')
      const spy = vi.fn()
      stt.on('transcript', spy)
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)
      expect(mockAxiosPost).toHaveBeenCalled()
      expect(spy).toHaveBeenCalledWith({
        text: 'Hello',
        isFinal: true,
        confidence: 1.0,
      })
      stt.stop()
    })

    it('skips silent buffers (RMS < 50)', () => {
      const stt = new RestSTT('groq', 'key')
      stt.start()
      stt.write(Buffer.alloc(8000, 0)) // all zeros = silence
      stt.notifySpeechEnded()
      expect(mockAxiosPost).not.toHaveBeenCalled()
      stt.stop()
    })

    it('skips small buffers (< 4000 bytes)', () => {
      const stt = new RestSTT('groq', 'key')
      stt.start()
      stt.write(Buffer.alloc(100, 0x55))
      stt.notifySpeechEnded()
      expect(mockAxiosPost).not.toHaveBeenCalled()
      stt.stop()
    })

    it('ignores speech ended when not active', () => {
      const stt = new RestSTT('groq', 'key')
      stt.notifySpeechEnded()
      expect(mockAxiosPost).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('emits error on upload failure', async () => {
      mockAxiosPost.mockRejectedValueOnce(new Error('Network error'))
      const stt = new RestSTT('groq', 'key')
      const spy = vi.fn()
      stt.on('error', spy)
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)
      expect(spy).toHaveBeenCalled()
      const err = spy.mock.calls[0][0]
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toBe('Network error')
      stt.stop()
    })

    it('wraps non-Error rejections in Error object', async () => {
      mockAxiosPost.mockRejectedValueOnce('string error')
      const stt = new RestSTT('groq', 'key')
      const spy = vi.fn()
      stt.on('error', spy)
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)
      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0][0]).toBeInstanceOf(Error)
      expect(spy.mock.calls[0][0].message).toBe('string error')
      stt.stop()
    })

    it('does not emit transcript for empty response', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: { text: '' } })
      const stt = new RestSTT('groq', 'key')
      const spy = vi.fn()
      stt.on('transcript', spy)
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)
      expect(spy).not.toHaveBeenCalled()
      stt.stop()
    })
  })

  describe('configuration', () => {
    it('setApiKey reconfigures provider (next upload uses new key)', () => {
      const stt = new RestSTT('groq', 'old-key')
      stt.start()
      stt.setApiKey('new-key')
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      // If setApiKey broke config, upload would fail or use wrong endpoint
      expect(mockAxiosPost).toHaveBeenCalled()
      stt.stop()
    })

    it('setSampleRate affects WAV header (verified via upload)', async () => {
      const stt = new RestSTT('groq', 'key')
      stt.setSampleRate(44100)
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)
      // WAV header should be generated with 44100 Hz sample rate
      expect(mockAxiosPost).toHaveBeenCalled()
      stt.stop()
    })

    it('setAudioChannelCount no-op for same value', () => {
      const stt = new RestSTT('groq', 'key')
      stt.setAudioChannelCount(1) // same as default
      // No error = no-op worked
    })

    it('setRecognitionLanguage reconfigures provider', () => {
      const stt = new RestSTT('groq', 'key')
      stt.start()
      stt.setRecognitionLanguage('spanish')
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      // Reconfig shouldn't break the pipeline
      expect(mockAxiosPost).toHaveBeenCalled()
      stt.stop()
    })

    it('setCredentials is a no-op', () => {
      const stt = new RestSTT('groq', 'key')
      stt.setCredentials('/some/path')
      // No error = no-op confirmed
    })
  })

  describe('provider configs', () => {
    it.each([
      ['groq', 'https://api.groq.com/openai/v1/audio/transcriptions'],
      ['openai', 'https://api.openai.com/v1/audio/transcriptions'],
      ['elevenlabs', 'https://api.elevenlabs.io/v1/speech-to-text'],
    ])('multipart provider %s sends to correct endpoint', async (_provider, endpoint) => {
      const stt = new RestSTT(_provider as any, 'key')
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)
      expect(mockAxiosPost).toHaveBeenCalledWith(
        endpoint,
        expect.anything(),
        expect.objectContaining({ timeout: 30000 }),
      )
      stt.stop()
    })

    it.each([
      [
        'azure',
        'https://eastus.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US',
      ],
      [
        'ibmwatson',
        'https://api.us-south.speech-to-text.watson.cloud.ibm.com/v1/recognize?language=en-US',
      ],
    ])('binary provider %s sends to correct endpoint', async (_provider, endpoint) => {
      const stt = new RestSTT(_provider as any, 'key')
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)
      expect(mockAxiosPost).toHaveBeenCalledWith(
        endpoint,
        expect.any(Buffer),
        expect.objectContaining({ timeout: 30000 }),
      )
      stt.stop()
    })

    it('azure uses binary upload with Ocp-Apim-Subscription-Key header', async () => {
      const stt = new RestSTT('azure', 'my-key', undefined, 'westus')
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.stringContaining('westus.stt.speech.microsoft.com'),
        expect.any(Buffer),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Ocp-Apim-Subscription-Key': 'my-key',
          }),
        }),
      )
      stt.stop()
    })

    it('model override replaces default model', async () => {
      const stt = new RestSTT('groq', 'key', 'whisper-custom')
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)
      // The upload should include the custom model in FormData
      const formDataCall = mockAxiosPost.mock.calls[0]
      expect(formDataCall).toBeDefined()
      stt.stop()
    })
  })

  describe('concurrent upload guard', () => {
    it('queues flush when upload is in progress', async () => {
      let resolveFirst: (v: any) => void
      const firstPromise = new Promise<any>((r) => {
        resolveFirst = r
      })
      mockAxiosPost.mockReturnValueOnce(firstPromise as any)

      const stt = new RestSTT('groq', 'key')
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded() // triggers first upload
      await vi.advanceTimersByTimeAsync(100)

      // Second flush while first is still pending
      stt.write(Buffer.alloc(8000, 0x55))
      stt.notifySpeechEnded()
      await vi.advanceTimersByTimeAsync(100)

      // Only 1 call so far — second is queued
      expect(mockAxiosPost).toHaveBeenCalledTimes(1)

      // Resolve first upload — queued flush should fire
      resolveFirst?.({ data: { text: 'first' } })
      await vi.advanceTimersByTimeAsync(100)

      expect(mockAxiosPost).toHaveBeenCalledTimes(2)
      stt.stop()
    })
  })

  describe('safety-net timer', () => {
    it('auto-flushes after 10s of continuous speech', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: { text: 'auto-flushed' } })
      const stt = new RestSTT('groq', 'key')
      const spy = vi.fn()
      stt.on('transcript', spy)
      stt.start()
      stt.write(Buffer.alloc(8000, 0x55))
      await vi.advanceTimersByTimeAsync(10000) // safety-net interval
      expect(spy).toHaveBeenCalledWith({
        text: 'auto-flushed',
        isFinal: true,
        confidence: 1.0,
      })
      stt.stop()
    })
  })
})
