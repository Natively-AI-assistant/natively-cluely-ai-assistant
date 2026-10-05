/**
 * Answer-pipeline-rebuild Phase 2, RC-8 — regression for a confirmed live bug:
 * "tell me about your experience at Stripe" (a genuine, correctly-authorized
 * `experience_answer`/`required`-policy profile question) was refused with
 * "This is not directly mentioned in the uploaded material" even though the
 * fixture résumé contains an explicit, detailed "Stripe, Inc. — Staff
 * Software Engineer" work-experience section. Confirmed live via the Phase 2
 * harness expansion (docs/answer-pipeline-rebuild/00_REPRODUCTION_RAW.json,
 * case3b_stripe_experience): sentinelLeak=false (profile absent) when it was
 * required to be present — a "required" direction violation, the blind spot
 * the harness expansion added specifically to catch (every prior assertion
 * only tested the opposite/forbidden direction).
 *
 * Root cause: `hasUnhandledQualifier`'s QUALIFIER_PATTERNS included a bare
 * `about|regarding` alternative in `/\b(...|about|regarding|with)\b\s+\w/`.
 * This matches the ordinary, completely unfiltered opener "tell me ABOUT
 * your experience [at Stripe]" and "tell me ABOUT your experience", making
 * `qualified` wrongly true. Every deterministic company/experience-lookup
 * branch in `selectManualProfileEvidence` (gap-between-roles,
 * total-experience-duration, duration-at-company/findExperienceByCompanyMention,
 * and the bare EXPERIENCE_PATTERNS listing) is gated on `!qualified`, so all
 * of them were skipped — falling through to zero evidence items and a
 * `refuse_insufficient_evidence` answerPolicy, entirely deterministic
 * (providerDispatch: false — decided before any LLM call).
 *
 * Fix: removed the bare `about`/`regarding` alternative from that regex.
 * Genuine technology/project-narrowing phrasing ("...experience WITH Kafka")
 * still qualifies via the `with` alternative in the same regex, so no real
 * filter case is lost — confirmed by the pre-existing
 * manualProfileIntelligence.test.mjs suite still passing unchanged.
 *
 * Requires: npm run build:electron.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { hasUnhandledQualifier } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/manualProfileIntelligence.js')).href
);

describe('RC-8 regression: bare "about"/"regarding" must not falsely qualify ordinary experience questions', () => {
  const mustNotQualify = [
    'tell me about your experience at Stripe',
    'tell me about your experience',
    'tell me about your last role',
    'tell me about your project',
    'walk me through your experience at Datadog',
  ];
  for (const q of mustNotQualify) {
    test(`"${q}" must NOT be treated as a qualified/filtered question`, () => {
      assert.equal(hasUnhandledQualifier(q.toLowerCase()), false, `expected unqualified, got qualified=true for "${q}"`);
    });
  }
});

describe('RC-8 fix must not regress genuine narrowing/filter qualifiers (still deferred to grounded LLM)', () => {
  const mustStillQualify = [
    'tell me about your experience with Kafka',
    'tell me about projects that used rest api',
    'which project used graphql',
    'skills in python',
    'tell me about my projects related to machine learning',
    'any projects with kubernetes',
    // "regarding" was deliberately KEPT (unlike "about") — a code-review pass
    // found the first version of this fix removed both, which let genuine
    // narrowing questions wrongly skip the qualifier gate (2026-07-27).
    'what projects do you have regarding cloud infrastructure',
    'tell me about the project regarding payments',
  ];
  for (const q of mustStillQualify) {
    test(`"${q}" must still be treated as qualified/filtered`, () => {
      assert.equal(hasUnhandledQualifier(q.toLowerCase()), true, `expected qualified=true, got false for "${q}"`);
    });
  }
});
