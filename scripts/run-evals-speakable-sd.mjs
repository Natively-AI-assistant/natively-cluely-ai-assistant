#!/usr/bin/env node
/**
 * /llm-eval runner for evals/speakable-sd
 *
 * Default: contract regression only (no API).
 * SPEAKABLE_SD_EVAL_LIVE=1: also run capability live Gemini cases.
 *
 * Exit 0 = SHIP (regression gate). Exit 1 = NO-SHIP.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const featureDir = join(root, 'evals', 'speakable-sd');
const liveEnabled = process.env.SPEAKABLE_SD_EVAL_LIVE === '1';

function loadEnvKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return '';
  const m = readFileSync(envPath, 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

function parseThreshold(yamlText) {
  // Tiny subset parser — only keys we need.
  const get = (key, def) => {
    const m = yamlText.match(new RegExp(`(?:^|\\n)${key}:\\s*([\\d.]+)`, 'm'));
    return m ? Number(m[1]) : def;
  };
  return {
    regressionMin: get('min_pass_rate', 1.0),
    capabilityMin: 0,
  };
}

function checkAsserts(ctx, asserts) {
  const fails = [];
  for (const a of asserts) {
    if (a.type === 'answer_type') {
      if (ctx.answerType !== a.eq) fails.push(`answer_type want=${a.eq} got=${ctx.answerType}`);
    } else if (a.type === 'contract_matches') {
      if (!new RegExp(a.pattern, 'i').test(ctx.contract || '')) {
        fails.push(`contract_matches /${a.pattern}/`);
      }
    } else if (a.type === 'contract_not_matches') {
      if (new RegExp(a.pattern, 'i').test(ctx.contract || '')) {
        fails.push(`contract_not_matches /${a.pattern}/`);
      }
    } else if (a.type === 'ti_prompt_matches') {
      if (!new RegExp(a.pattern, 'i').test(ctx.tiPrompt || '')) {
        fails.push(`ti_prompt_matches /${a.pattern}/`);
      }
    } else if (a.type === 'ti_prompt_not_matches') {
      if (new RegExp(a.pattern, 'i').test(ctx.tiPrompt || '')) {
        fails.push(`ti_prompt_not_matches /${a.pattern}/`);
      }
    } else if (a.type === 'output_matches') {
      if (!new RegExp(a.pattern, 'im').test(ctx.output || '')) {
        fails.push(`output_matches /${a.pattern}/`);
      }
    } else if (a.type === 'output_not_matches') {
      if (new RegExp(a.pattern, 'im').test(ctx.output || '')) {
        fails.push(`output_not_matches /${a.pattern}/`);
      }
    } else {
      fails.push(`unknown assert type ${a.type}`);
    }
  }
  return fails;
}

async function callGemini(apiKey, model, systemText, userText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}

async function main() {
  // Prefer dist build for planner/prompts.
  const require = createRequire(import.meta.url);
  // Ensure electron dist exists
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
  const prompts = await import(
    pathToFileURL(join(root, 'dist-electron/electron/llm/prompts.js')).href
  );

  const { planAnswer, formatAnswerPlanForPrompt } = planner;
  const tiPrompt = String(prompts.MODE_TECHNICAL_INTERVIEW_PROMPT || '');

  const cases = readFileSync(join(featureDir, 'cases.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const threshold = parseThreshold(readFileSync(join(featureDir, 'threshold.yaml'), 'utf8'));
  const apiKey = loadEnvKey();
  const model = process.env.BENCHMARK_MODEL || process.env.SPEAKABLE_SD_EVAL_MODEL || 'gemini-3.1-flash-lite';

  const bySuite = { regression: [], capability: [] };

  for (const c of cases) {
    const mode = c.input?.mode || 'contract';
    if (mode === 'live' && !liveEnabled) {
      console.log(`SKIP [capability] ${c.id} — set SPEAKABLE_SD_EVAL_LIVE=1 to run`);
      continue;
    }

    let ctx = { answerType: null, contract: '', tiPrompt, output: '' };
    let runErr = null;

    try {
      if (mode === 'ti_prompt') {
        // tiPrompt already set
      } else if (mode === 'contract' || mode === 'live') {
        const source = c.input.source || 'manual';
        const plan = planAnswer({
          question: c.input.question,
          source,
          speakerPerspective: source === 'what_to_answer' ? 'interviewer' : 'user',
        });
        ctx.answerType = plan.answerType;
        ctx.contract = formatAnswerPlanForPrompt(plan, false);

        if (mode === 'live') {
          if (!apiKey) throw new Error('GEMINI_API_KEY missing');
          const systemText = [
            'You are Natively helping a candidate in a technical interview.',
            ctx.contract,
            c.input.systemExtra || '',
          ].join('\n\n');
          ctx.output = await callGemini(apiKey, model, systemText, c.input.question);
        }
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
    if (mode === 'live' && ctx.output) {
      console.log(`  output_preview: ${ctx.output.slice(0, 160).replace(/\n/g, ' ')}…`);
    }
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
