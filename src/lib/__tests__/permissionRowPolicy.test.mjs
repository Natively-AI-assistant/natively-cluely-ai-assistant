// Both platform branches of the permissions card's row presentation.
//
// The card previously derived every row from `process.platform` inline, so a
// test could only ever exercise the branch it happened to run on — CLAUDE.md
// calls that insufficient for shared code with platform conditions. platform is
// an argument here, so darwin and win32 are both asserted on either OS, and
// process.platform is never mutated.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  describePermRow,
  allPermissionsResolved,
} from '../permissionRowPolicy.mjs';

describe('describePermRow — microphone, darwin', () => {
  test('granted is inert, never a switch the user can flip back', () => {
    const row = describePermRow('darwin', 'microphone', 'granted');
    assert.equal(row.tone, 'granted');
    assert.equal(row.actionable, false);
    assert.equal(row.actionLabel, null);
    assert.equal(row.remedy, 'none');
  });

  test('not-determined offers the consent prompt, not a settings panel', () => {
    const row = describePermRow('darwin', 'microphone', 'not-determined');
    assert.equal(row.remedy, 'request');
    assert.equal(row.actionLabel, 'Grant');
    assert.equal(row.actionable, true);
  });

  test('denied routes to Settings', () => {
    const row = describePermRow('darwin', 'microphone', 'denied');
    assert.equal(row.remedy, 'settings');
    assert.equal(row.actionLabel, 'Open Settings');
  });

  test('restricted is a dead end, so it offers no action', () => {
    const row = describePermRow('darwin', 'microphone', 'restricted');
    assert.equal(row.tone, 'blocked');
    assert.equal(row.actionable, false);
    assert.equal(row.remedy, 'policy');
  });
});

describe('describePermRow — microphone, win32', () => {
  test('never names macOS System Settings', () => {
    for (const status of ['denied', 'not-determined', 'restricted']) {
      const row = describePermRow('win32', 'microphone', status);
      assert.doesNotMatch(
        row.sublabel,
        /System Settings|Privacy & Security|macOS/i,
        `win32 "${status}" sub-label leaked macOS wording: ${row.sublabel}`,
      );
    }
  });

  test('restricted is the device-level switch, NOT policy — it must stay actionable', () => {
    // Electron maps win32 DeniedBySystem to 'restricted', which is the
    // machine-wide microphone switch. Treating it as an org policy block (as
    // the darwin branch does) would tell the user something false and leave
    // them no way forward. micPermissionPolicy documents this explicitly.
    const row = describePermRow('win32', 'microphone', 'restricted');
    assert.equal(row.remedy, 'settings');
    assert.equal(row.actionable, true);
  });

  test('not-determined has no consent prompt on Windows, so it opens the panel', () => {
    const row = describePermRow('win32', 'microphone', 'not-determined');
    assert.equal(row.remedy, 'settings');
    assert.notEqual(row.actionLabel, 'Grant');
  });

  test('unknown fails OPEN — a query failure must not lock a working mic out', () => {
    const row = describePermRow('win32', 'microphone', 'unknown');
    assert.equal(row.tone, 'granted');
  });
});

describe('describePermRow — screen recording', () => {
  test('darwin denied keeps the relaunch hint', () => {
    // macOS reads this grant at process launch; without the hint the user
    // re-enables it in Settings, sees nothing change, and assumes a bug.
    const row = describePermRow('darwin', 'screen', 'denied');
    assert.match(row.sublabel, /restart/i);
    assert.equal(row.remedy, 'settings');
  });

  test('darwin not-determined does NOT offer a consent prompt', () => {
    // There is no askForMediaAccess('screen') on macOS. Offering "Grant" would
    // be a button that cannot work.
    const row = describePermRow('darwin', 'screen', 'not-determined');
    assert.equal(row.remedy, 'settings');
    assert.notEqual(row.actionLabel, 'Grant');
  });

  test('win32 has no screen-capture gate, so the row asks for nothing', () => {
    const row = describePermRow('win32', 'screen', 'granted');
    assert.equal(row.remedy, 'unsupported');
    assert.equal(row.actionable, false);
  });
});

describe('no row ever self-reports a grant', () => {
  test('nothing but a real granted status yields the granted tone', () => {
    // The regression this guards: opening System Settings used to flip the row
    // to granted immediately. Only permissions:check may decide that.
    for (const platform of ['darwin', 'win32']) {
      for (const kind of ['microphone', 'screen']) {
        for (const status of ['denied', 'not-determined', 'loading']) {
          const row = describePermRow(platform, kind, status);
          if (platform === 'win32' && kind === 'screen') continue; // no gate
          assert.notEqual(
            row.tone,
            'granted',
            `${platform}/${kind}/${status} claimed a grant it had not observed`,
          );
        }
      }
    }
  });

  test('loading is pending on both platforms, never an action', () => {
    for (const platform of ['darwin', 'win32']) {
      const row = describePermRow(platform, 'microphone', 'loading');
      assert.equal(row.tone, 'pending');
      assert.equal(row.actionable, false);
      assert.equal(row.remedy, 'wait');
    }
  });
});

describe('allPermissionsResolved', () => {
  test('darwin requires BOTH grants', () => {
    assert.equal(
      allPermissionsResolved('darwin', { microphone: 'granted', screen: 'denied' }),
      false,
    );
    assert.equal(
      allPermissionsResolved('darwin', { microphone: 'granted', screen: 'granted' }),
      true,
    );
  });

  test('win32 ignores screen, which has no gate there', () => {
    assert.equal(
      allPermissionsResolved('win32', { microphone: 'granted', screen: 'not-determined' }),
      true,
    );
    assert.equal(
      allPermissionsResolved('win32', { microphone: 'denied', screen: 'granted' }),
      false,
    );
  });

  test('loading is not resolved — the done state must not flash before the check returns', () => {
    assert.equal(
      allPermissionsResolved('darwin', { microphone: 'loading', screen: 'loading' }),
      false,
    );
  });

  test('a policy block counts as resolved so the user is never trapped', () => {
    assert.equal(
      allPermissionsResolved('darwin', { microphone: 'restricted', screen: 'granted' }),
      true,
    );
  });
});
