// tests/utils/generateModesLive.mjs
//
// Phase 2 live generator: drives all 10 mission briefs through the REAL
// ModeGenerator pipeline, whose LLM call hits the locally-running natively-api
// backend (MiniMax-M3 via NATIVELY_FORCE_PRIMARY_GEN=minimax + local-test auth).
//
// This is NOT a unit test — it makes real network calls to real MiniMax. It
// writes the 10 generated modes + a validation report to
// test-results/modes-autopilot/generated-modes/.
//
// Env:
//   NATIVELY_API_BASE          (default http://localhost:3000)
//   NATIVELY_LOCAL_TEST_TOKEN  (default local-test) — matches server bypass
//   MODEGEN_OUT_DIR            (default test-results/modes-autopilot/generated-modes)
//
// Usage:
//   node tests/utils/generateModesLive.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODE_BRIEFS } from './modeBriefs.mjs';
import {
  generateMode,
  validateDraft,
  checkDistinctiveness,
} from '../../dist-electron/electron/services/ModeGenerator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const API_BASE = process.env.NATIVELY_API_BASE || 'http://localhost:3000';
const LOCAL_TOKEN = process.env.NATIVELY_LOCAL_TEST_TOKEN || 'local-test';
const OUT_DIR = process.env.MODEGEN_OUT_DIR || path.join(REPO, 'test-results/modes-autopilot/generated-modes');

fs.mkdirSync(OUT_DIR, { recursive: true });

// Real LLM call → local backend → MiniMax-M3. The backend forces MiniMax primary.
async function backendComplete(system, user) {
  const res = await fetch(`${API_BASE}/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-natively-local-test': LOCAL_TOKEN,
    },
    body: JSON.stringify({
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`backend /v1/chat HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.model && !/minimax/i.test(data.model)) {
    // Not fatal to generation, but the mission requires MiniMax — surface it loudly.
    console.warn(`[generateModesLive] WARNING: generation served by non-MiniMax model "${data.model}" (gen-pin fallback occurred)`);
  }
  return { text: data.content || '', model: data.model || 'unknown' };
}

async function main() {
  const results = [];
  const drafts = [];
  const modelsSeen = new Set();

  for (const brief of MODE_BRIEFS) {
    const started = Date.now();
    let lastModel = 'unknown';
    const completeTracking = async (system, user) => {
      const { text, model } = await backendComplete(system, user);
      lastModel = model;
      modelsSeen.add(model);
      return text;
    };
    try {
      const { draft, attempts, issues } = await generateMode(brief, completeTracking);
      const errors = issues.filter((i) => i.severity === 'error');
      const rec = {
        key: brief.key,
        ok: errors.length === 0,
        attempts,
        model: lastModel,
        durationMs: Date.now() - started,
        name: draft.name,
        templateType: draft.templateType,
        documentGrounded: draft.documentGrounded,
        requiresGrounding: brief.requiresGrounding,
        customContextLength: draft.customContext.length,
        issues,
        customContext: draft.customContext,
      };
      results.push(rec);
      drafts.push(draft);
      // Persist the individual mode artifact (raw model output + normalized draft).
      fs.writeFileSync(
        path.join(OUT_DIR, `${brief.key}.json`),
        JSON.stringify({ brief, draft, attempts, issues, model: lastModel }, null, 2),
      );
      console.log(
        `[gen] ${brief.key.padEnd(20)} ok=${rec.ok} attempts=${attempts} model=${lastModel} ` +
          `grounded=${draft.documentGrounded}(req=${brief.requiresGrounding}) len=${rec.customContextLength} ${rec.durationMs}ms`,
      );
    } catch (e) {
      const rec = {
        key: brief.key,
        ok: false,
        model: lastModel,
        durationMs: Date.now() - started,
        error: String(e.message || e),
      };
      results.push(rec);
      console.error(`[gen] ${brief.key} FAILED: ${rec.error}`);
    }
  }

  // Distinctiveness across all successfully generated drafts.
  const distinct = drafts.length >= 2 ? checkDistinctiveness(drafts, 0.6) : { maxPairSimilarity: 0, nearDuplicates: [] };

  const summary = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    total: MODE_BRIEFS.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    modelsSeen: [...modelsSeen],
    allMiniMax: [...modelsSeen].every((m) => /minimax/i.test(m)),
    distinctiveness: distinct,
    groundingCorrect: results.every((r) =>
      r.error ? false : r.requiresGrounding ? r.documentGrounded === true : true,
    ),
    results,
  };
  fs.writeFileSync(path.join(OUT_DIR, '_generation-report.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== GENERATION SUMMARY ===');
  console.log(`succeeded: ${summary.succeeded}/${summary.total}`);
  console.log(`models seen: ${summary.modelsSeen.join(', ')} (allMiniMax=${summary.allMiniMax})`);
  console.log(`max pairwise similarity: ${distinct.maxPairSimilarity.toFixed(3)} (threshold 0.6)`);
  console.log(`near-duplicates: ${distinct.nearDuplicates.length}`);
  console.log(`grounding correct: ${summary.groundingCorrect}`);
  console.log(`report: ${path.join(OUT_DIR, '_generation-report.json')}`);

  // Exit non-zero if the run doesn't meet Phase-2 bar so the caller can loop.
  const clean =
    summary.succeeded === summary.total &&
    summary.allMiniMax &&
    distinct.nearDuplicates.length === 0 &&
    summary.groundingCorrect;
  process.exit(clean ? 0 : 1);
}

main().catch((e) => {
  console.error('generateModesLive fatal:', e);
  process.exit(2);
});
