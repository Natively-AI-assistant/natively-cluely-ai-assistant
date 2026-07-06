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
 * Fixes (source-pinned, NOT a classification-pattern hack — the anti-thrash rule
 * forbids that):
 *  - ProfileCardTemplates: new §6b leadership card section (candidate_leadership).
 *  - KnowledgeOrchestrator.buildStructuredCategoryPack: leadership also emits
 *    when the question NAMES a leadership org (dynamic — org strings come from
 *    the resume itself, not a hardcoded pattern).
 *  - KnowledgeOrchestrator.buildExperienceFallbackPack: seeds leadership into the
 *    zero-node fallback so org-named questions with no category keyword still
 *    ground.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const orchSrc = readFileSync(
  path.resolve(__dirname, '../../../premium/electron/knowledge/KnowledgeOrchestrator.ts'), 'utf8');
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

describe('RC6: the deterministic runtime pack surfaces leadership for org-named questions', () => {
  test('buildStructuredCategoryPack emits leadership when the question names the org, not only on the "leadership" keyword', () => {
    const fn = orchSrc.slice(
      orchSrc.indexOf('private buildStructuredCategoryPack'),
      orchSrc.indexOf('private buildStructuredCategoryPack') + 8000);
    // The gate must be: wants('leadership') OR the question names a leadership org.
    assert.match(fn, /namesLeadershipOrg/);
    assert.match(fn, /if \(!wants\('leadership'\) && !namesLeadershipOrg\(/);
  });

  test('org matching is dynamic (reads org strings off the resume, not a hardcoded SEDS/TEDx pattern)', () => {
    // Scope to the namesLeadershipOrg closure body — the actual matcher.
    const start = orchSrc.indexOf('const namesLeadershipOrg');
    const fn = orchSrc.slice(start, start + 700);
    // no hardcoded org names in the matcher itself
    assert.doesNotMatch(fn, /SEDS|TEDx/);
    // matches on the resume-provided org string / its distinctive tokens
    assert.match(fn, /qLower\.includes\(o\)/);
    assert.match(fn, /tokens\.some\(\(t\) => qLower\.includes\(t\)\)/);
  });

  test('buildExperienceFallbackPack seeds leadership so a zero-keyword org question still grounds', () => {
    const fn = orchSrc.slice(
      orchSrc.indexOf('private buildExperienceFallbackPack'),
      orchSrc.indexOf('private buildStructuredCategoryPack'));
    assert.match(fn, /Array\.isArray\(resume\.leadership\)/);
    assert.match(fn, /category: 'leadership'/);
  });
});
