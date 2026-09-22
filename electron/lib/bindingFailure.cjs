'use strict';
/**
 * bindingFailure.cjs — work out what a native-module load failure ACTUALLY was.
 *
 * WHY THIS EXISTS (2026-08-26):
 *   `better-sqlite3` loads its binary through the `bindings` package, which tries a
 *   list of candidate paths and — crucially — SWALLOWS the real `dlopen` error at
 *   each one, moving on to the next. When every candidate fails it throws:
 *
 *     Could not locate the bindings file. Tried:
 *      → …/better-sqlite3/build/Release/better_sqlite3.node
 *      → …(12 more paths)
 *
 *   That message names a MISSING FILE even when the file is present and simply
 *   could not be loaded. Verified directly: with the binary sitting at
 *   build/Release, a direct require produced
 *   "incompatible architecture (have 'x86_64', need 'arm64')" while `bindings`
 *   reported "Could not locate the bindings file".
 *
 *   The consequence was a real user-facing bug. DatabaseManager.reportInitFailure
 *   classified arch mismatches with /incompatible architecture|ERR_DLOPEN_FAILED|
 *   mach-o/i — none of which appear in the `bindings` message. So on the most
 *   common genuine cause, users got the GENERIC "database initialization failed"
 *   line plus 13 unactionable paths, and never the "rebuild your native modules"
 *   guidance. Their symptom: the app launches, but nothing persists.
 *
 * This module re-derives the truth by probing the candidate paths: a file that
 * exists but reports a different arch than the running process IS the mismatch the
 * message hid. Pure and dependency-injected, so both platform branches are testable
 * from either host.
 */

/**
 * `bindings` renders its tried paths as " → /abs/path" lines. It also attaches
 * them as `err.tries`, but that is an array of path SEGMENTS in some versions, so
 * the message is the more reliable source and the array is the fallback.
 */
function extractTriedPaths(error) {
  const fromMessage = String((error && error.message) || '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:→|->)\s*/, '').trim())
    .filter((line) => line.length > 0 && (line.startsWith('/') || /^[A-Za-z]:[\\/]/.test(line)));
  if (fromMessage.length > 0) return fromMessage;

  const tries = error && error.tries;
  if (Array.isArray(tries)) {
    return tries.filter((t) => typeof t === 'string');
  }
  return [];
}

/** Does this error come from the `bindings` resolver (rather than a raw dlopen)? */
function isBindingsResolverError(error) {
  const msg = String((error && error.message) || '');
  return /Could not locate the bindings file/i.test(msg) || Array.isArray(error && error.tries);
}

/** A raw dlopen/arch failure that surfaced its own cause. */
function isDirectArchError(error) {
  const msg = String((error && error.message) || '');
  return (
    (error && error.code === 'ERR_DLOPEN_FAILED') ||
    /incompatible architecture|ERR_DLOPEN_FAILED|mach-o/i.test(msg)
  );
}

/**
 * Classify a native-module init failure.
 *
 * @param {unknown} error
 * @param {object} deps
 * @param {(p: string) => boolean} deps.exists
 * @param {(p: string) => string} deps.archOf   returns 'x64' | 'arm64' | 'unknown …'
 * @param {string} deps.processArch             normally process.arch
 * @returns {{kind:'arch-mismatch', path?:string, actual?:string, expected:string}
 *          |{kind:'binding-missing', tried:string[]}
 *          |{kind:'other'}}
 */
function diagnoseBindingFailure(error, deps) {
  const { exists, archOf, processArch } = deps;

  if (isDirectArchError(error)) {
    return { kind: 'arch-mismatch', expected: processArch };
  }

  if (!isBindingsResolverError(error)) return { kind: 'other' };

  const tried = extractTriedPaths(error);
  const present = [];
  for (const p of tried) {
    let there = false;
    try {
      there = exists(p);
    } catch {
      there = false;
    }
    if (there) present.push(p);
  }

  // Nothing on disk: this is a packaging/installation problem, not a rebuild.
  if (present.length === 0) return { kind: 'binding-missing', tried };

  for (const p of present) {
    let actual;
    try {
      actual = archOf(p);
    } catch {
      continue; // unreadable/unclassifiable — fall through, never guess a mismatch
    }
    if (typeof actual === 'string' && (actual === 'x64' || actual === 'arm64') && actual !== processArch) {
      return { kind: 'arch-mismatch', path: p, actual, expected: processArch };
    }
  }

  // Present, and every readable candidate matches this arch — the load failed for
  // some other reason (code signing, a missing transitive dylib, permissions).
  return { kind: 'other' };
}

module.exports = {
  extractTriedPaths,
  isBindingsResolverError,
  isDirectArchError,
  diagnoseBindingFailure,
};
