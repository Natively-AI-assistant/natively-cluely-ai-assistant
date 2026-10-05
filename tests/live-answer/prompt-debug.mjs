// Read the dev-only prompt recorder's log (electron/llm/promptDebug.ts).
//
//   node tests/live-answer/prompt-debug.mjs [--file=<requests.jsonl>] [--last=3] [--full] [--all]
//
// Default file: ./.agent/userdata/prompt-debug/requests.jsonl (the isolated
// dev:agent profile). Shows, per LLM request that went over the wire: provider,
// model, generation params, the composing surface / prompt source / persona
// action / declared surface, the system prompt's block outline in order (with
// offsets and its hash), and the user message. --all includes background calls
// that no composition note links to. --full prints the full system prompt.
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const file = arg('file', path.join(process.cwd(), '.agent', 'userdata', 'prompt-debug', 'requests.jsonl'));
const last = Number(arg('last', '3'));
const full = process.argv.includes('--full');
const all = process.argv.includes('--all');
if (!fs.existsSync(file)) { console.error(`no recorder log at ${file} — start the app with NATIVELY_PROMPT_DEBUG=1`); process.exit(1); }

const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const wire = lines.filter((l) => l.kind === 'wire' && (all || l.note));
const outline = (s) => [...s.matchAll(/(?:^|\n)(#{1,3} [^\n]{0,60}|<[a-z_]+(?: [^>]{0,50})?>|\[LANGUAGE[^\]]*\])/g)]
  .map((m) => `${String(m.index).padStart(6)}  ${m[1]}`);

for (const w of wire.slice(-last)) {
  const n = w.note ?? {};
  const facts = n.extra?.turnFacts ?? {};
  console.log('═'.repeat(100));
  console.log(`#${w.seq} ${w.ts}  ${w.provider}/${w.model}  ${w.path}${w.blocked ? '  [BLOCKED — captured, not sent]' : ''}  status=${w.status ?? '?'}`);
  console.log(`params: ${JSON.stringify(w.params)}`);
  console.log(`composed by: surface=${n.surface ?? '(none — not linked to a composition note)'} promptSource=${n.promptSource ?? '-'} mode=${n.mode ?? '-'} tier=${n.tier ?? '-'}`);
  console.log(`persona: action=${facts.personaAction ?? '-'} declaredSurface=${facts.surface ?? '-'} coding=${facts.codingTask ?? '-'}`);
  console.log(`system: ${w.system.length} chars sha=${w.systemSha} matchesComposition=${n.systemMatchesWire ?? '-'}  user matchesComposition=${n.userMatchesWire ?? '-'}`);
  console.log(outline(w.system).join('\n'));
  if (full) { console.log('── SYSTEM ──'); console.log(w.system); }
  for (const m of w.messages) { console.log(`── ${m.role.toUpperCase()} (${m.text.length} chars) ──`); console.log(full ? m.text : m.text.slice(0, 1500)); }
}
