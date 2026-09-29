// Shared helpers for tests that build an ISOLATED dist tree in os.tmpdir() and
// link the repo's real node_modules into it (so the compiled-per-file tree can
// resolve dependencies without a second install).
//
// The link is the dangerous part. On Windows it must be a JUNCTION — plain
// directory symlinks need elevated privileges or Developer Mode — and a
// recursive delete of the containing directory can traverse a junction and
// destroy the contents of the REAL node_modules it points at.
//
// That is not hypothetical. CI, Windows leg, 2026-08-16: esbuild's platform
// package was present when the Electron suite started (that suite's own
// `build:electron` ran fine at 11:07:51) and gone by the time it finished at
// 11:13:08. Every later step then died with
//   The package "@esbuild/win32-x64" could not be found, and is needed by esbuild.
// — `Run intelligence unit tests` and `Run src/lib unit tests` both. Nothing
// between those steps writes to node_modules except these tests' cleanup.
//
// The consequence off CI is worse than a red check: a Windows developer running
// `npm test` silently corrupts their own node_modules and has to reinstall.
//
// removeIsolatedDistTree() detaches the link FIRST, so the recursive delete
// cannot reach the real tree at all. That is correct regardless of how a given
// Node version classifies a junction, which is the point — it does not depend
// on `fs.rmSync` getting reparse points right.

import fs from 'node:fs';
import path from 'node:path';

/** Node needs an explicit type on Windows; junctions avoid the privilege requirement. */
export const NODE_MODULES_LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

/**
 * Detach a node_modules link without following it.
 * `unlink` covers POSIX symlinks; Windows junctions need `rmdir`. A missing
 * link is not an error — cleanup may run after a failed setup.
 */
export function detachNodeModulesLink(dir) {
    const linkPath = path.join(dir, 'node_modules');
    try {
        fs.unlinkSync(linkPath);
        return true;
    } catch {
        try {
            fs.rmdirSync(linkPath);
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Remove an isolated dist tree safely: detach the node_modules link, THEN
 * delete the directory. Never call `fs.rmSync(dir, { recursive: true })`
 * directly on a tree that contains a link to the real node_modules.
 *
 * `detach` is injectable ONLY so the regression guard can prove the detach
 * happens. It has to be provable by injection because the hazard is
 * Windows-only: on POSIX `fs.rmSync` unlinks a symlink instead of following
 * it, so a macOS run of the destructive version passes and an end-state
 * assertion cannot tell the two implementations apart. Asserting the call
 * makes the guard bite on every platform rather than only on the Windows leg,
 * where it would be discovered by breaking someone's install.
 */
export function removeIsolatedDistTree(dir, detach = detachNodeModulesLink) {
    if (!dir) return;
    detach(dir);
    fs.rmSync(dir, { recursive: true, force: true });
}
