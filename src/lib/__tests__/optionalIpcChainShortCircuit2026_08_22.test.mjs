// CR-08 (code-review, 2026-08-21) — investigated and NOT a defect.
//
// The review claimed that
//     window.electronAPI?.getAmbiguousCredentialStores?.().then(...).catch(...)
// throws a synchronous TypeError when the method is absent, because `.then` is
// called on undefined and the `.catch` sits on the same broken chain — so the
// documented "absent API (older main) -> render nothing" would instead unmount
// the settings tree.
//
// That is not how optional chaining works. `?.` short-circuits the ENTIRE chain,
// not just the link it guards: when the method is missing the whole expression
// — `.then` and `.catch` included — is skipped and evaluates to undefined. The
// comment at that call site is accurate, and the ~80 other uses of this idiom
// across the renderer are equally safe. Nothing was changed.
//
// It IS reachable, though, the moment someone "tidies" the call into a temp
// variable — that breaks the chain and produces exactly the crash described.
// These tests pin the semantics and the call-site shape so a future refactor
// cannot introduce the bug the review imagined.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

describe('optional-chain short-circuit semantics', () => {
  const api = { present: async () => ({ ok: true }) };

  test('an ABSENT method short-circuits the whole chain — no throw', () => {
    let threw = null;
    let value = 'unset';
    try {
      value = api?.missing?.().then(() => 'then ran').catch(() => 'catch ran');
    } catch (e) { threw = e; }
    assert.equal(threw, null, '.then/.catch must never be reached when the method is absent');
    assert.equal(value, undefined, 'the whole optional chain evaluates to undefined');
  });

  test('BREAKING the chain into a temp variable DOES throw (the refactor to avoid)', () => {
    assert.throws(() => {
      const f = api?.missing;
      (f?.()).then(() => {}).catch(() => {});
    }, TypeError, 'this is the shape that would actually crash the settings tree');
  });

  test('a PRESENT method still resolves normally', async () => {
    const r = await api?.present?.().then((v) => v.ok).catch(() => false);
    assert.equal(r, true);
  });
});

describe('the AmbiguousStoresCard call site keeps an unbroken chain', () => {
  test('it calls through the optional chain rather than a hoisted reference', () => {
    const src = fs.readFileSync(
      path.join(root, 'src/components/settings/AIProvidersSettings.tsx'), 'utf8');
    const i = src.indexOf('const AmbiguousStoresCard');
    assert.notEqual(i, -1, 'AmbiguousStoresCard not found');
    const body = src.slice(i, i + 1600);

    assert.match(
      body,
      /window\.electronAPI\?\.getAmbiguousCredentialStores\?\.\(\)\s*\n?\s*\.then/,
      'the call must stay one unbroken optional chain; hoisting the method into a '
      + 'variable first makes .then run on undefined and crashes the settings tree (CR-08)',
    );
  });
});
