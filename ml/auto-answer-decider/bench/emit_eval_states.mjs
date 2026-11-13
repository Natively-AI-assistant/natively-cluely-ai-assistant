/**
 * Emit the §4 decider state FIELDS for every judge-eval candidate, built by the
 * app's own TypeScript builder (deciderState.ts, from dist-electron) so
 * `addressed_to` comes from the judge's real name helpers. Python fits and
 * serializes them (decider/state.py) with the model's tokenizer.
 *
 *   npm run build:electron   # once, from the repo root
 *   node ml/auto-answer-decider/bench/emit_eval_states.mjs > <out.jsonl>
 *
 * Judge-eval sets are TEST ONLY: this output must never reach training data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const { buildDeciderStateFields, modeIdForName } = require(path.join(root, 'dist-electron/electron/intelligence/autoAnswer/decider/deciderState.js'));

const dir = path.join(root, 'electron/intelligence/autoAnswer/__tests__/judge-eval');
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const cases = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  cases.forEach((c, i) => {
    // judgeEval.mjs judges a case with no modeName as 'Technical Interview'.
    const modeName = c.modeName ?? 'Technical Interview';
    const modeId = modeIdForName(modeName);
    if (!modeId) throw new Error(`${file}#${i}: no template id for mode "${modeName}"`);
    const fields = buildDeciderStateFields({
      candidateText: c.text,
      recentTurns: (c.ctx ?? []).map((t, k) => ({ ...t, timestamp: k })),
      modeId,
      lastAnsweredText: c.lastAnswered ?? null,
      userName: c.userName ?? null,
      transcriptLagging: false,
    });
    process.stdout.write(JSON.stringify({ set: file, index: i, expect: c.expect, fields }) + '\n');
  });
}
