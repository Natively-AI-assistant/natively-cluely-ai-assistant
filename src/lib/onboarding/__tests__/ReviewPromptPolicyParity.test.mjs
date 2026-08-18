// Pins the review-prompt engagement policy across the three places it lives.
//
// WHY THIS EXISTS. The policy was stated four times — the client ledger
// (electron/services/ReviewPromptLogic.ts), its backend twin
// (natively-api/reviews.js), a dead private copy in ReviewService.ts, and the
// onboarding catalog (src/lib/onboarding/stageCatalog.*). Nothing tied them
// together, and they drifted in BOTH directions at once:
//
//   * Values: the catalog demanded 6 sessions / 45 minutes; the ledger asked
//     for 3 / 30.
//   * Semantics: the ledger's rule is "sessions OR usage", but the catalog
//     encoded it via `triggers`, which the orchestrator ANDs.
//
// Production takes the stricter of the two, so the catalog won and the
// ledger's thresholds never bound — tuning them moved nothing, with no failing
// test to say so. This suite makes that class of drift loud.
//
// The ledger files are read as TEXT rather than imported: ReviewPromptLogic.ts
// is TypeScript and reviews.js lives in a separate submodule, so neither loads
// cleanly under `node --test` from here. Parsing the constants is enough to
// catch a divergent edit, which is the whole job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REVIEW_PROMPT_MIN_SESSIONS,
  REVIEW_PROMPT_MIN_USAGE_MS,
  reviewEngagementMet,
} from '../stageCatalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../../..');

/** Read `const NAME = <expr>` and evaluate the arithmetic (e.g. `30 * 60 * 1000`). */
function readConstant(source, name) {
  const m = new RegExp(`${name}\\s*=\\s*([0-9*\\s]+)`).exec(source);
  if (!m) return null;
  return m[1].trim().split('*').reduce((acc, n) => acc * Number(n.trim()), 1);
}

const LEDGERS = [
  { label: 'client ledger', path: join(REPO, 'electron/services/ReviewPromptLogic.ts') },
  { label: 'backend ledger', path: join(REPO, 'natively-api/reviews.js') },
];

for (const { label, path } of LEDGERS) {
  test(`${label} agrees with the onboarding catalog`, (t) => {
    if (!existsSync(path)) {
      // natively-api is a submodule; a shallow checkout should skip, not fail.
      t.skip(`${path} not present`);
      return;
    }
    const src = readFileSync(path, 'utf8');
    const sessions = readConstant(src, 'PROMPT_FIRST_SESSION_THRESHOLD');
    const usageMs = readConstant(src, 'PROMPT_FIRST_USAGE_MS_THRESHOLD');

    // Guard the premise: if the names change, every assertion below would pass
    // vacuously against `null`.
    assert.ok(sessions != null, `${label}: PROMPT_FIRST_SESSION_THRESHOLD not found — was it renamed?`);
    assert.ok(usageMs != null, `${label}: PROMPT_FIRST_USAGE_MS_THRESHOLD not found — was it renamed?`);

    assert.equal(
      sessions, REVIEW_PROMPT_MIN_SESSIONS,
      `${label} wants ${sessions} sessions, catalog wants ${REVIEW_PROMPT_MIN_SESSIONS}`,
    );
    assert.equal(
      usageMs, REVIEW_PROMPT_MIN_USAGE_MS,
      `${label} wants ${usageMs}ms usage, catalog wants ${REVIEW_PROMPT_MIN_USAGE_MS}ms`,
    );
  });
}

test('engagement is OR, not AND', () => {
  // The exact semantic that was lost when the policy moved into `triggers`.
  assert.equal(
    reviewEngagementMet({ startupCount: REVIEW_PROMPT_MIN_SESSIONS, totalUsageMs: 0 }),
    true, 'sessions alone should qualify',
  );
  assert.equal(
    reviewEngagementMet({ startupCount: 0, totalUsageMs: REVIEW_PROMPT_MIN_USAGE_MS }),
    true, 'usage alone should qualify',
  );
  assert.equal(
    reviewEngagementMet({
      startupCount: REVIEW_PROMPT_MIN_SESSIONS - 1,
      totalUsageMs: REVIEW_PROMPT_MIN_USAGE_MS - 1,
    }),
    false, 'neither gate met should not qualify',
  );
});

test('ReviewService does not keep a private copy of the thresholds', () => {
  // It declared all four and read exactly one; the other three were dead, and
  // the live one silently duplicated the redisplay delay. It now imports from
  // ReviewPromptLogic, which owns them.
  const svc = readFileSync(join(REPO, 'electron/services/ReviewService.ts'), 'utf8');
  const code = svc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.doesNotMatch(
    code, /^\s*const PROMPT_[A-Z_]+\s*=\s*\d/m,
    'ReviewService redeclared a PROMPT_* threshold instead of importing it',
  );
  assert.match(code, /REVIEW_PROMPT_CONSTANTS/, 'ReviewService no longer sources the shared constants');
});
