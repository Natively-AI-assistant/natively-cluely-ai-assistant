/**
 * Resolves the on-disk path to vectorSearchWorker.js across two build layouts:
 *
 *   - Unbundled (esbuild entry at electron/rag/VectorStore.ts):
 *       __dirname = dist-electron/electron/rag/
 *       worker is a sibling → vectorSearchWorker.js
 *
 *   - Bundled (VectorStore inlined into dist-electron/electron/main.js):
 *       __dirname = dist-electron/electron/
 *       worker stays at its source-mirrored location → rag/vectorSearchWorker.js
 */

import path from 'path';
import { findFirstExistingPath } from '../audio/whisper/workerPathResolver';

export function resolveVectorSearchWorkerPath(): string {
    return findFirstExistingPath([
        path.join(__dirname, 'vectorSearchWorker.js'),
        path.join(__dirname, 'rag', 'vectorSearchWorker.js'),
    ]);
}
