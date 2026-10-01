// Tests for electron/lib/bindingFailure.cjs — telling an arch mismatch apart from a
// genuinely missing native binary, through the `bindings` package's misleading error.
//
// THE BUG THIS EXISTS FOR (2026-08-26): `bindings` swallows the real dlopen error at
// every candidate path and throws "Could not locate the bindings file. Tried: …".
// DatabaseManager classified arch mismatches with
// /incompatible architecture|ERR_DLOPEN_FAILED|mach-o/i — none of which appear in that
// message — so on the most common real cause users got the GENERIC failure plus 13
// unactionable paths, never the "rebuild your native modules" guidance. Their symptom
// was simply that nothing persisted.
//
// The fixture below is the verbatim error from a real failing launch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  extractTriedPaths,
  isBindingsResolverError,
  isDirectArchError,
  diagnoseBindingFailure,
} = require('../bindingFailure.cjs');

const ROOT = '/Users/evin/natively-cluely-ai-assistant/node_modules/better-sqlite3';
const REAL_PATH = `${ROOT}/build/Release/better_sqlite3.node`;

/** Verbatim from the failing launch, trimmed to 3 of the 13 candidates. */
function bindingsError() {
  const err = new Error(
    'Could not locate the bindings file. Tried:\n' +
      ` → ${ROOT}/build/better_sqlite3.node\n` +
      ` → ${ROOT}/build/Debug/better_sqlite3.node\n` +
      ` → ${REAL_PATH}`
  );
  err.tries = [`${ROOT}/build/better_sqlite3.node`, `${ROOT}/build/Debug/better_sqlite3.node`, REAL_PATH];
  return err;
}

describe('extractTriedPaths', () => {
  test('parses the arrow-prefixed candidate list out of the message', () => {
    assert.deepEqual(extractTriedPaths(bindingsError()), [
      `${ROOT}/build/better_sqlite3.node`,
      `${ROOT}/build/Debug/better_sqlite3.node`,
      REAL_PATH,
    ]);
  });

  test('parses Windows drive-letter paths too', () => {
    const err = new Error('Could not locate the bindings file. Tried:\n → C:\\app\\node_modules\\b.node');
    assert.deepEqual(extractTriedPaths(err), ['C:\\app\\node_modules\\b.node']);
  });

  test('falls back to err.tries when the message has no path lines', () => {
    const err = new Error('Could not locate the bindings file.');
    err.tries = ['/a/b.node'];
    assert.deepEqual(extractTriedPaths(err), ['/a/b.node']);
  });
});

describe('diagnoseBindingFailure', () => {
  const deps = ({ present = [], arch = {}, processArch = 'arm64' } = {}) => ({
    exists: (p) => present.includes(p),
    archOf: (p) => arch[p] ?? 'unknown (whatever)',
    processArch,
  });

  test('THE REGRESSION: a present-but-wrong-arch binary is an arch mismatch, not a missing file', () => {
    const d = diagnoseBindingFailure(
      bindingsError(),
      deps({ present: [REAL_PATH], arch: { [REAL_PATH]: 'x64' }, processArch: 'arm64' })
    );
    assert.equal(d.kind, 'arch-mismatch');
    assert.equal(d.path, REAL_PATH);
    assert.equal(d.actual, 'x64');
    assert.equal(d.expected, 'arm64');
  });

  test('the mirror case (arm64 binary under an Intel app) is caught too', () => {
    const d = diagnoseBindingFailure(
      bindingsError(),
      deps({ present: [REAL_PATH], arch: { [REAL_PATH]: 'arm64' }, processArch: 'x64' })
    );
    assert.equal(d.kind, 'arch-mismatch');
    assert.equal(d.actual, 'arm64');
  });

  test('when NO candidate exists it is a packaging fault, not a rebuild', () => {
    // Saying "rebuild your native modules" to a user whose install is simply missing
    // the binary sends them somewhere that cannot help.
    const d = diagnoseBindingFailure(bindingsError(), deps({ present: [] }));
    assert.equal(d.kind, 'binding-missing');
    assert.equal(d.tried.length, 3);
  });

  test('present with a MATCHING arch is not blamed on arch', () => {
    // Code signing, a missing transitive dylib, permissions — real causes that must
    // not be mislabelled as an arch problem.
    const d = diagnoseBindingFailure(
      bindingsError(),
      deps({ present: [REAL_PATH], arch: { [REAL_PATH]: 'arm64' }, processArch: 'arm64' })
    );
    assert.equal(d.kind, 'other');
  });

  test('an unreadable/unclassifiable binary never yields a FALSE mismatch', () => {
    const d = diagnoseBindingFailure(
      bindingsError(),
      deps({ present: [REAL_PATH], arch: { [REAL_PATH]: 'unknown (data)' }, processArch: 'arm64' })
    );
    assert.equal(d.kind, 'other');
  });

  test('an archOf that throws is survived, not propagated', () => {
    const d = diagnoseBindingFailure(bindingsError(), {
      exists: () => true,
      archOf: () => { throw new Error('file(1) unavailable'); },
      processArch: 'arm64',
    });
    assert.equal(d.kind, 'other');
  });

  test('a direct dlopen error is still classified as arch mismatch (old behaviour kept)', () => {
    const err = new Error("dlopen(...): tried: '...' (mach-o file, but is an incompatible architecture)");
    assert.ok(isDirectArchError(err));
    assert.equal(diagnoseBindingFailure(err, deps()).kind, 'arch-mismatch');

    const coded = new Error('nope');
    coded.code = 'ERR_DLOPEN_FAILED';
    assert.equal(diagnoseBindingFailure(coded, deps()).kind, 'arch-mismatch');
  });

  test('an unrelated DB error stays "other" so it is reported verbatim', () => {
    const err = new Error('SQLITE_CORRUPT: database disk image is malformed');
    assert.ok(!isBindingsResolverError(err));
    assert.equal(diagnoseBindingFailure(err, deps()).kind, 'other');
  });
});
