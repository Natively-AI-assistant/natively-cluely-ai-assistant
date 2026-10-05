// Tests run against the esbuild-compiled workerPathResolver in dist-electron/.
// Run via: npm run build:electron && node --test electron/services/__tests__/
//
// What this guards against: a future refactor that drops one of the candidate
// paths from the resolver but doesn't notice because the unbundled-layout
// candidate still works in dev. esbuild ships into the bundled layout, which
// is where the original bug (#244) lived.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/audio/whisper/workerPathResolver.js',
);
const { findFirstExistingPath, resolveWhisperWorkerPath } = await import(
    pathToFileURL(compiledPath).href
);

test('findFirstExistingPath returns the first candidate that exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-resolver-'));
    try {
        const a = path.join(tmp, 'a', 'whisperWorker.js');
        const b = path.join(tmp, 'b', 'whisperWorker.js');
        const c = path.join(tmp, 'c', 'whisperWorker.js');
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.writeFileSync(b, '// fixture');

        assert.equal(findFirstExistingPath([a, b, c]), b, 'should pick the existing candidate');
        assert.equal(findFirstExistingPath([b, a, c]), b, 'should pick the first match in order');
        assert.equal(findFirstExistingPath([a, c]), a, 'should fall back to first candidate when none exist');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('findFirstExistingPath accepts a custom existence predicate', () => {
    const seen = [];
    const picked = findFirstExistingPath(['/x', '/y', '/z'], p => {
        seen.push(p);
        return p === '/y';
    });
    assert.equal(picked, '/y');
    assert.deepEqual(seen, ['/x', '/y'], 'predicate short-circuits on first match');
});

test('resolveWhisperWorkerPath points at a real whisperWorker.js after build', () => {
    const resolved = resolveWhisperWorkerPath();
    assert.match(resolved, /whisperWorker\.js$/);
    assert.ok(
        fs.existsSync(resolved),
        `expected resolveWhisperWorkerPath() to point at an existing file, got ${resolved}. ` +
        `If this fails, esbuild's output layout has changed and the candidate list in ` +
        `electron/audio/whisper/workerPathResolver.ts needs updating — the original bug ` +
        `was MODULE_NOT_FOUND for whisperWorker.js (see PR #244).`,
    );
});

// Regression coverage for the follow-up bug: build-electron.js gives every
// .ts file under electron/ its own esbuild entry point, so this resolver's
// __dirname takes on whichever caller's bundle it's inlined into. The test
// above only exercises the resolver's OWN compiled location
// (dist-electron/electron/audio/whisper/), which is exactly why the broken
// candidate list shipped undetected — LocalWhisperSTT.ts (audio/) and
// LocalModelDownloadService.ts (services/) each have a different __dirname
// and neither was covered. Exercise findFirstExistingPath with the same
// candidate shape the resolver builds, from each real caller depth, against
// the actual built dist-electron/ tree.
const distElectronDir = path.resolve(__dirname, '../../../dist-electron/electron');

test('the whisper worker resolves from every known caller depth after build', () => {
    const candidatesFor = (dir) => ([
        path.join(dir, 'whisperWorker.js'),
        path.join(dir, 'whisper', 'whisperWorker.js'),
        path.join(dir, '..', 'audio', 'whisper', 'whisperWorker.js'),
        path.join(dir, 'audio', 'whisper', 'whisperWorker.js'),
    ]);
    const callerDirs = {
        'modelPreloader.ts (electron/audio/whisper/)': path.join(distElectronDir, 'audio', 'whisper'),
        'LocalWhisperSTT.ts (electron/audio/)': path.join(distElectronDir, 'audio'),
        'LocalModelDownloadService.ts (electron/services/)': path.join(distElectronDir, 'services'),
        'fully bundled into main.js (electron/)': distElectronDir,
    };
    for (const [label, dir] of Object.entries(callerDirs)) {
        const resolved = findFirstExistingPath(candidatesFor(dir));
        assert.ok(
            fs.existsSync(resolved),
            `${label}: expected a candidate to resolve to an existing whisperWorker.js from __dirname=${dir}, got ${resolved}`,
        );
    }
});
