// benchmarks/deepseek-vs-gemini/fixtures/check-coding-fixtures.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function runSubprocess(command, args, input, timeoutMs = 5000) {
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
  return `
${code}
const testCases = ${JSON.stringify(testCases)};
const out = testCases.map(tc => {
  try {
    const actual = ${functionName}(...tc.input);
    return { actual };
  } catch (e) {
    return { error: String(e) };
  }
});
console.log(JSON.stringify(out));
`;
}

function buildPyHarness(code, functionName, testCases) {
  return `
${code}
import json
test_cases = json.loads('''${JSON.stringify(testCases)}''')
out = []
for tc in test_cases:
    try:
        actual = ${functionName}(*tc["input"])
        out.append({"actual": actual})
    except Exception as e:
        out.append({"error": str(e)})
print(json.dumps(out))
`;
}

async function executeCode(language, code, functionName, testCases) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-vs-gemini-'));
  try {
    if (language === 'javascript' || language === 'typescript') {
      const file = path.join(tmpDir, 'harness.mjs');
      fs.writeFileSync(file, buildJsHarness(code, functionName, testCases));
      return await runSubprocess('node', [file], '');
    }
    if (language === 'python') {
      const file = path.join(tmpDir, 'harness.py');
      fs.writeFileSync(file, buildPyHarness(code, functionName, testCases));
      return await runSubprocess('python3', [file], '');
    }
    return { code: -1, stdout: '', stderr: `unsupported execution language: ${language}` };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function runReferenceSolution(problem) {
  const { code, stdout, stderr } = await executeCode(
    problem.language,
    problem.reference_solution,
    problem.function_name,
    problem.test_cases,
  );
  if (code !== 0) {
    return {
      pass: false,
      results: problem.test_cases.map((tc) => ({ input: tc.input, expected: tc.expected, actual: null, ok: false, error: stderr || `exit code ${code}` })),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return {
      pass: false,
      results: problem.test_cases.map((tc) => ({ input: tc.input, expected: tc.expected, actual: null, ok: false, error: `unparseable output: ${stdout}` })),
    };
  }
  const results = problem.test_cases.map((tc, i) => {
    const r = parsed[i] || {};
    const ok = !('error' in r) && JSON.stringify(r.actual) === JSON.stringify(tc.expected);
    return { input: tc.input, expected: tc.expected, actual: r.actual ?? null, ok, error: r.error };
  });
  return { pass: results.every((r) => r.ok), results };
}
