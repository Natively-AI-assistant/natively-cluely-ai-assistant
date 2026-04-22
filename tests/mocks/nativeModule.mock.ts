/**
 * Shared native module mock factory for audio tests.
 *
 * Provides consistent mock patterns for:
 * - AudioDevices (getInputDevices, getOutputDevices)
 * - SystemAudioCapture (system audio capture)
 * - MicrophoneCapture (microphone capture)
 *
 * Usage:
 *   import { createNativeModuleMock, resetNativeModuleMock } from '../mocks/nativeModule.mock'
 *
 *   // In test file
 *   const mock = createNativeModuleMock()
 *   vi.mock('../../electron/audio/nativeModuleLoader', () => ({
 *     loadNativeModule: vi.fn(() => mock),
 *   }))
 *
 *   // Or with test-specific overrides
 *   const mock = createNativeModuleMock({
 *     getInputDevices: () => [{ id: 'test-1', name: 'Test Mic' }],
 *   })
 */

import { vi } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Instance storage for test helpers
// ---------------------------------------------------------------------------

const sysInstances: any[] = [];
const micInstances: any[] = [];

// ---------------------------------------------------------------------------
// Mock classes (mirroring actual native module behavior)
// ---------------------------------------------------------------------------

class MockRustSysCapture extends EventEmitter {
  deviceId: string | null;
  started = false;
  dataCallback: any = null;
  speechEndedCallback: any = null;

  constructor(deviceId?: string | null) {
    super();
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

  // Test helpers for triggering events
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

class MockRustMicCapture extends EventEmitter {
  deviceId: string | null;
  started = false;
  dataCallback: any = null;
  speechEndedCallback: any = null;

  constructor(deviceId?: string | null) {
    super();
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

  // Test helpers for triggering events
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

// ---------------------------------------------------------------------------
// Default device lists
// ---------------------------------------------------------------------------

const defaultInputDevices = [
  { id: 'mic-1', name: 'Built-in Microphone' },
  { id: 'mic-2', name: 'External USB Mic' },
];

const defaultOutputDevices = [
  { id: 'speaker-1', name: 'Built-in Speakers' },
];

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export interface NativeModuleMockOptions {
  /** Custom input devices array */
  inputDevices?: Array<{ id: string; name: string }>;
  /** Custom output devices array */
  outputDevices?: Array<{ id: string; name: string }>;
  /** Custom getInputDevices implementation */
  getInputDevices?: () => Array<{ id: string; name: string }>;
  /** Custom getOutputDevices implementation */
  getOutputDevices?: () => Array<{ id: string; name: string }>;
  /** Custom getHardwareId implementation */
  getHardwareId?: () => string;
  /** Custom verifyGumroadKey implementation */
  verifyGumroadKey?: (key: string) => Promise<string>;
  /** Whether getInputDevices should throw */
  throwOnDevices?: boolean;
  /** Whether to track SystemAudioCapture instances */
  trackSysInstances?: boolean;
  /** Whether to track MicrophoneCapture instances */
  trackMicInstances?: boolean;
}

/**
 * Create a native module mock with configurable options.
 */
export function createNativeModuleMock(options: NativeModuleMockOptions = {}): any {
  const {
    inputDevices = defaultInputDevices,
    outputDevices = defaultOutputDevices,
    getInputDevices: customGetInputDevices,
    getOutputDevices: customGetOutputDevices,
    getHardwareId = () => 'test-hwid',
    verifyGumroadKey = vi.fn(() => Promise.resolve('ok')),
    throwOnDevices = false,
    trackSysInstances = false,
    trackMicInstances = false,
  } = options;

  const getInputDevicesFn = customGetInputDevices ?? (() => {
    if (throwOnDevices) throw new Error('Device error');
    return [...inputDevices];
  });

  const getOutputDevicesFn = customGetOutputDevices ?? (() => {
    if (throwOnDevices) throw new Error('Device error');
    return [...outputDevices];
  });

  return {
    getInputDevices: vi.fn(getInputDevicesFn),
    getOutputDevices: vi.fn(getOutputDevicesFn),
    getHardwareId: vi.fn(getHardwareId),
    verifyGumroadKey: vi.fn(verifyGumroadKey),

    SystemAudioCapture: vi.fn(function (deviceId?: string | null) {
      const instance = new MockRustSysCapture(deviceId);
      if (trackSysInstances) sysInstances.push(instance);
      return instance;
    }),

    MicrophoneCapture: vi.fn(function (deviceId?: string | null) {
      const instance = new MockRustMicCapture(deviceId);
      if (trackMicInstances) micInstances.push(instance);
      return instance;
    }),
  };
}

/**
 * Reset all mock call history.
 */
export function resetNativeModuleMock(): void {
  sysInstances.length = 0;
  micInstances.length = 0;
}

/**
 * Get the most recently created SystemAudioCapture instance.
 * Only works if trackSysInstances was true when creating the mock.
 */
export function getLatestSysInstance(): any | undefined {
  return sysInstances[sysInstances.length - 1];
}

/**
 * Get the most recently created MicrophoneCapture instance.
 * Only works if trackMicInstances was true when creating the mock.
 */
export function getLatestMicInstance(): any | undefined {
  return micInstances[micInstances.length - 1];
}

/**
 * Clear instance tracking arrays.
 */
export function clearNativeModuleInstances(): void {
  sysInstances.length = 0;
  micInstances.length = 0;
}
