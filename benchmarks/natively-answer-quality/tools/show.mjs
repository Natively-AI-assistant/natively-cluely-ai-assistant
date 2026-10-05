#!/usr/bin/env node
// node tools/show.mjs ID[,ID] [--ctx] [--answers]   — item, its source material, and every recorded answer.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const ids = args[0].split(',');
const ds = Object.fromEntries(['dev', 'holdout', 'final'].map((p) => [p, JSON.parse(fs.readFileSync(path.join(ROOT, 'dataset', p + '.json'), 'utf8'))]));
const runs = fs.readdirSync(path.join(ROOT, 'results')).filter((d) => !d.startsWith('_') && fs.existsSync(path.join(ROOT, 'results', d, 'natively_benchmark_full.jsonl')));
for (const id of ids) {
  const part = Object.keys(ds).find((p) => ds[p].items.some((i) => i.id === id)); const d = ds[part]; const it = d.items.find((i) => i.id === id);
  const head = it.conversation_id ? d.items.find((x) => x.conversation_id === it.conversation_id && x.turn_index === 1) : it;
  console.log(`\n######## ${id} (${part}) ${it.mode} ${it.surface} cat=${it.category} trap=${it.claim_trap} pi=${it.pi_ref} needles=${JSON.stringify(it.needles)}\nQ: ${it.question}\nexpected: ${it.expected_answer_type}`);
  if (head.prior_transcript) console.log('PRIOR:\n' + head.prior_transcript.map((l) => `  ${l.speaker}: ${l.text}`).join('\n'));
  if (it.conversation_id) console.log('CHAIN:', d.items.filter((x) => x.conversation_id === it.conversation_id).sort((a, b) => a.turn_index - b.turn_index).map((x) => `${x.turn_index}:${x.id} ${x.question}`).join(' || '));
  if (args.includes('--ctx') && head.context_ref) console.log(`CTX ${head.context_ref} (${d.contexts[head.context_ref].file_name}):\n${d.contexts[head.context_ref].text}`);
  if (args.includes('--answers')) for (const r of runs) {
    const f = path.join(ROOT, 'results', r, 'natively_benchmark_full.jsonl');
    const row = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.benchmark_id === id);
    if (row) console.log(`--- [${r}] ${(row.rendered_answer ?? row.raw_answer ?? '').replace(/\n+/g, ' ⏎ ')}`);
  }
}
