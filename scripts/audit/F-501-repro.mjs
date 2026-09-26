// F-501 repro: Seminar Mode's strictness contract was unreachable.
//
// TurnPlanner selects SEMINAR_GROUNDING_PROFILE (evidence 'required' +
// onNoEvidence 'say_not_found_then_answer_general') when
// `sourceContract.templateType === 'seminar'`. But ModeSourceContract has NO
// `templateType` field — only `seededForTemplateType` — and
// IntelligenceEngine built its frozen snapshot with
// `templateType: rawSnapshotSourceContract.templateType`, which therefore
// always resolved to undefined. The real value sits one object away, on the
// mode info the contract was snapshotted from. Seminar routed correctly but
// was never STRICT: no evidence requirement, no "Not in your reference files"
// preamble.
//
// Drives the REAL groundingProfileFor via planTurn from the built bundle.
// Expected (correct): a seminar contract yields the strict profile → exit 0.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../dist-electron/electron/llm');
const { planTurn } = await import(pathToFileURL(path.join(distLlm, 'TurnPlanner.js')).href);

const availability = {
  hasReferenceFiles: true, hasProfileFacts: false, hasJobDescription: false,
  hasLiveTranscript: true, hasMeetingRag: false,
};
const base = { question: 'What did the paper conclude about latency?', availability };

const seminar = planTurn({ ...base, sourceContract: { sourceAuthority: 'reference_files_primary', templateType: 'seminar' } });
const plain   = planTurn({ ...base, sourceContract: { sourceAuthority: 'reference_files_primary' } });

const p = seminar.groundingProfile ?? {};
console.log('[F-501] seminar profile:', JSON.stringify(p));
console.log('[F-501] non-seminar profile:', JSON.stringify(plain.groundingProfile ?? {}));

let bad = false;
if (p.evidencePreference !== 'required') {
  console.error(`[F-501] seminar evidencePreference is '${p.evidencePreference}', expected 'required'`); bad = true;
}
if (p.onNoEvidence !== 'say_not_found_then_answer_general') {
  console.error(`[F-501] seminar onNoEvidence is '${p.onNoEvidence}', expected 'say_not_found_then_answer_general'`); bad = true;
}
// Guard the other modes: the 7 built-ins must keep the permissive default.
if ((plain.groundingProfile ?? {}).evidencePreference === 'required') {
  console.error('[F-501] a NON-seminar mode became strict — strictness must not leak globally'); bad = true;
}

// The ACTUAL dead link: TurnPlanner was always correct — IntelligenceEngine
// never SUPPLIED a templateType, because it read the field off the contract
// (which has none) instead of off the mode.
const fs = await import('node:fs');
const engine = fs.readFileSync(path.resolve(__dirname, '../../electron/IntelligenceEngine.ts'), 'utf8');
const i = engine.indexOf('const snapshotSourceContract');
const block = i === -1 ? '' : engine.slice(i, i + 1800);
if (!/templateType:\s*\(snapshotModeInfo as any\)\?\.templateType/.test(block)) {
  console.error("[F-501] IntelligenceEngine still reads templateType off the CONTRACT (which has no such field) instead of off snapshotModeInfo — the seminar branch stays unreachable");
  bad = true;
} else {
  console.log('[F-501] IntelligenceEngine sources templateType from the mode snapshot');
}

if (bad) { console.error('[F-501] FAIL (F-501 reproduced).'); process.exit(1); }
console.log('[F-501] PASS: seminar resolves the strict grounding profile; other modes keep the default.');
process.exit(0);
