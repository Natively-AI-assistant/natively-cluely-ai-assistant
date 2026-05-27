// Tests run against the esbuild-compiled workerPathResolver in dist-electron/.
// Run via: npm run build:electron && node --test electron/rag/__tests__/
//
// Guards against MODULE_NOT_FOUND when VectorStore is bundled into main.js
// but vectorSearchWorker.js remains at dist-electron/electron/rag/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/rag/workerPathResolver.js',
);
const { resolveVectorSearchWorkerPath } = await import(pathToFileURL(compiledPath).href);

test('resolveVectorSearchWorkerPath points at a real vectorSearchWorker.js after build', () => {
    const resolved = resolveVectorSearchWorkerPath();
    assert.match(resolved, /vectorSearchWorker\.js$/);
    assert.ok(
        fs.existsSync(resolved),
        `expected resolveVectorSearchWorkerPath() to point at an existing file, got ${resolved}. ` +
            `If this fails, esbuild's output layout has changed and the candidate list in ` +
            `electron/rag/workerPathResolver.ts needs updating.`,
    );
});
