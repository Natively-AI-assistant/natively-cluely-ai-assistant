// RestateLLM / LookupLLM — output contract checks (source structure)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

test('RestateLLM uses RESTATE_MODE_PROMPT and PromptAssembler spine blocks', () => {
  const src = fs.readFileSync(path.join(root, 'electron/llm/RestateLLM.ts'), 'utf8');
  assert.match(src, /RESTATE_MODE_PROMPT/);
  assert.match(src, /sessionSpine/);
  assert.match(src, /currentTurn/);
  assert.doesNotMatch(src, /CLARIFY_MODE_PROMPT/);
});

test('LookupLLM uses LOOKUP_MODE_PROMPT and retrieved context slot', () => {
  const src = fs.readFileSync(path.join(root, 'electron/llm/LookupLLM.ts'), 'utf8');
  assert.match(src, /LOOKUP_MODE_PROMPT/);
  assert.match(src, /retrievedModeContext/);
});

test('RESTATE_MODE_PROMPT forbids clarifying questions back to interviewer', () => {
  const prompts = fs.readFileSync(path.join(root, 'electron/llm/prompts.ts'), 'utf8');
  const restateBlock = prompts.slice(
    prompts.indexOf('export const RESTATE_MODE_PROMPT'),
    prompts.indexOf('export const LOOKUP_MODE_PROMPT'),
  );
  assert.match(restateBlock, /NEVER output a clarifying question/i);
});

test('LOOKUP_MODE_PROMPT forbids full coding solutions', () => {
  const prompts = fs.readFileSync(path.join(root, 'electron/llm/prompts.ts'), 'utf8');
  const lookupBlock = prompts.slice(
    prompts.indexOf('export const LOOKUP_MODE_PROMPT'),
    prompts.indexOf('export const MEETING_BRIEF_MODE_PROMPT'),
  );
  assert.match(lookupBlock, /NEVER provide a full coding solution/i);
});
