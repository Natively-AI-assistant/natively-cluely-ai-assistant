import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateQuality, aggregateCoding, aggregateLatencyCost, renderMarkdownReport } from './lib/aggregate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadJson(name, fallback) {
  const p = path.join(RESULTS_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
}

function categoryByPromptFromFixtures() {
  const map = {};
  for (const file of ['meeting.json', 'technical-interview.json', 'sales.json', 'recruiting.json', 'general.json']) {
    for (const entry of JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'))) {
      map[entry.id] = entry.category;
    }
  }
  return map;
}

function main() {
  const raw = loadJson('raw-latest.json', []);
  const coding = loadJson('coding-latest.json', []);
  const judged = loadJson('judged-latest.json', { perPrompt: [], contested: [] });

  const categoryByPrompt = categoryByPromptFromFixtures();
  const quality = aggregateQuality(judged.perPrompt, categoryByPrompt);
  const codingAgg = aggregateCoding(coding);
  const latencyCost = aggregateLatencyCost(raw);

  const md = renderMarkdownReport({ quality, coding: codingAgg, latencyCost, contested: judged.contested });
  const outPath = path.join(RESULTS_DIR, 'report-latest.md');
  fs.writeFileSync(outPath, md);
  console.log(`Wrote report to ${outPath}`);
  console.log(md);
}

main();
