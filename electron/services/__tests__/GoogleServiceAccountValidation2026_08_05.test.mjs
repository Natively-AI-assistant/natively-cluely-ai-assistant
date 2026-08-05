// electron/services/__tests__/GoogleServiceAccountValidation2026_08_05.test.mjs
//
// The service-account classifier, and specifically the DEFINITE / INDEFINITE
// split that decides whether the boot path is allowed to delete a persisted
// credential.
//
// WHY THIS SPLIT EXISTS
// A first cut of this fix validated with `fs.statSync(p).isFile()` and evicted
// the stored path whenever that returned false. Two ways that destroys a
// working credential:
//   1. The key lives on an external volume / network share that is not mounted
//      at launch, or in a macOS TCC-protected folder. statSync throws exactly
//      like a deleted file — on macOS an unmounted /Volumes/X path reports
//      ENOENT — so a recoverable condition looked identical to a gone one.
//   2. statSync passes for ANY file, so the common mistake (the file dialog
//      filters to *.json, so users pick an OAuth client-secret json) was
//      adopted and persisted, then crashed the Speech SDK later — the same
//      deferred-crash symptom the validation was added to remove.
//
// So the contract is: `definite` true ONLY when we positively read the file and
// determined it is not a usable key. Callers may evict on definite; never on
// indefinite. These tests pin exactly that.
//
// Platform note: the classifier takes injectable IO and does no path parsing,
// so it is platform-agnostic by construction. The Windows-shaped cases below
// run on every OS precisely because nothing in the unit depends on the host
// filesystem — see the 'paths are treated as opaque' block.
//
// Run via: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/GoogleServiceAccountValidation2026_08_05.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const {
  classifyServiceAccountFile,
  describeServiceAccountRejection,
  DUMMY_SERVICE_ACCOUNT_PATH,
} = require(dist('services/googleServiceAccount.js'));

/** A structurally valid service-account key (fake credentials). */
const VALID_KEY = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'abc123',
  private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
  client_email: 'svc@test-project.iam.gserviceaccount.com',
  client_id: '123',
});

/** IO stub: `files` maps path → contents; anything else throws like ENOENT. */
const io = (files, { dirs = [], throwCode } = {}) => ({
  statSync: (p) => {
    if (throwCode && files[p] === undefined) { const e = new Error(throwCode); e.code = throwCode; throw e; }
    if (dirs.includes(p)) return { isFile: () => false };
    if (files[p] === undefined) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
    return { isFile: () => true };
  },
  readFileSync: (p) => {
    if (files[p] === undefined) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
    if (files[p] instanceof Error) throw files[p];
    return files[p];
  },
});

describe('a usable key is accepted', () => {
  test('a well-formed service-account json', () => {
    const v = classifyServiceAccountFile('/k/sa.json', io({ '/k/sa.json': VALID_KEY }));
    assert.equal(v.usable, true);
  });
});

describe('DEFINITE rejections — safe to evict the stored path', () => {
  const cases = [
    ['empty string', '', {}, 'empty'],
    ['the .env.example placeholder', DUMMY_SERVICE_ACCOUNT_PATH, {}, 'placeholder'],
    ['a directory', '/k/dir', { files: {}, dirs: ['/k/dir'] }, 'not_a_file'],
    ['not json at all', '/k/x.json', { files: { '/k/x.json': 'not json {{{' } }, 'not_json'],
    // The realistic mis-pick: the dialog filters to *.json.
    ['an OAuth client-secret json', '/k/client.json',
      { files: { '/k/client.json': JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } }) } },
      'not_service_account'],
    ['a package.json', '/k/package.json',
      { files: { '/k/package.json': JSON.stringify({ name: 'natively', version: '1.0.0' }) } },
      'not_service_account'],
    ['service_account type but no private_key', '/k/partial.json',
      { files: { '/k/partial.json': JSON.stringify({ type: 'service_account', client_email: 'a@b.com' }) } },
      'not_service_account'],
    ['json null', '/k/null.json', { files: { '/k/null.json': 'null' } }, 'not_service_account'],
  ];

  for (const [label, p, opts, expectedReason] of cases) {
    test(`${label} → definite`, () => {
      const v = classifyServiceAccountFile(p, io(opts.files || {}, opts));
      assert.equal(v.usable, false);
      assert.equal(v.reason, expectedReason);
      assert.equal(v.definite, true,
        `"${label}" is a positive determination — the boot path is allowed to evict it`);
      assert.ok(describeServiceAccountRejection(v.reason).length > 0, 'every reason needs user-facing text');
    });
  }
});

describe('INDEFINITE rejections — MUST NOT evict (the file may come back)', () => {
  // Each of these is a real user setup where the credential is fine and merely
  // invisible right now. Evicting would destroy it permanently.
  const transient = [
    ['unmounted external volume (reports ENOENT on macOS)', '/Volumes/KeyDrive/sa.json', 'ENOENT'],
    ['permission denied / macOS TCC-protected folder', '/Users/x/Documents/sa.json', 'EACCES'],
    ['unreachable network share', '//fileserver/keys/sa.json', 'EIO'],
    ['disconnected Windows mapped drive', 'Z:\\keys\\sa.json', 'ENOENT'],
  ];

  for (const [label, p, code] of transient) {
    test(`${label} → indefinite`, () => {
      const v = classifyServiceAccountFile(p, io({}, { throwCode: code }));
      assert.equal(v.usable, false);
      assert.equal(v.reason, 'unreadable');
      assert.equal(v.definite, false,
        `"${label}" is a visibility failure, not proof the key is gone. Evicting the stored path here `
        + 'destroys a credential that returns as soon as the volume/share/permission is available.');
    });
  }

  test('a read that throws AFTER a successful stat is also indefinite', () => {
    // stat says it is a file, then the read fails (permissions, IO error).
    const err = new Error('EACCES'); err.code = 'EACCES';
    const v = classifyServiceAccountFile('/k/sa.json', io({ '/k/sa.json': err }));
    assert.equal(v.definite, false);
  });
});

describe('the verdict never carries key material', () => {
  // `detail` is logged by both callers (main.ts boot path, ipcHandlers picker).
  // JSON.parse embeds a snippet of its INPUT in the thrown message — e.g.
  //   Unexpected token 'p', "private_ke"... is not valid JSON
  // — and the input here is a PRIVATE KEY file. Passing that through would
  // print key bytes into the app log, which is a worse outcome than the bad
  // pick it is describing.
  test('a malformed key file does not leak its contents via detail', () => {
    const secret = 'SUPERSECRET_PRIVATE_KEY_MATERIAL';
    const malformed = `{"type":"service_account","private_key":"${secret}" TRAILING GARBAGE`;
    const v = classifyServiceAccountFile('/k/broken.json', io({ '/k/broken.json': malformed }));

    assert.equal(v.usable, false);
    assert.equal(v.reason, 'not_json');
    const serialized = JSON.stringify(v);
    assert.ok(!serialized.includes(secret), 'the verdict must not contain key material');
    assert.ok(!serialized.includes('private_key'), 'not even the field name should round-trip');
    assert.equal(v.detail, undefined, 'not_json must carry NO detail — the parser message quotes the input');
  });

  test('a wrong-but-valid json reports only its type, never its values', () => {
    const v = classifyServiceAccountFile('/k/oauth.json', io({
      '/k/oauth.json': JSON.stringify({ type: 'authorized_user', client_secret: 'SHOULD_NOT_APPEAR' }),
    }));
    assert.equal(v.reason, 'not_service_account');
    assert.ok(!JSON.stringify(v).includes('SHOULD_NOT_APPEAR'), 'secret values must not reach the log');
    assert.equal(v.detail, 'type=authorized_user', 'the type alone is the useful, safe hint');
  });
});

describe('paths are treated as opaque strings (cross-platform by construction)', () => {
  // The classifier does no path parsing — no separator handling, no drive-letter
  // logic — so a Windows path behaves exactly like a POSIX one on every host.
  // That is why the Windows cases above are meaningful when run on macOS.
  const windowsish = [
    'C:\\Users\\Sam\\keys\\sa.json',
    '\\\\server\\share\\sa.json',
    'C:/Users/Sam/keys/sa.json',
    'C:\\Users\\Sam Smith\\My Keys\\sa.json', // spaces
  ];
  for (const p of windowsish) {
    test(`accepts a valid key at ${p}`, () => {
      assert.equal(classifyServiceAccountFile(p, io({ [p]: VALID_KEY })).usable, true);
    });
  }
});
