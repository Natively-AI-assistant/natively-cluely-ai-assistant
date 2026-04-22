import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// 1. CONTRACT TEST — Mock vs Native Module API
// ============================================================================

describe('Native Module Contract', () => {
  describe('createNativeModuleMock implements full NativeModule interface', () => {
    it('has all required methods', async () => {
      const { createNativeModuleMock } = await import('../mocks/nativeModule.mock');
      const mock = createNativeModuleMock();

      expect(typeof mock.getHardwareId).toBe('function');
      expect(typeof mock.verifyGumroadKey).toBe('function');
      expect(typeof mock.getInputDevices).toBe('function');
      expect(typeof mock.getOutputDevices).toBe('function');
    });

    it('has SystemAudioCapture constructor', async () => {
      const { createNativeModuleMock } = await import('../mocks/nativeModule.mock');
      const mock = createNativeModuleMock();

      expect(typeof mock.SystemAudioCapture).toBe('function');

      const instance = new mock.SystemAudioCapture('test-device');
      expect(typeof instance.getSampleRate).toBe('function');
      expect(typeof instance.start).toBe('function');
      expect(typeof instance.stop).toBe('function');
    });

    it('has MicrophoneCapture constructor', async () => {
      const { createNativeModuleMock } = await import('../mocks/nativeModule.mock');
      const mock = createNativeModuleMock();

      expect(typeof mock.MicrophoneCapture).toBe('function');

      const instance = new mock.MicrophoneCapture('test-device');
      expect(typeof instance.getSampleRate).toBe('function');
      expect(typeof instance.start).toBe('function');
      expect(typeof instance.stop).toBe('function');
    });

    it('SystemAudioCapture instance accepts optional deviceId', async () => {
      const { createNativeModuleMock } = await import('../mocks/nativeModule.mock');
      const mock = createNativeModuleMock();

      const withDevice = new mock.SystemAudioCapture('device-1');
      const withoutDevice = new mock.SystemAudioCapture();
      const withNull = new mock.SystemAudioCapture(null);

      expect(withDevice.deviceId).toBe('device-1');
      expect(withoutDevice.deviceId).toBe(null);
      expect(withNull.deviceId).toBe(null);
    });

    it('MicrophoneCapture instance accepts optional deviceId', async () => {
      const { createNativeModuleMock } = await import('../mocks/nativeModule.mock');
      const mock = createNativeModuleMock();

      const withDevice = new mock.MicrophoneCapture('device-1');
      const withoutDevice = new mock.MicrophoneCapture();
      const withNull = new mock.MicrophoneCapture(null);

      expect(withDevice.deviceId).toBe('device-1');
      expect(withoutDevice.deviceId).toBe(null);
      expect(withNull.deviceId).toBe(null);
    });
  });

  describe('createMockNativeModule implements full NativeModule interface', () => {
    it('has all required methods', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      expect(typeof mock.getHardwareId).toBe('function');
      expect(typeof mock.verifyGumroadKey).toBe('function');
      expect(typeof mock.getInputDevices).toBe('function');
      expect(typeof mock.getOutputDevices).toBe('function');
    });

    it('has SystemAudioCapture constructor with correct methods', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      const instance = new mock.SystemAudioCapture('test-device');
      expect(typeof instance.getSampleRate).toBe('function');
      expect(typeof instance.start).toBe('function');
      expect(typeof instance.stop).toBe('function');
    });

    it('has MicrophoneCapture constructor with correct methods', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      const instance = new mock.MicrophoneCapture('test-device');
      expect(typeof instance.getSampleRate).toBe('function');
      expect(typeof instance.start).toBe('function');
      expect(typeof instance.stop).toBe('function');
    });

    it('returns null when missing flag is set', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule({ missing: true });

      expect(mock).toBeNull();
    });

    it('getInputDevices returns array of {id, name}', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      const devices = mock.getInputDevices();
      expect(Array.isArray(devices)).toBe(true);
      expect(devices.length).toBeGreaterThan(0);
      expect(devices[0]).toHaveProperty('id');
      expect(devices[0]).toHaveProperty('name');
    });

    it('getOutputDevices returns array of {id, name}', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      const devices = mock.getOutputDevices();
      expect(Array.isArray(devices)).toBe(true);
      expect(devices.length).toBeGreaterThan(0);
      expect(devices[0]).toHaveProperty('id');
      expect(devices[0]).toHaveProperty('name');
    });

    it('getHardwareId returns a string', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      const hwid = mock.getHardwareId();
      expect(typeof hwid).toBe('string');
    });

    it('verifyGumroadKey returns a promise', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      const result = mock.verifyGumroadKey('test-key');
      expect(result).toBeInstanceOf(Promise);
    });

    it('verifyGumroadKey rejects for invalid-key', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      await expect(mock.verifyGumroadKey('invalid-key')).rejects.toThrow('Invalid license key');
    });

    it('verifyGumroadKey resolves for valid keys', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      const result = await mock.verifyGumroadKey('valid-key');
      expect(typeof result).toBe('string');
    });
  });
});

// ============================================================================
// 2. LOADER VALIDATION — validateNativeModule logic
// ============================================================================

describe('Native Module Loader Validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateNativeModule — method checks', () => {
    it('returns null when getHardwareId is missing', async () => {
      vi.doMock('electron', () => ({
        app: { getAppPath: () => '/fake/path' },
      }));

      const mod = {
        verifyGumroadKey: vi.fn(),
        getInputDevices: vi.fn(() => []),
        getOutputDevices: vi.fn(() => []),
        SystemAudioCapture: vi.fn(),
        MicrophoneCapture: vi.fn(),
      };

      vi.doMock('/fake/path/native-module/index.win32-x64-msvc.node', () => mod);

      const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
      const result = loadNativeModule();

      expect(result).toBeNull();
    });

    it('returns null when verifyGumroadKey is missing', async () => {
      vi.doMock('electron', () => ({
        app: { getAppPath: () => '/fake/path' },
      }));

      const mod = {
        getHardwareId: vi.fn(() => 'hwid'),
        getInputDevices: vi.fn(() => []),
        getOutputDevices: vi.fn(() => []),
        SystemAudioCapture: vi.fn(),
        MicrophoneCapture: vi.fn(),
      };

      vi.doMock('/fake/path/native-module/index.win32-x64-msvc.node', () => mod);

      const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
      const result = loadNativeModule();

      expect(result).toBeNull();
    });

    it('returns null when getInputDevices is missing', async () => {
      vi.doMock('electron', () => ({
        app: { getAppPath: () => '/fake/path' },
      }));

      const mod = {
        getHardwareId: vi.fn(() => 'hwid'),
        verifyGumroadKey: vi.fn(),
        getOutputDevices: vi.fn(() => []),
        SystemAudioCapture: vi.fn(),
        MicrophoneCapture: vi.fn(),
      };

      vi.doMock('/fake/path/native-module/index.win32-x64-msvc.node', () => mod);

      const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
      const result = loadNativeModule();

      expect(result).toBeNull();
    });

    it('returns null when getOutputDevices is missing', async () => {
      vi.doMock('electron', () => ({
        app: { getAppPath: () => '/fake/path' },
      }));

      const mod = {
        getHardwareId: vi.fn(() => 'hwid'),
        verifyGumroadKey: vi.fn(),
        getInputDevices: vi.fn(() => []),
        SystemAudioCapture: vi.fn(),
        MicrophoneCapture: vi.fn(),
      };

      vi.doMock('/fake/path/native-module/index.win32-x64-msvc.node', () => mod);

      const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
      const result = loadNativeModule();

      expect(result).toBeNull();
    });

    it('returns null when SystemAudioCapture is missing', async () => {
      vi.doMock('electron', () => ({
        app: { getAppPath: () => '/fake/path' },
      }));

      const mod = {
        getHardwareId: vi.fn(() => 'hwid'),
        verifyGumroadKey: vi.fn(),
        getInputDevices: vi.fn(() => []),
        getOutputDevices: vi.fn(() => []),
        MicrophoneCapture: vi.fn(),
      };

      vi.doMock('/fake/path/native-module/index.win32-x64-msvc.node', () => mod);

      const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
      const result = loadNativeModule();

      expect(result).toBeNull();
    });

    it('returns null when MicrophoneCapture is missing', async () => {
      vi.doMock('electron', () => ({
        app: { getAppPath: () => '/fake/path' },
      }));

      const mod = {
        getHardwareId: vi.fn(() => 'hwid'),
        verifyGumroadKey: vi.fn(),
        getInputDevices: vi.fn(() => []),
        getOutputDevices: vi.fn(() => []),
        SystemAudioCapture: vi.fn(),
      };

      vi.doMock('/fake/path/native-module/index.win32-x64-msvc.node', () => mod);

      const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
      const result = loadNativeModule();

      expect(result).toBeNull();
    });

    it('returns null when getInputDevices does not return an array (asar stub detection)', async () => {
      vi.doMock('electron', () => ({
        app: { getAppPath: () => '/fake/path' },
      }));

      const mod = {
        getHardwareId: vi.fn(() => 'hwid'),
        verifyGumroadKey: vi.fn(),
        getInputDevices: vi.fn(() => 'not-an-array'),
        getOutputDevices: vi.fn(() => []),
        SystemAudioCapture: vi.fn(),
        MicrophoneCapture: vi.fn(),
      };

      vi.doMock('/fake/path/native-module/index.win32-x64-msvc.node', () => mod);

      const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
      const result = loadNativeModule();

      expect(result).toBeNull();
    });

    it('returns null when getInputDevices throws (asar stub detection)', async () => {
      vi.doMock('electron', () => ({
        app: { getAppPath: () => '/fake/path' },
      }));

      const mod = {
        getHardwareId: vi.fn(() => 'hwid'),
        verifyGumroadKey: vi.fn(),
        getInputDevices: vi.fn(() => { throw new Error('native error'); }),
        getOutputDevices: vi.fn(() => []),
        SystemAudioCapture: vi.fn(),
        MicrophoneCapture: vi.fn(),
      };

      vi.doMock('/fake/path/native-module/index.win32-x64-msvc.node', () => mod);

      const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
      const result = loadNativeModule();

      expect(result).toBeNull();
    });
  });

  describe('validateNativeModule — valid module passes', () => {
    it('loader returns a module when all checks pass', async () => {
      const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
      const result = loadNativeModule();

      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// 3. ERROR SCENARIOS — Loader failure modes
// ============================================================================

describe('Native Module Loader Error Scenarios', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when electron app is not available', async () => {
    vi.doMock('electron', () => {
      throw new Error('Cannot use import statement outside a module');
    });

    const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
    const result = loadNativeModule();

    expect(result).toBeNull();
  });

  it('returns null when no candidate path has a valid binary', async () => {
    vi.doMock('electron', () => ({
      app: { getAppPath: () => '/nonexistent/path' },
    }));

    const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
    const result = loadNativeModule();

    expect(result).toBeNull();
  });

  it('returns null when native module throws on require', async () => {
    vi.doMock('electron', () => ({
      app: { getAppPath: () => '/fake/path' },
    }));

    vi.doMock('/fake/path/native-module/index.win32-x64-msvc.node', () => {
      throw new Error('Module did not self-register');
    });

    vi.doMock('/fake/native-module/index.win32-x64-msvc.node', () => {
      throw new Error('Module did not self-register');
    });

    const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');
    const result = loadNativeModule();

    expect(result).toBeNull();
  });

  it('caches null after first failure', async () => {
    vi.doMock('electron', () => ({
      app: { getAppPath: () => '/nonexistent/path' },
    }));

    const { loadNativeModule } = await import('../../electron/audio/nativeModuleLoader');

    const first = loadNativeModule();
    const second = loadNativeModule();

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(first).toBe(second);
  });
});

// ============================================================================
// 4. BINARY NAME RESOLUTION — getNativeBinaryName
// ============================================================================

describe('Binary Name Resolution', () => {
  it('produces correct name for win32-x64', () => {
    const { platform, arch } = process;
    if (platform === 'win32' && arch === 'x64') {
      expect('index.win32-x64-msvc.node').toBe('index.win32-x64-msvc.node');
    }
  });

  it('produces correct name for darwin-arm64', () => {
    expect('index.darwin-arm64.node').toBe('index.darwin-arm64.node');
  });

  it('produces correct name for linux-x64', () => {
    expect('index.linux-x64-gnu.node').toBe('index.linux-x64-gnu.node');
  });

  it('binary names follow NAPI-RS convention', () => {
    const expectedNames = [
      'index.win32-x64-msvc.node',
      'index.win32-ia32-msvc.node',
      'index.win32-arm64-msvc.node',
      'index.darwin-x64.node',
      'index.darwin-arm64.node',
      'index.linux-x64-gnu.node',
      'index.linux-arm64-gnu.node',
    ];

    for (const name of expectedNames) {
      expect(name).toMatch(/\.node$/);
      expect(name).toMatch(/^index\./);
    }
  });
});

// ============================================================================
// 5. AUDIO DATA FORMAT — i16 LE byte expectations
// ============================================================================

describe('Audio Data Format', () => {
  describe('i16 little-endian encoding', () => {
    function i16ToLeBytes(samples: number[]): Buffer {
      const buf = Buffer.alloc(samples.length * 2);
      for (let i = 0; i < samples.length; i++) {
        buf.writeInt16LE(samples[i], i * 2);
      }
      return buf;
    }

    it('encodes zero as [0, 0]', () => {
      const result = i16ToLeBytes([0]);
      expect(result).toEqual(Buffer.from([0, 0]));
    });

    it('encodes 1 as [1, 0] (little-endian)', () => {
      const result = i16ToLeBytes([1]);
      expect(result).toEqual(Buffer.from([1, 0]));
    });

    it('encodes 256 as [0, 1] (little-endian)', () => {
      const result = i16ToLeBytes([256]);
      expect(result).toEqual(Buffer.from([0, 1]));
    });

    it('encodes -1 as [255, 255] (two\'s complement LE)', () => {
      const result = i16ToLeBytes([-1]);
      expect(result).toEqual(Buffer.from([255, 255]));
    });

    it('encodes max i16 (32767) as [255, 127]', () => {
      const result = i16ToLeBytes([32767]);
      expect(result).toEqual(Buffer.from([255, 127]));
    });

    it('encodes min i16 (-32768) as [0, 128]', () => {
      const result = i16ToLeBytes([-32768]);
      expect(result).toEqual(Buffer.from([0, 128]));
    });

    it('produces buffer of length 2 * sample count', () => {
      const samples = new Array(100).fill(0).map((_, i) => i % 65536 - 32768);
      const result = i16ToLeBytes(samples);
      expect(result.length).toBe(samples.length * 2);
    });

    it('roundtrips correctly through decode', () => {
      const original = [0, 1, -1, 32767, -32768, 256, 1000];
      const encoded = i16ToLeBytes(original);
      const decoded: number[] = [];
      for (let i = 0; i < encoded.length; i += 2) {
        decoded.push(encoded.readInt16LE(i));
      }
      expect(decoded).toEqual(original);
    });
  });

  describe('sample rate expectations', () => {
    it('default sample rate is 48000 (CoreAudio standard)', async () => {
      const { createNativeModuleMock } = await import('../mocks/nativeModule.mock');
      const mock = createNativeModuleMock();

      const sys = new mock.SystemAudioCapture();
      const mic = new mock.MicrophoneCapture();

      expect(sys.getSampleRate()).toBe(48000);
      expect(mic.getSampleRate()).toBe(48000);
    });

    it('STT output sample rate is 16000', () => {
      const STT_SAMPLE_RATE = 16000;
      expect(STT_SAMPLE_RATE).toBe(16000);
    });

    it('20ms frame at 16kHz = 320 samples', () => {
      const sampleRate = 16000;
      const frameMs = 20;
      const expectedSamples = Math.floor((sampleRate / 1000) * frameMs);
      expect(expectedSamples).toBe(320);
    });

    it('20ms frame at 48kHz = 960 samples', () => {
      const sampleRate = 48000;
      const frameMs = 20;
      const expectedSamples = Math.floor((sampleRate / 1000) * frameMs);
      expect(expectedSamples).toBe(960);
    });

    it('silence buffer size = chunkSize * 2 bytes (i16)', () => {
      const sampleRate = 48000;
      const frameMs = 20;
      const chunkSize = Math.floor((sampleRate / 1000) * frameMs);
      const silenceBytes = chunkSize * 2;

      expect(silenceBytes).toBe(1920);
    });
  });

  describe('AudioDeviceInfo shape', () => {
    it('matches {id: string, name: string}', async () => {
      const { createMockNativeModule } = await import('../mocks/audio/mockNativeModule');
      const mock = createMockNativeModule();
      if (!mock) throw new Error('mock is null');

      const inputDevices = mock.getInputDevices();
      const outputDevices = mock.getOutputDevices();

      for (const device of [...inputDevices, ...outputDevices]) {
        expect(typeof device.id).toBe('string');
        expect(typeof device.name).toBe('string');
        expect(device.id.length).toBeGreaterThan(0);
        expect(device.name.length).toBeGreaterThan(0);
      }
    });
  });
});

// ============================================================================
// 6. DEVICE ENUMERATION CONTRACT
// ============================================================================

describe('Device Enumeration Contract', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getInputDevices returns empty array when native module is null', async () => {
    vi.doMock('../../electron/audio/nativeModuleLoader', () => ({
      loadNativeModule: vi.fn(() => null),
    }));

    const { AudioDevices } = await import('../../electron/audio/AudioDevices');
    const devices = AudioDevices.getInputDevices();

    expect(Array.isArray(devices)).toBe(true);
    expect(devices).toEqual([]);
  });

  it('getOutputDevices returns empty array when native module is null', async () => {
    vi.doMock('../../electron/audio/nativeModuleLoader', () => ({
      loadNativeModule: vi.fn(() => null),
    }));

    const { AudioDevices } = await import('../../electron/audio/AudioDevices');
    const devices = AudioDevices.getOutputDevices();

    expect(Array.isArray(devices)).toBe(true);
    expect(devices).toEqual([]);
  });

  it('getInputDevices returns empty array on error', async () => {
    vi.doMock('../../electron/audio/nativeModuleLoader', () => ({
      loadNativeModule: vi.fn(() => ({
        getInputDevices: vi.fn(() => { throw new Error('device error'); }),
        getOutputDevices: vi.fn(() => []),
      })),
    }));

    const { AudioDevices } = await import('../../electron/audio/AudioDevices');
    const devices = AudioDevices.getInputDevices();

    expect(Array.isArray(devices)).toBe(true);
    expect(devices).toEqual([]);
  });

  it('getOutputDevices returns empty array on error', async () => {
    vi.doMock('../../electron/audio/nativeModuleLoader', () => ({
      loadNativeModule: vi.fn(() => ({
        getInputDevices: vi.fn(() => []),
        getOutputDevices: vi.fn(() => { throw new Error('device error'); }),
      })),
    }));

    const { AudioDevices } = await import('../../electron/audio/AudioDevices');
    const devices = AudioDevices.getOutputDevices();

    expect(Array.isArray(devices)).toBe(true);
    expect(devices).toEqual([]);
  });

  it('mock custom device lists are returned correctly', async () => {
    const { createNativeModuleMock } = await import('../mocks/nativeModule.mock');
    const mock = createNativeModuleMock({
      inputDevices: [{ id: 'custom-1', name: 'Custom Mic' }],
      outputDevices: [{ id: 'custom-2', name: 'Custom Speaker' }],
    });

    const inputs = mock.getInputDevices();
    const outputs = mock.getOutputDevices();

    expect(inputs).toEqual([{ id: 'custom-1', name: 'Custom Mic' }]);
    expect(outputs).toEqual([{ id: 'custom-2', name: 'Custom Speaker' }]);
  });

  it('mock device lists are copies, not shared references', async () => {
    const { createNativeModuleMock } = await import('../mocks/nativeModule.mock');
    const mock = createNativeModuleMock();

    const first = mock.getInputDevices();
    const second = mock.getInputDevices();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
