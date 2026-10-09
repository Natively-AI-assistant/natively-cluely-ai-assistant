/**
 * "Was this file the script node was started with, or did something import it?"
 *
 * The usual one-liner,
 *
 *   import.meta.url === pathToFileURL(process.argv[1]).href
 *
 * is wrong whenever the script is reached through a link: node resolves the
 * entry script's REAL path for import.meta.url but leaves argv[1] as typed, so
 * the two differ, the guard says "imported", and the script prints nothing and
 * exits 0. From a symlinked checkout that turned `npm test` (which starts
 * through scripts/run-with-env.mjs) and the packaging gate into silent passes.
 *
 * Nothing here is platform-specific. pathToFileURL keeps the Windows shape
 * right (backslashes, drive letter, percent-encoding), and realpathSync follows
 * junctions as well as symlinks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @param {string} metaUrl  the caller's `import.meta.url`
 * @param {string | undefined} [entry]  defaults to `process.argv[1]`
 * @returns {boolean}
 */
export function isEntryScript(metaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  if (metaUrl === pathToFileURL(entry).href) return true;

  const self = fileURLToPath(metaUrl);
  try {
    // path.relative, not ===: on Windows it compares without regard to case, so
    // a drive letter typed as `c:` still matches `C:`. It is exact elsewhere.
    return path.relative(fs.realpathSync(entry), fs.realpathSync(self)) === '';
  } catch {
    // The entry path cannot be resolved, so the question cannot be settled.
    // Wrongly answering "imported" is the silent exit 0, so fall back to the
    // file name and err towards running. An importing test file never shares
    // the name of the script it imports.
    return path.basename(entry) === path.basename(self);
  }
}
