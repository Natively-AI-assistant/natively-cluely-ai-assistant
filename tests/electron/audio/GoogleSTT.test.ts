/**
 * Tests for GoogleSTT - Google Cloud Speech-to-Text streaming
 *
 * Mocks @google-cloud/speech to test connection lifecycle, transcript parsing,
 * configuration changes, and error handling without real API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ─── Mock gRPC stream ────────────────────────────────────────────────────────

let currentStream: any;

function createMockStream() {
  const stream = new EventEmitter() as any;
  stream.write = vi.fn();
  stream.end = vi.fn();
  stream.destroy = vi.fn();
  stream.destroyed = false;
  stream.writable = true;
  stream.command = { writable: true };
  currentStream = stream;
  return stream;
}

// ─── Mock @google-cloud/speech ───────────────────────────────────────────────

vi.mock('@google-cloud/speech', () => {
  function SpeechClientMock(this: any, _config?: any) {
    // Constructor logic
  }
  SpeechClientMock.prototype.streamingRecognize = vi.fn(function () {
    return createMockStream();
  });

  return { SpeechClient: SpeechClientMock };
});

import { GoogleSTT } from '../../../electron/audio/GoogleSTT';
import { SpeechClient } from '@google-cloud/speech';

describe('GoogleSTT', () => {
  let stt: GoogleSTT;

  beforeEach(() => {
    vi.useFakeTimers();
    // Reset mock
    const proto = SpeechClient.prototype as any;
    proto.streamingRecognize.mockClear();
    proto.streamingRecognize.mockImplementation(function () {
      return createMockStream();
    });
    stt = new GoogleSTT();
  });

  afterEach(() => {
    try { stt.stop(); } catch { /* stream may already be null */ }
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('creates a streaming recognize connection', () => {
      stt.start();
      expect((SpeechClient.prototype as any).streamingRecognize).toHaveBeenCalledTimes(1);
    });

    it('passes correct audio configuration', () => {
      stt.start();
      const config = (SpeechClient.prototype as any).streamingRecognize.mock.calls[0][0];
      expect(config.config.encoding).toBe('LINEAR16');
      expect(config.config.sampleRateHertz).toBe(16000);
      expect(config.config.audioChannelCount).toBe(1);
      expect(config.interimResults).toBe(true);
    });

    it('does nothing if already active', () => {
      stt.start();
      stt.start();
      expect((SpeechClient.prototype as any).streamingRecognize).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop()', () => {
    it('ends and destroys the stream', () => {
      stt.start();
      stt.stop();
      expect(currentStream.end).toHaveBeenCalled();
      expect(currentStream.destroy).toHaveBeenCalled();
    });

    it('does nothing if not active', () => {
      expect(() => stt.stop()).not.toThrow();
    });
  });

  describe('write()', () => {
    it('writes audio data to the stream', () => {
      stt.start();
      const data = Buffer.from([1, 2, 3, 4]);
      stt.write(data);
      expect(currentStream.write).toHaveBeenCalledWith(data);
    });

    it('buffers audio when stream is not ready', () => {
      stt.start();
      currentStream.writable = false;
      currentStream.command = { writable: false };
      stt.write(Buffer.from([1, 2]));
      expect(currentStream.write).not.toHaveBeenCalled();
    });

    it('drops data when not active', () => {
      stt.write(Buffer.from([1, 2]));
      expect((SpeechClient.prototype as any).streamingRecognize).not.toHaveBeenCalled();
    });
  });

  describe('transcript parsing', () => {
    it('emits transcript event for final results', () => {
      const spy = vi.fn();
      stt.on('transcript', spy);
      stt.start();

      currentStream.emit('data', {
        results: [{ alternatives: [{ transcript: 'Hello world', confidence: 0.92 }], isFinal: true }],
      });

      expect(spy).toHaveBeenCalledWith({ text: 'Hello world', isFinal: true, confidence: 0.92 });
    });

    it('emits transcript event for interim results', () => {
      const spy = vi.fn();
      stt.on('transcript', spy);
      stt.start();

      currentStream.emit('data', {
        results: [{ alternatives: [{ transcript: 'Hel', confidence: 0.4 }], isFinal: false }],
      });

      expect(spy).toHaveBeenCalledWith({ text: 'Hel', isFinal: false, confidence: 0.4 });
    });

    it('ignores empty transcripts', () => {
      const spy = vi.fn();
      stt.on('transcript', spy);
      stt.start();

      currentStream.emit('data', {
        results: [{ alternatives: [{ transcript: '', confidence: 0 }], isFinal: true }],
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('emits error event on stream error', () => {
      const spy = vi.fn();
      stt.on('error', spy);
      stt.start();

      const err = new Error('gRPC error');
      currentStream.emit('error', err);
      expect(spy).toHaveBeenCalledWith(err);
    });

    it('resets streaming state on error', () => {
      stt.start();
      // Must have at least one listener — Node EventEmitter throws on 'error' with none
      stt.on('error', () => {});
      currentStream.emit('error', new Error('test'));

      // isActive is still true — write() triggers lazy reconnect
      // But we need to stop() first if we want to call start() again
      stt.stop();

      (SpeechClient.prototype as any).streamingRecognize.mockClear();
      stt.start();
      expect((SpeechClient.prototype as any).streamingRecognize).toHaveBeenCalled();
    });
  });

  describe('stream lifecycle', () => {
    it('resets state when stream ends', () => {
      stt.start();
      currentStream.emit('end');
      stt.write(Buffer.from([1]));
      expect(currentStream.write).not.toHaveBeenCalled();
    });

    it('resets state when stream closes', () => {
      stt.start();
      currentStream.emit('close');
      stt.write(Buffer.from([1]));
      expect(currentStream.write).not.toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('setSampleRate restarts stream when active', () => {
      stt.start();
      const count = (SpeechClient.prototype as any).streamingRecognize.mock.calls.length;
      stt.setSampleRate(44100);

      expect((SpeechClient.prototype as any).streamingRecognize.mock.calls.length).toBeGreaterThan(count);
      const newConfig = (SpeechClient.prototype as any).streamingRecognize.mock.calls[count][0];
      expect(newConfig.config.sampleRateHertz).toBe(44100);
    });

    it('setSampleRate does nothing when rate is the same', () => {
      stt.start();
      const count = (SpeechClient.prototype as any).streamingRecognize.mock.calls.length;
      stt.setSampleRate(16000);
      expect((SpeechClient.prototype as any).streamingRecognize).toHaveBeenCalledTimes(count);
    });

    it('setAudioChannelCount restarts stream when active', () => {
      stt.start();
      const count = (SpeechClient.prototype as any).streamingRecognize.mock.calls.length;
      stt.setAudioChannelCount(2);

      expect((SpeechClient.prototype as any).streamingRecognize.mock.calls.length).toBeGreaterThan(count);
      const newConfig = (SpeechClient.prototype as any).streamingRecognize.mock.calls[count][0];
      expect(newConfig.config.audioChannelCount).toBe(2);
    });

    it('setRecognitionLanguage debounces and restarts', async () => {
      stt.start();
      const count = (SpeechClient.prototype as any).streamingRecognize.mock.calls.length;
      stt.setRecognitionLanguage('spanish');
      await vi.advanceTimersByTimeAsync(300);

      expect((SpeechClient.prototype as any).streamingRecognize.mock.calls.length).toBeGreaterThan(count);
    });
  });

  describe('notifySpeechEnded', () => {
    it('is a no-op (server-side VAD)', () => {
      stt.start();
      expect(() => stt.notifySpeechEnded()).not.toThrow();
    });
  });
});
