// tools/app-intelligence-investigation/trace-storage-map.ts
//
// Read-only trace of every SQLite CREATE TABLE statement found in the source
// tree of `electron/`, plus the methods DatabaseManager exposes for each
// table. The output is meant to mirror the diagram in
// `docs/NATIVELY_INTELLIGENCE_SYSTEM_CURRENT_STATE_REPORT.md §16` so that
// future changes to the schema can be diffed against the canonical baseline.
//
// This script does NOT open the DB. It only scans the static source. It
// imports no stateful service.
//
// Run with:
//   npx tsx tools/app-intelligence-investigation/trace-storage-map.ts

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET_FILES = ['electron/db/DatabaseManager.ts'];

interface TableRow {
  name: string;
  sourceFile: string;
  sourceLine: number;
  raw: string;
  hasProvenanceColumn: boolean;
  hasFacticityColumn: boolean;
  hasModeRefColumn: boolean;
}

const TABLE_ROWS: TableRow[] = [];

function classifyTable(raw: string, name: string): Pick<TableRow, 'hasProvenanceColumn' | 'hasFacticityColumn' | 'hasModeRefColumn'> {
  return {
    hasProvenanceColumn: /\b(source_(?:id|name|file|path|document_id)|reference_file_id|origin|provenance|attribution)\b/i.test(raw),
    hasFacticityColumn: /\b(facticity|confidence|trust|trust_level|verified|pii)\b/i.test(raw),
    hasModeRefColumn: /\bmode(_id|UniqueId)?\b/i.test(raw),
  };
}

function scan(): void {
  const re = /CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX|VIRTUAL\s+TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\)\s*(?:USING\s+\w+)?\s*;?/gi;
  for (const rel of TARGET_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf-8');
    const lines = text.split('\n');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1];
      const columns = m[2];
      const idx = text.slice(0, m.index).split('\n').length;
      const raw = m[0];
      TABLE_ROWS.push({ name, sourceFile: rel, sourceLine: idx, raw, ...classifyTable(raw, name) });
    }
  }
}

function inferPurpose(tableName: string): string {
  switch (tableName) {
    case 'meetings': return 'one row per meeting; summary_json blob; meeting-mode persistence';
    case 'transcripts': return 'per-segment transcript rows; speaker + content + timestamp_ms';
    case 'ai_interactions': return 'per-question interaction log; telemetry';
    case 'chunks': return 'semantic chunks of cleaned transcript; per-row embedding BLOB';
    case 'chunk_summaries': return 'one LLM-generated summary row per meeting (post-process)';
    case 'embedding_queue': return 'pending / failed embed jobs';
    case 'user_profile': return 'LEGACY (v1) dormant structured profile JSON — never read by the current pipeline';
    case 'profile_custom_notes': return 'free-form 4000-char user notes';
    case 'profile_persona': return 'Pro-tier persona (tone/voice preference)';
    case 'modes': return 'one row per mode (builtin + custom)';
    case 'mode_reference_files': return 'one row per uploaded reference file (per mode)';
    case 'mode_reference_chunks': return 'lexical chunks for hybrid retrieval';
    case 'mode_note_sections': return 'one row per note section (compiled_prompt cached)';
    case 'knowledge_sources': return 'OKF source-attribution row (reference file | profile_resume | profile_jd)';
    case 'knowledge_packs': return 'one OKF pack per source';
    case 'knowledge_cards': return 'one OKF concept card per pack (pii=true for profile)';
    case 'knowledge_entities': return 'OKF named entities per pack';
    case 'knowledge_relations': return 'OKF typed relations (subject, predicate, object)';
    case 'knowledge_index_versions': return 'OKF index-version metadata (lifecycle)';
    case 'card_versions': return 'OKF edit history (one row per card version)';
    case 'aot_results': return 'premium artifact cache (intro, gap, negotiation, mock-questions, culture)';
    default: return '(unknown)';
  }
}

function printTables(): void {
  console.log('# CREATE TABLE / INDEX / VIRTUAL TABLE statements');
  console.log('# Source: ' + TARGET_FILES.join(', '));
  console.log('# -----------------------------------------------------------------');
  for (const t of TABLE_ROWS) {
    const tag =
      (t.hasProvenanceColumn ? ' P' : '  ') +
      (t.hasFacticityColumn ? 'F' : ' ') +
      (t.hasModeRefColumn ? 'M' : ' ');
    console.log(`  [${tag}] ${t.name.padEnd(28)} @ ${t.sourceFile}:${t.sourceLine}`);
    console.log(`        purpose: ${inferPurpose(t.name)}`);
  }
}

function coverageTable(): void {
  console.log('');
  console.log('# Provenance / Facticity / Mode-Ref coverage');
  console.log('# -----------------------------------------------------------------');
  console.log('# P = has a source-id / source-name / source-file / provenance column');
  console.log('# F = has a facticity / confidence / trust / pii column');
  console.log('# M = has a mode_id / modeUniqueId column');
  console.log('');
  const byFlag: Record<string, string[]> = { P: [], F: [], M: [] };
  for (const t of TABLE_ROWS) {
    if (t.hasProvenanceColumn) byFlag.P.push(t.name);
    if (t.hasFacticityColumn) byFlag.F.push(t.name);
    if (t.hasModeRefColumn) byFlag.M.push(t.name);
  }
  console.log('  with P: ' + (byFlag.P.join(', ') || '(none)'));
  console.log('  with F: ' + (byFlag.F.join(', ') || '(none)'));
  console.log('  with M: ' + (byFlag.M.join(', ') || '(none)'));

  console.log('');
  console.log('# Critical gaps for a future EvidencePack / source-registry:');
  console.log('  - `transcripts` has no per-row source-trust column (every row is');
  console.log('    assumed speaker-correct; STT confidence may be present in some');
  console.log('    providers but is not persisted in the table).');
  console.log('  - `ai_interactions` has no source registry tag; cross-turn provenance');
  console.log('    is impossible without joining with SessionTracker state.');
  console.log('  - `knowledge_cards` HAS `pii` (good for profile PII isolation),');
  console.log('    but no per-card `confidence` column on retrieval hits — confidence');
  console.log('    is computed at retrieval time and never persisted.');
  console.log('  - `chunks` has `embedding BLOB` but no per-row "verified by quote"');
  console.log('    column (the OkfVerifier runs at extraction time, not at retrieval).');
  console.log('');
}

function main(): void {
  scan();
  printTables();
  coverageTable();
  console.log('# End of trace-storage-map.ts output.');
}

main();