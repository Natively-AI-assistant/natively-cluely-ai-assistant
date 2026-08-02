// electron/llm/__tests__/PromptSystemV2LiveEval2026_08_01.test.mjs
//
// Prompt System v2 — LIVE model-output evaluation over the 16 required
// behavior scenarios (fixtures/promptV2BehaviorScenarios.json).
//
// OPT-IN ONLY: runs the real provider, so it is skipped unless BOTH
//   RUN_PROMPT_V2_EVAL=1   and   GEMINI_API_KEY (or GOOGLE_API_KEY) are set.
// This is the shadow-evaluation harness the migration plan calls for: it
// exercises the v2 composer end-to-end (buildSystemPromptV2 +
// buildTurnContentV2) against a live model and applies deterministic checks
// (regexes + the spoken-format lint). It never runs in CI by default and
// never doubles production traffic — it is a standalone offline harness.
//
//   RUN_PROMPT_V2_EVAL=1 GEMINI_API_KEY=... \
//     node --test electron/llm/__tests__/PromptSystemV2LiveEval2026_08_01.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const enabled = process.env.RUN_PROMPT_V2_EVAL === '1' && apiKey;

const v2 = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/promptSystemV2.js')).href
);
const { scenarios } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/promptV2BehaviorScenarios.json'), 'utf8')
);

const MODEL = process.env.PROMPT_V2_EVAL_MODEL || 'gemini-3.1-flash-lite';

async function generate(system, user) {
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({ apiKey });
  const res = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    config: { systemInstruction: system, temperature: 0.2, maxOutputTokens: 2048 },
  });
  return (res.text ?? '').trim();
}

describe(`Prompt System v2 live behavior eval (${enabled ? `model=${MODEL}` : 'SKIPPED — set RUN_PROMPT_V2_EVAL=1 + GEMINI_API_KEY'})`, () => {
  for (const s of scenarios) {
    test(`${s.id}`, { skip: !enabled }, async () => {
      const system = v2.buildSystemPromptV2({ mode: s.mode, action: s.action, tier: 'cloud' });
      const user = v2.buildTurnContentV2({
        evidence: s.evidence,
        recentTranscript: s.recentTranscript,
        currentTurn: s.currentTurn,
        directRequest: s.directRequest,
      });
      const out = await generate(system, user);
      assert.ok(out.length > 0, 'model returned empty output');

      if (s.expectSentinel) {
        assert.ok(v2.shouldSuppressModelOutput(out), `expected exact [[NO_ACTION]], got: ${out.slice(0, 200)}`);
        return;
      }
      assert.ok(!v2.shouldSuppressModelOutput(out), `unexpected sentinel for ${s.id}`);

      for (const re of s.mustMatch ?? []) {
        assert.match(out, toRegex(re), `${s.id}: output missing required pattern ${re}\n---\n${out.slice(0, 400)}`);
      }
      for (const re of s.mustNotMatch ?? []) {
        assert.doesNotMatch(out, toRegex(re), `${s.id}: output contains forbidden pattern ${re}\n---\n${out.slice(0, 400)}`);
      }
      if (s.spokenLint) {
        const violations = v2.spokenFormatViolations(out);
        assert.deepEqual(violations, [], `${s.id}: spoken-format violations ${JSON.stringify(violations)}\n---\n${out.slice(0, 400)}`);
      }
    });
  }
});

function toRegex(spec) {
  if (spec.startsWith('(?i)')) return new RegExp(spec.slice(4), 'im');
  return new RegExp(spec, 'm');
}
