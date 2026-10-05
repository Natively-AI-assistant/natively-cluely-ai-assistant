// Live-reproduced 2026-09-25 in an isolated dev:agent instance with no AI key:
// Clarify, Recap and Follow-up questions failed in main ("No AI provider
// configured") but the overlay never heard. Each generateStream caught the
// provider error and ended the stream empty; the engine treats an empty stream
// as a successful no-op, so neither the final event nor 'error' was emitted and
// the "Thinking..." placeholder spun forever. The wrappers must rethrow so the
// engine's catch emits 'error'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = async (name) => (await import(pathToFileURL(path.resolve(repoRoot, `dist-electron/electron/llm/${name}.js`)).href))[name];

const failingHelper = {
  getPromptTier: () => 'standard',
  fitContextForCurrentModel: (c) => c,
  // eslint-disable-next-line require-yield
  async *streamChat() { throw new Error('No AI provider configured'); },
};

const cases = [
  ['ClarifyLLM', (llm) => llm.generateStream('ctx')],
  ['RecapLLM', (llm) => llm.generateStream('ctx')],
  ['FollowUpQuestionsLLM', (llm) => llm.generateStream('ctx')],
  ['FollowUpLLM', (llm) => llm.generateStream('previous answer', 'make it shorter', 'ctx')],
];

for (const [name, start] of cases) {
  test(`${name}.generateStream rethrows provider errors instead of ending empty`, async () => {
    const Cls = await load(name);
    const llm = new Cls(failingHelper);
    await assert.rejects(async () => { for await (const _ of start(llm)) { /* drain */ } }, /No AI provider configured/);
  });
}
