#!/usr/bin/env node
/**
 * /llm-eval runner for evals/sd-routing
 *
 * Contract-only by default (planAnswer seam). No API.
 * Exit 0 = SHIP (regression). Exit 1 = NO-SHIP.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const featureDir = join(root, 'evals', 'sd-routing');

function parseThreshold(yamlText) {
  const m = yamlText.match(/(?:^|\n)min_pass_rate:\s*([\d.]+)/m);
  return { regressionMin: m ? Number(m[1]) : 1.0 };
}

function checkAsserts(ctx, asserts) {
  const fails = [];
  for (const a of asserts) {
    if (a.type === 'answer_type') {
      if (ctx.answerType !== a.eq) fails.push(`answer_type want=${a.eq} got=${ctx.answerType}`);
    } else if (a.type === 'answer_type_not') {
      if (ctx.answerType === a.eq) fails.push(`answer_type_not got forbidden=${a.eq}`);
    } else if (a.type === 'meta_tags_present') {
      const missing = (ctx.missingTags || []);
      if (missing.length) fails.push(`meta_tags_missing: ${missing.join(',')}`);
    } else {
      fails.push(`unknown assert type ${a.type}`);
    }
  }
  return fails;
}

async function main() {
  const require = createRequire(import.meta.url);
  try {
    require('child_process').execSync('npm run build:electron', {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    console.error('build:electron failed — run it manually');
    process.exit(1);
  }

  const planner = await import(
    pathToFileURL(join(root, 'dist-electron/electron/llm/AnswerPlanner.js')).href
  );
  const { planAnswer } = planner;

  const cases = readFileSync(join(featureDir, 'cases.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const allTags = new Set();
  for (const c of cases) {
    for (const t of c.tags || []) allTags.add(t);
  }

  const threshold = parseThreshold(readFileSync(join(featureDir, 'threshold.yaml'), 'utf8'));
  const bySuite = { regression: [], capability: [] };

  for (const c of cases) {
    const mode = c.input?.mode || 'route';
    let ctx = { answerType: null, missingTags: [] };
    let runErr = null;

    try {
      if (mode === 'meta') {
        const required = c.input.requireTags || [];
        ctx.missingTags = required.filter((t) => !allTags.has(t));
      } else if (mode === 'route') {
        const source = c.input.source || 'what_to_answer';
        const plan = planAnswer({
          question: c.input.question,
          source,
          speakerPerspective: source === 'what_to_answer' ? 'interviewer' : 'user',
          sdSessionOpen: c.input.sdSessionOpen === true,
          ...(c.input.sdIntention != null ? { sdIntention: c.input.sdIntention } : {}),
        });
        ctx.answerType = plan.answerType;
      } else {
        throw new Error(`unknown input.mode ${mode}`);
      }
    } catch (e) {
      runErr = e?.message || String(e);
    }

    const fails = runErr ? [`run_error: ${runErr}`] : checkAsserts(ctx, c.assert || []);
    const pass = fails.length === 0;
    bySuite[c.suite] = bySuite[c.suite] || [];
    bySuite[c.suite].push({ id: c.id, pass, fails });
    const detail = fails.length ? ` — ${fails.join('; ')}` : '';
    console.log(`${pass ? 'PASS' : 'FAIL'} [${c.suite}] ${c.id}${detail}`);
  }

  function rate(rows) {
    if (!rows.length) return 1;
    return rows.filter((r) => r.pass).length / rows.length;
  }

  const reg = bySuite.regression || [];
  const cap = bySuite.capability || [];
  const regRate = rate(reg);
  const capRate = rate(cap);

  console.log(
    `regression: ${reg.filter((r) => r.pass).length}/${reg.length} (${regRate.toFixed(2)}) gate≥${threshold.regressionMin}`,
  );
  console.log(
    `capability: ${cap.filter((r) => r.pass).length}/${cap.length} (${capRate.toFixed(2)}) [tracked]`,
  );

  const ship = reg.length > 0 && regRate >= threshold.regressionMin;
  console.log(ship ? 'SHIP' : 'NO-SHIP');
  process.exit(ship ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
