/**
 * Profile Intelligence production-fix ROUND 2 (2026-07-06) — RC6: leadership[]
 * grounding gap.
 *
 * Real-session evidence: "Tell me about your role at SEDS CUSAT." and "What did
 * you do for TEDx CUSAT?" both produced a FABRICATED DENIAL of real resume
 * content — the model answered "I do not have any experience with SEDS CUSAT"
 * even though the resume's leadership[] array holds a Technical Head @ SEDS CUSAT
 * and a Sponsorship Executive @ TEDx CUSAT.
 *
 * Two-layer root cause:
 *  1. INGESTION: ProfileCardTemplates.buildResumeCardDrafts cards
 *     experience/projects/education/achievements/skills — but NEVER leadership[].
 *     So leadership content is absent from knowledge_cards → invisible to
 *     retrieval. (Verified against the live DB: knowledge_cards had zero
 *     SEDS/TEDx rows.)
 *  2. RUNTIME PACK: KnowledgeOrchestrator's deterministic category pack only
 *     emitted leadership nodes when the question literally contained
 *     "leadership"/"led"/"managed" (detectCategoryHints). "your role at SEDS
 *     CUSAT" maps the word "role" → `experience`, so leadership stayed hidden and
 *     the model saw only full-time roles → denied the org.
 *
 * Fixes:
 *  - ProfileCardTemplates: new §6b leadership card section (candidate_leadership).
 *  - KnowledgeOrchestrator.buildStructuredCategoryPack: leadership also emits
 *    when the question NAMES a leadership org (dynamic — org strings come from
 *    the resume itself, not a hardcoded pattern).
 *  - KnowledgeOrchestrator.buildExperienceFallbackPack: seeds leadership into the
 *    zero-node fallback so org-named questions with no category keyword still
 *    ground.
 *
 * Phase 6 Slice 3/4 prep (context-rebuild, 2026-07-25): the two
 * `KnowledgeOrchestrator.ts`-source-pinned describe blocks that used to live
 * in this file (testing buildStructuredCategoryPack/buildExperienceFallbackPack/
 * namesLeadershipOrg) were converted to REAL behavioral tests against a live
 * processQuestion() call — see
 * LeadershipGroundingFixBehavioral2026_07_25.test.mjs. That conversion was a
 * migration-plan pre-requisite: Slice 4 rewrites exactly the injection-
 * decision logic those assertions pinned, and a source-pinned assertion
 * would have broken on line/text changes regardless of whether the
 * refactored behavior was correct. The 3 tests below (main-repo files
 * ProfileCardTemplates.ts/types.ts/OkfMarkdownExporter.ts, not the premium
 * submodule) are NOT touched by Slice 4 and remain source-pinned — one of
 * them (candidate_leadership's KnowledgeCardType union membership) has no
 * runtime equivalent at all, since TS union types don't exist at runtime.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cardSrc = readFileSync(
  path.resolve(__dirname, '../../services/knowledge/ProfileCardTemplates.ts'), 'utf8');
const typesSrc = readFileSync(
  path.resolve(__dirname, '../../services/knowledge/types.ts'), 'utf8');
const exporterSrc = readFileSync(
  path.resolve(__dirname, '../../services/knowledge/OkfMarkdownExporter.ts'), 'utf8');

describe('RC6: leadership[] is carded at ingestion', () => {
  test('candidate_leadership is a valid KnowledgeCardType', () => {
    assert.match(typesSrc, /\|\s*'candidate_leadership'/);
  });

  test('ProfileCardTemplates builds a candidate_leadership card from resume.leadership', () => {
    assert.match(cardSrc, /for \(const lead of arr\(resume\?\.leadership\)\)/);
    assert.match(cardSrc, /type: 'candidate_leadership'/);
    assert.match(cardSrc, /sourceCategory: 'leadership'/);
  });

  test('the leadership card carries the org so an org-named query can match it', () => {
    // The card section reads role + organization + description off each entry.
    const seg = cardSrc.slice(cardSrc.indexOf('resume?.leadership'), cardSrc.indexOf('// 7) skills'));
    assert.match(seg, /const org = str\(l\.organization\)/);
    assert.match(seg, /const role = str\(l\.role\)/);
    assert.match(seg, /entities: \[org, role\]/);
  });

  test('OkfMarkdownExporter has a human-readable label for candidate_leadership', () => {
    assert.match(exporterSrc, /candidate_leadership: 'Candidate Leadership'/);
  });
});

// The former "RC6: the deterministic runtime pack surfaces leadership for
// org-named questions" describe block (3 tests, source-pinning
// KnowledgeOrchestrator.ts's buildStructuredCategoryPack/
// buildExperienceFallbackPack/namesLeadershipOrg) was converted to real
// behavioral tests — see LeadershipGroundingFixBehavioral2026_07_25.test.mjs.
