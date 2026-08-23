// electron/services/knowledge/__tests__/StarStoryEvidenceAuthorityGap2026_07_25.test.mjs
//
// Phase 6 Slice 5 (context-rebuild, 05_MIGRATION_PLAN.md Slice 5 item 2):
// "STAR-story cards are typed generatedFrom:'llm_synthesis', confidence:
// 'low', never returned as authority:'evidence' (D16d)." The plan's own
// pre-required test asks for a fix verified against `UnifiedRetriever`.
//
// THIS IS NOT THAT TEST. Investigation (see 05_MIGRATION_PLAN.md's Slice 5
// STATUS note) found item 2 has no subject to fix yet:
//   - STAR-story content lives ONLY as Tier 1 ContextNodes (category:
//     'star_story'). It is NEVER converted into a Tier 2 KnowledgeCard
//     anywhere in the codebase (confirmed by an exhaustive grep for
//     'star_story' across electron/services/knowledge, premium/electron/
//     knowledge, and electron/intelligence/context-os — the only 3 hits are
//     StarStoryGenerator.ts's own construction, HybridSearchEngine.ts's
//     category-boost table, and AOTPipeline.ts's culture-mapping consumer).
//   - `UnifiedRetriever` (the class the plan's test targets) does not exist
//     in this codebase at all.
//   - Neither KnowledgeCard.generatedFrom/confidence nor EvidenceItem.
//     authority is ever set for STAR content, because STAR content never
//     reaches either of those typed shapes — it is inlined as a raw text
//     block directly into the LLM prompt by
//     HybridSearchEngine.formatContextBlock().
//
// Building a converter with no live caller would be exactly the kind of
// premature abstraction this project's ground rules warn against. Instead,
// these tests characterize the CURRENT, real gap D16d describes — that an
// LLM-synthesized STAR narrative is indistinguishable from the candidate's
// own verbatim words once it reaches the prompt — so the gap is documented
// with executable evidence, not just prose, and a future UnifiedRetriever
// implementation has a concrete regression test to turn green.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');

const starStoryGeneratorSrc = readFileSync(
  path.resolve(repoRoot, 'premium/electron/knowledge/StarStoryGenerator.ts'),
  'utf8',
);
const hybridSearchEngineSrc = readFileSync(
  path.resolve(repoRoot, 'premium/electron/knowledge/HybridSearchEngine.ts'),
  'utf8',
);

describe('D16d gap, part 1: starStoriesToNodes() carries generation_mode only as free text, never a structured field', () => {
  test('the returned ContextNode-shaped object has no confidence/generatedFrom/authority field', () => {
    const fnStart = starStoryGeneratorSrc.indexOf('export function starStoriesToNodes(');
    assert.ok(fnStart >= 0);
    const fnBody = starStoryGeneratorSrc.slice(fnStart, starStoryGeneratorSrc.indexOf('\n}', fnStart));
    assert.doesNotMatch(fnBody, /confidence:/);
    assert.doesNotMatch(fnBody, /generatedFrom:/);
    assert.doesNotMatch(fnBody, /authority:/);
  });

  test('generation_mode is folded into the free-text tags string, not a typed field the node exposes', () => {
    const fnStart = starStoryGeneratorSrc.indexOf('export function starStoriesToNodes(');
    const fnBody = starStoryGeneratorSrc.slice(fnStart, starStoryGeneratorSrc.indexOf('\n}', fnStart));
    assert.match(fnBody, /tags: extractTags\(`.*\$\{story\.generation_mode.*\}`\)/);
  });
});

describe('D16d gap, part 2: formatContextBlock renders star_story under the SAME tag as verbatim résumé experience', () => {
  test('the categoryConfig table maps star_story and experience to the identical XML tag (candidate_experience)', () => {
    const tableStart = hybridSearchEngineSrc.indexOf('const categoryConfig');
    assert.ok(tableStart >= 0);
    const tableBody = hybridSearchEngineSrc.slice(tableStart, hybridSearchEngineSrc.indexOf('\n    };', tableStart));
    const experienceMatch = tableBody.match(/'experience':\s*\{\s*tag:\s*'([^']+)'/);
    const starStoryMatch = tableBody.match(/'star_story':\s*\{\s*tag:\s*'([^']+)'/);
    assert.ok(experienceMatch && starStoryMatch, 'both experience and star_story entries must exist in categoryConfig');
    assert.equal(starStoryMatch[1], experienceMatch[1], 'star_story must share experience\'s tag today — this IS the gap D16d names');
  });

  test('the only prefix distinguishing a STAR story in the rendered block is a bracketed label prose could easily drop or an LLM could ignore', () => {
    const tableStart = hybridSearchEngineSrc.indexOf('const categoryConfig');
    const tableBody = hybridSearchEngineSrc.slice(tableStart, hybridSearchEngineSrc.indexOf('\n    };', tableStart));
    const starStoryBlock = tableBody.slice(tableBody.indexOf("'star_story':"), tableBody.indexOf("'project':"));
    assert.match(starStoryBlock, /STAR Story:/, 'the only signal is a plain-text prefix inside the same tag, not a distinct authority/confidence marker');
  });
});

describe('D16d gap, part 3: no Tier 2 KnowledgeCard or UnifiedRetriever consumes star_story content at all', () => {
  test('KnowledgeOrchestrator only ever persists STAR nodes to the Tier 1 db, never converts them to a KnowledgeCard', () => {
    const orchestratorSrc = readFileSync(
      path.resolve(repoRoot, 'premium/electron/knowledge/KnowledgeOrchestrator.ts'),
      'utf8',
    );
    const genIdx = orchestratorSrc.indexOf('generateStarStoryNodes(');
    assert.ok(genIdx >= 0, 'expected the STAR generation call site to still exist');
    const nearby = orchestratorSrc.slice(genIdx, genIdx + 300);
    assert.match(nearby, /this\.db\.saveNodes\(/, 'STAR nodes are saved to the Tier 1 db (this.db), not converted to a Tier 2 KnowledgeCard');
    assert.doesNotMatch(orchestratorSrc, /UnifiedRetriever/, 'UnifiedRetriever does not exist in this codebase — the plan\'s named test subject has no implementation to test yet');
  });
});
