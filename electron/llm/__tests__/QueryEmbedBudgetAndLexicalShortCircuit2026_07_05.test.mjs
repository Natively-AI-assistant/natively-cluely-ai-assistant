/**
 * Profile Intelligence production-fix ROUND 2 (2026-07-05, RC5).
 *
 * 1. Cloud query embed budget: KnowledgeOrchestrator.cloudQueryEmbedder wraps
 *    the raw embed fn in a 300ms Promise.race — a provider 429/cooldown used
 *    to stall processQuestion for ~2s (real-session evidence: "+1986ms
 *    processQuestion DONE" right after "[GeminiEmbeddingProvider] key #3
 *    rate-limited (429)"). Past the budget the embed resolves [] and
 *    HybridSearchEngine degrades to keyword-only scoring.
 *
 * 2. Lexical retriever short-circuit: ModeContextRetriever.retrieve() returns
 *    the canonical empty result immediately when there are no reference files
 *    AND no retrievable customContext — the session log showed the full
 *    lexical pipeline (planner/rescue-gate traces) running on EVERY manual
 *    profile question with fileCount: 0.
 *
 * Source-pin tests (the orchestrator needs a live DB; behavior verified
 * manually via the harness — stalled 5000ms embed → 336ms processQuestion).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const orchSrc = readFileSync(path.resolve(__dirname, '../../../premium/electron/knowledge/KnowledgeOrchestrator.ts'), 'utf8');
const retrieverSrc = readFileSync(path.resolve(__dirname, '../../services/ModeContextRetriever.ts'), 'utf8');

describe('RC5: cloud query embed is budgeted on the hot path', () => {
  test('cloudQueryEmbedder wraps the raw fn in a Promise.race with QUERY_EMBED_BUDGET_MS', () => {
    const fn = orchSrc.slice(orchSrc.indexOf('private cloudQueryEmbedder'), orchSrc.indexOf('private resolveQueryEmbedder'));
    assert.match(fn, /QUERY_EMBED_BUDGET_MS = 300/);
    assert.match(fn, /Promise\.race\(/);
    assert.match(fn, /setTimeout\(\(\) => resolve\(\[\]\), QUERY_EMBED_BUDGET_MS\)/);
  });

  test('budget miss resolves [] (keyword-only degradation), never throws into the hot path', () => {
    const fn = orchSrc.slice(orchSrc.indexOf('private cloudQueryEmbedder'), orchSrc.indexOf('private resolveQueryEmbedder'));
    assert.match(fn, /catch\s*\{\s*return \[\];/);
  });
});

describe('RC5: lexical retriever short-circuits with nothing to retrieve', () => {
  test('retrieve() returns the empty result before any chunking when no files and no customContext', () => {
    const fn = retrieverSrc.slice(retrieverSrc.indexOf('retrieve(mode: Mode'), retrieverSrc.indexOf('retrieve(mode: Mode') + 3000);
    const shortCircuitIdx = fn.indexOf('!hasReferenceFiles && !hasRetrievableCustomContext');
    const diagIdx = fn.indexOf('LEXICAL retrieve() entry');
    assert.ok(shortCircuitIdx !== -1, 'short-circuit must exist');
    assert.ok(diagIdx !== -1, 'diag trace must still exist for the non-empty path');
    assert.ok(shortCircuitIdx < diagIdx, 'short-circuit must run BEFORE the expensive diag/chunking work');
  });

  test('customContext still runs the full path (no over-correction)', () => {
    assert.match(retrieverSrc, /hasRetrievableCustomContext = !options\.excludeCustomContext && !!\(mode\.customContext \|\| ''\)\.trim\(\)/);
  });
});
