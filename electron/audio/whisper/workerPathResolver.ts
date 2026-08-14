/**
 * Resolves the on-disk path to whisperWorker.js.
 *
 * build-electron.js gives every .ts file under electron/ its own esbuild
 * entry point (bundle:true, outbase-preserving), so __dirname inside this
 * resolver takes on whichever caller's bundle it got inlined into — the
 * candidate list below has to cover every caller's depth relative to
 * whisperWorker.js's own compiled location (dist-electron/electron/audio/whisper/):
 *
 *   - electron/audio/whisper/modelPreloader.ts → __dirname = .../audio/whisper/  → sibling
 *   - electron/audio/LocalWhisperSTT.ts        → __dirname = .../audio/         → whisper/whisperWorker.js
 *   - electron/services/LocalModelDownloadService.ts → __dirname = .../services/ → ../audio/whisper/whisperWorker.js
 *   - fully bundled into dist-electron/electron/main.js → __dirname = .../electron/ → audio/whisper/whisperWorker.js
 *
 * whisperWorker.js is in package.json's asarUnpack list, so once a candidate
 * is picked, an app.asar prefix (packaged build) is rewritten to
 * app.asar.unpacked — matching IntentClassifier.ts's getWorkerPath().
 */

import path from 'path';
import fs from 'fs';

export function findFirstExistingPath(
    candidates: readonly string[],
    exists: (p: string) => boolean = fs.existsSync,
): string {
    return candidates.find(p => exists(p)) ?? candidates[0];
}

export function resolveWhisperWorkerPath(): string {
    let resolvedPath = findFirstExistingPath([
        path.join(__dirname, 'whisperWorker.js'),
        path.join(__dirname, 'whisper', 'whisperWorker.js'),
        path.join(__dirname, '..', 'audio', 'whisper', 'whisperWorker.js'),
        path.join(__dirname, 'audio', 'whisper', 'whisperWorker.js'),
    ]);
    if (resolvedPath.includes('app.asar') && !resolvedPath.includes('app.asar.unpacked')) {
        resolvedPath = resolvedPath.replace('app.asar', 'app.asar.unpacked');
    }
    return resolvedPath;
}
