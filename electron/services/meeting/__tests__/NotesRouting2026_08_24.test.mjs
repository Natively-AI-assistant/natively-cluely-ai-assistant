import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../../dist-electron/electron/services/meeting');
const { generateStructured } = await import(pathToFileURL(path.join(base, 'generateStructured.js')).href);

// The gateway routes purpose:'extraction' to a dedicated path with a larger budget and a
// DeepSeek→Gemini loop that never selects MiniMax-M3 (documented as severely
// under-extracting). Meeting extraction MUST opt in, or dense notes are impossible.
test('generateStructured forwards callOpts to every LLM call it makes', async () => {
  const seen = [];
  const llmHelper = {
    generateMeetingSummary: async (_system, _content, _groq, opts) => {
      seen.push(opts);
      return 'not json';   // force the repair retry so both calls are observed
    },
  };

  await generateStructured({
    schemaName: 'Probe',
    systemPrompt: 'x',
    jsonShapeHint: '{}',
    userContent: 'y',
    llmHelper,
    callOpts: { purpose: 'extraction', timeoutMs: 60000 },
    validate: () => ({ ok: false, errors: ['nope'], repaired: false }),
  });

  assert.equal(seen.length, 2, 'primary + repair retry should both be observed');
  for (const opts of seen) {
    assert.equal(opts?.purpose, 'extraction');
    assert.equal(opts?.timeoutMs, 60000);
  }
});
