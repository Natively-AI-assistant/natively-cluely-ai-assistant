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
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const candidates: string[] = [];

  // Alongside us first: true when the caller IS that bundle, and cheapest.
  candidates.push(path.join(fromDir, ...segments));

  // Then every ancestor, each checked both as an app root
  // (`electron/<segments>`) and as the electron root (`<segments>`). Ordered
  // nearest-first so a nested app directory cannot shadow the real one.
  let dir = fromDir;
  for (let i = 0; i < MAX_ASCENT; i++) {
    candidates.push(path.join(dir, ...segments));
    candidates.push(path.join(dir, 'electron', ...segments));
    const parent = path.dirname(dir);
    if (parent === dir) break;          // hit the filesystem root
    dir = parent;
  }

  return unpackAsar(candidates.find(p => exists(p)) ?? candidates[0]);
}

/**
 * A script that loads a native addon cannot be read from inside an asar
 * archive, so any path landing inside one is rewritten to the unpacked tree.
 */
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
  return resolveBundledScript(fromDir, ['rag', fileName], exists);
}
