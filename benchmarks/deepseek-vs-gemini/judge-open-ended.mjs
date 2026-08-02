// Two-step because plain Node scripts cannot call the Agent tool directly:
//   1. `node judge-open-ended.mjs --prepare` writes results/judge-batches.json
//      (anonymized batches) — the operating Claude Code session then dispatches
//      each batch to a Claude subagent via the Agent tool with the rubric below,
//      and saves each structured reply to results/judge-raw-replies/<i>.json.
//   2. `node judge-open-ended.mjs --aggregate` folds those replies into
//      results/judged-latest.json and prints the contested-pairs list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJudgeBatches, parseJudgeScores, flagContested } from './lib/judge-batching.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const REPLIES_DIR = path.join(RESULTS_DIR, 'judge-raw-replies');
const BATCH_SIZE = 12;

export const RUBRIC_INSTRUCTIONS = `You are judging anonymized AI assistant responses for quality. For each prompt you'll see 2-3 responses labeled "Response 1"/"Response 2"/etc (order is randomized, labels carry no meaning). Score EACH response 1-5 on:
- correctness: is it accurate and grounded in the given context (no fabrication)?
- completeness: does it fully answer what was asked?
- actionability: is it clear, well-organized, and immediately useful in a live meeting/call?
Return strict JSON: { "<promptId>": { "<label>": { "correctness": N, "completeness": N, "actionability": N, "rationale": "one sentence" }, ... }, ... }`;

function prepare() {
  const raw = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'raw-latest.json'), 'utf8'));
  // NOTE: answersByPrompt (letter -> modelId) is kept separate from textsByPrompt
  // (__text_<letter> -> answer text) because buildJudgeBatches() derives its
  // model-slot list from Object.keys(answersByPrompt[promptId]) — mixing the two
  // into one object would make the __text_ entries look like extra "models".
  // The two are merged only in the serialized judge-batches.json for the
  // operator's promptId+model -> text lookup during Step 7 dispatch.
  const answersByPrompt = {};
  const textsByPrompt = {};
  for (const r of raw.filter((r) => !r.error)) {
    answersByPrompt[r.promptId] = answersByPrompt[r.promptId] || {};
    textsByPrompt[r.promptId] = textsByPrompt[r.promptId] || {};
    const letter = String.fromCharCode(65 + Object.keys(answersByPrompt[r.promptId]).length);
    answersByPrompt[r.promptId][letter] = r.modelId;
    textsByPrompt[r.promptId][`__text_${letter}`] = r.text;
  }
  const batches = buildJudgeBatches(answersByPrompt, BATCH_SIZE, 12345);
  const serializedAnswersByPrompt = {};
  for (const promptId of Object.keys(answersByPrompt)) {
    serializedAnswersByPrompt[promptId] = { ...answersByPrompt[promptId], ...textsByPrompt[promptId] };
  }
  fs.writeFileSync(path.join(RESULTS_DIR, 'judge-batches.json'), JSON.stringify({ answersByPrompt: serializedAnswersByPrompt, batches }, null, 2));
  fs.mkdirSync(REPLIES_DIR, { recursive: true });
  console.log(`Wrote ${batches.length} batches to results/judge-batches.json.`);
  console.log(`Rubric to send with each batch:\n${RUBRIC_INSTRUCTIONS}`);
  console.log(`Save each batch's structured reply JSON to results/judge-raw-replies/<batchIndex>.json, then run --aggregate.`);
}

function aggregate() {
  const { answersByPrompt, batches } = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'judge-batches.json'), 'utf8'));
  const allScored = [];
  batches.forEach((batch, i) => {
    const replyPath = path.join(REPLIES_DIR, `${i}.json`);
    if (!fs.existsSync(replyPath)) { console.warn(`Missing reply for batch ${i}, skipping.`); return; }
    const reply = JSON.parse(fs.readFileSync(replyPath, 'utf8'));
    allScored.push(...parseJudgeScores(reply, batch));
  });

  const byPrompt = {};
  for (const s of allScored) {
    byPrompt[s.promptId] = byPrompt[s.promptId] || { promptId: s.promptId, totalsByModel: {}, detail: [] };
    const total = (s.scores.correctness || 0) + (s.scores.completeness || 0) + (s.scores.actionability || 0);
    byPrompt[s.promptId].totalsByModel[s.modelId] = total;
    byPrompt[s.promptId].detail.push(s);
  }
  const perPrompt = Object.values(byPrompt);
  const contested = flagContested(perPrompt, 20);

  fs.writeFileSync(path.join(RESULTS_DIR, 'judged-latest.json'), JSON.stringify({ perPrompt, contested }, null, 2));
  console.log(`Aggregated ${allScored.length} scored answers across ${perPrompt.length} prompts.`);
  console.log(`Flagged ${contested.length} contested pairs for manual review — see results/judged-latest.json .contested`);
}

const mode = process.argv[2];
if (mode === '--prepare') prepare();
else if (mode === '--aggregate') aggregate();
else { console.log('Usage: node judge-open-ended.mjs --prepare | --aggregate'); process.exit(1); }
