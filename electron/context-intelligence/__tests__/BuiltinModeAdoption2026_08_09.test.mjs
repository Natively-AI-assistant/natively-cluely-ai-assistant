// "Default modes" did not exist. Every row in the modes table was a
// user-created `mode_<uuid>` with a freely editable template — including the
// ones NAMED "General", "Team Meet" and "Technical Interview". That is the
// deeper reason a mode could be named one thing and behave as another
// (reported 2026-08-09: "Technical Interview" running as `general`, so the
// user's résumé was never in scope).
//
// planBuiltinAdoption is the pure decision behind the migration that
// introduces the concept. It is a separate function precisely because it
// RECLASSIFIES USER DATA, and a rule that touches user data should be readable
// and testable without a database.
//
// The rule, and why each clause exists:
//
//   ADOPT a row as built-in only when its name is EXACTLY the canonical label
//   for its own templateType. "Team Meet"/team-meet is the app's own default,
//   untouched. "Lecture"/general is NOT — the user built it from the blank
//   template and named it themselves; locking its template would take away a
//   choice they made.
//
//   ONE per type, the OLDEST. Duplicates exist in the wild (this user has two
//   "Looking for work" rows). Adopting both would leave two immutable modes
//   with the same name and no way to tell them apart.
//
//   SEED only the types nothing was adopted for, so a user who already has a
//   real "Seminar" does not get a second one.
//
// The migration deliberately does NOT hide the Answer policy control on
// built-ins. Locking the template fixes the reported bug; hiding the control
// would additionally strand any choice already stored against a built-in mode
// with no UI left to undo it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const { planBuiltinAdoption, BUILTIN_MODE_LABELS } =
  await import(pathToFileURL(path.join(base, 'services/builtinModes.js')).href);

// The reporting user's actual table, in creation order.
const REAL_ROWS = [
  { id: 'm1', name: 'General', templateType: 'general', createdAt: '1' },
  { id: 'm2', name: 'Looking for work', templateType: 'looking-for-work', createdAt: '2' },
  { id: 'm3', name: 'Technical Interview', templateType: 'technical-interview', createdAt: '3' },
  { id: 'm4', name: 'Looking for work', templateType: 'looking-for-work', createdAt: '4' },
  { id: 'm5', name: 'Team Meet', templateType: 'team-meet', createdAt: '5' },
  { id: 'm6', name: 'Lecture', templateType: 'general', createdAt: '6' },
  { id: 'm7', name: 'Untitled Mode', templateType: 'general', createdAt: '7' },
];

describe('planBuiltinAdoption on the reported real-world table', () => {
  const plan = planBuiltinAdoption(REAL_ROWS);

  test('adopts exactly the four whose name matches their own template', () => {
    assert.deepEqual(plan.adopt.sort(), ['m1', 'm2', 'm3', 'm5']);
  });

  test('a user-named mode on the blank template stays CUSTOM', () => {
    // "Lecture" is templateType general — the user's own construction. Locking
    // it would silently remove a choice they made, and it is not what they
    // asked for.
    assert.ok(!plan.adopt.includes('m6'), 'Lecture/general must stay custom');
    assert.ok(!plan.adopt.includes('m7'), 'Untitled Mode must stay custom');
  });

  test('a duplicate adopts only the OLDEST of its type', () => {
    assert.ok(plan.adopt.includes('m2'), 'the older Looking for work is adopted');
    assert.ok(!plan.adopt.includes('m4'), 'the duplicate stays custom rather than a second immutable twin');
  });

  test('seeds exactly the types nothing was adopted for', () => {
    // 'call-center' joined the built-ins on 2026-08-23. REAL_ROWS predates it,
    // so nothing adopts it and it seeds like the rest.
    assert.deepEqual(plan.seed.sort(), ['call-center', 'lecture', 'recruiting', 'sales', 'seminar']);
  });

  test('adopted + seeded covers every built-in template exactly once', () => {
    const covered = [...plan.adopt.map((id) => REAL_ROWS.find((r) => r.id === id).templateType), ...plan.seed];
    assert.deepEqual(covered.sort(), Object.keys(BUILTIN_MODE_LABELS).sort());
    assert.equal(new Set(covered).size, covered.length, 'no template covered twice');
  });
});

describe('general properties', () => {
  test('an empty table seeds all eight and adopts nothing', () => {
    const plan = planBuiltinAdoption([]);
    assert.deepEqual(plan.adopt, []);
    assert.equal(plan.seed.length, Object.keys(BUILTIN_MODE_LABELS).length);
  });

  test('a name that matches a DIFFERENT template is not adopted', () => {
    // The exact reported shape: named "Technical Interview", running as general.
    // Adopting it would freeze the wrong template permanently.
    const plan = planBuiltinAdoption([
      { id: 'x', name: 'Technical Interview', templateType: 'general', createdAt: '1' },
    ]);
    assert.deepEqual(plan.adopt, [], 'a mislabelled mode must not be frozen as-is');
    assert.ok(plan.seed.includes('technical-interview'));
    assert.ok(plan.seed.includes('general'));
  });

  test('is idempotent — re-running over an already-migrated table adopts nothing new', () => {
    const rows = REAL_ROWS.map((r) => ({ ...r, isBuiltin: ['m1', 'm2', 'm3', 'm5'].includes(r.id) }));
    const plan = planBuiltinAdoption(rows);
    assert.deepEqual(plan.adopt, [], 'already-built-in rows are not re-adopted');
    assert.deepEqual(plan.seed.sort(), ['call-center', 'lecture', 'recruiting', 'sales', 'seminar']);
  });

  test('whitespace and case in a name do not silently qualify', () => {
    const plan = planBuiltinAdoption([
      { id: 'a', name: 'team meet', templateType: 'team-meet', createdAt: '1' },
      { id: 'b', name: '  Team Meet  ', templateType: 'team-meet', createdAt: '2' },
    ]);
    // Trimmed exact match only: a renamed mode should not be swept up by a
    // fuzzy comparison, but surrounding whitespace is not a rename.
    assert.deepEqual(plan.adopt, ['b']);
  });
});
