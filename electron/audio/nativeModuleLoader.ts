import path from 'path';

export interface AudioDeviceInfo {
  id: string;
  name: string;
}

export interface NativeModule {
  getHardwareId(): string;
  verifyGumroadKey(licenseKey: string): Promise<string>;
  getInputDevices(): Array<AudioDeviceInfo>;
  getOutputDevices(): Array<AudioDeviceInfo>;
  SystemAudioCapture: new (deviceId?: string | null) => {
    getSampleRate(): number;
    start(callback: (...args: any[]) => any, onSpeechEnded?: (...args: any[]) => any): void;
    stop(): void;
  };
  MicrophoneCapture: new (deviceId?: string | null) => {
    getSampleRate(): number;
    start(callback: (...args: any[]) => any, onSpeechEnded?: (...args: any[]) => any): void;
    stop(): void;
  };
}

const REQUIRED_METHODS = ['getHardwareId', 'verifyGumroadKey', 'getInputDevices', 'getOutputDevices'];
const REQUIRED_CONSTRUCTORS = ['SystemAudioCapture', 'MicrophoneCapture'];

/**
 * Validates that a loaded native module conforms to the NativeModule interface.
 * Throws immediately if any required method or constructor is missing.
 */
function validateNativeModule(mod: any): asserts mod is NativeModule {
    for (const fn of REQUIRED_METHODS) {
        if (typeof mod[fn] !== 'function') {
            throw new Error(`NativeModule: missing or invalid method "${fn}" (expected function, got ${typeof mod[fn]})`);
        }
    }
    for (const cls of REQUIRED_CONSTRUCTORS) {
        if (typeof mod[cls] !== 'function') {
            throw new Error(`NativeModule: missing or invalid constructor "${cls}" (expected constructor, got ${typeof mod[cls]})`);
        }
    }
}

/**
 * Maps platform+arch to the NAPI-RS compiled binary name.
 * These filenames are produced by `npx napi build` in native-module/.
 * Naming convention: index.<platform>-<arch>-<abi>.node
 */
function getNativeBinaryName(): string {
    const { platform, arch } = process;
    const map: Record<string, Record<string, string>> = {
        win32:  { x64: 'index.win32-x64-msvc.node' },
        darwin: { x64: 'index.darwin-x64.node', arm64: 'index.darwin-arm64.node' },
        linux:  { x64: 'index.linux-x64-gnu.node', arm64: 'index.linux-arm64-gnu.node' },
    };
    return map[platform]?.[arch] ?? `index.${platform}-${arch}.node`;
}

// undefined = not yet attempted, null = attempted but failed, object = loaded
let cached: NativeModule | null | undefined = undefined;

/**
 * Loads the Rust native module directly from the .node binary file.
 *
 * We bypass `require('natively-audio')` intentionally. That approach relied on
 * npm creating a symlink from node_modules/natively-audio -> native-module/,
 * which breaks on Windows (Git Bash produces POSIX-style symlinks that Node
 * can't resolve). Loading the .node file directly avoids npm entirely.
 *
 * IMPORTANT: `app` is imported inside this function (not at module top-level)
 * so this module is safe to import from renderer processes, workers, and tests.
 *
 * Candidate paths cover three scenarios:
 *   1. Development — app.getAppPath() returns the project root where
 *      native-module/index.*.node lives after `npm run build:native`.
 *   2. Development fallback — one level up, in case the app is launched
 *      from a subdirectory.
 *   3. Production (ASAR) — electron-builder packs the project into app.asar
 *      but unpacks .node files to app.asar.unpacked/ (configured via
 *      asarUnpack in package.json). process.resourcesPath is only valid in
 *      packaged Electron, so it is guarded before use.
 *
 * The function returns null on failure rather than throwing, so the app
 * degrades gracefully (audio device enumeration returns empty arrays).
 */
export function loadNativeModule(): NativeModule | null {
    if (cached !== undefined) return cached;

    // Lazily import app to avoid "Cannot use require of electron module" errors
    // when this module is accidentally imported in a renderer or worker context.
    let appPath: string;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { app } = require('electron') as typeof import('electron');
        appPath = app.getAppPath();
    } catch (e) {
        console.error('[nativeModuleLoader] app.getAppPath() not available:', e);
        cached = null;
        return null;
    }

    const binary = getNativeBinaryName();

    // Build candidate paths.
    // process.resourcesPath is only defined in packaged Electron — guard it.
    const candidates: string[] = [
        path.join(appPath, 'native-module', binary),
        path.join(appPath, '..', 'native-module', binary),
    ];
    if (process.resourcesPath) {
        candidates.push(
            path.join(process.resourcesPath, 'app.asar.unpacked', 'native-module', binary)
        );
    }

    for (const filePath of candidates) {
        try {
            const mod = require(filePath);
            validateNativeModule(mod);
            cached = mod;
            console.log(`[nativeModuleLoader] Loaded ${binary} from: ${filePath}`);
            return cached;
        } catch (err: unknown) {
            // Log per-path failure so developers can diagnose ABI mismatches,
            // missing builds, or wrong paths — not just a generic "failed" message.
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[nativeModuleLoader] Could not load from ${filePath}: ${msg}`);
        }
    }

    console.error(`[nativeModuleLoader] Failed to load ${binary} from all ${candidates.length} candidate paths.`);
    cached = null;
    return null;
}
