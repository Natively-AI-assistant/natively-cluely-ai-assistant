// electron/services/knowledge/OkfMarkdownExporter.ts
//
// OKF Phase 2 — exports a KnowledgePack as an OKF v0.1-compatible Markdown
// bundle: index.md + log.md + one concept .md file per card, nested under a
// bundle directory. Producer-defined extension fields (source_*, confidence,
// generated_from, concept_id, entities, ...) are emitted alongside the
// required `type` field per the "Natively Adaptation" rule in
// docs/investigations/okf-official-spec-notes.md.

import type { KnowledgeCard, KnowledgePack } from './types';

export interface ExportedFile {
  /** Bundle-relative path, e.g. "thesis/openvla-oft.md" or "index.md". */
  path: string;
  content: string;
}

/**
 * Always emits a double-quoted YAML flow scalar via JSON.stringify (valid
 * YAML — a double-quoted string uses the same escaping rules as JSON).
 *
 * A prior "unquoted when it looks safe" fast-path (regex
 * `^[\w .,/#:()'-]*$` + a `: `/leading-`-` guard) was removed after
 * verification against js-yaml turned up real, non-hypothetical failures:
 * a title ending in a bare colon (e.g. "3.4.1 Definitions:" — a real
 * section-heading shape after OkfExtractor strips the leading section
 * number but leaves a trailing colon intact) was classified "safe" by that
 * regex but produces `title: 3.4.1 Definitions:\n`, which js-yaml rejects
 * with "bad indentation of a mapping entry" — a genuinely unparseable
 * frontmatter block that OkfConformance's own (regex-based, not a full
 * YAML parser) checker would NOT catch either, so the exported bundle
 * would silently ship a non-conformant file. Always-quote trades a
 * negligible amount of frontmatter readability for correctness — these are
 * generated metadata fields, not something a human hand-edits inline.
 */
export function yamlEscapeScalar(value: string): string {
  return JSON.stringify(value);
}

export function yamlList(values: string[] | number[]): string {
  if (values.length === 0) return '[]';
  return `[${values.map((v) => (typeof v === 'number' ? String(v) : yamlEscapeScalar(String(v)))).join(', ')}]`;
}

/** Maps a Natively KnowledgeCardType to a human-readable OKF `type` value. */
export function okfTypeFor(card: KnowledgeCard): string {
  const map: Partial<Record<KnowledgeCard['type'], string>> = {
    concept: 'Reference Concept',
    entity: 'Reference Entity',
    section: 'Reference Section',
    qa_pair: 'Reference QA',
    definition: 'Reference Definition',
    methodology: 'Reference Methodology',
    result: 'Reference Result',
    conclusion: 'Reference Conclusion',
    // OKF Profile Intelligence card types (2026-07-02).
    candidate_identity: 'Candidate Identity',
    candidate_summary: 'Candidate Summary',
    candidate_experience: 'Candidate Experience',
    candidate_project: 'Candidate Project',
    candidate_education: 'Candidate Education',
    candidate_achievement: 'Candidate Achievement',
    candidate_skills: 'Candidate Skills',
    target_job_role: 'Target Job Role',
    target_job_requirements: 'Target Job Requirements',
    target_job_nice_to_haves: 'Target Job Nice-to-Haves',
    target_job_keywords: 'Target Job Keywords',
    artifact_gap_analysis: 'Interview Artifact Gap Analysis',
    artifact_negotiation: 'Interview Artifact Negotiation Strategy',
    artifact_mock_questions: 'Interview Artifact Mock Questions',
    artifact_culture_mapping: 'Interview Artifact Culture Mapping',
    artifact_intro: 'Interview Artifact Intro',
  };
  return map[card.type] || 'Reference Concept';
}

function cardConceptPath(bundleDir: string, slug: string): string {
  const dir = bundleDir.replace(/^\/+|\/+$/g, '');
  return dir ? `${dir}/${slug}.md` : `${slug}.md`;
}

function buildCardMarkdown(card: KnowledgeCard, params: { sourceFileId: string; sourceFileName: string; nowIso: string; slugById: Map<string, string> }): string {
  const fm: string[] = [];
  fm.push(`type: ${okfTypeFor(card)}`);
  fm.push(`title: ${yamlEscapeScalar(card.title)}`);
  fm.push(`description: ${yamlEscapeScalar(card.body.split(/(?<=[.!?])\s/)[0]?.slice(0, 160) || card.title)}`);
  fm.push(`resource: natively://reference-file/${params.sourceFileId}#pages=${card.sourcePages.join(',')}`);
  fm.push(`tags: ${yamlList(card.tags)}`);
  fm.push(`timestamp: ${params.nowIso}`);
  // Natively producer-defined extension fields (OKF "extra fields allowed").
  fm.push(`source_file_id: ${yamlEscapeScalar(params.sourceFileId)}`);
  fm.push(`source_file_name: ${yamlEscapeScalar(params.sourceFileName)}`);
  fm.push(`source_pages: ${yamlList(card.sourcePages)}`);
  fm.push(`source_sections: ${yamlList(card.sourceSections)}`);
  fm.push(`source_checksum: ${yamlEscapeScalar(card.sourceChecksum)}`);
  fm.push(`confidence: ${card.confidence}`);
  fm.push(`generated_from: ${card.generatedFrom}`);
  fm.push(`concept_id: ${yamlEscapeScalar(card.conceptId)}`);
  fm.push(`entities: ${yamlList(card.entities)}`);
  fm.push(`related_cards: ${yamlList(card.relatedCardIds)}`);
  fm.push(`card_version: ${card.cardVersion}`);

  const body: string[] = [];
  body.push(`# ${card.title}`);
  body.push('');
  body.push(card.body);
  if (card.sourceQuotes.length > 0) {
    body.push('');
    body.push('# Source Evidence');
    body.push('');
    for (const q of card.sourceQuotes) {
      const loc = q.section ? `Page ${q.page}, Section ${q.section}` : `Page ${q.page}`;
      body.push(`- ${loc}: "${q.text}"`);
    }
  }
  body.push('');
  body.push('# Citations');
  body.push('');
  card.sourcePages.forEach((page, i) => {
    body.push(`[${i + 1}] natively://reference-file/${params.sourceFileId}#page=${page}`);
  });
  const relatedSlugs = card.relatedCardIds.map((id) => params.slugById.get(id)).filter((s): s is string => Boolean(s));
  if (relatedSlugs.length > 0) {
    body.push('');
    body.push('See also: ' + relatedSlugs.map((slug) => `[[${slug}]]`).join(', '));
  }

  return `---\n${fm.join('\n')}\n---\n\n${body.join('\n')}\n`;
}

function buildPackIndexMarkdown(pack: KnowledgePack, bundleDir: string): string {
  const fm = [
    `pack_id: ${pack.id}`,
    `source_file: ${yamlEscapeScalar(pack.fileName)}`,
    `total_cards: ${pack.stats.cardCount}`,
    `total_entities: ${pack.stats.entityCount}`,
    `pack_version: ${pack.packVersion}`,
    `generated_at: ${pack.updatedAt}`,
  ];

  const byType = new Map<string, KnowledgeCard[]>();
  for (const card of pack.cards) {
    const list = byType.get(card.type) || [];
    list.push(card);
    byType.set(card.type, list);
  }

  const sectionTitles: Record<string, string> = {
    section: 'Sections',
    concept: 'Concepts',
    definition: 'Definitions',
    methodology: 'Methodology',
    result: 'Results',
    conclusion: 'Conclusions',
    entity: 'Entities',
    qa_pair: 'Q&A',
  };

  const body: string[] = [];
  body.push(`# ${pack.fileName} — Knowledge Pack`);
  body.push('');
  body.push(`This pack contains ${pack.stats.cardCount} source-attributed cards extracted from the uploaded document "${pack.fileName}".`);
  body.push('');

  for (const [type, label] of Object.entries(sectionTitles)) {
    const cards = byType.get(type as KnowledgeCard['type']);
    if (!cards || cards.length === 0) continue;
    body.push(`## ${label}`);
    body.push('');
    for (const card of cards) {
      const desc = card.body.split(/(?<=[.!?])\s/)[0]?.slice(0, 90) || '';
      body.push(`- [${card.title}](/${cardConceptPath(bundleDir, card.slug)}) - ${desc}`);
    }
    body.push('');
  }

  return `---\n${fm.join('\n')}\n---\n\n${body.join('\n')}\n`;
}

function buildBundleRootIndexMarkdown(packs: KnowledgePack[]): string {
  const fm = [`okf_version: "0.1"`];
  const body: string[] = ['# Knowledge Bundle', ''];
  for (const pack of packs) {
    body.push(`- [${pack.fileName}](/${slugifyDir(pack.fileName)}/index.md) - ${pack.stats.cardCount} cards`);
  }
  return `---\n${fm.join('\n')}\n---\n\n${body.join('\n')}\n`;
}

function buildLogMarkdown(pack: KnowledgePack): string {
  const date = pack.updatedAt.slice(0, 10);
  return `# Change Log\n\n## ${date}\n\n**Creation**: Knowledge pack generated from "${pack.fileName}" — ${pack.stats.cardCount} cards, ${pack.stats.entityCount} entities (pack v${pack.packVersion}).\n`;
}

export function slugifyDir(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'document';
}

/**
 * Exports a single pack into its bundle subdirectory. Does not include the
 * bundle-root index.md — see exportBundleRoot for multi-pack bundles.
 * `bundleDirOverride` lets a caller pin the directory name (e.g. "thesis")
 * instead of the filename-derived default — useful for a benchmark/demo
 * export where a short, readable directory name is wanted.
 */
export function exportPack(pack: KnowledgePack, params: { sourceFileId: string; sourceFileName: string; bundleDirOverride?: string }): ExportedFile[] {
  const bundleDir = params.bundleDirOverride || slugifyDir(pack.fileName);
  const files: ExportedFile[] = [];
  const slugById = new Map(pack.cards.map((c) => [c.id, c.slug]));

  for (const card of pack.cards) {
    files.push({
      path: cardConceptPath(bundleDir, card.slug),
      content: buildCardMarkdown(card, { sourceFileId: params.sourceFileId, sourceFileName: params.sourceFileName, nowIso: pack.updatedAt, slugById }),
    });
  }

  files.push({ path: `${bundleDir}/index.md`, content: buildPackIndexMarkdown(pack, bundleDir) });
  files.push({ path: `${bundleDir}/log.md`, content: buildLogMarkdown(pack) });

  return files;
}

/** Exports the bundle-root index.md (okf_version declaration + links to each pack's index.md) and root log.md. */
export function exportBundleRoot(packs: KnowledgePack[]): ExportedFile[] {
  return [
    { path: 'index.md', content: buildBundleRootIndexMarkdown(packs) },
    {
      path: 'log.md',
      content: `# Change Log\n\n${packs.map((p) => `## ${p.updatedAt.slice(0, 10)}\n\n**Update**: "${p.fileName}" pack regenerated (v${p.packVersion}).\n`).join('\n')}`,
    },
  ];
}
