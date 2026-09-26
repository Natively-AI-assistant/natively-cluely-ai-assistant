// F-504 / F-505 repro.
//
// F-504: IntelligenceEngine declared
//          const seedCandidateBackground = _c3TurnPlan.answerDirectives.seedCandidateBackground;
//        immediately after a try/catch that sets _c3TurnPlan = null on failure.
//        The const was NEVER READ (the live consumer optional-chains its own
//        copy), so it was dead code — and it was the single unguarded deref, so
//        a TurnPlanner dynamic-import failure threw a TypeError that the outer
//        catch swallowed, discarding the whole JIT profile-evidence block and
//        leaving candidateProfile empty. The defensive fallback destroyed the
//        grounding it exists to protect.
//
// F-505: two mode-prior normalizers still carried the pre-Campaign-3 7-member
//        template list, so toActiveModeInfo returned null for a 'seminar' mode
//        and planAnswer ran mode-blind.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let bad = false;

// F-504 — no unguarded deref of a value the code itself treats as nullable.
const engine = read('electron/IntelligenceEngine.ts');
if (/const seedCandidateBackground = _c3TurnPlan\.answerDirectives/.test(engine)) {
  console.error('[F-504] the dead, unguarded _c3TurnPlan deref is still present (F-504 reproduced)');
  bad = true;
} else {
  console.log('[F-504] ok — the dead unguarded deref is gone');
}
if (!/_c3TurnPlan\?\.answerDirectives\?\.seedCandidateBackground/.test(engine)) {
  console.error('[F-504] the LIVE consumer must remain optional-chained'); bad = true;
}

// F-505 — both normalizers must accept the 8th template.
for (const rel of ['electron/llm/ProfileIntelligenceRouter.ts', 'electron/intelligence/ContextRouter.ts']) {
  const src = read(rel);
  const i = src.indexOf('MODE_TEMPLATE_TYPES');
  const block = i === -1 ? '' : src.slice(i, i + 600);
  if (!/'seminar'/.test(block)) {
    console.error(`[F-505] ${rel} still omits 'seminar' (F-505 reproduced)`); bad = true;
  } else {
    console.log(`[F-505] ok — ${path.basename(rel)} accepts 'seminar'`);
  }
}

// The union these mirror must genuinely contain all 8, or the fix is wrong.
const profiles = read('electron/llm/modeProfiles.ts');
for (const t of ['general', 'looking-for-work', 'sales', 'recruiting', 'team-meet', 'lecture', 'technical-interview', 'seminar']) {
  if (!profiles.includes(`'${t}'`)) { console.error(`[F-505] modeProfiles does not define '${t}'`); bad = true; }
}

if (bad) { console.error('FAIL'); process.exit(1); }
console.log('PASS: no unguarded turn-plan deref; both mode-prior normalizers cover all 8 templates.');
process.exit(0);
