import fs from 'fs';
import path from 'path';

/**
 * Locate and load riva_asr.proto.
 *
 * The path is NOT a constant because `__dirname` depends on which bundle the
 * caller ended up in. esbuild emits one file per entry AND inlines statically
 * imported modules, so this code runs from `dist-electron/electron/main.js`
 * (→ `<dir>/audio/riva_asr.proto`) today, but the same source also exists as
 * `dist-electron/electron/audio/NvidiaNimStreamingSTT.js` (→ `<dir>/riva_asr.proto`).
 * A single hardcoded join is therefore correct only by accident of the current
 * import graph. Probing real candidates keeps it correct through a refactor,
 * in dev, and in the packaged app (asar reads fine through fs).
 */
export function resolveRivaAsrProtoPath(): string {
    const candidates = [
        // Bundled into dist-electron/electron/main.js (the packaged path today).
        path.join(__dirname, 'audio', 'riva_asr.proto'),
        // Running from dist-electron/electron/audio/*.js.
        path.join(__dirname, 'riva_asr.proto'),
        // Source tree, for tests and ts-node-style execution.
        path.resolve(__dirname, '..', '..', 'electron', 'audio', 'riva_asr.proto'),
    ];
    try {
        // Packaged app: anchor off the app root rather than the bundle layout.
        const { app } = require('electron');
        if (app?.getAppPath) {
            candidates.push(path.join(app.getAppPath(), 'dist-electron', 'electron', 'audio', 'riva_asr.proto'));
        }
    } catch { /* not in an Electron main process (tests, tooling) */ }

    for (const candidate of candidates) {
        try { if (fs.existsSync(candidate)) return candidate; } catch { /* keep probing */ }
    }
    throw new Error(
        `riva_asr.proto not found. Looked in:\n  ${candidates.join('\n  ')}\n`
        + 'Run `npm run build:electron` to copy it into dist-electron.',
    );
}

const LOAD_OPTIONS = { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true } as const;

/**
 * Load the `nvidia.riva.asr` package. `keepCase: false` means every field is
 * addressed in camelCase on the JS side (`audioContent`, not `audio_content`) —
 * protobuf silently DROPS an unrecognised key, so a snake_case slip here
 * serializes to an empty message rather than throwing.
 */
export function loadRivaAsrPackage(): any {
    const grpc = require('@grpc/grpc-js');
    const loader = require('@grpc/proto-loader');
    const definition = loader.loadSync(resolveRivaAsrProtoPath(), LOAD_OPTIONS);
    return grpc.loadPackageDefinition(definition).nvidia.riva.asr;
}

/** Hosted NVIDIA Cloud Functions endpoint for Riva speech services. */
export const NVCF_GRPC_TARGET = 'grpc.nvcf.nvidia.com:443';

/** Build the auth metadata NVCF expects: bearer token plus the function id. */
export function buildNvcfMetadata(apiKey: string, functionId: string): any {
    const grpc = require('@grpc/grpc-js');
    const metadata = new grpc.Metadata();
    metadata.add('authorization', `Bearer ${(apiKey || '').trim()}`);
    metadata.add('function-id', functionId);
    return metadata;
}

/** Open a streaming-recognize call against the hosted NVCF endpoint. */
export function createNvcfStreamingRecognize(apiKey: string, functionId: string): any {
    const grpc = require('@grpc/grpc-js');
    const pkg = loadRivaAsrPackage();
    const client = new pkg.RivaSpeechRecognition(NVCF_GRPC_TARGET, grpc.credentials.createSsl());
    return client.streamingRecognize(buildNvcfMetadata(apiKey, functionId));
}
