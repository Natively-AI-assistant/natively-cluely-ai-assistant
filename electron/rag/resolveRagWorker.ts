// electron/rag/resolveRagWorker.ts
//
// Find a script that ships at a known place under `electron/`, from whatever
// bundle is asking.
//
// WHY THIS IS NOT A ONE-LINER. esbuild builds one bundle per entry point and
// INLINES every module a bundle imports, so `LocalReranker.ts` and
// `GgufReranker.ts` are each copied into ~30 output files at four different
// depths — `electron/main.js`, `electron/llm/WhatToAnswerLLM.js`,
// `electron/services/reranking/rerankerConfig.js`, `electron/rag/…`. `__dirname`
// is therefore the directory of whichever bundle is EXECUTING, not the
// directory the source file lives in. (Same root cause as the duplicated
// singletons that made `getInstance()` return two different objects.)
//
// The extension host had the SAME bug, found on 2026-09-04 from a startup log:
// `bootstrapPath()` returned `path.join(__dirname, 'host', 'bootstrap.js')`,
// and ExtensionHost is inlined into main.js / ipcHandlers.js / WindowHelper.js
// — all at `electron/` depth — so it looked for
// `dist-electron/electron/host/bootstrap.js`, which does not exist. EVERY
// extension failed to start with ERR_MODULE_NOT_FOUND. The only depth that
// would have resolved, `electron/services/extensions`, is not one any bundle
// runs at.
//
// Both classes used to try three fixed candidates:
//
//     <__dirname>/<worker>.js
//     <__dirname>/rag/<worker>.js
//     <__dirname>/electron/rag/<worker>.js
//
// which covers `electron/rag` and `electron` and nothing else. MEASURED against
// the real dist tree:
//
//     __dirname                            resolves?
//     electron                             yes (candidate 2)
//     electron/rag                         yes (candidate 1)
//     electron/llm                         NO
//     electron/services                    NO
//     electron/services/reranking          NO
//     electron/services/modes              NO
//
// The rerank seam lives under `services/`, so the production path was one of
// the failing rows: `buildLocalGgufPort()` returned a port, the port spawned a
// Worker on a path that does not exist, and `rerank()` caught the error and
// returned null — which the seam reads as "keep the existing order". A reranker
// that silently does nothing, with no user-visible error.
//
// So: walk UP from `__dirname` looking for the file, instead of guessing how
// deep we are. Bounded, cheap (a handful of existsSync calls, once per process),
// and it keeps working if a bundle moves.

import * as fs from 'fs';
import * as path from 'path';

/** How far to walk up. dist-electron/electron/services/reranking is depth 3. */
const MAX_ASCENT = 6;

/**
 * Absolute path to a script that ships at a known place under `electron/`.
 *
 * @param fromDir  the calling bundle's `__dirname`
 * @param segments the script's path relative to `electron/`, e.g.
 *                 `['rag', 'localRerankerWorker.js']` or
 *                 `['services', 'extensions', 'host', 'bootstrap.js']`
 * @param exists   injected for tests, which need to simulate a dist layout
 *                 without building one
 */
export function resolveBundledScript(
  fromDir: string,
  segments: readonly string[],
  opts: {
    exists?: (p: string) => boolean;
    /**
     * Rewrite a path landing inside app.asar to the unpacked tree.
     *
     * OPT-IN, and it must stay that way. `fs.existsSync` returns true for a
     * path inside app.asar — Electron patches fs to make the archive look like
     * a directory — so a resolved candidate always "exists", and rewriting it
     * to app.asar.unpacked produces a path that exists ONLY if electron-builder
     * was told to unpack that file. Rewriting unconditionally therefore turns a
     * working packaged path into a missing one, silently, for any script that
     * is not in `build.asarUnpack`.
     *
     * Every caller passing true must have a matching asarUnpack glob;
     * AsarUnpackedScriptsExist2026_09_04 pins that pairing.
     */
    unpackFromAsar?: boolean;
  } = {},
): string {
  const exists = opts.exists ?? fs.existsSync;
  const candidates: string[] = [];

  // Every ancestor, each checked both as an app root (`electron/<segments>`)
  // and as the electron root (`<segments>`). Starts AT fromDir and is ordered
  // nearest-first, so a nested app directory cannot be shadowed by an outer one.
  let dir = fromDir;
  for (let i = 0; i < MAX_ASCENT; i++) {
    candidates.push(path.join(dir, ...segments));
    candidates.push(path.join(dir, 'electron', ...segments));
    const parent = path.dirname(dir);
    if (parent === dir) break;          // hit the filesystem root
    dir = parent;
  }

  const resolved = candidates.find(p => exists(p)) ?? candidates[0];
  return opts.unpackFromAsar ? unpackAsar(resolved) : resolved;
}

/** Rewrite a path inside app.asar to the unpacked tree beside it. */
function unpackAsar(p: string): string {
  return p.includes('app.asar') && !p.includes('app.asar.unpacked')
    ? p.replace('app.asar', 'app.asar.unpacked')
    : p;
}

/**
 * The rag workers specifically. Kept as its own name because that is what the
 * two reranker call sites read as, and because its tests pin this shape.
 */
export function resolveRagWorker(
  fromDir: string,
  fileName: string,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  // The bare filename beside the caller comes FIRST, and is not something
  // resolveBundledScript can express: when the caller IS the rag bundle the
  // worker sits next to it, not under a further `rag/`. Generalising this
  // function dropped that probe and broke the case, which the existing test
  // caught immediately — hence it being spelled out here rather than folded in.
  const beside = path.join(fromDir, fileName);
  if (exists(beside)) return unpackAsar(beside);
  // The not-found path must still name the CALLER's directory, not a `rag/`
  // subdirectory of it: the MODULE_NOT_FOUND that worker_threads throws is the
  // only diagnostic when a worker genuinely cannot be found, and it should
  // point somewhere the reader recognises.
  const resolved = resolveBundledScript(fromDir, ['rag', fileName],
    { exists, unpackFromAsar: true });
  return exists(resolved) || resolved.includes('app.asar') ? resolved : unpackAsar(beside);
}
