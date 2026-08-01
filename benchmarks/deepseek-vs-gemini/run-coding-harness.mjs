// benchmarks/deepseek-vs-gemini/run-coding-harness.mjs
//
// Runs the coding.json problems against all 3 models, executes JS/TS/Python
// answers locally against embedded test cases, and scores pass/fail. Go/SQL
// problems (execution:false) are recorded with raw text only, to be scored
// by the judge pipeline (judge-open-ended.mjs) instead — see the plan's
// Global Constraints for why execution isn't attempted for those languages.
//
// Usage:
//   node benchmarks/deepseek-vs-gemini/run-coding-harness.mjs --dry-run
//   node benchmarks/deepseek-vs-gemini/run-coding-harness.mjs --confirm [--sample=N] [--concurrency=4] [--only=deepseek-v4-flash]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/cli-args.mjs';
import { extractCode } from './lib/coding-extract.mjs';
import { pendingWork } from './lib/resumability.mjs';
import { runWithConcurrency } from './lib/concurrency.mjs';
import { createDeepseekClient, createGeminiClient, callDeepseek, callGemini } from './lib/clients.mjs';
import { upsertResult } from './lib/results.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RESULTS_DIR = path.join(__dirname, 'results');
const ALL_MODELS = ['deepseek-v4-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'];
const SYSTEM_PROMPT = 'You are an expert programmer. Respond with a single fenced code block containing only the requested function, no explanation.';

function runSubprocess(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => resolve({ code: -1, stdout: '', stderr: String(err) }));
  });
}

function buildJsHarness(code, functionName, testCases) {
  return `${code}\nconst testCases = ${JSON.stringify(testCases)};\nconst out = testCases.map(tc => {\n  try { return { actual: ${functionName}(...tc.input) }; }\n  catch (e) { return { error: String(e) }; }\n});\nconsole.log(JSON.stringify(out));\n`;
}

function buildPyHarness(code, functionName, testCases) {
  return `${code}\nimport json\ntest_cases = json.loads('''${JSON.stringify(testCases)}''')\nout = []\nfor tc in test_cases:\n    try:\n        out.append({"actual": ${functionName}(*tc["input"])})\n    except Exception as e:\n        out.append({"error": str(e)})\nprint(json.dumps(out))\n`;
}

export async function executeAndScore(problem, extractedCode) {
  if (extractedCode == null) {
    return { passCount: 0, totalCount: problem.test_cases.length, error: 'no code extracted from response' };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-vs-gemini-coding-'));
  try {
    let run;
    if (problem.language === 'javascript') {
      const file = path.join(tmpDir, 'harness.mjs');
      fs.writeFileSync(file, buildJsHarness(extractedCode, problem.function_name, problem.test_cases));
      run = await runSubprocess('node', [file]);
    } else if (problem.language === 'typescript') {
      // TS answers may contain real type annotations that plain `node` can't parse.
      // Write as .ts and run with Node's built-in type-stripping (same convention as
      // package.json's test:lib / eval:intelligence:ui / benchmark:l4-aggregate scripts).
      const file = path.join(tmpDir, 'harness.ts');
      fs.writeFileSync(file, buildJsHarness(extractedCode, problem.function_name, problem.test_cases));
      run = await runSubprocess('node', ['--experimental-strip-types', file]);
    } else if (problem.language === 'python') {
      const file = path.join(tmpDir, 'harness.py');
      fs.writeFileSync(file, buildPyHarness(extractedCode, problem.function_name, problem.test_cases));
      run = await runSubprocess('python3', [file]);
    } else {
      return { passCount: 0, totalCount: problem.test_cases.length, error: `unsupported execution language ${problem.language}` };
    }
    if (run.code !== 0) {
      return { passCount: 0, totalCount: problem.test_cases.length, error: run.stderr.slice(0, 500) || `exit ${run.code}` };
    }
    let parsed;
    try {
      parsed = JSON.parse(run.stdout.trim());
    } catch {
      return { passCount: 0, totalCount: problem.test_cases.length, error: `unparseable output: ${run.stdout.slice(0, 300)}` };
    }
    let passCount = 0;
    for (let i = 0; i < problem.test_cases.length; i++) {
      const r = parsed[i] || {};
      if (!('error' in r) && JSON.stringify(r.actual) === JSON.stringify(problem.test_cases[i].expected)) passCount++;
    }
    return { passCount, totalCount: problem.test_cases.length, error: null };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelIds = args.only || ALL_MODELS;
  let problems = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'coding.json'), 'utf8'));
  if (args.sample) problems = problems.slice(0, args.sample);

  console.log(`Coding problems: ${problems.length} x ${modelIds.length} models = ${problems.length * modelIds.length} calls`);
  if (args.dryRun) { console.log('--dry-run: exiting without making any calls.'); return; }
  if (!args.confirm) { console.log('Pass --confirm to proceed (or --dry-run to preview).'); process.exit(1); }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const resultsPath = path.join(RESULTS_DIR, 'coding-latest.json');
  const existing = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : [];
  const pending = pendingWork(problems.map((p) => p.id), modelIds, existing.map((r) => ({ promptId: r.problemId, modelId: r.modelId, error: r.error })));

  const byId = new Map(problems.map((p) => [p.id, p]));
  const deepseekClient = createDeepseekClient(process.env.DEEPSEEK_API_KEY);
  const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY);
  let results = existing.slice();

  const tasks = pending.map(({ promptId, modelId }) => async () => {
    const problem = byId.get(promptId);
    const userPrompt = `${problem.prompt}\n\nWrite the function named exactly "${problem.function_name || 'solve'}".`;
    const call = modelId === 'deepseek-v4-flash'
      ? await callDeepseek(deepseekClient, { model: modelId, systemPrompt: SYSTEM_PROMPT, userPrompt })
      : await callGemini(geminiClient, { model: modelId, systemPrompt: SYSTEM_PROMPT, userPrompt });

    let scored = { passCount: null, totalCount: null, error: call.error };
    if (!call.error && problem.execution) {
      const code = extractCode(call.text, problem.language);
      scored = await executeAndScore(problem, code);
    }
    const record = {
      problemId: promptId, modelId, difficulty: problem.difficulty, language: problem.language,
      execution: problem.execution, rawText: call.text, ...scored,
    };
    results = upsertResult(results, record, 'problemId');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`[${modelId}] ${promptId}: ${scored.error ? `ERROR ${scored.error}` : problem.execution ? `${scored.passCount}/${scored.totalCount}` : 'unexecuted (judge pipeline)'}`);
    return record;
  });

  await runWithConcurrency(tasks, args.concurrency);
  console.log(`Done. Wrote ${results.length} results to ${resultsPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
