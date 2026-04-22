import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock nativeModuleLoader — uses consistent mock pattern (see tests/mocks/nativeModule.mock.ts)
vi.mock('../../../electron/audio/nativeModuleLoader', () => {
  class MockRustSysCapture {
    deviceId: string | null;
    started = false;
    dataCallback: any = null;
    speechEndedCallback: any = null;

    constructor(deviceId?: string | null) {
      this.deviceId = deviceId || null;
    }

    getSampleRate = vi.fn(() => 48000);
    get_sample_rate = vi.fn(() => 48000);

    start = vi.fn((onData?: any, onSpeechEnded?: any) => {
      this.started = true;
      this.dataCallback = onData;
      this.speechEndedCallback = onSpeechEnded;
    });

    stop = vi.fn(() => {
      this.started = false;
    });

    _triggerData(chunk: Buffer) {
      if (this.dataCallback) this.dataCallback(null, chunk);
    }
    _triggerError(err: Error) {
      if (this.dataCallback) this.dataCallback(err, Buffer.alloc(0));
    }
    _triggerSpeechEnded() {
      if (this.speechEndedCallback) this.speechEndedCallback(null, true);
    }
  }

  const instances: any[] = [];

  return {
    loadNativeModule: vi.fn(() => ({
      SystemAudioCapture: vi.fn(function (deviceId?: string | null) {
        const instance = new MockRustSysCapture(deviceId);
        instances.push(instance);
        return instance;
      }),
      MicrophoneCapture: vi.fn(),
      getInputDevices: vi.fn(() => []),
      getOutputDevices: vi.fn(() => []),
      getHardwareId: vi.fn(() => 'test'),
      verifyGumroadKey: vi.fn(),
    })),
    _sysInstances: instances,
  };
});

import { SystemAudioCapture } from '../../../electron/audio/SystemAudioCapture';
import * as nativeModuleMock from '../../../electron/audio/nativeModuleLoader';

function getLatestSys() {
  const instances = (nativeModuleMock as any)._sysInstances;
  return instances[instances.length - 1];
}

describe('SystemAudioCapture', () => {
  beforeEach(() => {
    (nativeModuleMock as any)._sysInstances.length = 0;
  });

  describe('constructor', () => {
    it('creates with default device when no ID provided', () => {
      const cap = new SystemAudioCapture();
      expect(cap).toBeTruthy();
    });

    it('creates with specific device ID', () => {
      const cap = new SystemAudioCapture('loopback-1');
      expect(cap).toBeTruthy();
    });
  });

  describe('getSampleRate()', () => {
    it('returns detected sample rate', () => {
      const cap = new SystemAudioCapture();
      expect(cap.getSampleRate()).toBe(48000);
    });
  });

  describe('start()', () => {
    it('creates native monitor on first start', () => {
      const cap = new SystemAudioCapture();
      cap.start();
      const native = getLatestSys();
      expect(native).toBeTruthy();
      expect(native.start).toHaveBeenCalled();
    });

    it('does nothing if already recording', () => {
      const cap = new SystemAudioCapture();
      cap.start();
      const native = getLatestSys();
      const callCount = native.start.mock.calls.length;

      cap.start();
      expect(native.start).toHaveBeenCalledTimes(callCount);
    });

    it('emits start event', () => {
      const spy = vi.fn();
      const cap = new SystemAudioCapture();
      cap.on('start', spy);
      cap.start();
      expect(spy).toHaveBeenCalled();
    });

    it('emits data events from native callback', () => {
      const spy = vi.fn();
      const cap = new SystemAudioCapture();
      cap.on('data', spy);
      cap.start();

      const native = getLatestSys();
      const chunk = Buffer.from([1, 2, 3, 4]);
      native._triggerData(chunk);

      expect(spy).toHaveBeenCalled();
      expect(Buffer.isBuffer(spy.mock.calls[0][0])).toBe(true);
    });

    it('emits speech_ended event', () => {
      const spy = vi.fn();
      const cap = new SystemAudioCapture();
      cap.on('speech_ended', spy);
      cap.start();

      const native = getLatestSys();
      native._triggerSpeechEnded();

      expect(spy).toHaveBeenCalled();
    });

    it('emits error on native callback error', () => {
      const spy = vi.fn();
      const cap = new SystemAudioCapture();
      cap.on('error', spy);
      cap.start();

      const native = getLatestSys();
      native._triggerError(new Error('native error'));

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('stops native capture', () => {
      const cap = new SystemAudioCapture();
      cap.start();
      const native = getLatestSys();

      cap.stop();
      expect(native.stop).toHaveBeenCalled();
    });

    it('does nothing if not recording', () => {
      const cap = new SystemAudioCapture();
      expect(() => cap.stop()).not.toThrow();
    });

    it('emits stop event', () => {
      const spy = vi.fn();
      const cap = new SystemAudioCapture();
      cap.on('stop', spy);
      cap.start();
      cap.stop();
      expect(spy).toHaveBeenCalled();
    });

    it('destroys monitor on stop', () => {
      const cap = new SystemAudioCapture();
      cap.start();
      cap.stop();

      // After stop, getSampleRate returns default (monitor is null)
      expect(cap.getSampleRate()).toBe(48000);
    });
  });

  describe('destroy()', () => {
    it('stops capture and removes listeners', () => {
      const cap = new SystemAudioCapture();
      cap.on('data', vi.fn());
      cap.start();
      cap.destroy();

      expect(cap.listenerCount('data')).toBe(0);
    });
  });
});
