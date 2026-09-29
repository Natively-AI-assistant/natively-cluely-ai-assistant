// Run a REAL user's reference pack + question list through the decision layer.
//
// Everything else in this directory uses a synthetic corpus. That corpus was
// built to mirror the reported structure, and the report documents its own
// limits: clean headings, no OCR noise, no ASR errors in the questions, needles
// that are exact substrings. The numbers from it are UPPER BOUNDS.
//
// This script takes the pack itself. Point it at a directory of reference files
// plus a question list and it answers the only question that matters: with THIS
// user's files and THIS user's phrasings, does the reference file get retrieved?
//
//   npx esbuild tester-pack.ts --bundle --platform=node --format=cjs --outfile=/tmp/tp.cjs \
//     && PACK=/path/to/pack node /tmp/tp.cjs [modeId]
//
// The pack is read from disk and never copied into the repo — it is the user's
// material, sanitized or not.
import * as fs from 'fs';
import * as path from 'path';
import { decide } from '../../electron/context-intelligence/orchestration/orchestrator';
import { resolveModePolicy, MODE_IDS } from '../../electron/context-intelligence/policies/mode-policy-registry';
import { sourceTypeForFile } from '../../electron/context-intelligence/retrieval/mode-retrieval-port';
import { authorityOf } from '../../electron/context-intelligence/policies/source-authority-policy';

const PACK = process.env.PACK;
if (!PACK) { console.error('set PACK=/path/to/pack'); process.exit(1); }
const MODE = process.argv[2] || 'general';

/** Question lines: numbered items only, so headings and prose are skipped. */
function questionsFrom(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s+\S/.test(l))
    .map((l) => l.replace(/^\d+\.\s+/, ''));
}

const files = fs.readdirSync(PACK).filter((f) => f.endsWith('.md') && !/readme/i.test(f));
const qFile = fs.readdirSync(PACK).find((f) => /question/i.test(f));
if (!qFile) { console.error('no *question* file in the pack'); process.exit(1); }
const questions = questionsFrom(path.join(PACK, qFile));

/** Mirrors the real filter order: plan -> planned-type filter -> claim authority. */
function reaches(modeId: string, q: string, fileName: string, body: string) {
  const policy = resolveModePolicy(modeId);
  const stamped = sourceTypeForFile(fileName, body, policy.allowedSourceTypes);
  const d = decide({
    requestId: 'r', requestSequence: 1, surface: 'manual_chat' as any, modeId,
    scope: { userId: 'u' }, sessionId: 's', manualQuestion: q,
    hasAttachedDocuments: true, attachedFileNames: [fileName],
  });
  if (!d.retrievalPlan.shouldRetrieve) return { ok: false, why: 'NO_RETRIEVAL', stamped };
  if (!new Set(d.retrievalPlan.sourceTypes).has(stamped)) return { ok: false, why: 'PLANNED_TYPE_FILTER', stamped };
  const needed = new Set(d.claimRequirements.filter((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED').map((c) => c.claimType));
  const acceptedFor = authorityOf(stamped);
  if (needed.size && !acceptedFor.some((c) => needed.has(c as any))) return { ok: false, why: 'CLAIM_AUTHORITY', stamped };
  return { ok: true, why: 'ok', stamped };
}

// The combined file is Test A; it is the one the report says was worst.
const combined = files.find((f) => /combined/i.test(f)) ?? files[0];
const body = fs.readFileSync(path.join(PACK, combined), 'utf8');

console.log(`pack: ${PACK}`);
console.log(`file: ${combined}  (${body.length} chars)   mode: ${MODE}\n`);

const run = (label: string) => {
  let ok = 0;
  const rows = questions.map((q) => {
    const r = reaches(MODE, q, combined, body);
    if (r.ok) ok++;
    return { q, r };
  });
  console.log(`── ${label} ──  ${ok}/${questions.length} reach the reference file`);
  for (const { q, r } of rows) {
    console.log(`   ${r.ok ? 'OK ' : 'x  '} ${(r.ok ? '' : r.why).padEnd(20)} ${q.slice(0, 78)}`);
  }
  console.log();
  return ok;
};

// FLAGS OFF reproduces the build the user actually reported against.
const FLAGS = [
  'NATIVELY_RETRIEVAL_REFERENCE_FILES_EVIDENCE_USER_CLAIMS',
  'NATIVELY_RETRIEVAL_CLASSIFIER_TOKEN_FRAMING',
  'NATIVELY_RETRIEVAL_FOLLOWUP_SOURCE_CONTINUITY',
];
for (const f of FLAGS) process.env[f] = '0';
const before = run('BEFORE (the build he reported against)');
for (const f of FLAGS) delete process.env[f];
const after = run('AFTER  (main today)');

console.log(`${before}/${questions.length}  ->  ${after}/${questions.length}\n`);

// And the same question set across every mode, after.
console.log('after, per mode:');
for (const m of MODE_IDS) {
  const n = questions.filter((q) => reaches(m, q, combined, body).ok).length;
  console.log(`   ${m.padEnd(20)} ${n}/${questions.length}`);
}
