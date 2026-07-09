// electron/services/knowledge/ProfileMarkdownExporter.ts
//
// OKF Profile Intelligence — Phase 3 (2026-07-02). Exports the resume + JD
// profile KnowledgePacks as a single OKF v0.1-conformant Markdown bundle with
// the profile layout (candidate/, target-job/, artifacts/, references/). Reuses
// the shared OkfMarkdownExporter's YAML helpers + type mapping (extend, don't
// fork) and the shared OkfConformance checker. Every concept file carries a
// non-empty `type`, `pii: true`, `okf_version: "0.1"`, and a `# Citations`
// section per the OKF citation convention.
//
// references/resume.md + references/job-description.md are POINTER concepts:
// metadata + a resource URI only. They deliberately do NOT copy the full resume
// / JD text into the bundle (privacy — the raw document stays in the premium
// store; the bundle is the curated, card-level view).

import { yamlEscapeScalar, yamlList, okfTypeFor } from './OkfMarkdownExporter';
import type { ExportedFile } from './OkfMarkdownExporter';
import type { KnowledgeCard, KnowledgePack } from './types';

const BUNDLE_DIRS = ['candidate', 'target-job', 'artifacts'] as const;

/** The bundle-relative directory a profile card lives under, derived from its concept id. */
function dirForCard(card: KnowledgeCard): string {
  const seg = card.conceptId.split('/')[0];
  return (BUNDLE_DIRS as readonly string[]).includes(seg) ? seg : 'candidate';
}

function cardResourceUri(card: KnowledgeCard): string {
  const category = card.sourceSections[0] || 'profile';
  return `natively://profile-card/${card.sourceId}#concept=${encodeURIComponent(card.conceptId)}&category=${encodeURIComponent(category)}`;
}

function buildProfileCardMarkdown(card: KnowledgeCard, nowIso: string, slugByConcept: Map<string, string>): string {
  const category = card.sourceSections[0] || 'profile';
  const fm: string[] = [];
  fm.push(`type: ${okfTypeFor(card)}`);
  fm.push(`title: ${yamlEscapeScalar(card.title)}`);
  fm.push(`description: ${yamlEscapeScalar(card.body.split(/(?<=[.!?])\s/)[0]?.slice(0, 160) || card.title)}`);
  fm.push(`resource: ${yamlEscapeScalar(cardResourceUri(card))}`);
  fm.push(`tags: ${yamlList(card.tags)}`);
  fm.push(`timestamp: ${nowIso}`);
  fm.push(`okf_version: "0.1"`);
  fm.push(`pii: true`);
  // Natively producer-defined extension fields (OKF allows extra keys).
  fm.push(`source_category: ${yamlEscapeScalar(category)}`);
  fm.push(`source_quotes: ${yamlList(card.sourceQuotes.map((q) => q.text))}`);
  fm.push(`confidence: ${card.confidence}`);
  fm.push(`generated_from: ${card.generatedFrom}`);
  fm.push(`concept_id: ${yamlEscapeScalar(card.conceptId)}`);
  fm.push(`entities: ${yamlList(card.entities)}`);
  fm.push(`related_cards: ${yamlList(card.relatedCardIds.map((id) => slugByConcept.get(id) || id))}`);
  fm.push(`card_version: ${card.cardVersion}`);

  const body: string[] = [];
  body.push(`# ${card.title}`);
  body.push('');
  body.push(card.body);
  if (card.sourceQuotes.length > 0) {
    body.push('');
    body.push('# Source Evidence');
    body.push('');
    for (const q of card.sourceQuotes) body.push(`- ${q.section || 'profile'}: "${q.text}"`);
  }
  body.push('');
  body.push('# Citations');
  body.push('');
  body.push(`[1] ${cardResourceUri(card)}`);
  const refTarget = dirForCard(card) === 'target-job' ? '/references/job-description.md' : '/references/resume.md';
  body.push(`[2] ${refTarget}`);

  return `---\n${fm.join('\n')}\n---\n\n${body.join('\n')}\n`;
}

function dirIndex(dir: string, cards: KnowledgeCard[]): string {
  const fm = [`total_cards: ${cards.length}`, `directory: ${dir}`];
  const body: string[] = [`# ${dir}`, ''];
  for (const c of cards) {
    const desc = c.body.split(/(?<=[.!?])\s/)[0]?.slice(0, 90) || '';
    body.push(`- [${c.title}](/${c.conceptId}.md) - ${desc}`);
  }
  body.push('');
  return `---\n${fm.join('\n')}\n---\n\n${body.join('\n')}\n`;
}

function referencePointer(kind: 'resume' | 'job-description', pack: KnowledgePack | null): string {
  const title = kind === 'resume' ? 'Candidate Resume (source document)' : 'Target Job Description (source document)';
  const type = kind === 'resume' ? 'Reference Resume' : 'Reference Job Description';
  const uri = pack ? `natively://profile-doc/${pack.sourceId}` : `natively://profile-doc/${kind}`;
  const fm = [
    `type: ${type}`,
    `title: ${yamlEscapeScalar(title)}`,
    `description: ${yamlEscapeScalar('Pointer to the uploaded source document. Full text is intentionally not copied into the bundle (PII).')}`,
    `resource: ${yamlEscapeScalar(uri)}`,
    `okf_version: "0.1"`,
    `pii: true`,
  ];
  const body = [
    `# ${title}`,
    '',
    'This is a pointer concept. The curated, card-level view of this document lives under the sibling bundle directories; the full source text is retained in the application store and intentionally not duplicated here.',
    '',
    '# Citations',
    '',
    `[1] ${uri}`,
  ];
  return `---\n${fm.join('\n')}\n---\n\n${body.join('\n')}\n`;
}

/**
 * Export the profile bundle from the resume + JD packs (either may be null).
 * Returns the full file set (bundle-relative paths). Callers should run
 * checkConformance before writing to disk.
 */
export function exportProfileBundle(params: {
  resumePack: KnowledgePack | null;
  jdPack: KnowledgePack | null;
  nowIso?: string;
}): ExportedFile[] {
  const nowIso = params.nowIso || '1970-01-01T00:00:00.000Z';
  const packs = [params.resumePack, params.jdPack].filter((p): p is KnowledgePack => Boolean(p));
  const allCards = packs.flatMap((p) => p.cards);
  const slugByConcept = new Map(allCards.map((c) => [c.id, c.conceptId]));

  const files: ExportedFile[] = [];

  // Concept files, grouped by directory.
  const byDir = new Map<string, KnowledgeCard[]>();
  for (const card of allCards) {
    const dir = dirForCard(card);
    const list = byDir.get(dir) || [];
    list.push(card);
    byDir.set(dir, list);
    files.push({ path: `${card.conceptId}.md`, content: buildProfileCardMarkdown(card, nowIso, slugByConcept) });
  }

  // Per-directory index.md (progressive disclosure).
  for (const dir of BUNDLE_DIRS) {
    const cards = byDir.get(dir);
    if (!cards || cards.length === 0) continue;
    files.push({ path: `${dir}/index.md`, content: dirIndex(dir, cards) });
  }

  // references/ pointer concepts.
  files.push({ path: 'references/resume.md', content: referencePointer('resume', params.resumePack) });
  files.push({ path: 'references/job-description.md', content: referencePointer('job-description', params.jdPack) });

  // Bundle root index.md + log.md.
  const rootBody: string[] = ['# Candidate Profile — Knowledge Bundle', ''];
  rootBody.push('An OKF v0.1 bundle representing the candidate profile, target job, and precomputed interview artifacts. Every concept is PII (`pii: true`).', '');
  for (const dir of BUNDLE_DIRS) {
    if (byDir.get(dir)?.length) rootBody.push(`- [${dir}](/${dir}/index.md)`);
  }
  rootBody.push('- [references/resume.md](/references/resume.md)');
  rootBody.push('- [references/job-description.md](/references/job-description.md)');
  files.push({ path: 'index.md', content: `---\nokf_version: "0.1"\npii: true\n---\n\n${rootBody.join('\n')}\n` });

  const cardCount = allCards.length;
  files.push({
    path: 'log.md',
    content: `# Change Log\n\n## ${nowIso.slice(0, 10)}\n\n**Creation**: Profile knowledge bundle generated — ${cardCount} concept cards across ${[...byDir.keys()].length} directories.\n`,
  });

  return files;
}
