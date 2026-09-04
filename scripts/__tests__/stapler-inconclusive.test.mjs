// `stapler validate` consults Apple's CloudKit ticket-delivery API, so it fails on a
// flaky network even when the DMG is perfectly stapled. afterAllArtifactBuild.cjs uses
// that call as its idempotence guard — so reading a network failure as "not stapled"
// makes it rebuild and re-notarize a finished DMG, ~25 minutes for nothing, which is
// exactly what the guard exists to prevent.
//
// Observed 2026-08-27 on Natively-2.8.8-arm64.dmg, seconds after this same hook had
// stapled AND validated it; Gatekeeper confirmed the ticket offline
// ("accepted / source=Notarized Developer ID") while stapler was still failing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isInconclusiveStaplerFailure } = require('../afterAllArtifactBuild.cjs');

// Verbatim tail of the real failure.
const CLOUDKIT_TIMEOUT = `NSLocalizedDescription=The request timed out., NSErrorFailingURLStringKey=https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup, _kCFStreamErrorDomainKey=4}
CloudKit's response is inconsistent with expections: (null)
The validate action failed! Error 68.`;

test('THE REGRESSION: a CloudKit timeout is inconclusive, not proof of no ticket', () => {
  assert.equal(isInconclusiveStaplerFailure(CLOUDKIT_TIMEOUT), true);
});

test('other network shapes are inconclusive too', () => {
  for (const m of [
    'Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline."',
    'connect ETIMEDOUT api.apple-cloudkit.com:443',
    'getaddrinfo ENOTFOUND api.apple-cloudkit.com',
  ]) {
    assert.equal(isInconclusiveStaplerFailure(m), true, m);
  }
});

test('a genuinely unstapled file is NOT excused as a network problem', () => {
  // This must stay negative, or the guard would skip notarizing a DMG that needs it.
  assert.equal(
    isInconclusiveStaplerFailure('Natively-2.8.8.dmg does not have a ticket stapled to it.'),
    false
  );
});

test('a missing file is not a network problem either', () => {
  assert.equal(isInconclusiveStaplerFailure('Error 66. The file could not be found.'), false);
});

test('empty output is not treated as inconclusive', () => {
  assert.equal(isInconclusiveStaplerFailure(''), false);
  assert.equal(isInconclusiveStaplerFailure(undefined), false);
});

test('the afterAllArtifactBuild hook is still the callable default export', () => {
  assert.equal(typeof require('../afterAllArtifactBuild.cjs'), 'function');
});
