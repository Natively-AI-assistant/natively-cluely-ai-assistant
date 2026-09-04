// electron/rag/resolveRagWorker.ts
//
// Find a worker script that lives in `electron/rag/`, from whatever bundle is
// asking.
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
 * Absolute path to a worker script that ships in `electron/rag/`.
 *
 * @param fromDir  the calling bundle's `__dirname`
 * @param fileName e.g. `localRerankerWorker.js`
 * @param exists   injected for tests, which need to simulate a dist layout
 *                 without building one
 */
export function resolveRagWorker(
  fromDir: string,
  fileName: string,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const candidates: string[] = [];

  // Alongside us first: true when the caller IS the rag bundle, and cheapest.
  candidates.push(path.join(fromDir, fileName));

  // Then every ancestor, each checked both as an app root (`electron/rag/…`)
  // and as the electron root (`rag/…`). Ordered nearest-first so a nested app
  // directory cannot shadow the real one.
  let dir = fromDir;
  for (let i = 0; i < MAX_ASCENT; i++) {
    candidates.push(path.join(dir, 'rag', fileName));
    candidates.push(path.join(dir, 'electron', 'rag', fileName));
    const parent = path.dirname(dir);
    if (parent === dir) break;          // hit the filesystem root
    dir = parent;
  }

  let resolved = candidates.find(p => exists(p)) ?? candidates[0];

  // A worker that loads a native addon cannot be read from inside an asar
  // archive. Unchanged from both call sites' previous behaviour.
  if (resolved.includes('app.asar') && !resolved.includes('app.asar.unpacked')) {
    resolved = resolved.replace('app.asar', 'app.asar.unpacked');
  }
  return resolved;
}
