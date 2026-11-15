// electron/services/__tests__/BuiltinSectionInstructions2026_11_16.test.mjs
//
// Built-in note sections ship their extraction instructions (meeting/sectionInstructions.ts)
// instead of compiling them with an AI call on every user's machine: first launch made 56
// compile calls (2026-11-15 dev run, PR #746). These tests pin:
//   - every built-in section (modes + note templates) has exactly one shipped instruction,
//     and every shipped instruction belongs to a real section (no drift either way);
//   - no shipped instruction asks for "Not discussed" / "NA" (the chunk prompt forbids it);
//   - the notes prompts pick shipped > the user's compiled > description;
//   - seeding, "Use a template" and switching mode make no AI calls; a user's own section
//     compiles once, and an edit clears the instruction written for the old text;
//   - "NA" and "Not discussed." lines are dropped as placeholders.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href;

const { ModesManager, TEMPLATE_NOTE_SECTIONS } = await import(dist('services/ModesManager.js'));
const { NOTE_TEMPLATES } = await import(dist('services/meeting/noteTemplates.js'));
const { BUILTIN_SECTION_INSTRUCTIONS, builtinSectionInstruction, sectionGuidance } = await import(dist('services/meeting/sectionInstructions.js'));
const { buildChunkPrompt } = await import(dist('services/meeting/ChunkSummaryGenerator.js'));
const { buildV2FallbackPrompts } = await import(dist('services/meeting/v2FallbackNotes.js'));
const { isEmptyPlaceholder } = await import(dist('services/meeting/MeetingSummaryV3.js'));

// The older sets migrations v12/v13 wrote into users' databases (the default General mode
// of a new install has v12's). Read from the migration source, which never changes.
function migrationSeededSections() {
  const src = fs.readFileSync(path.resolve(__dirname, '../../db/DatabaseManager.ts'), 'utf8');
  const from = src.indexOf('Version 11 → 12');
  const to = src.indexOf('user_version = 13', from);
  assert.ok(from > 0 && to > from, 'migration v12/v13 block found');
  const block = src.slice(from, to);
  const re = /\{\s*title:\s*(['"])(.*?)\1,\s*description:\s*(['"])(.*?)\3\s*\}/g;
  const out = [];
  for (let m; (m = re.exec(block));) out.push({ title: m[2], description: m[4].replace(/\\'/g, "'"), from: 'migration v12/v13' });
  return out;
}

const builtinSections = [
  ...Object.entries(TEMPLATE_NOTE_SECTIONS).flatMap(([mode, secs]) => secs.map((s) => ({ ...s, from: `mode ${mode}` }))),
  ...NOTE_TEMPLATES.flatMap((t) => t.sections.map((s) => ({ ...s, from: `template ${t.id}` }))),
  ...migrationSeededSections(),
];
const key = (s) => `${s.title}\u0000${s.description}`;

test('a new install: every section it seeds has a shipped instruction', () => {
  const mgr = ModesManager.getInstance(); // test database: migrations + built-in seeding
  // Built-in modes only: the test database is reused across runs and keeps custom modes
  // earlier tests made, whose sections are user text and compile on save instead.
  const builtin = mgr.getModes().filter((m) => m.isBuiltin);
  assert.ok(builtin.length >= 9, `found ${builtin.length} built-in modes`);
  const seeded = builtin.flatMap((m) => mgr.getNoteSections(m.id).map((s) => ({ ...s, mode: m.name })));
  assert.ok(seeded.length >= 50, `seeded ${seeded.length} sections`);
  const missing = seeded.filter((s) => !builtinSectionInstruction(s.title, s.description));
  assert.deepEqual(missing.map((s) => `${s.mode}: ${s.title}`), []);
});

test('every built-in section has a shipped instruction', () => {
  const missing = builtinSections.filter((s) => !builtinSectionInstruction(s.title, s.description));
  assert.deepEqual(missing.map((s) => `${s.from}: ${s.title}`), [], 'add these to sectionInstructions.ts (or fix the key after editing the section text)');
});

test('every shipped instruction belongs to a built-in section, once', () => {
  const real = new Set(builtinSections.map(key));
  const stale = BUILTIN_SECTION_INSTRUCTIONS.filter((s) => !real.has(key(s)));
  assert.deepEqual(stale.map((s) => s.title), [], 'these entries match no section: the section text changed');
  const seen = new Set();
  const dupes = BUILTIN_SECTION_INSTRUCTIONS.filter((s) => (seen.has(key(s)) ? true : (seen.add(key(s)), false)));
  assert.deepEqual(dupes.map((s) => s.title), []);
});

test('no shipped instruction asks for a placeholder or is empty', () => {
  for (const s of BUILTIN_SECTION_INSTRUCTIONS) {
    assert.ok(s.instruction.trim().length >= 30, `${s.title}: too short`);
    assert.doesNotMatch(s.instruction, /not discussed|"na"|\bN\/A\b|\bNA\b/i, `${s.title}: asks for a placeholder`);
  }
});

test('guidance order: shipped for built-in text, else the compiled one, else the description', () => {
  const builtin = TEMPLATE_NOTE_SECTIONS.sales[1];
  const shipped = builtinSectionInstruction(builtin.title, builtin.description);
  // Unedited built-in: shipped wins even over an instruction an older build compiled into the DB.
  assert.equal(sectionGuidance({ ...builtin, compiledPrompt: 'old compiled text' }), shipped);
  // Edited by the user: their compiled instruction.
  assert.equal(sectionGuidance({ title: builtin.title, description: 'Only pricing pain.', compiledPrompt: 'Mine.' }), 'Mine.');
  // Edited, not compiled (no key, or the compile failed): the new description.
  assert.equal(sectionGuidance({ title: builtin.title, description: 'Only pricing pain.' }), 'Only pricing pain.');
  assert.match(sectionGuidance({ title: 'Custom' }), /Custom/);
});

test('the chunk prompt and the fallback prompt carry the shipped instruction', () => {
  const sections = TEMPLATE_NOTE_SECTIONS.sales.slice(0, 3);
  const chunk = { chunkIndex: 0, segments: [], text: 'Alice: hi', charCount: 9, tokenEstimate: 3, overlapFromPrevious: false, timeRange: {}, segmentIds: [] };
  const { systemPrompt } = buildChunkPrompt({ chunk, totalChunks: 1, modeTemplateType: 'sales', modeNoteSections: sections });
  const v2 = buildV2FallbackPrompts({ modeNoteSections: sections, groqGenericPrompt: '' }).summaryPrompt;
  for (const s of sections) {
    const shipped = builtinSectionInstruction(s.title, s.description);
    assert.ok(systemPrompt.includes(shipped), `chunk prompt carries ${s.title}`);
    assert.ok(v2.includes(shipped), `fallback prompt carries ${s.title}`);
  }
});

function countingHelper() {
  const h = {
    calls: 0,
    hasAnyConfiguredProvider: () => true,
    async generateMeetingSummary() {
      h.calls++;
      return JSON.stringify({ instruction: 'Extract the relevant points. Use ONLY the transcript provided; do not use outside knowledge. If nothing fits, leave this section out.' });
    },
  };
  return h;
}
const drain = () => new Promise((r) => setTimeout(r, 150));

test('seeding a mode, "Use a template" and switching mode make no AI calls', async () => {
  const h = countingHelper();
  ModesManager.setLlmHelperForCompiler(h);
  const mgr = ModesManager.getInstance();
  const mode = mgr.createMode({ name: 'Shipped seed check', templateType: 'sales' });
  mgr.replaceNoteSectionsWith(mode.id, NOTE_TEMPLATES[0].sections);
  mgr.setActiveMode(mode.id);
  await drain();
  assert.equal(h.calls, 0);
  mgr.setActiveMode(null);
});

test("a user's own section compiles once; built-in text does not", async () => {
  const h = countingHelper();
  ModesManager.setLlmHelperForCompiler(h);
  const mgr = ModesManager.getInstance();
  const mode = mgr.createMode({ name: 'Shipped add check', templateType: 'general' });
  const builtin = TEMPLATE_NOTE_SECTIONS.general[0];

  mgr.addNoteSection({ modeId: mode.id, title: builtin.title, description: builtin.description });
  await drain();
  assert.equal(h.calls, 0, 're-adding a default section needs no compile');

  mgr.addNoteSection({ modeId: mode.id, title: 'Hiring plans', description: 'Roles they plan to hire for this year.' });
  await drain();
  assert.equal(h.calls, 1, 'a section the user wrote compiles once');
});

test('editing a section clears the instruction written for the old text', async () => {
  const mgr = ModesManager.getInstance();
  const mode = mgr.createMode({ name: 'Shipped edit check', templateType: 'general' });
  const section = mgr.getNoteSections(mode.id)[0];
  mgr.updateNoteSection(section.id, { compiledPrompt: 'Instruction for the old text.' });

  // No provider: the recompile is skipped, so only the clearing can change it.
  ModesManager.setLlmHelperForCompiler({ hasAnyConfiguredProvider: () => false, async generateMeetingSummary() { throw new Error('no'); } });
  mgr.updateNoteSection(section.id, { description: 'Only what changed for customers.' });
  await drain();
  const after = mgr.getNoteSections(mode.id).find((s) => s.id === section.id);
  assert.ok(!after.compiledPrompt, 'the stale instruction is gone');
  assert.equal(sectionGuidance(after), 'Only what changed for customers.');
});

test('"NA" and "Not discussed." lines are placeholders; real notes are not', () => {
  for (const t of ['NA', 'NA.', '"NA"', 'Not discussed.', 'not mentioned', 'N/A']) assert.equal(isEmptyPlaceholder(t), true, t);
  for (const t of ['Nachos for the offsite', 'Not discussed with legal yet; Ana owns it', 'NASA contract renewal']) assert.equal(isEmptyPlaceholder(t), false, t);
});
