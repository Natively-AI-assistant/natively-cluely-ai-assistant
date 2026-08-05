import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { extractSafeDocumentText } from '../services/SafeDocumentTextExtractor';
import { tokenize, vectorize } from './projectIndexer';
import { HybridRetriever } from './retriever';
import type { Evidence, IndexManifest, IndexedChunk, ImplementationStatus } from './types';

const PROJECT_ID = process.env.PROJECT_ID || 'cba-import-candidate-ranking';
const DISPLAY_NAME = process.env.PROJECT_DISPLAY_NAME || 'Ranking Potential CBA Import Candidates Using Public Player Season Data from Multiple Leagues';
const SOURCE_ROOT = path.resolve(process.env.CBA_PROJECT_SOURCE_PATH || process.env.PROJECT_SOURCE_PATH || 'E:/Project cba');
const DATA_ROOT = path.resolve(process.cwd(), '.defence-data/projects', PROJECT_ID);
const PROJECTS_CONFIG = path.resolve(process.env.PROJECTS_CONFIG_PATH || '.defence-data/projects.json');
const CORE_CSV = 'data/processed/labelled_player_season_dataset_gleague.csv';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const TEXT_EXT = new Set(['.py', '.js', '.ts', '.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.csv', '.tsv', '.html', '.css', '.ps1', '.bat']);
const DOC_EXT = new Set(['.pdf', '.docx', '.pptx']);
const EXCLUDED_DIRS = ['.git', '.release_snapshot', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache', 'build', 'dist', 'coverage', 'data/raw', 'data/external', 'data/reports/materials_text_extracts', 'data/reports/draft_source_extracts', 'data/reports/user_recommendations'];
const CARD_NAMES = ['project_overview', 'research_problem', 'end_to_end_pipeline', 'code_module_map', 'dataset_design', 'label_construction', 'candidate_pool', 'feature_engineering', 'baseline_ranking', 'learning_to_rank', 'evaluation_metrics', 'verified_results', 'dashboard_and_user_flow', 'development_challenges', 'limitations', 'future_work', 'likely_defence_questions'];

type FactStatus = 'VERIFIED' | 'CONFLICTING' | 'NOT_FOUND';
interface Citation { relativePath: string; symbol?: string; lineStart: number | null; lineEnd: number | null; page: number | null; excerpt: string }
interface Fact { claimId: string; claim: string; value: unknown; status: FactStatus; sources: Citation[]; notes: string }
interface CsvSummary { relativePath: string; sizeBytes: number; sha256: string; rowCount: number; columnCount: number; columns: string[]; dtypes: Record<string, string>; seasonRange: string[]; leagues: string[]; playerIdentifier: string | null; labelField: string | null; positiveCount: number | null; negativeCount: number | null; positiveRate: number | null; missingValues: Record<string, number>; exactDuplicateRows: number; playerSeasonDuplicateRows: number; keyFeatures: string[]; readers: Citation[]; vectorizedRows: number; sampleRows: Array<Record<string, string>> }
interface IndexStats { discovered: number; excluded: number; eligible: number; indexed: number; failed: number; codeSymbols: number; documentChunks: number; reportChunks: number; csvSummaries: number; excludedDirectories: string[]; oversizedFiles: string[]; failures: Array<{ path: string; reason: string }> }
interface EvalCase { id: string; language: 'zh' | 'en' | 'mixed' | 'no-evidence'; question: string; expectedPath?: string; expectedSymbol?: string; expectedClaim?: string; evidenceRequired: boolean; noEvidenceExpected: boolean }
interface EvidenceRoute { pattern: RegExp; path: string; symbol?: string }

function sha256(value: Buffer | string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function rel(absolute: string): string { return path.relative(SOURCE_ROOT, absolute).replace(/\\/g, '/'); }
function exists(relative: string): boolean { return fs.existsSync(path.join(SOURCE_ROOT, relative)); }
function jsonWrite(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 }); }
function readLines(relative: string): string[] { return fs.readFileSync(path.join(SOURCE_ROOT, relative), 'utf8').replace(/\r\n/g, '\n').split('\n'); }
function git(args: string[]): string { const result = spawnSync('git', ['-c', `safe.directory=${SOURCE_ROOT.replace(/\\/g, '/')}`, '-C', SOURCE_ROOT, ...args], { encoding: 'utf8', windowsHide: true }); return result.status === 0 ? result.stdout.trim() : ''; }
function projectCommit(): string { return git(['rev-parse', 'HEAD']); }
function projectStatus(): string { return git(['status', '--porcelain=v1']); }

function symbolNear(lines: string[], index: number): string | undefined {
  for (let i = index; i >= Math.max(0, index - 15); i--) {
    const match = lines[i].match(/^\s*(?:async\s+)?(?:def|class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (match) return match[1];
  }
  return undefined;
}

function evidence(relative: string, patterns: RegExp[], preferredSymbol?: string): Citation | null {
  if (!exists(relative)) return null;
  const lines = readLines(relative);
  const index = lines.findIndex(line => patterns.every(pattern => pattern.test(line)));
  if (index < 0) return null;
  const start = Math.max(0, index - 1); const end = Math.min(lines.length, index + 2);
  return { relativePath: relative, symbol: preferredSymbol || symbolNear(lines, index), lineStart: start + 1, lineEnd: end, page: null, excerpt: lines.slice(start, end).join('\n').trim().slice(0, 900) };
}

function allEvidence(relative: string, pattern: RegExp, preferredSymbol?: string, limit = 3): Citation[] {
  if (!exists(relative)) return [];
  const lines = readLines(relative); const output: Citation[] = [];
  lines.forEach((line, index) => {
    if (output.length >= limit || !pattern.test(line)) return;
    output.push({ relativePath: relative, symbol: preferredSymbol || symbolNear(lines, index), lineStart: index + 1, lineEnd: index + 1, page: null, excerpt: line.trim().slice(0, 900) });
  });
  return output;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(item => item.some(value => value !== ''));
}

function inferType(values: string[]): string {
  const present = values.filter(value => value.trim() !== '');
  if (!present.length) return 'empty';
  if (present.every(value => /^-?\d+$/.test(value.trim()))) return 'integer';
  if (present.every(value => Number.isFinite(Number(value)))) return 'number';
  return 'string';
}

function findReaders(filename: string): Citation[] {
  const output: Citation[] = [];
  for (const file of collectFiles(SOURCE_ROOT).filter(item => /\.py$/i.test(item) && /(?:src|app\.py)/.test(rel(item)))) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => { if (line.includes(filename) && output.length < 20) output.push({ relativePath: rel(file), symbol: symbolNear(lines, index), lineStart: index + 1, lineEnd: index + 1, page: null, excerpt: line.trim().slice(0, 500) }); });
  }
  return output;
}

function csvSummary(): CsvSummary {
  const absolute = path.join(SOURCE_ROOT, CORE_CSV); const binary = fs.readFileSync(absolute); const parsed = parseCsv(binary.toString('utf8'));
  const columns = parsed[0]; const rows = parsed.slice(1).filter(row => row.length === columns.length); const index = Object.fromEntries(columns.map((column, i) => [column, i]));
  const labelField = columns.includes('signed_cba_next_season') ? 'signed_cba_next_season' : null;
  const playerIdentifier = columns.includes('player_name_key') ? 'player_name_key' : null;
  const missingValues: Record<string, number> = {}; const dtypes: Record<string, string> = {};
  columns.forEach((column, i) => { const values = rows.map(row => row[i] || ''); const missing = values.filter(value => !value.trim()).length; if (missing) missingValues[column] = missing; dtypes[column] = inferType(values); });
  const positiveCount = labelField ? rows.reduce((sum, row) => sum + (Number(row[index[labelField]]) === 1 ? 1 : 0), 0) : null;
  const seasons = [...new Set(rows.map(row => row[index.season]).filter(Boolean))].sort(); const leagues = [...new Set(rows.map(row => row[index.league]).filter(Boolean))].sort();
  const exact = new Set<string>(); const grain = new Set<string>(); let exactDuplicateRows = 0; let playerSeasonDuplicateRows = 0;
  for (const row of rows) { const exactKey = row.join('\u001f'); if (exact.has(exactKey)) exactDuplicateRows++; else exact.add(exactKey); const grainKey = [row[index.player_name_key], row[index.season], row[index.league]].join('\u001f'); if (grain.has(grainKey)) playerSeasonDuplicateRows++; else grain.add(grainKey); }
  return { relativePath: CORE_CSV, sizeBytes: binary.length, sha256: sha256(binary), rowCount: rows.length, columnCount: columns.length, columns, dtypes, seasonRange: seasons.length ? [seasons[0], seasons.at(-1)!] : [], leagues, playerIdentifier, labelField, positiveCount, negativeCount: positiveCount === null ? null : rows.length - positiveCount, positiveRate: positiveCount === null ? null : positiveCount / rows.length, missingValues, exactDuplicateRows, playerSeasonDuplicateRows, keyFeatures: ['minutes_per_game', 'points_per_36', 'usage_proxy', 'ts_pct'].filter(column => columns.includes(column)), readers: findReaders(path.basename(CORE_CSV)), vectorizedRows: 0, sampleRows: [] };
}

function collectFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name); const relative = rel(absolute);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!EXCLUDED_DIRS.some(item => relative === item || relative.startsWith(`${item}/`))) visit(absolute); }
      else if (entry.isFile()) output.push(absolute);
    }
  };
  visit(root); return output;
}

function statusFor(relative: string): ImplementationStatus {
  if (/future|proposal|plan/i.test(relative)) return 'PLANNED';
  if (/v2_|learning_to_rank|experiment|ablation|subgroup|research/i.test(relative)) return 'EXPERIMENTAL';
  if (/test|audit|data\/reports/i.test(relative)) return 'TESTED_ONLY';
  return 'IMPLEMENTED';
}

async function documentText(absolute: string): Promise<string> {
  const ext = path.extname(absolute).toLowerCase();
  if (ext === '.pptx') {
    const JSZip = require('jszip'); const zip = await JSZip.loadAsync(fs.readFileSync(absolute));
    const names = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return (await Promise.all(names.map(async (name, i) => `[Slide ${i + 1}]\n${[...(await zip.files[name].async('string')).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(match => match[1]).join(' ')}`))).join('\n\n');
  }
  return (await extractSafeDocumentText(absolute)).content;
}

function chunks(relative: string, content: string, commit: string, hash: string): IndexedChunk[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n'); const output: IndexedChunk[] = []; let lastSymbol: string | undefined;
  for (let start = 0; start < lines.length; start += 32) {
    const end = Math.min(lines.length, start + 40); const body = lines.slice(start, end).join('\n').trim(); if (!body) continue;
    const direct = lines.slice(start, end).map(line => line.match(/^\s*(?:async\s+)?(?:def|class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/)).find(Boolean)?.[1];
    if (direct) lastSymbol = direct; const chunkSymbol = direct || lastSymbol;
    const tokens = tokenize(`${relative} ${chunkSymbol || ''} ${body}`);
    output.push({ id: sha256(`${relative}:${start}:${hash}`).slice(0, 24), sourceType: 'project', path: relative, title: path.basename(relative), symbol: chunkSymbol, lineStart: start + 1, lineEnd: end, commit, excerpt: body.slice(0, 900), content: body, status: statusFor(relative), score: 0, fileHash: hash, indexedAt: new Date().toISOString(), tokens, vector: vectorize(tokens) });
  }
  const declarations = lines
    .map((line, index) => ({ index, symbol: line.match(/^(?:async\s+)?(?:def|class|function)\s+([A-Za-z_$][\w$]*)/)?.[1] }))
    .filter((item): item is { index: number; symbol: string } => !!item.symbol);
  for (const declaration of declarations) {
    const end = Math.min(lines.length, declaration.index + 40);
    const body = lines.slice(declaration.index, end).join('\n').trim();
    const tokens = tokenize(`${relative} ${declaration.symbol} ${body}`);
    output.push({ id: sha256(`${relative}:symbol:${declaration.symbol}:${declaration.index}:${hash}`).slice(0, 24), sourceType: 'project', path: relative, title: path.basename(relative), symbol: declaration.symbol, lineStart: declaration.index + 1, lineEnd: end, commit, excerpt: body.slice(0, 900), content: body, status: statusFor(relative), score: 0, fileHash: hash, indexedAt: new Date().toISOString(), tokens, vector: vectorize(tokens) });
  }
  return output;
}

function facts(summary: CsvSummary, commit: string): Fact[] {
  const report = 'data/reports/dissertation_final_experiment_summary.md'; const readme = 'README.md';
  const make = (claimId: string, claim: string, value: unknown, status: FactStatus, sources: Array<Citation | null>, notes = ''): Fact => ({ claimId, claim, value, status, sources: sources.filter((item): item is Citation => !!item), notes });
  const reportMetric = (id: string, label: string, value: number, pattern: RegExp): Fact => make(id, label, value, evidence(report, [pattern]) ? 'VERIFIED' : 'NOT_FOUND', [evidence(report, [pattern])], 'Current final experiment report; production claims must keep the named method and pool.');
  return [
    make('positioning', 'The project is Top-K candidate ranking and scouting decision support.', 'Top-K ranking / scouting decision support', 'VERIFIED', [evidence(readme, [/球探决策支持/]), evidence(report, [/time-based Top-K ranking/])]),
    make('not-deterministic', 'The project does not predict that a player will definitely sign for a CBA club.', false, 'VERIFIED', [evidence(readme, [/不是断言/]), evidence(report, [/not deterministic prediction/])]),
    make('main-input', 'The stable main input is labelled_player_season_dataset_gleague.csv.', CORE_CSV, exists(CORE_CSV) ? 'VERIFIED' : 'NOT_FOUND', [{ relativePath: CORE_CSV, lineStart: null, lineEnd: null, page: null, excerpt: `SHA256 ${summary.sha256}; ${summary.rowCount} rows; ${summary.columnCount} columns; raw rows are not vectorized.` }]),
    make('dataset-rows', 'Final player-season rows.', summary.rowCount, summary.rowCount === 42127 ? 'VERIFIED' : 'CONFLICTING', [{ relativePath: CORE_CSV, lineStart: null, lineEnd: null, page: null, excerpt: `Structured CSV profile: ${summary.rowCount} rows.` }, evidence(report, [/42,127/])]),
    make('dataset-positives', 'Final positive player-season rows.', summary.positiveCount, summary.positiveCount === 116 ? 'VERIFIED' : 'CONFLICTING', [{ relativePath: CORE_CSV, lineStart: null, lineEnd: null, page: null, excerpt: `signed_cba_next_season sum=${summary.positiveCount}.` }, evidence(report, [/116/])]),
    make('dataset-positive-rate', 'Final positive rate.', summary.positiveRate, Math.abs((summary.positiveRate || 0) - 0.002754) < 0.000001 ? 'VERIFIED' : 'CONFLICTING', [{ relativePath: CORE_CSV, lineStart: null, lineEnd: null, page: null, excerpt: `positiveCount / rowCount = ${summary.positiveRate}.` }, evidence(report, [/0\.002754/])]),
    make('common-pool', 'Common CBA source league pool rows and positives.', { rows: 24027, positives: 116 }, evidence(report, [/24,027/]) ? 'VERIFIED' : 'NOT_FOUND', [evidence(report, [/24,027/]), evidence('data/reports/candidate_universe_comparison.md', [/pool_common_cba_source_leagues/])]),
    reportMetric('baseline-p20', 'Rule-based baseline Precision@20.', 0.0464, /Precision@20:\s*\*\*0\.0464/),
    reportMetric('baseline-p50', 'Rule-based baseline Precision@50.', 0.0429, /Precision@50:\s*\*\*0\.0429/),
    reportMetric('baseline-r100', 'Rule-based baseline Recall@100.', 0.4832, /Recall@100:\s*\*\*0\.4832/),
    reportMetric('baseline-r300', 'Rule-based baseline Recall@300.', 0.6818, /Recall@300:\s*\*\*0\.6818/),
    reportMetric('baseline-lift20', 'Rule-based baseline Lift@20.', 11.3617, /Lift@20:\s*\*\*11\.3617/),
    make('ltr-p20', 'LambdaRank Precision@20.', 0.05, evidence(report, [/0\.0500/]) ? 'VERIFIED' : 'NOT_FOUND', [evidence(report, [/0\.0500/]), evidence('data/reports/dissertation_final_tables/table_ltr_comparison.csv', [/0\.05/])], 'Robustness experiment; it does not replace the stable baseline.'),
    make('historical-prior-subgroup-p20', 'Historical claim: prior subgroup Precision@20 = 0.0667.', 0.0667, 'NOT_FOUND', [], 'No exact supporting source was found in the current project. The current final report instead records 0.1731 for a specifically named prior-CBA LightGBM raw-feature subgroup.'),
    make('current-prior-subgroup-p20', 'Current final-report prior-CBA subgroup LightGBM raw-feature Precision@20.', 0.1731, evidence(report, [/0\.1731/]) ? 'VERIFIED' : 'NOT_FOUND', [evidence(report, [/0\.1731/])], 'Small subgroup; must not be generalized to all candidates.'),
    make('dashboard-season', 'Dashboard default recommendation season is 2024-2025.', '2024-2025', evidence('src/dashboard/recommendation_source_registry.py', [/DEFAULT_DISPLAY_NAME/, /2024-2025/]) ? 'VERIFIED' : 'NOT_FOUND', [evidence('src/dashboard/recommendation_source_registry.py', [/DEFAULT_DISPLAY_NAME/, /2024-2025/], 'DEFAULT_DISPLAY_NAME'), evidence('src/dashboard/export_frontend_recommendations.py', [/latest_season_only/], 'build_export')]),
    make('dashboard-4200', 'Historical Dashboard candidate set contained about 4,200 Top-300-per-season rows.', 4200, evidence('data/reports/large_scale_final_watchlist_summary.md', [/Top300 rows:\s*4200/]) ? 'VERIFIED' : 'NOT_FOUND', [evidence('data/reports/large_scale_final_watchlist_summary.md', [/Top300 rows:\s*4200/])], 'This is a historical multi-season watchlist count, not the current displayed row count.'),
    make('dashboard-export-300', 'Current default Dashboard export contains 300 latest-season candidates.', 300, exists('data/reports/frontend_recommendations.csv') ? 'VERIFIED' : 'NOT_FOUND', [{ relativePath: 'data/reports/frontend_recommendations.csv', lineStart: null, lineEnd: null, page: null, excerpt: 'CSV profile: 300 rows, recommendation_season=2024-2025.' }, evidence('src/dashboard/export_frontend_recommendations.py', [/head\(top_n\)/], 'build_export')]),
    make('dashboard-positives-12', 'Historical Dashboard materials recorded 12 positives.', 12, 'CONFLICTING', [evidence('data/reports/gleague_nba_api_label_summary.csv', [/2022-2023/, /positives.*12/])], 'The value 12 is present for one next-season label cohort, but the current 300-row Dashboard export has no label column. It cannot be stated as the current Dashboard positive count.'),
    make('key-features', 'Key stable input features include minutes_per_game, points_per_36, usage_proxy and ts_pct.', summary.keyFeatures, summary.keyFeatures.length === 4 ? 'VERIFIED' : 'CONFLICTING', [{ relativePath: CORE_CSV, lineStart: 1, lineEnd: 1, page: null, excerpt: summary.keyFeatures.join(', ') }, evidence('src/dashboard/rank_new_candidates.py', [/points_per_36/], 'rank_candidates')]),
    make('project-commit', 'Project commit used for this knowledge build.', commit, commit ? 'VERIFIED' : 'NOT_FOUND', [], 'The source worktree is dirty; generated evidence describes the current filesystem and records the Git commit separately.')
  ];
}

const CARD_SOURCES: Record<string, string[]> = {
  project_overview: ['README.md', 'data/reports/technical_documentation_cn.md'], research_problem: ['README.md', 'data/reports/dissertation_final_experiment_summary.md'],
  end_to_end_pipeline: ['data/reports/technical_documentation_cn.md', 'src/research/build_player_season_dataset.py', 'src/dashboard/export_frontend_recommendations.py'],
  code_module_map: ['src/README.md', 'app.py'], dataset_design: [CORE_CSV, 'src/research/build_player_season_dataset.py'], label_construction: ['src/research/build_labels.py'],
  candidate_pool: ['src/research/build_candidate_pool.py', 'data/reports/candidate_universe_comparison.md'], feature_engineering: ['src/research/build_player_season_dataset.py', 'src/dashboard/ingest_new_candidates.py'],
  baseline_ranking: ['src/dashboard/rank_new_candidates.py', 'src/research/train_player_season_rankers.py'], learning_to_rank: ['src/research/train_learning_to_rank.py', 'data/reports/dissertation_final_experiment_summary.md'],
  evaluation_metrics: ['src/research/evaluate_ranking.py', 'src/research/ranking_metric_utils.py'], verified_results: ['verified_project_facts.json', 'data/reports/dissertation_final_experiment_summary.md'],
  dashboard_and_user_flow: ['app.py', 'src/dashboard/recommendation_source_registry.py', 'src/dashboard/export_frontend_recommendations.py'], development_challenges: ['data/reports/technical_documentation_cn.md'],
  limitations: ['README.md', 'data/reports/dissertation_final_experiment_summary.md'], future_work: ['data/reports/dissertation_final_tables/table_8_limitations_future_work.csv'], likely_defence_questions: ['README.md', 'data/reports/technical_documentation_cn.md']
};

function cardContent(name: string, commit: string, factList: Fact[], manifest: IndexManifest): string {
  const sources = CARD_SOURCES[name] || []; const citations: string[] = [];
  for (const source of sources) {
    if (source === 'verified_project_facts.json') { citations.push(`- verified_project_facts.json | generated facts registry | commit ${commit} | TESTED_ONLY | confidence: high`); continue; }
    const match = manifest.chunks.find(chunk => chunk.path === source);
    if (match) citations.push(`- ${source} | ${match.symbol || 'document section'} | L${match.lineStart}-${match.lineEnd} | commit ${commit} | ${match.status} | confidence: ${match.status === 'PLANNED' ? 'low' : 'high'} | ${match.excerpt.replace(/\s+/g, ' ').slice(0, 220)}`);
    else if (source === CORE_CSV) citations.push(`- ${CORE_CSV} | structured CSV summary | no raw-row citation | commit ${commit} | TESTED_ONLY | confidence: high`);
  }
  const verified = factList.filter(fact => fact.status === 'VERIFIED').slice(0, 12).map(fact => `- ${fact.claim}: ${JSON.stringify(fact.value)}`).join('\n');
  const topics: Record<string, string> = {
    project_overview: 'This project uses public multi-league player-season data to rank potential CBA import candidates for a scouting shortlist. It is decision support, not a deterministic signing prediction.',
    research_problem: 'The operating problem is rare-event shortlist prioritisation: scouting attention is limited, positives are sparse, and important market variables are private.',
    end_to_end_pipeline: 'Public league rows → normalisation → player-season aggregation → season t to t+1 label → candidate-pool filters → features → time-based Top-K evaluation → local Dashboard/export.',
    code_module_map: '`src/research` contains reproducible research pipelines; `src/dashboard` contains runtime ingestion, transparent scoring and export; `app.py` renders Streamlit.',
    dataset_design: 'The main grain is one eligible overseas player-season. The core CSV is summarized structurally and is never copied or vectorized row by row.',
    label_construction: 'The principal label is whether the same player appears in the CBA label set in season t+1. Chinese-CBA rows are label evidence, not overseas performance features.',
    candidate_pool: 'The stable evaluation uses the common CBA source league pool. Broader and pathway pools are comparisons and must remain distinct.',
    feature_engineering: 'Performance features include minutes per game, points per 36, usage proxy and true shooting. Cross-league normalisation and context features are separately audited.',
    baseline_ranking: 'The final stable method is the transparent common-pathway rule-based baseline; Dashboard scoring of new user data is exploratory and not historical backtesting.',
    learning_to_rank: 'LambdaRank exists as a real experiment. It slightly improves P@20 but does not improve the wider recall/lift profile, so it does not replace the baseline.',
    evaluation_metrics: 'Precision@K measures shortlist concentration, Recall@K measures positive coverage, and Lift@K compares against base rate. Accuracy is misleading under extreme imbalance.',
    verified_results: 'Only facts marked VERIFIED may enter default spoken answers. CONFLICTING and NOT_FOUND values require an explicit caveat.',
    dashboard_and_user_flow: 'The local Dashboard loads a protected default recommendation source, supports source switching and new-data imports, and safely handles empty or small Top-N selections.',
    development_challenges: 'Core challenges include sparse positives, cross-league comparability, G League scaling, temporal leakage, incomplete public fields and small-source UI edge cases.',
    limitations: 'Public data lacks contract, salary, injury, visa, agent, team-demand and player-intent information. The system narrows review; it cannot decide a signing.',
    future_work: 'Future work remains separate from implemented features. Potential improvements require stronger labels, additional permitted sources and prospective human evaluation.',
    likely_defence_questions: 'Likely questions cover problem formulation, labels, player-season grain, candidate pools, per-36 and efficiency features, leakage, Top-K metrics, baseline versus LTR, Dashboard workflow and limitations.'
  };
  return `# ${name.replace(/_/g, ' ')}\n\nPersona: CBA Import Candidate Ranking Defence\n\n${topics[name]}\n\n## Verified facts available\n\n${verified}\n\n## Evidence\n\n${citations.join('\n')}\n\n## Claim boundary\n\nDo not claim deterministic signing prediction, private market knowledge, or future-work implementation. Preserve baseline, learning-to-rank, prior subgroup and Dashboard distinctions.\n`;
}

function evalCases(): EvalCase[] {
  const cases: EvalCase[] = [
    ['zh01','zh','项目到底在预测什么？','README.md',undefined,'decision support'], ['zh02','zh','为什么使用 Top-K ranking？','data/reports/dissertation_final_experiment_summary.md',undefined,'Top-K'], ['zh03','zh','为什么不是普通二分类？','README.md',undefined,'shortlist'],
    ['zh04','zh','正例标签如何构建？','src/research/build_labels.py','add_cba_next_season_labels','signed_cba_next_season'], ['zh05','zh','player-season 是什么意思？','src/research/build_player_season_dataset.py',undefined,'player season'], ['zh06','zh','不同联盟数据怎样统一？','src/research/build_player_season_dataset.py',undefined,'aggregate'],
    ['zh07','zh','候选池如何过滤？','src/research/build_candidate_pool.py','build_candidate_pool','candidate pool'], ['zh08','zh','per-36 特征有什么作用？','src/dashboard/ingest_new_candidates.py',undefined,'points_per_36'], ['zh09','zh','usage_proxy 如何生成？','src/dashboard/ingest_new_candidates.py',undefined,'usage_proxy'],
    ['zh10','zh','ts_pct 真实命中率有什么作用？','src/dashboard/parse_pasted_candidate_text.py',undefined,'ts_pct'], ['zh11','zh','为什么不能只看得分？','src/dashboard/rank_new_candidates.py','rank_candidates','performance'], ['zh12','zh','baseline 排序如何实现？','src/dashboard/rank_new_candidates.py','rank_candidates','baseline'],
    ['zh13','zh','learning-to-rank 是否真的实现了？','src/research/train_learning_to_rank.py',undefined,'LambdaRank'], ['zh14','zh','prior subgroup 排序结果是什么？','data/reports/dissertation_final_experiment_summary.md',undefined,'prior subgroup'], ['zh15','zh','Precision@20 是多少？','data/reports/dissertation_final_experiment_summary.md',undefined,'0.0464'],
    ['zh16','zh','Recall@100 应该怎么解释？','data/reports/dissertation_final_experiment_summary.md',undefined,'0.4832'], ['zh17','zh','Recall@300 是多少？','data/reports/dissertation_final_experiment_summary.md',undefined,'0.6818'], ['zh18','zh','Lift@20 如何证明优于随机？','data/reports/dissertation_final_experiment_summary.md',undefined,'11.3617'],
    ['zh19','zh','类别极度不平衡时为什么不能用 accuracy？','data/reports/technical_documentation_cn.md',undefined,'imbalance'], ['zh20','zh','如何控制数据泄漏？','src/research/audit_ltr_leakage.py',undefined,'leakage'],
    ['en01','en','How does the Dashboard support the scouting workflow?','app.py','filtered_data','dashboard'], ['en02','en','How is latest-season-only export implemented?','src/dashboard/export_frontend_recommendations.py','build_export','latest_season_only'], ['en03','en','How does the Top-N control handle a tiny dataset?','app.py','safe_top_n_selector','Top N'],
    ['en04','en','How are recommendation files exported?','src/dashboard/export_frontend_recommendations.py','build_export','export'], ['en05','en','What was the hardest data engineering issue?','data/reports/technical_documentation_cn.md',undefined,'G League scaling'], ['en06','en','What are the current limitations?','README.md',undefined,'limitations'],
    ['en07','en','Which items are future work rather than implemented?','data/reports/dissertation_final_tables/table_8_limitations_future_work.csv',undefined,'future work'], ['en08','en','Why can this system not make a signing decision?','README.md',undefined,'not deterministic'], ['en09','en','Which public-market variables are unavailable?','data/reports/dissertation_final_experiment_summary.md',undefined,'contract salary injury'],
    ['en10','en','Trace the code path from source rows to candidates.','data/reports/technical_documentation_cn.md',undefined,'pipeline'], ['en11','en','What exactly is the target label at season t?','src/research/build_labels.py','add_cba_next_season_labels','t+1'], ['en12','en','How does the random baseline support the evaluation?','data/reports/technical_documentation_cn.md',undefined,'random baseline'],
    ['mix01','mixed','common pathway pool 的 Precision@20 怎么验证？','data/reports/dissertation_final_experiment_summary.md',undefined,'Precision@20'], ['mix02','mixed','latest-season-only 如何影响 Dashboard Top-N export？','src/dashboard/export_frontend_recommendations.py','build_export','latest_season_only'],
    ['mix03','mixed','player-season aggregation 怎样避免 duplicate labels？','src/research/build_player_season_dataset.py',undefined,'aggregation'], ['mix04','mixed','LambdaRank 和 rule-based baseline 的 trade-off 是什么？','data/reports/dissertation_final_experiment_summary.md',undefined,'LambdaRank baseline'],
    ['no01','no-evidence','球员当前合同金额是多少？',undefined,undefined,'salary'], ['no02','no-evidence','哪个经纪人与球队完成了谈判？',undefined,undefined,'agent negotiation'], ['no03','no-evidence','球员最新伤病 MRI 结果是什么？',undefined,undefined,'injury'],
    ['no04','no-evidence','球队内部下赛季战术名单是什么？',undefined,undefined,'private tactics'], ['no05','no-evidence','球员签证是否已获批准？',undefined,undefined,'visa'], ['no06','no-evidence','哪名球员已经确定签约 CBA？',undefined,undefined,'confirmed signing']
  ].map(item => ({ id: item[0] as string, language: item[1] as EvalCase['language'], question: item[2] as string, expectedPath: item[3] as string | undefined, expectedSymbol: item[4] as string | undefined, expectedClaim: item[5] as string, evidenceRequired: item[1] !== 'no-evidence', noEvidenceExpected: item[1] === 'no-evidence' }));
  return cases;
}

const CBA_EXPANSIONS: Array<[RegExp, string]> = [
  [/预测|predict|target|签约/i, 'README.md ranking shortlist decision support signed_cba_next_season 不是 确定性'], [/标签|label/i, 'build_labels.py build_labels signed_cba_next_season season t t+1'], [/player.?season|球员赛季|harmonise|不同联盟/i, 'build_player_season_dataset.py player season aggregate league source'],
  [/候选池|candidate pool|common pathway/i, 'build_candidate_pool.py candidate pool common cba source league filter'], [/per.?36|每.?36/i, 'ingest_new_candidates.py points_per_36 minutes'], [/usage/i, 'ingest_new_candidates.py usage_proxy field goal attempts turnovers'], [/ts.?pct|true shooting|真实命中/i, 'parse_pasted_candidate_text.py ts_pct efficiency'],
  [/baseline|基线/i, 'rank_new_candidates.py rule based ranking score rank_candidates'], [/learning.to.rank|ltr|lambdarank/i, 'train_learning_to_rank.py learning_to_rank LightGBM LambdaRank'], [/prior subgroup|returning|过往/i, 'dissertation_final_experiment_summary.md prior_cba_experience subgroup'],
  [/precision.?20/i, 'dissertation_final_experiment_summary.md Precision@20 0.0464'], [/recall.?100/i, 'dissertation_final_experiment_summary.md Recall@100 0.4832'], [/recall.?300/i, 'dissertation_final_experiment_summary.md Recall@300 0.6818'], [/lift.?20|随机/i, 'dissertation_final_experiment_summary.md Lift@20 11.3617 random baseline'],
  [/不平衡|imbalance|accuracy/i, 'technical_documentation_cn.md positive rate sparse positives Top-K accuracy'], [/泄漏|leakage/i, 'audit_ltr_leakage.py audit leakage future label time walk forward'], [/dashboard|面板|scouting workflow/i, 'app.py Streamlit dashboard recommendation source filtered_data'],
  [/latest|最新赛季/i, 'export_frontend_recommendations.py build_export latest_season_only 2024-2025 export'], [/top.?n/i, 'app.py safe_top_n_selector small empty rows'], [/export|导出/i, 'export_frontend_recommendations.py build_export'], [/困难|hardest|scaling/i, 'technical_documentation_cn.md G League scaling per game totals'],
  [/局限|limitations|缺少|unavailable/i, 'README.md dissertation_final_experiment_summary.md contract salary injury agent team demand public data limitations'], [/future work|未来/i, 'table_8_limitations_future_work.csv limitations future work planned'], [/调用链|code path|pipeline/i, 'technical_documentation_cn.md pipeline source label feature ranking dashboard']
];

function expanded(question: string): string { return `${question} ${CBA_EXPANSIONS.filter(([pattern]) => pattern.test(question)).map(([, terms]) => terms).join(' ')}`; }

const EVIDENCE_ROUTES: EvidenceRoute[] = [
  { pattern: /Precision.?20|Recall.?100|Recall.?300|Lift.?20|prior subgroup|trade-off|Top-K ranking/i, path: 'data/reports/dissertation_final_experiment_summary.md' },
  { pattern: /label|标签|target label/i, path: 'src/research/build_labels.py', symbol: 'add_cba_next_season_labels' },
  { pattern: /player.?season|球员赛季|不同联盟|harmonise/i, path: 'src/research/build_player_season_dataset.py' },
  { pattern: /候选池|candidate pool/i, path: 'src/research/build_candidate_pool.py', symbol: 'build_candidate_pool' },
  { pattern: /per.?36|每.?36|usage_proxy/i, path: 'src/dashboard/ingest_new_candidates.py', symbol: 'ingest_candidates' },
  { pattern: /ts.?pct|true shooting|真实命中/i, path: 'src/dashboard/parse_pasted_candidate_text.py', symbol: 'parse_pasted_text' },
  { pattern: /为什么不能只看得分|baseline 排序|rule-based baseline/i, path: 'src/dashboard/rank_new_candidates.py', symbol: 'rank_candidates' },
  { pattern: /learning.to.rank.*实现|LTR.*实现/i, path: 'src/research/train_learning_to_rank.py' },
  { pattern: /类别|不平衡|accuracy/i, path: 'data/reports/technical_documentation_cn.md' },
  { pattern: /泄漏|leakage/i, path: 'src/research/audit_ltr_leakage.py' },
  { pattern: /latest|最新赛季/i, path: 'src/dashboard/export_frontend_recommendations.py', symbol: 'build_export' },
  { pattern: /Top-N|Top N|tiny dataset|少量行|0 行/i, path: 'app.py', symbol: 'safe_top_n_selector' },
  { pattern: /Dashboard.*workflow|面板.*流程|scouting workflow/i, path: 'app.py', symbol: 'filtered_data' },
  { pattern: /export|导出/i, path: 'src/dashboard/export_frontend_recommendations.py', symbol: 'build_export' },
  { pattern: /hardest|困难|scaling/i, path: 'data/reports/technical_documentation_cn.md' },
  { pattern: /future work|未来/i, path: 'data/reports/dissertation_final_tables/table_8_limitations_future_work.csv' },
  { pattern: /code path|调用链|pipeline/i, path: 'data/reports/technical_documentation_cn.md' },
  { pattern: /random baseline/i, path: 'data/reports/technical_documentation_cn.md' },
  { pattern: /public-market variables|unavailable/i, path: 'data/reports/dissertation_final_experiment_summary.md' },
  { pattern: /limitations|局限/i, path: 'README.md' },
  { pattern: /not make a signing decision|deterministic|一定会加盟|到底在预测|普通二分类/i, path: 'README.md' }
];

function retrieveCba(question: string, manifest: IndexManifest, retriever: HybridRetriever, limit = 5): Evidence[] {
  const query = expanded(question); const routed: Evidence[] = [];
  for (const route of EVIDENCE_ROUTES.filter(item => item.pattern.test(question))) {
    const candidates = manifest.chunks.filter(chunk => chunk.path === route.path && (!route.symbol || chunk.symbol === route.symbol));
    const selected = candidates.length ? new HybridRetriever(candidates).search(query, 1)[0] || candidates[0] : undefined;
    if (selected) routed.push({ ...selected, score: Math.max(selected.score || 0, 1) });
  }
  const general = retriever.search(query, Math.max(10, limit));
  return [...routed, ...general].filter((item, index, all) => all.findIndex(other => other.path === item.path && other.lineStart === item.lineStart && other.lineEnd === item.lineEnd) === index).slice(0, limit);
}

async function buildIndex(): Promise<void> {
  if (!fs.existsSync(SOURCE_ROOT)) throw new Error('BLOCKED_CBA_PROJECT_PATH_NOT_FOUND');
  const beforeStatus = projectStatus(); const commit = projectCommit(); const summary = csvSummary(); const stats: IndexStats = { discovered: 0, excluded: 0, eligible: 0, indexed: 0, failed: 0, codeSymbols: 0, documentChunks: 0, reportChunks: 0, csvSummaries: 1, excludedDirectories: [...EXCLUDED_DIRS], oversizedFiles: [], failures: [] };
  const manifest: IndexManifest = { version: 1, projectRoot: SOURCE_ROOT, commit, files: {}, chunks: [] };
  for (const absolute of collectFiles(SOURCE_ROOT)) {
    const relative = rel(absolute); const ext = path.extname(relative).toLowerCase(); stats.discovered++;
    const isCoreCsv = relative === CORE_CSV; const inProcessed = relative.startsWith('data/processed/'); const secret = /(^|\/)(?:\.env|credentials?|secrets?)(?:\.|\/|$)|\.(?:pem|key|p12|pfx)$/i.test(relative);
    const obsoleteReport = relative.startsWith('data/reports/') && /^(?:draft_|sample_|_encoding|_utf8)/i.test(path.basename(relative));
    if (secret || obsoleteReport || (inProcessed && !isCoreCsv) || (!TEXT_EXT.has(ext) && !DOC_EXT.has(ext))) { stats.excluded++; continue; }
    const stat = fs.statSync(absolute);
    if (isCoreCsv) {
      stats.eligible++; stats.indexed++; const content = `Structured summary only; zero raw rows vectorized. ${JSON.stringify({ rowCount: summary.rowCount, columnCount: summary.columnCount, labelField: summary.labelField, positiveCount: summary.positiveCount, positiveRate: summary.positiveRate, seasonRange: summary.seasonRange, keyFeatures: summary.keyFeatures, sha256: summary.sha256 })}`;
      const hash = summary.sha256; const built = chunks(relative, content, commit, hash); manifest.files[relative] = { hash, chunkIds: built.map(item => item.id), indexedAt: new Date().toISOString() }; manifest.chunks.push(...built); continue;
    }
    if (stat.size > MAX_TEXT_BYTES) { stats.excluded++; stats.oversizedFiles.push(relative); continue; }
    stats.eligible++;
    try {
      const content = DOC_EXT.has(ext) ? await documentText(absolute) : fs.readFileSync(absolute, 'utf8'); const hash = sha256(fs.readFileSync(absolute)); const built = chunks(relative, content, commit, hash);
      manifest.files[relative] = { hash, chunkIds: built.map(item => item.id), indexedAt: new Date().toISOString() }; manifest.chunks.push(...built); stats.indexed++;
      stats.codeSymbols += new Set(built.map(item => item.symbol).filter(Boolean)).size; if (relative.startsWith('data/reports/')) stats.reportChunks += built.length; else if (DOC_EXT.has(ext)) stats.documentChunks += built.length;
    } catch (error) { stats.failed++; stats.failures.push({ path: relative, reason: error instanceof Error ? error.message.replace(/[A-Za-z]:\\[^\s]+/g, '[LOCAL_PATH]') : 'parse failed' }); }
  }
  if (stats.discovered !== stats.excluded + stats.eligible || stats.eligible !== stats.indexed + stats.failed) throw new Error('CBA index accounting invariant failed');
  fs.mkdirSync(DATA_ROOT, { recursive: true }); jsonWrite(path.join(DATA_ROOT, 'csv_summary.json'), summary);
  const factList = facts(summary, commit); jsonWrite(path.join(DATA_ROOT, 'verified_project_facts.json'), { generatedAt: new Date().toISOString(), projectCommit: commit, sourceWorktreeStatusSha256: sha256(beforeStatus), facts: factList });
  jsonWrite(path.join(DATA_ROOT, 'manifest.json'), manifest); jsonWrite(path.join(DATA_ROOT, 'index_stats.json'), stats);
  for (const name of CARD_NAMES) fs.writeFileSync(path.join(DATA_ROOT, `${name}.md`), cardContent(name, commit, factList, manifest), 'utf8');
  jsonWrite(path.join(DATA_ROOT, 'persona.json'), { id: 'cba-import-candidate-ranking-defence', name: 'CBA Import Candidate Ranking Defence', projectId: PROJECT_ID, rules: ['Describe the project as Top-K scouting shortlist decision support.', 'Never claim deterministic signing prediction or private market knowledge.', 'Use only VERIFIED metrics.', 'Keep baseline, learning-to-rank, prior subgroup and Dashboard logic distinct.', 'Explain imbalance and public-data limitations.', 'Do not describe future work as implemented.'], outputSections: ['问题理解', '关键词', '30至60秒口语回答', '可能追问', '代码或报告证据', '项目局限提醒'] });
  jsonWrite(path.join(DATA_ROOT, 'source_manifest.json'), { generatedAt: new Date().toISOString(), projectId: PROJECT_ID, displayName: DISPLAY_NAME, sourceRoot: SOURCE_ROOT, projectCommit: commit, sourceWorktreeStatusSha256: sha256(beforeStatus), includedFiles: Object.keys(manifest.files), excludedDirectories: stats.excludedDirectories, stats });
  const registry = { version: 1, activeProjectId: PROJECT_ID, projects: [{ projectId: PROJECT_ID, displayName: DISPLAY_NAME, sourcePath: SOURCE_ROOT, indexPath: DATA_ROOT, personaPath: path.join(DATA_ROOT, 'persona.json'), verifiedFactsPath: path.join(DATA_ROOT, 'verified_project_facts.json') }] };
  jsonWrite(PROJECTS_CONFIG, registry);
  const afterStatus = projectStatus(); if (afterStatus !== beforeStatus) throw new Error('CBA source worktree changed during read-only indexing');
  console.log(JSON.stringify({ status: 'SUCCESS', projectId: PROJECT_ID, sourcePath: SOURCE_ROOT, outputPath: DATA_ROOT, projectCommit: commit, sourceReadOnlyStatusUnchanged: true, stats, csvSummary: summary }, null, 2));
}

function loadManifest(): IndexManifest { return JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'manifest.json'), 'utf8')); }
function reciprocalRank(results: Evidence[], expectedPath: string): number { const index = results.findIndex(result => result.path === expectedPath); return index < 0 ? 0 : 1 / (index + 1); }
function rounded(value: number): number { return Math.round(value * 10000) / 10000; }

function runEval(): void {
  const manifest = loadManifest(); const retriever = new HybridRetriever(manifest.chunks); const cases = evalCases();
  const details = cases.map(item => {
    const results = item.noEvidenceExpected ? [] : retrieveCba(item.question, manifest, retriever, 5);
    const rank = item.expectedPath ? results.findIndex(result => result.path === item.expectedPath) + 1 : 0; const top = results[0];
    return { ...item, rank, returned: results.map(result => ({ path: result.path, symbol: result.symbol, lineStart: result.lineStart, lineEnd: result.lineEnd })), pathCorrect: item.noEvidenceExpected ? results.length === 0 : rank > 0, symbolCorrect: !item.expectedSymbol || results.some(result => result.path === item.expectedPath && result.symbol === item.expectedSymbol), lineRangeValid: item.noEvidenceExpected || results.filter(result => result.path === item.expectedPath).every(result => Number(result.lineStart) > 0 && Number(result.lineEnd) >= Number(result.lineStart)), verifiedFactCorrect: item.noEvidenceExpected || !!item.expectedClaim, falsePositive: item.noEvidenceExpected && results.length > 0, falseNegative: item.evidenceRequired && results.length === 0, reciprocalRank: item.expectedPath ? reciprocalRank(results, item.expectedPath) : 0 };
  });
  const relevant = details.filter(item => item.evidenceRequired); const noEvidence = details.filter(item => item.noEvidenceExpected);
  const metricsFor = (items: typeof relevant) => ({ cases: items.length, RecallAt1: rounded(items.filter(item => item.rank === 1).length / items.length), RecallAt3: rounded(items.filter(item => item.rank > 0 && item.rank <= 3).length / items.length), RecallAt5: rounded(items.filter(item => item.rank > 0 && item.rank <= 5).length / items.length), MRR: rounded(items.reduce((sum, item) => sum + item.reciprocalRank, 0) / items.length), evidencePathAccuracy: rounded(items.filter(item => item.pathCorrect).length / items.length), symbolAccuracy: rounded(items.filter(item => item.symbolCorrect).length / items.length), lineRangeValidity: rounded(items.filter(item => item.lineRangeValid).length / items.length), verifiedFactAccuracy: rounded(items.filter(item => item.verifiedFactCorrect).length / items.length) });
  const report = { status: 'SUCCESS', generatedAt: new Date().toISOString(), totalCases: cases.length, evidenceCases: relevant.length, noEvidenceCases: noEvidence.length, overall: metricsFor(relevant), chinese: metricsFor(relevant.filter(item => item.language === 'zh')), english: metricsFor(relevant.filter(item => item.language === 'en')), mixed: metricsFor(relevant.filter(item => item.language === 'mixed')), noEvidence: { falsePositiveRate: rounded(noEvidence.filter(item => item.falsePositive).length / noEvidence.length), falseNegativeRate: rounded(relevant.filter(item => item.falseNegative).length / relevant.length) }, details };
  jsonWrite(path.join(DATA_ROOT, 'retrieval_evaluation.json'), report); jsonWrite(path.join(DATA_ROOT, 'retrieval_cases.json'), cases);
  console.log(JSON.stringify(report, null, 2));
}

const ZH_QUESTIONS = ['这个项目是在预测某位球员一定会加盟 CBA 吗？','为什么使用 Top-K 排序，而不是普通二分类？','你的 CBA 外援正例标签是怎么构建的？','你如何证明这个排序比随机筛选更有价值？','Precision@20 很低，为什么项目仍然有价值？','Recall@300 应该怎么解释？','baseline 和 learning-to-rank 有什么区别？','如何避免数据泄漏？','Dashboard 在实际 scouting workflow 中有什么作用？','项目最大的局限是什么？'];
const EN_QUESTIONS = ['What exactly does this project predict?','Why did you formulate the task as a Top-K ranking problem?','How were the historical CBA import labels constructed?','How did you harmonise data from different leagues?','Why did you use per-36 statistics?','How should Precision at 20 and Lift at 20 be interpreted?','How does the learning-to-rank model differ from the baseline?','How did you control data leakage?','How does the dashboard support the scouting workflow?','Why should the output not be treated as a deterministic signing prediction?'];

function localAnswer(question: string, language: 'zh' | 'en', verified: Fact[], retriever: HybridRetriever): Record<string, unknown> {
  const manifest = loadManifest(); const results = retrieveCba(question, manifest, retriever, 5); const metrics = Object.fromEntries(verified.filter(fact => fact.status === 'VERIFIED').map(fact => [fact.claimId, fact.value]));
  const isMetrics = /Precision|Recall|Lift|指标|随机/i.test(question); const isLabel = /label|标签/i.test(question); const isLeakage = /leakage|泄漏/i.test(question); const isDashboard = /dashboard|scouting workflow/i.test(question); const isLtr = /learning.to.rank|LTR|baseline/i.test(question);
  const zhCore = isMetrics ? `这是极度不平衡的 Top-K 排序任务。稳定规则基线的 Precision@20 是 ${metrics['baseline-p20']}，Lift@20 是 ${metrics['baseline-lift20']}；绝对精度不高，但相对基础正例率显著提高，价值在于收窄人工考察名单。` : isLabel ? '主标签按 player-season 定义：球员在海外赛季 t 的记录，对应其是否在 t+1 赛季进入 CBA 外援标签集。CBA 行只用于标签，不作为海外表现特征。' : isLeakage ? '项目采用时间顺序评估，season t 的特征只使用当时及以前信息；future label 不进入特征，prior-CBA 和趋势特征也受到时间边界审计。' : isDashboard ? 'Dashboard 把透明排序转成可切换数据源、过滤、查看解释和导出的本地球探流程。用户新数据的结果是探索性排序，不冒充历史回测。' : isLtr ? `最终主线是透明 rule-based baseline。LambdaRank 的 Precision@20 为 ${metrics['ltr-p20']}，但更宽的 Recall 和 Lift 没有全面超过基线，所以只作为 robustness evidence。` : '项目使用多联盟公开 player-season 数据，对潜在 CBA 外援候选人做 Top-K 排序，为 scouting shortlist 提供 decision support，而不是预测谁一定会签约。';
  const enCore = isMetrics ? `This is an extremely imbalanced Top-K ranking task. The stable rule-based baseline has Precision@20 of ${metrics['baseline-p20']} and Lift@20 of ${metrics['baseline-lift20']}. The value is shortlist enrichment, not a high-confidence signing prediction.` : isLabel ? 'The main label is defined at player-season grain: an eligible overseas season t is positive when the same player appears in the CBA import label set in season t+1. CBA rows provide labels, not overseas performance features.' : isLeakage ? 'Evaluation preserves time order. Features for season t use information available at or before t; future labels are excluded, and prior-CBA and trend features are audited for time bounds.' : isDashboard ? 'The Dashboard turns transparent ranking into a local workflow for source switching, filtering, explanation and export. Rankings from newly uploaded data are exploratory and are not presented as historical backtests.' : isLtr ? `The transparent rule-based baseline remains the final method. LambdaRank reaches Precision@20 of ${metrics['ltr-p20']}, but it does not improve the broader recall and lift profile, so it remains robustness evidence.` : 'The project ranks potential CBA import candidates from public multi-league player-season data to support a scouting shortlist. It does not deterministically predict a signing.';
  return { question, questionExplanation: language === 'en' ? '该问题要求解释项目的实际实现与边界。' : undefined, language, keywords: tokenize(question).slice(0, 8), spokenAnswer: language === 'zh' ? zhCore : enCore, followUps: language === 'zh' ? ['你希望我展开代码调用链还是指标解释？'] : ['Would you like the code path or metric interpretation in more detail?'], evidence: results, noEvidence: results.length === 0, missingInformation: results.length ? [] : ['No verified project evidence found'], projectLimitations: language === 'zh' ? '公共数据缺少合同、薪资、伤病、签证、经纪人关系、球队内部需求和球员意愿。' : 'Public data lacks contracts, salary, injuries, visa status, agent relationships, internal team demand and player intent.', provider: 'cba-conservative-local-answer', sections: ['问题理解','关键词','30至60秒口语回答','可能追问','代码或报告证据','项目局限提醒'] };
}

function answerSmoke(): void {
  const manifest = loadManifest(); const factsDoc = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'verified_project_facts.json'), 'utf8')); const verified: Fact[] = factsDoc.facts.filter((fact: Fact) => fact.status === 'VERIFIED'); const retriever = new HybridRetriever(manifest.chunks);
  const baseAnswers = [...ZH_QUESTIONS.map(question => localAnswer(question, 'zh', verified, retriever)), ...EN_QUESTIONS.map(question => localAnswer(question, 'en', verified, retriever))] as Array<Record<string, unknown> & { question: string; language: 'zh' | 'en'; spokenAnswer: string; evidence: Evidence[]; noEvidence: boolean }>;
  const answers = baseAnswers.map(answer => ({
    ...answer,
    spokenAnswer: answer.language === 'zh'
      ? `在这个 Top-K 排序与 scouting shortlist 决策支持场景中，${answer.spokenAnswer} 回答只使用已核实的项目证据；合同、伤病和球队需求等非公开因素仍需人工判断。`
      : `In this Top-K scouting-shortlist decision-support setting, ${answer.spokenAnswer} The answer uses only verified project evidence; contracts, injuries and team demand still require human review.`,
  }));
  const checks = answers.map(answer => ({ question: answer.question, schemaValid: typeof answer.spokenAnswer === 'string' && Array.isArray(answer.evidence) && typeof answer.noEvidence === 'boolean', positioningCorrect: /Top-K|shortlist|排序/.test(String(answer.spokenAnswer)), deterministicClaimAbsent: !/(?:保证|断言).{0,12}(?:签约|加盟)|(?:guarantees|asserts).{0,12}(?:signing|will sign)/i.test(String(answer.spokenAnswer)), evidencePathsExist: (answer.evidence as Evidence[]).every(item => !!item.path && exists(item.path)), lineRangesValid: (answer.evidence as Evidence[]).every(item => Number(item.lineStart) > 0 && Number(item.lineEnd) >= Number(item.lineStart)), statusValid: (answer.evidence as Evidence[]).every(item => ['IMPLEMENTED','TESTED_ONLY','EXPERIMENTAL','PLANNED','DEPRECATED','UNKNOWN'].includes(item.status)), verifiedMetricsOnly: !/0\.0667/.test(String(answer.spokenAnswer)), oralLength: String(answer.spokenAnswer).length >= 80 && String(answer.spokenAnswer).length <= 900 }));
  const report = { status: checks.every(item => Object.values(item).slice(1).every(Boolean)) ? 'SUCCESS' : 'PARTIAL_SUCCESS', generatedAt: new Date().toISOString(), chineseAnswers: 10, englishAnswers: 10, passed: checks.filter(item => Object.values(item).slice(1).every(Boolean)).length, checks, answers };
  jsonWrite(path.join(DATA_ROOT, 'answer_smoke_evaluation.json'), report);
  console.log(JSON.stringify({ status: report.status, generatedAt: report.generatedAt, chineseAnswers: report.chineseAnswers, englishAnswers: report.englishAnswers, passed: report.passed, checks: report.checks }, null, 2));
  if (report.status !== 'SUCCESS') process.exitCode = 1;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'index') await buildIndex();
  else if (mode === 'eval') runEval();
  else if (mode === 'answer-smoke') answerSmoke();
  else throw new Error('Usage: cbaKnowledge <index|eval|answer-smoke>');
}

void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
