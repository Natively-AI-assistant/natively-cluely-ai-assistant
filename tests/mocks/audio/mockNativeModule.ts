/**
 * Mock native audio module for testing MicrophoneCapture and SystemAudioCapture.
 *
 * Simulates the napi-rs native Rust module with:
 * - Mock constructors for MicrophoneCapture and SystemAudioCapture
 * - start(), stop(), getSampleRate() methods as vi.fn()
 * - Factory function for easy test setup
 */

import { vi, type Mock } from 'vitest';

export interface MockNativeCaptureOptions {
  /** Sample rate returned by getSampleRate (default: 48000) */
  sampleRate?: number;
  /** Whether start() should throw */
  startError?: Error;
  /** Whether constructor should throw */
  constructError?: Error;
  /** Simulate data chunks emitted during start() */
  dataChunks?: Buffer[];
  /** Delay before emitting each chunk (ms) */
  chunkDelay?: number;
}

export interface MockCaptureInstance {
  getSampleRate: Mock;
  start: Mock;
  stop: Mock;
  /** Internal: trigger the data callback manually */
  _triggerData: (chunk: Buffer) => void;
  /** Internal: trigger the speech-ended callback manually */
  _triggerSpeechEnded: () => void;
  /** Internal: trigger the error callback manually */
  _triggerError: (err: Error) => void;
  /** Internal: stored data callback from start() */
  _dataCallback: ((err: Error | null, chunk: Buffer) => void) | null;
  /** Internal: stored speech-ended callback from start() */
  _speechEndedCallback: ((err: Error | null, ended: boolean) => void) | null;
}

/**
 * Create a mock capture instance (simulates a Rust native capture class)
 */
export function createMockCaptureInstance(options: MockNativeCaptureOptions = {}): MockCaptureInstance {
  const sampleRate = options.sampleRate ?? 48000;

  let dataCallback: ((err: Error | null, chunk: Buffer) => void) | null = null;
  let speechEndedCallback: ((err: Error | null, ended: boolean) => void) | null = null;

  const instance: MockCaptureInstance = {
    getSampleRate: vi.fn(() => sampleRate),

    start: vi.fn((onData?: (err: Error | null, chunk: Buffer) => void, onSpeechEnded?: (err: Error | null, ended: boolean) => void) => {
      if (options.startError) throw options.startError;
      dataCallback = onData || null;
      speechEndedCallback = onSpeechEnded || null;

      // Emit simulated data chunks if provided
      if (options.dataChunks && onData) {
        const chunks = [...options.dataChunks];
        const emitNext = () => {
          const chunk = chunks.shift();
          if (chunk) {
            onData(null, chunk);
            if (chunks.length > 0 && options.chunkDelay) {
              setTimeout(emitNext, options.chunkDelay);
            } else if (chunks.length > 0) {
              queueMicrotask(emitNext);
            }
          }
        };
        if (options.chunkDelay) {
          setTimeout(emitNext, options.chunkDelay);
        } else {
          queueMicrotask(emitNext);
        }
      }
    }),

    stop: vi.fn(() => {
      dataCallback = null;
      speechEndedCallback = null;
    }),

    _triggerData: (chunk: Buffer) => {
      if (dataCallback) dataCallback(null, chunk);
    },

    _triggerSpeechEnded: () => {
      if (speechEndedCallback) speechEndedCallback(null, true);
    },

    _triggerError: (err: Error) => {
      if (dataCallback) dataCallback(err, Buffer.alloc(0));
    },

    get _dataCallback() { return dataCallback; },
    get _speechEndedCallback() { return speechEndedCallback; },
    set _dataCallback(cb: any) { dataCallback = cb; },
    set _speechEndedCallback(cb: any) { speechEndedCallback = cb; },
  };

  return instance;
}

export interface MockAudioDeviceInfo {
  id: string;
  name: string;
}

export interface MockNativeModuleOptions {
  /** Input devices to return */
  inputDevices?: MockAudioDeviceInfo[];
  /** Output devices to return */
  outputDevices?: MockAudioDeviceInfo[];
  /** Whether to throw on getInputDevices/getOutputDevices */
  devicesError?: Error;
  /** MicrophoneCapture constructor options */
  micCapture?: MockNativeCaptureOptions;
  /** SystemAudioCapture constructor options */
  sysCapture?: MockNativeCaptureOptions;
  /** Whether the native module should be null (simulates missing binary) */
  missing?: boolean;
}

/**
 * Create a full mock native module matching the NativeModule interface
 */
export function createMockNativeModule(options: MockNativeModuleOptions = {}) {
  if (options.missing) {
    return null;
  }

  const inputDevices = options.inputDevices ?? [
    { id: 'mic-1', name: 'Built-in Microphone' },
    { id: 'mic-2', name: 'External USB Mic' },
  ];

  const outputDevices = options.outputDevices ?? [
    { id: 'speaker-1', name: 'Built-in Speakers' },
  ];

  const micInstances: MockCaptureInstance[] = [];
  const sysInstances: MockCaptureInstance[] = [];

  const module_ = {
    getHardwareId: vi.fn(() => 'mock-hardware-id-12345'),

    verifyGumroadKey: vi.fn(async (licenseKey: string) => {
      if (licenseKey === 'invalid-key') {
        throw new Error('Invalid license key');
      }
      return JSON.stringify({ status: 'valid', email: 'test@example.com' });
    }),

    getInputDevices: vi.fn(() => {
      if (options.devicesError) throw options.devicesError;
      return [...inputDevices];
    }),

    getOutputDevices: vi.fn(() => {
      if (options.devicesError) throw options.devicesError;
      return [...outputDevices];
    }),

    MicrophoneCapture: vi.fn(function MicrophoneCaptureMock(deviceId?: string | null) {
      if (options.micCapture?.constructError) {
        throw options.micCapture.constructError;
      }
      const instance = createMockCaptureInstance(options.micCapture);
      micInstances.push(instance);
      return instance;
    }),

    SystemAudioCapture: vi.fn(function SystemAudioCaptureMock(deviceId?: string | null) {
      if (options.sysCapture?.constructError) {
        throw options.sysCapture.constructError;
      }
      const instance = createMockCaptureInstance(options.sysCapture);
      sysInstances.push(instance);
      return instance;
    }),

    // Expose instances for test assertions
    _micInstances: micInstances,
    _sysInstances: sysInstances,
    _latestMicInstance: () => micInstances[micInstances.length - 1] ?? null,
    _latestSysInstance: () => sysInstances[sysInstances.length - 1] ?? null,
  };

  return module_;
}

/**
 * Helper: create mock MicrophoneCapture constructor for vi.mock
 */
export function mockMicrophoneCapture(options: MockNativeCaptureOptions = {}) {
  const instances: MockCaptureInstance[] = [];

  const Constructor = vi.fn((deviceId?: string | null) => {
    if (options.constructError) throw options.constructError;
    const instance = createMockCaptureInstance(options);
    instances.push(instance);
    return instance;
  });

  return { Constructor, instances, latest: () => instances[instances.length - 1] ?? null };
}

/**
 * Helper: create mock SystemAudioCapture constructor for vi.mock
 */
export function mockSystemAudioCapture(options: MockNativeCaptureOptions = {}) {
  const instances: MockCaptureInstance[] = [];

  const Constructor = vi.fn((deviceId?: string | null) => {
    if (options.constructError) throw options.constructError;
    const instance = createMockCaptureInstance(options);
    instances.push(instance);
    return instance;
  });

  return { Constructor, instances, latest: () => instances[instances.length - 1] ?? null };
}

export default createMockNativeModule;
