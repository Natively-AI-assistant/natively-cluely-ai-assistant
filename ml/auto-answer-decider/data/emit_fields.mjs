/**
 * Add the §4 state FIELDS to candidate records, using the app's own TypeScript builder
 * (dist-electron deciderState.js), so addressed_to comes from the judge's real name helpers.
 *   node data/emit_fields.mjs < records.jsonl > records+fields.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const S = require(path.join(root, 'dist-electron/electron/intelligence/autoAnswer/decider/deciderState.js'));

for (const line of fs.readFileSync(0, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const rec = JSON.parse(line);
  rec.fields = S.buildDeciderStateFields({
    candidateText: rec.candidate,
    recentTurns: rec.context.map((t, i) => ({ role: t.speaker === 'USER' ? 'user' : 'interviewer', text: t.text, timestamp: i })),
    modeId: rec.mode,
    lastAnsweredText: rec.last_answered ?? null,
    userName: rec.user_name ?? null,
    transcriptLagging: !!rec.transcript_lagging,
  });
  process.stdout.write(JSON.stringify(rec) + '\n');
}
