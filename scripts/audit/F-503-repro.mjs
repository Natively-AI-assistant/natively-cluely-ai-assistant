// F-503 repro: summary regeneration resolved the mode by templateType, not by
// the persisted id, so it used ANOTHER mode's note sections and identity.
//
// MeetingPersistence persists selectedModeId/Name/TemplateType at write time,
// but the regenerate path ignored selectedModeId and did
//   getModes().find(m => m.templateType === templateType)
// getModes() is ORDER BY created_at ASC, so `find` returns the OLDEST row with
// that template. Every user-built custom mode is templateType 'general' and the
// built-in "General" is seeded first — so regenerating a meeting that ran under
// a custom mode silently used the built-in's note sections and then rewrote
// modeMeta.selectedModeId/Name with the wrong identity.
//
// Models the resolution exactly as the handler performs it, and cross-checks
// the shipped source so the harness cannot drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../electron/MeetingPersistence.ts'), 'utf8');

// created_at ASC: the seeded built-in comes first, the user's custom mode later.
const modes = [
  { id: 'mode_builtin_general', name: 'General', templateType: 'general' },
  { id: 'mode_custom_abc',      name: 'My Interview Prep', templateType: 'general' },
];
const storedMode = { selectedModeId: 'mode_custom_abc', selectedModeName: 'My Interview Prep', selectedTemplateType: 'general' };

const usesId = /const byId = storedMode\?\.selectedModeId/.test(src)
  && /const match = byId \?\? all\.find/.test(src);

const resolve = () => {
  const templateType = storedMode.selectedTemplateType;
  const byId = usesId && storedMode.selectedModeId ? modes.find((m) => m.id === storedMode.selectedModeId) : undefined;
  return byId ?? modes.find((m) => m.templateType === templateType);
};

const picked = resolve();
console.log('[F-503] source resolves by persisted id:', usesId);
console.log('[F-503] meeting ran under:', storedMode.selectedModeName, '| regeneration picked:', picked?.name);

let bad = false;
if (!usesId) { console.error('[F-503] the shipped code still resolves by templateType only'); bad = true; }
if (picked?.id !== 'mode_custom_abc') {
  console.error(`[F-503] regeneration picked '${picked?.name}' instead of the mode the meeting actually ran under`);
  bad = true;
}

// A deleted mode must still fall back rather than crash.
const deletedStored = { selectedModeId: 'mode_gone', selectedTemplateType: 'general' };
const fallback = (usesId ? modes.find((m) => m.id === deletedStored.selectedModeId) : undefined)
  ?? modes.find((m) => m.templateType === deletedStored.selectedTemplateType);
if (!fallback) { console.error('[F-503] a deleted mode must still fall back to a template match'); bad = true; }
else console.log('[F-503] deleted-mode fallback →', fallback.name);

if (bad) { console.error('[F-503] FAIL (F-503 reproduced).'); process.exit(1); }
console.log('[F-503] PASS: regeneration uses the mode the meeting ran under, with a safe fallback when it is gone.');
process.exit(0);
