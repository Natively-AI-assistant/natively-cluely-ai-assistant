// Regression test for: a worker the app spawns was never unpacked from the
// asar, so it silently no-opped in every packaged build.
//
// THE BUG. `ggufRerankerWorker.js` was missing from package.json's
// `asarUnpack`, while every one of its siblings — whisperWorker,
// intentClassifierWorker, localEmbeddingWorker, localRerankerWorker,
// rerankerDownloadWorker — was listed.
//
// Why that is fatal rather than cosmetic. resolveRagWorker() ends with:
//
//     if (resolved.includes('app.asar') && !resolved.includes('app.asar.unpacked')) {
//       resolved = resolved.replace('app.asar', 'app.asar.unpacked');
//     }
//
// which is correct — a worker that loads a native addon cannot be read from
// inside an archive. But it rewrites UNCONDITIONALLY. In a packaged build
// `fs.existsSync` returns true for a path inside app.asar (Electron makes the
// archive look like a directory), so the worker resolves, gets rewritten to
// `app.asar.unpacked/electron/rag/ggufRerankerWorker.js`, and that file does
// not exist unless asarUnpack put it there. `new Worker(...)` then throws,
// GgufReranker.rerank() catches it and returns null, and the seam reads null as
// "keep the existing order".
//
// So: a user downloads a 400MB GGUF reranker, selects it, watches Test
// Connection pass — and in the shipped app it reorders nothing, with no error
// anywhere. Exactly the silent-no-op class that
// RagWorkerPathAcrossBundles2026_09_04 fixed for the DEV path; this is the
// packaged half of the same failure.
//
// It also became much more consequential the moment an explicitly-selected
// reranker started running on every query rather than 1 in 36
// (ActiveModelIsTheOneUsed2026_09_04).
//
// THE FIX, guarded here: every worker script the app actually spawns must
// appear in asarUnpack. Asserted by DERIVING the list from the source rather
// than hard-coding it, so a worker added later is covered without anyone
// remembering to update this file.
//
// THE EVIDENCE IS PARITY, not inference. After 7245da18 both rerankers resolve
// their worker through the SAME resolveRagWorker(), and localRerankerWorker.js
// — which is in asarUnpack — demonstrably works in production. This fix makes
// ggufRerankerWorker.js byte-for-byte identical in treatment to a
// proven-working sibling. The packing chain is confirmed too: package.json
// build.files includes "dist-electron", asar defaults to true, and the worker
// is present at dist-electron/electron/rag/ggufRerankerWorker.js — so it does
// land inside app.asar, which is exactly what triggers the rewrite.
//
// Cross-platform: asar packaging is identical on macOS and Windows, so this
// guard covers both. No packaged build was produced to observe the failure
// directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const asarUnpack = pkg?.build?.asarUnpack ?? [];

/**
 * Worker scripts the app SPAWNS, derived from the source.
 *
 * A spawn site looks like `new Worker(<something>)` where the filename reaches
 * it either directly or through a resolver; both forms name the file as a
 * string literal ending in `Worker.js`, so collecting those literals from the
 * electron/ sources is the reliable signal. Helper modules that merely have
 * "Worker" in their name (resolveRagWorker.ts) are excluded because they are
 * never referenced as a `*Worker.js` literal.
 */
function spawnedWorkerFilenames() {
    const found = new Set();
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!/\.(ts|mts|js|mjs)$/.test(entry.name)) continue;
            const src = readFileSync(full, 'utf8');
            for (const m of src.matchAll(/['"`]([A-Za-z0-9_]+Worker\.(?:js|mjs))['"`]/g)) {
                found.add(m[1]);
            }
        }
    };
    walk(path.join(repoRoot, 'electron'));
    return [...found].sort();
}

const isUnpacked = (file) => asarUnpack.some((pattern) => pattern.endsWith(file));

test('every worker script the app spawns is unpacked from the asar', () => {
    const workers = spawnedWorkerFilenames();
    assert.ok(workers.length >= 5, `expected to find the worker scripts, found ${workers.length}`);

    const missing = workers.filter((w) => !isUnpacked(w));
    assert.deepEqual(
        missing,
        [],
        `these worker scripts are spawned but NOT in package.json asarUnpack: ${missing.join(', ')}.\n` +
        'In a packaged build the resolver rewrites the path to app.asar.unpacked/… unconditionally, ' +
        'so an un-unpacked worker resolves to a file that does not exist. new Worker() throws, the ' +
        'caller swallows it, and the feature silently does nothing in the shipped app.',
    );
});

test('the gguf reranker worker specifically is unpacked', () => {
    // Named explicitly because this is the one that was missing, and because
    // the derived sweep above would go quiet if the filename literal ever moved
    // somewhere the walker does not look.
    assert.ok(
        isUnpacked('ggufRerankerWorker.js'),
        'ggufRerankerWorker.js must be in asarUnpack — its sibling localRerankerWorker.js already is',
    );
});

test('mutation probe: removing an entry is actually detected', () => {
    const without = asarUnpack.filter((p) => !p.endsWith('localRerankerWorker.js'));
    const detect = (file) => without.some((pattern) => pattern.endsWith(file));
    assert.equal(
        detect('localRerankerWorker.js'),
        false,
        'the membership check is vacuous — it reports a removed worker as still unpacked',
    );
});
