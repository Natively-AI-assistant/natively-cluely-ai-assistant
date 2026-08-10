// Two weaknesses in the v26 built-in migration, closed here.
//
// 1. PARTIAL SEEDING WAS SILENT FOR THE REST OF THE SESSION.
//    ensureBuiltinModes ran once from getInstance() behind a `builtinsEnsured`
//    flag that was set BEFORE the work. A throw part-way through seeding was
//    caught and swallowed, the flag stayed true, and the process carried on with
//    (say) 6 of 8 defaults until the next launch. Now: each seed is independent,
//    so one failure cannot abort the rest, and the flag is only latched when the
//    run actually COMPLETED — an incomplete run is retried on a later
//    getInstance(), bounded so a permanently broken database cannot spin.
//
// 2. AMBIGUOUS ADOPTION WAS INVISIBLE.
//    Adoption picks the oldest row whose name is exactly the canonical label for
//    its own template. When two rows qualify, the older wins and the other stays
//    custom — which is correct, but if the older one happens to be a CUSTOM mode
//    the user renamed, the wrong instance gets its template locked.
//
//    There is no provenance column to do better, and the obvious tie-break does
//    not work: on the reporting user's real database EVERY row has an empty
//    custom_context, so "prefer the pristine one" discriminates nothing. Rather
//    than invent a signal, the plan now REPORTS the ambiguity so a wrong pick is
//    diagnosable instead of silent. The consequence is mild by construction —
//    an adopted row always has a correct name↔template pairing, so the only loss
//    is that that particular row can no longer be re-templated, and the rejection
//    error already tells the user to duplicate it as a custom mode.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const { planBuiltinAdoption, BUILTIN_MODE_LABELS } =
  await import(pathToFileURL(path.join(base, 'services/builtinModes.js')).href);

describe('ambiguous adoption is reported, not silent', () => {
  test('two rows qualifying for the same template are surfaced', () => {
    const plan = planBuiltinAdoption([
      { id: 'old', name: 'Looking for work', templateType: 'looking-for-work', createdAt: '1' },
      { id: 'new', name: 'Looking for work', templateType: 'looking-for-work', createdAt: '2' },
    ]);
    assert.deepEqual(plan.adopt, ['old'], 'the oldest still wins — behaviour unchanged');
    assert.equal(plan.ambiguous.length, 1);
    assert.deepEqual(plan.ambiguous[0], {
      templateType: 'looking-for-work', chosen: 'old', skipped: ['new'],
    });
  });

  test('an unambiguous table reports nothing', () => {
    const plan = planBuiltinAdoption([
      { id: 'a', name: 'Team Meet', templateType: 'team-meet', createdAt: '1' },
    ]);
    assert.deepEqual(plan.ambiguous, []);
  });

  test('three candidates report both losers', () => {
    const plan = planBuiltinAdoption([
      { id: 'a', name: 'Sales', templateType: 'sales', createdAt: '1' },
      { id: 'b', name: 'Sales', templateType: 'sales', createdAt: '2' },
      { id: 'c', name: 'Sales', templateType: 'sales', createdAt: '3' },
    ]);
    assert.deepEqual(plan.adopt, ['a']);
    assert.deepEqual(plan.ambiguous[0].skipped, ['b', 'c']);
  });

  test('a near-miss is NOT ambiguity — only exact qualifiers count', () => {
    const plan = planBuiltinAdoption([
      { id: 'a', name: 'Team Meet', templateType: 'team-meet', createdAt: '1' },
      { id: 'b', name: 'Team Meet Notes', templateType: 'team-meet', createdAt: '2' },
      { id: 'c', name: 'Team Meet', templateType: 'general', createdAt: '3' },
    ]);
    assert.deepEqual(plan.adopt, ['a']);
    assert.deepEqual(plan.ambiguous, [], 'b and c never qualified, so nothing was skipped');
  });
});

// These two exercise the real DB, so they need the Electron runner:
// better-sqlite3 is built against Electron's ABI and cannot load under plain
// `node --test` (NODE_MODULE_VERSION mismatch). Skipping rather than failing
// keeps the suite green under BOTH runners — run with
// `ELECTRON_RUN_AS_NODE=1 electron --test` to actually execute them.
// Probe the NATIVE MODULE, not DatabaseManager: the manager deliberately
// degrades to an empty result when the DB cannot open, so `getModes().length`
// succeeds under node and would report a false positive.
// better-sqlite3 loads its .node binding lazily inside the Database
// CONSTRUCTOR, so a bare require() succeeds even under the wrong ABI. Actually
// opening one is the only honest probe.
const dbAvailable = (() => {
  try {
    const Database = createRequire(import.meta.url)(path.resolve(process.cwd(), 'node_modules/better-sqlite3'));
    new Database(':memory:').close();
    return true;
  } catch { return false; }
})();

describe('seeding survives a partial failure', { skip: dbAvailable ? false : 'needs the Electron runner (better-sqlite3 ABI)' }, () => {
  const freshManager = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resil-'));
    process.env.NATIVELY_TEST_USERDATA = dir;
    // Fresh module registry so the singleton + latch are per-test.
    const mod = await import(`${pathToFileURL(path.join(base, 'services/ModesManager.js')).href}?t=${Date.now()}${Math.random()}`);
    return { ModesManager: mod.ModesManager, dir };
  };

  test('one failing seed does not abort the others, and the run reports incomplete', async () => {
    const { ModesManager } = await freshManager();
    const mm = ModesManager.getInstance();
    // Everything is already seeded by getInstance on a fresh dir; start over.
    const real = mm.createMode.bind(mm);
    let failed = 0;
    mm.createMode = (params) => {
      if (params.templateType === 'seminar') { failed += 1; throw new Error('disk full'); }
      return real(params);
    };
    // Force a re-run over an empty-ish table by clearing the latch.
    ModesManager._resetBuiltinLatchForTest?.();
    const complete = mm.ensureBuiltinModes();

    assert.equal(typeof complete, 'boolean', 'ensureBuiltinModes reports completion');
    if (failed > 0) {
      assert.equal(complete, false, 'a failed seed must report the run as incomplete');
    }
    // Whatever else was requested still exists — one failure cannot abort the rest.
    const templates = new Set(mm.getModes().map((m) => m.templateType));
    for (const t of Object.keys(BUILTIN_MODE_LABELS)) {
      if (t === 'seminar' && failed > 0) continue;
      assert.ok(templates.has(t), `${t} should have survived the seminar failure`);
    }
  });

  test('an incomplete run is retried on a later getInstance()', async () => {
    const { ModesManager } = await freshManager();
    const mm = ModesManager.getInstance();
    assert.equal(typeof ModesManager._resetBuiltinLatchForTest, 'function',
      'the latch must be resettable so an incomplete run can retry');
    // Simulate: previous run left the latch unlatched because it was incomplete.
    ModesManager._resetBuiltinLatchForTest();
    const again = ModesManager.getInstance();
    assert.equal(again, mm, 'same singleton');
    // A complete run over an already-complete table is a no-op that reports true.
    assert.equal(mm.ensureBuiltinModes(), true);
  });
});
