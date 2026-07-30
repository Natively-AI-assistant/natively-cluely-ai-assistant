/**
 * THE canonical evaluation corpus — one list, shared by every harness.
 *
 * WHY THIS FILE EXISTS
 * golden-live.cjs and provider-eval.cjs each carried their own CORPUS array and
 * they DRIFTED: 13 files versus 10. The consequences were not cosmetic.
 *
 *   * `resume_v1_2023.md` and `meeting_transcript_previous.txt` were ingested by
 *     NEITHER harness, while 8 corpus questions (G-01..G-03, H-01..H-04, and
 *     H-05's premise) are built entirely on those two documents contradicting
 *     their newer counterparts. The stale-version gate in golden-live grepped
 *     for `/resume_v1/` in a corpus that never contained it and reported 42/42
 *     with nothing to reject.
 *   * `10_BENCHMARK_RESULTS.md` §4.2 stated "the thesis is now back in the
 *     corpus" while naming provider-eval.cjs as its runner — a harness whose
 *     list did not include the thesis.
 *
 * A single source of truth is the fix. Adding a document here adds it
 * everywhere, and a gate cannot silently lose its fixture again.
 *
 * RETRIEVAL GROUPS — why one merged corpus is wrong
 * `lfw_resume.txt` is Evin J; `resume_v1/v2` are Priya Raghunathan. Both are
 * RESUME. Indexed together they make "the candidate" two people, and Priya's
 * résumé (which lists Kubernetes and PostgreSQL) then answers C-01 and C-02 —
 * the probes asserting those terms appear NOWHERE in the résumé. C-02 is the
 * canonical JD-as-experience result in 10_BENCHMARK_RESULTS §3, and in a merged
 * corpus it passes for a corrupt reason.
 *
 * So documents declare which GROUP(s) they belong to, each group is ingested
 * into its own mode, and a question is answered against its group's files only.
 * This is deliberately NOT done with `scopeId`: the adapter stamps every item
 * with the turn's own scope key and never compares it against a per-source
 * scope, so scope isolation would not actually filter anything here.
 *
 * VERSION IDENTITY
 * `sourceKey` is the LOGICAL source (a résumé, a recurring meeting). `versionId`
 * identifies one revision of it, and exactly one revision per sourceKey carries
 * `active: true`. Without this, every file is its own source at its own single
 * version and `filterByScopeAndVersion` is definitionally a no-op — which is
 * precisely the state golden-live was measuring in (it stamped the literal
 * `'legacy'` as every file's active version).
 */
'use strict';

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * @typedef {object} CorpusDoc
 * @property {string}  path      repo-relative
 * @property {string}  label     SourceType
 * @property {string}  sourceKey logical source; files sharing one are versions of it
 * @property {string}  versionId this revision
 * @property {boolean} active    true for the single current revision of sourceKey
 * @property {string[]} groups    retrieval groups this document is indexed into
 * @property {string} [meetingId]  meeting this record belongs to; absent ⇒ user-scoped
 */

/** @type {CorpusDoc[]} */
const CORPUS = [
  // ── Résumé / JD ─────────────────────────────────────────────────────────────
  { path: 'tests/fixtures/modes/looking-for-work/lfw_resume.txt', label: 'RESUME',
    sourceKey: 'lfw-resume', versionId: 'v1', active: true, groups: ['base'] },
  { path: 'tests/fixtures/modes/looking-for-work/lfw_jd.md', label: 'JOB_DESCRIPTION',
    sourceKey: 'lfw-jd', versionId: 'v1', active: true, groups: ['base'] },

  // A REAL version pair — same logical résumé, two revisions that disagree on
  // graduation year (2019 → 2017), team size (4 → 11) and peak volume
  // (2.3M → 5.1M). The 2023 revision is SUPERSEDED and must be rejected by the
  // filter, not merely ranked lower (06_SOURCE_AUTHORITY_SPEC §3.2).
  { path: 'test-fixtures/ci-v3-corpus/additions/resume_v1_2023.md', label: 'RESUME',
    sourceKey: 'candidate-resume', versionId: '2023', active: false, groups: ['versioned'] },
  { path: 'test-fixtures/ci-v3-corpus/additions/resume_v2_2026.md', label: 'RESUME',
    sourceKey: 'candidate-resume', versionId: '2026', active: true, groups: ['versioned'] },

  // ── Cross-meeting isolation ────────────────────────────────────────────────
  // Two meetings that REVERSE each other's decisions, written with deliberately
  // high lexical overlap so similarity ranking cannot separate them.
  //
  // Modelled as distinct SCOPES, not as versions of one source. A past meeting is
  // not a stale draft of the current one — both are permanent records, and
  // 06_SOURCE_AUTHORITY_SPEC §4 is explicit that the separating mechanism is
  // `scopeId = currentMeetingId`. Modelling them as versions made the H-* family
  // pass for the wrong reason: it rejected the June transcript as SUPERSEDED,
  // which is the wrong rejection reason for the right outcome.
  { path: 'test-fixtures/ci-v3-corpus/additions/meeting_transcript_previous.txt', label: 'MEETING_TRANSCRIPT',
    sourceKey: 'eng-sync-june', versionId: 'v1', active: true, groups: ['versioned'],
    meetingId: 'm-june' },
  { path: 'test-fixtures/ci-v3-corpus/additions/meeting_transcript_current.txt', label: 'MEETING_TRANSCRIPT',
    sourceKey: 'eng-sync-sept', versionId: 'v1', active: true, groups: ['base', 'versioned'],
    meetingId: 'm-sept' },

  // ── Reference files ────────────────────────────────────────────────────────
  { path: 'tests/fixtures/modes/sales/sales_pricing_policy.json', label: 'REFERENCE_FILE',
    sourceKey: 'sales-pricing', versionId: 'v1', active: true, groups: ['base'] },
  { path: 'tests/fixtures/modes/sales/sales_competitor_battlecard.md', label: 'REFERENCE_FILE',
    sourceKey: 'sales-battlecard', versionId: 'v1', active: true, groups: ['base'] },
  { path: 'tests/fixtures/modes/recruiting/recruiting_compensation_policy.txt', label: 'REFERENCE_FILE',
    sourceKey: 'recruiting-comp', versionId: 'v1', active: true, groups: ['base'] },
  { path: 'tests/fixtures/modes/technical-interview/tech_error_log.txt', label: 'REFERENCE_FILE',
    sourceKey: 'tech-error-log', versionId: 'v1', active: true, groups: ['base'] },
  { path: 'tests/fixtures/modes/lecture/lecture_pde_syllabus.md', label: 'REFERENCE_FILE',
    sourceKey: 'lecture-syllabus', versionId: 'v1', active: true, groups: ['base'] },
  { path: 'tests/fixtures/modes/team-meet/team_meet_risk_register.json', label: 'REFERENCE_FILE',
    sourceKey: 'risk-register', versionId: 'v1', active: true, groups: ['base'] },

  // Large documents. The 66-page thesis is INCLUDED: F22 (the provider-aware
  // embedding batch) fixed the SIGTRAP that previously forced its exclusion, so
  // the large-document case is genuinely exercised rather than asserted.
  { path: 'test-fixtures/modes-corpus/thesis/institutional_thesis.pdf', label: 'REFERENCE_FILE',
    sourceKey: 'thesis', versionId: 'v1', active: true, groups: ['base'] },
  { path: 'test-fixtures/modes-corpus/papers/attention_is_all_you_need_1706.03762.pdf', label: 'REFERENCE_FILE',
    sourceKey: 'paper-attention', versionId: 'v1', active: true, groups: ['base'] },
  { path: 'test-fixtures/modes-corpus/papers/bert_1810.04805.pdf', label: 'REFERENCE_FILE',
    sourceKey: 'paper-bert', versionId: 'v1', active: true, groups: ['base'] },
];

/** Documents belonging to a retrieval group. */
function docsForGroup(group) {
  const docs = CORPUS.filter((d) => d.groups.includes(group));
  if (!docs.length) throw new Error(`unknown corpus group '${group}'`);
  return docs;
}

/**
 * The group a question must be answered against.
 *
 * Only the version/conflict families need the versioned group; everything else
 * would be contaminated by a second person's résumé appearing under the same
 * RESUME label. Declared here rather than in questions.json so the mapping is
 * reviewable in one place alongside the reason it exists.
 */
const VERSIONED_QUESTIONS = new Set(['G-01', 'G-02', 'G-03', 'H-01', 'H-02', 'H-03', 'H-04']);
const groupForQuestion = (id) => (VERSIONED_QUESTIONS.has(id) ? 'versioned' : 'base');

/** Mode to drive for a question whose first required source is X. */
const MODE_FOR_SOURCE = {
  RESUME: 'looking-for-work',
  JOB_DESCRIPTION: 'looking-for-work',
  REFERENCE_FILE: 'seminar',
  MEETING_TRANSCRIPT: 'team-meet',
  PROFILE_FACT: 'looking-for-work',
};

/**
 * Build the SourceRegistry the retrieval port consumes.
 *
 * The port compares `activeVersions.get(sourceId)` against
 * `chunkVersions.get(sourceId)` and rejects a mismatch as SUPERSEDED_VERSION
 * (legacy-adapter.ts). So for every ingested file:
 *
 *   activeVersions[fileId] = the ACTIVE version of that file's logical source
 *   chunkVersions[fileId]  = the version THIS file actually is
 *
 * A superseded revision therefore carries active=2026 / chunk=2023 and is
 * rejected, while the current revision matches and is admitted. Mapping both to
 * the same literal — as golden-live previously did with 'legacy' — makes the
 * comparison vacuous.
 *
 * @param {Array<{label:string, path:string, file:{id:string}|null}>} ingested
 */
/**
 * The scope a document belongs to, as a structured EvidenceScope.
 *
 * Structured rather than a pre-formatted key string: the adapter compares scopes
 * by CONTAINMENT (a user-level résumé stays visible inside a meeting turn), which
 * string keys cannot express, and it removes any need for this file to reproduce
 * `scopeKey()`'s exact format.
 */
function scopeFor(decl, userId) {
  return decl.meetingId ? { userId, meetingId: decl.meetingId } : { userId };
}

function buildRegistry(ingested, { userId = 'local' } = {}) {
  const byPath = new Map(CORPUS.map((d) => [d.path, d]));

  // The active version of each logical source, taken from the declaration.
  const activeOf = new Map();
  for (const d of CORPUS) if (d.active) activeOf.set(d.sourceKey, d.versionId);

  const sourceTypes = new Map();
  const activeVersions = new Map();
  const chunkVersions = new Map();
  const sourceScopes = new Map();
  /** fileId -> declaration, for assertions that need to know what a file IS. */
  const docOf = new Map();

  for (const item of ingested) {
    if (!item.file) continue;               // empty files are kept as cases, not sources
    const decl = byPath.get(item.path);
    if (!decl) throw new Error(`ingested file not declared in CORPUS: ${item.path}`);

    const active = activeOf.get(decl.sourceKey);
    if (!active) throw new Error(`sourceKey '${decl.sourceKey}' has no active version`);

    sourceTypes.set(item.file.id, decl.label);
    activeVersions.set(item.file.id, active);
    chunkVersions.set(item.file.id, decl.versionId);
    sourceScopes.set(item.file.id, scopeFor(decl, userId));
    docOf.set(item.file.id, decl);
  }

  return { sourceTypes, activeVersions, chunkVersions, sourceScopes, docOf };
}

/**
 * File ids that MUST be rejected as superseded if retrieval ever surfaces them.
 * Lets a gate assert on identity rather than on a filename substring that
 * silently matches nothing.
 */
function supersededFileIds(registry) {
  const out = new Set();
  for (const [fileId, decl] of registry.docOf) if (!decl.active) out.add(fileId);
  return out;
}

/** Sanity: exactly one active revision per logical source. */
function assertCorpusWellFormed() {
  const seen = new Map();
  for (const d of CORPUS) {
    if (!d.groups?.length) throw new Error(`${d.path} declares no group`);
    if (!d.active) continue;
    if (seen.has(d.sourceKey)) {
      throw new Error(`sourceKey '${d.sourceKey}' has two active revisions: `
        + `${seen.get(d.sourceKey)} and ${d.versionId}`);
    }
    seen.set(d.sourceKey, d.versionId);
  }
  for (const d of CORPUS) {
    if (!seen.has(d.sourceKey)) throw new Error(`sourceKey '${d.sourceKey}' has no active revision`);
  }
  return { logicalSources: seen.size, documents: CORPUS.length };
}

/** The meeting a live turn is taking place in, for questions that need one. */
const CURRENT_MEETING_ID = 'm-sept';

/**
 * The scope a QUESTION is asked in, DERIVED from the sources it needs.
 *
 * A question about a meeting is asked *inside* that meeting — so any question
 * that draws on MEETING_TRANSCRIPT gets the current meeting's scope, and the
 * previous meeting's record is then rejected OUT_OF_SCOPE.
 *
 * This was first written as a hardcoded set of the four H-* ids, which was wrong:
 * A-09, F-05 and F-06 are also transcript questions, so they were asked at plain
 * user scope and could not see the September transcript at all — the filter
 * rejected the evidence they needed. Deriving the scope from `requiredSources`
 * keeps the two from drifting as the corpus grows.
 */
function scopeForQuestion(q, userId = 'local') {
  const sources = [...(q.requiredSources || []), ...(q.optionalSources || [])];
  return sources.includes('MEETING_TRANSCRIPT')
    ? { userId, meetingId: CURRENT_MEETING_ID }
    : { userId };
}

/**
 * File ids that must be rejected OUT_OF_SCOPE for a given turn scope.
 * Mirrors the adapter's containment rule, so a user-level document is NOT
 * expected to be rejected inside a meeting turn.
 */
function outOfScopeFileIds(registry, scope) {
  const out = new Set();
  for (const [fileId, s] of registry.sourceScopes) {
    const narrows = (a, b) => a !== undefined && a !== b;
    if (s.userId !== scope.userId || narrows(s.meetingId, scope.meetingId)) out.add(fileId);
  }
  return out;
}

module.exports = {
  CORPUS, MODE_FOR_SOURCE, REPO_ROOT,
  docsForGroup, groupForQuestion, VERSIONED_QUESTIONS,
  scopeForQuestion, CURRENT_MEETING_ID, outOfScopeFileIds, scopeFor,
  buildRegistry, supersededFileIds, assertCorpusWellFormed,
};
