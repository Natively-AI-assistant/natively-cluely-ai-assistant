// benchmarks/deepseek-vs-gemini/run-raw-comparison.mjs
//
// Direct-API comparison of deepseek-v4-flash vs gemini-3.6-flash vs
// gemini-3.1-flash-lite across the 5 open-ended fixture categories. Does NOT
// touch Natively's production pipeline — see docs/superpowers/specs/
// 2026-08-01-deepseek-vs-gemini-benchmark-design.md.
//
// Usage:
//   node benchmarks/deepseek-vs-gemini/run-raw-comparison.mjs --dry-run
//   node benchmarks/deepseek-vs-gemini/run-raw-comparison.mjs --confirm [--sample=N] [--concurrency=4] [--only=deepseek-v4-flash]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/cli-args.mjs';
import { estimateRunCost, costFor } from './lib/pricing.mjs';
import { pendingWork } from './lib/resumability.mjs';
import { runWithConcurrency } from './lib/concurrency.mjs';
import { createDeepseekClient, createGeminiClient, callDeepseek, callGemini } from './lib/clients.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RESULTS_DIR = path.join(__dirname, 'results');
const CATEGORY_FILES = ['meeting.json', 'technical-interview.json', 'sales.json', 'recruiting.json', 'general.json'];
const ALL_MODELS = ['deepseek-v4-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'];
const SYSTEM_PROMPT = 'You are a helpful assistant embedded in a live meeting/call. Answer the question directly using the provided context. Be concise and actionable.';

function loadFixtures(sampleCap) {
  let all = [];
  for (const file of CATEGORY_FILES) {
    const entries = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
    all = all.concat(sampleCap ? entries.slice(0, sampleCap) : entries);
  }
  return all;
}

function loadExistingResults(resultsPath) {
  if (!fs.existsSync(resultsPath)) return [];
  return JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelIds = args.only || ALL_MODELS;
  const fixtures = loadFixtures(args.sample);
  const byId = new Map(fixtures.map((f) => [f.id, f]));

  const AVG_INPUT_TOKENS = 600;
  const AVG_OUTPUT_TOKENS = 350;
  const estimate = estimateRunCost(modelIds, fixtures.length, AVG_INPUT_TOKENS, AVG_OUTPUT_TOKENS);
  console.log(`Fixtures: ${fixtures.length} prompts x ${modelIds.length} models = ${fixtures.length * modelIds.length} calls`);
  console.log(`Estimated cost (rough, ${AVG_INPUT_TOKENS}in/${AVG_OUTPUT_TOKENS}out avg): $${estimate.toFixed(4)}`);

  if (args.dryRun) {
    console.log('--dry-run: exiting without making any calls.');
    return;
  }
  if (!args.confirm) {
    console.log('Pass --confirm to proceed with real API calls (or --dry-run to just preview cost).');
    process.exit(1);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const resultsPath = path.join(RESULTS_DIR, 'raw-latest.json');
  const existing = loadExistingResults(resultsPath);
  const promptIds = fixtures.map((f) => f.id);
  const pending = pendingWork(promptIds, modelIds, existing);
  console.log(`${pending.length} of ${promptIds.length * modelIds.length} (model, prompt) pairs pending.`);

  const deepseekClient = createDeepseekClient(process.env.DEEPSEEK_API_KEY);
  const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY);

  const results = existing.slice();
  const tasks = pending.map(({ promptId, modelId }) => async () => {
    const fixture = byId.get(promptId);
    const userPrompt = `Context:\n${fixture.context}\n\nQuestion: ${fixture.question}`;
    const call = modelId === 'deepseek-v4-flash'
      ? await callDeepseek(deepseekClient, { model: modelId, systemPrompt: SYSTEM_PROMPT, userPrompt })
      : await callGemini(geminiClient, { model: modelId, systemPrompt: SYSTEM_PROMPT, userPrompt });
    const costUsd = call.error ? 0 : costFor(modelId, call.inputTokens, call.outputTokens);
    const record = { promptId, category: fixture.category, modelId, ...call, costUsd };
    results.push(record);
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`[${modelId}] ${promptId}: ${call.error ? `ERROR ${call.error}` : `${call.latencyMs}ms, $${costUsd.toFixed(6)}`}`);
    return record;
  });

  await runWithConcurrency(tasks, args.concurrency);
  console.log(`Done. Wrote ${results.length} results to ${resultsPath}`);
}

main();
