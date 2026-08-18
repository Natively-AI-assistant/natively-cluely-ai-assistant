/**
 * buildThinkingConfig — per-model thinking-level floor.
 *
 * WHY THIS EXISTS
 *
 * `thinkingLevel: 'minimal'` is NOT uniformly supported across the Gemini flash
 * tier. Probed live against the API on 2026-08-14:
 *
 *   gemini-3.1-flash-lite   minimal → 200    low → 200
 *   gemini-3.6-flash        minimal → 200    low → 200
 *   gemini-3.7-flash        minimal → 400    low → 200
 *       ("Thinking level MINIMAL is not supported for this model.
 *         Please retry with other thinking level.")
 *
 * buildThinkingConfig used to send MINIMAL for ANY non-Pro model whenever the
 * threaded budget was <= 0 — and both interactive budgets (INTERACTIVE_ /
 * CODING_THINKING_BUDGET) are 0. So bumping the client's GEMINI_FLASH_MODEL to
 * gemini-3.7-flash without this floor 400s every interactive Gemini stream on
 * the direct/BYOK path.
 *
 * Mirrors thinkingConfigForModel() in natively-api/lib/flashModelPicker.js —
 * if you change the policy on one side, change it on the other.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 electron --test electron/llm/__tests__/ThinkingLevelPerModelFloor2026_08_14.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// The SDK enum values are UPPERCASE ('MINIMAL'/'LOW') — assert against the enum
// rather than lowercase literals, which is what the API actually receives.
import { ThinkingLevel } from '@google/genai'

// Exercises the REAL compiled engine, like every other test in this directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js')
const { buildThinkingConfig } = await import(pathToFileURL(modPath).href)

const BUDGET_OFF = 0

test('gemini-3.7-flash floors at low — MINIMAL is a 400 on this model', () => {
  assert.deepEqual(buildThinkingConfig('gemini-3.7-flash', BUDGET_OFF), { thinkingLevel: ThinkingLevel.LOW })
})

// Keep in sync with GEMINI_FLASH_MODEL in electron/LLMHelper.ts (module-private,
// so it cannot be imported here) and electron/IntelligenceManager.ts.
const SHIPPED_FLASH_MODEL = 'gemini-3.7-flash'

test('REGRESSION: the shipped flash model is never sent thinkingLevel minimal', () => {
  const cfg = buildThinkingConfig(SHIPPED_FLASH_MODEL, BUDGET_OFF)
  assert.notEqual(cfg.thinkingLevel, ThinkingLevel.MINIMAL,
    `${SHIPPED_FLASH_MODEL} must not receive MINIMAL — verify against the live API before adding it to MINIMAL_THINKING_MODELS`)
})

test('models verified to accept minimal still get it (no latency regression)', () => {
  assert.deepEqual(buildThinkingConfig('gemini-3.1-flash-lite', BUDGET_OFF), { thinkingLevel: ThinkingLevel.MINIMAL })
  assert.deepEqual(buildThinkingConfig('gemini-3.6-flash', BUDGET_OFF), { thinkingLevel: ThinkingLevel.MINIMAL })
})

test('an unrecognized model falls back to low, never minimal', () => {
  // Direction matters: `low` is accepted by every flash tier, `minimal` is not.
  // A future/unlisted model must degrade to a working request, not a hard 400.
  assert.deepEqual(buildThinkingConfig('gemini-9.9-flash', BUDGET_OFF), { thinkingLevel: ThinkingLevel.LOW })
})

test('Pro still floors at low (cannot disable thinking)', () => {
  assert.deepEqual(buildThinkingConfig('gemini-3.1-pro-preview', BUDGET_OFF), { thinkingLevel: ThinkingLevel.LOW })
  assert.deepEqual(buildThinkingConfig('gemini-3-pro', BUDGET_OFF), { thinkingLevel: ThinkingLevel.LOW })
})

test('an explicit positive budget is still preserved verbatim', () => {
  assert.deepEqual(buildThinkingConfig('gemini-3.7-flash', 512), { thinkingBudget: 512 })
})

test('undefined model keeps the previous minimal default', () => {
  assert.deepEqual(buildThinkingConfig(undefined, BUDGET_OFF), { thinkingLevel: ThinkingLevel.MINIMAL })
})
