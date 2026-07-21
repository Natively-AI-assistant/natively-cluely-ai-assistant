/**
 * Resolves the on-disk path to whisperWorker.js across two build layouts:
 *
 *   - Unbundled (tsc → dist-electron):
 *       this module compiles to dist-electron/electron/audio/whisper/workerPathResolver.js
 *       __dirname = dist-electron/electron/audio/whisper/
 *       worker is a sibling → whisperWorker.js
 *
 *   - Bundled (esbuild `bundle: true` inlines into main.js):
 *       this module is folded into dist-electron/electron/main.js
 *       __dirname = dist-electron/electron/
 *       worker stays at its source-mirrored location → audio/whisper/whisperWorker.js
 *
 * Because this resolver is itself bundled alongside its callers, its own
 * __dirname tracks the bundling state — so callers don't need to pass anything.
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
    return findFirstExistingPath([
        path.join(__dirname, 'whisperWorker.js'),
        path.join(__dirname, 'audio', 'whisper', 'whisperWorker.js'),
    ]);
}
