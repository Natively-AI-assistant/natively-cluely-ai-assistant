// Note templates (2026-10-20): Granola's template library, for the notes only
// (noteTemplates.ts). Picked in the notepad for the running meeting
// (live-notes:set-template, held by MeetingPersistence until Stop) or for a
// Regenerate; the template's sections replace the mode's, live answers keep
// the mode. Pro or a live trial, as Regenerate in another mode.
//
// Run under Electron's Node (the bundle pulls native modules):
//   ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/NoteTemplates2026_10_20.test.mjs
// No platform branch: nothing here differs between macOS and Windows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const Module = require('node:module');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);
// LF everywhere: premium/ has no .gitattributes, so Windows checks it out CRLF.
const src = (p) => fs.readFileSync(path.join(REPO, p), 'utf8').replace(/\r\n/g, '\n');

// A stand-in `electron` so the bundle loads outside an app (it only needs these at import).
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
    if (req === 'electron') return { app: { getPath: () => '/tmp', isReady: () => false, getAppPath: () => '/tmp', isPackaged: false, on() {}, once() {} }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} } };
    return realLoad.call(this, req, parent, isMain);
};
const { MeetingPersistence, recoveryMetadataFor, resolveRegenerateNoteTemplate } = require(dist('MeetingPersistence.js'));
Module._load = realLoad;
const {
    NOTE_TEMPLATES, NOTE_TEMPLATE_GROUPS, QUICK_NOTE_TEMPLATE_IDS, applyNoteTemplate, noteTemplateById, quickNoteTemplates, searchNoteTemplates,
} = require(dist('services/meeting/noteTemplates.js'));
const { regenerateGate, noteTemplateGate } = require(dist('services/meeting/notesTemplateGate.js'));

describe('the library', () => {
    test('29 templates, unique ids, every one in a known group with sections that say what goes in them', () => {
        assert.equal(NOTE_TEMPLATES.length, 29);
        assert.equal(new Set(NOTE_TEMPLATES.map((t) => t.id)).size, NOTE_TEMPLATES.length);
        for (const t of NOTE_TEMPLATES) {
            assert.ok(NOTE_TEMPLATE_GROUPS.includes(t.group), t.id);
            assert.ok(t.name && t.context.length > 20, t.id);
            assert.ok(t.sections.length >= 2, t.id);
            for (const s of t.sections) assert.ok(s.title.trim() && s.description.trim().length > 10, `${t.id}: ${s.title}`);
            assert.ok(t.id.length <= 64 && /^[a-z0-9-]+$/.test(t.id), t.id);
        }
    });
    test('no other product named in anything the model or the user reads', () => {
        const text = JSON.stringify(NOTE_TEMPLATES).toLowerCase();
        assert.ok(!text.includes('granola'));
    });
    test('the five quick ones, in order, all Popular', () => {
        assert.deepEqual(quickNoteTemplates().map((t) => t.id), [...QUICK_NOTE_TEMPLATE_IDS]);
        assert.deepEqual(QUICK_NOTE_TEMPLATE_IDS, ['one-to-one', 'customer-discovery', 'hiring', 'stand-up', 'weekly-team-meeting']);
        for (const t of quickNoteTemplates()) assert.equal(t.group, 'Popular');
    });
    test('lookup takes known string ids only', () => {
        assert.equal(noteTemplateById('hiring').name, 'Hiring');
        for (const bad of ['nope', '', null, undefined, 7, {}, 'x'.repeat(65)]) assert.equal(noteTemplateById(bad), null, String(bad));
    });
    test('search: every word must match the name, group or a section heading; empty keeps all', () => {
        assert.equal(searchNoteTemplates('').length, NOTE_TEMPLATES.length);
        assert.ok(searchNoteTemplates('hiring').some((t) => t.id === 'hiring'));
        assert.ok(searchNoteTemplates('VC board').every((t) => t.group === 'VC' || /board/i.test(t.name)));
        assert.ok(searchNoteTemplates('VC board').some((t) => t.id === 'vc-board-meeting'));
        assert.deepEqual(searchNoteTemplates('zzzz qqqq'), []);
    });
    test('apply: the template\'s sections, its description before the mode\'s own context (kept)', () => {
        const t = noteTemplateById('stand-up');
        const a = applyNoteTemplate(t, 'MODE CONTEXT: I am a PM.');
        assert.deepEqual(a.sections.map((s) => s.title), t.sections.map((s) => s.title));
        assert.notEqual(a.sections[0], t.sections[0]);
        assert.ok(a.contextBlock.startsWith(`NOTES TEMPLATE: ${t.name}\nThis meeting: ${t.context}`));
        assert.ok(a.contextBlock.endsWith('\n\nMODE CONTEXT: I am a PM.'));
        assert.ok(!applyNoteTemplate(t, '').contextBlock.includes('\n\n'));
    });
});

describe('the running meeting\'s template (MeetingPersistence)', () => {
    const fake = () => {
        const self = { liveNoteTemplateId: null, changes: 0 };
        self.liveJournal = { noteChange: () => { self.changes += 1; } };
        return self;
    };
    const set = (self, id) => MeetingPersistence.prototype.setLiveNoteTemplate.call(self, id);
    test('a known id is held and written to the live copy once; unknown ids are refused; null clears', () => {
        const self = fake();
        assert.equal(set(self, 'hiring'), true);
        assert.equal(MeetingPersistence.prototype.getLiveNoteTemplate.call(self), 'hiring');
        assert.equal(self.changes, 1);
        assert.equal(set(self, 'hiring'), true);
        assert.equal(self.changes, 1);
        assert.equal(set(self, 'nope'), false);
        assert.equal(self.liveNoteTemplateId, 'hiring');
        assert.equal(set(self, null), true);
        assert.equal(self.liveNoteTemplateId, null);
        assert.equal(self.changes, 2);
        assert.equal(set(self, null), true);
        assert.equal(self.changes, 2);
    });
    test('recovery: a saved template comes back with the meeting; an unknown one does not', () => {
        assert.equal(recoveryMetadataFor({}, { noteTemplateId: 'board-meeting' }).metadata.noteTemplateId, 'board-meeting');
        assert.deepEqual(recoveryMetadataFor({}, { noteTemplateId: 'gone' }), { metadata: null, mode: null });
    });
});

describe('Regenerate: which template', () => {
    const stored = { selectedModeId: 'm1', noteTemplateId: 'hiring' };
    test('an explicit template wins; null clears it; unknown is none', () => {
        assert.equal(resolveRegenerateNoteTemplate({ noteTemplateId: 'stand-up', modeId: 'm2', stored }).id, 'stand-up');
        assert.equal(resolveRegenerateNoteTemplate({ noteTemplateId: null, stored }), null);
        assert.equal(resolveRegenerateNoteTemplate({ noteTemplateId: 'nope', stored }), null);
    });
    test('choosing a mode drops the template; a plain regenerate keeps the one the notes were in', () => {
        assert.equal(resolveRegenerateNoteTemplate({ modeId: 'm2', stored }), null);
        assert.equal(resolveRegenerateNoteTemplate({ templateType: 'sales', stored }), null);
        assert.equal(resolveRegenerateNoteTemplate({ stored }).id, 'hiring');
        assert.equal(resolveRegenerateNoteTemplate({ stored: { noteTemplateId: 'gone' } }), null);
        assert.equal(resolveRegenerateNoteTemplate({}), null);
    });
});

describe('the Pro gate', () => {
    const deps = (pro) => ({ templateOfMode: () => 'general', isProOrTrialActive: () => pro });
    test('a template needs Pro or a live trial; clearing or none never asks', () => {
        assert.equal(noteTemplateGate('hiring', () => false), 'pro_required');
        assert.equal(noteTemplateGate('hiring', () => true), null);
        assert.equal(noteTemplateGate(null, () => false), null);
        assert.equal(noteTemplateGate(undefined, () => false), null);
        assert.equal(regenerateGate({ noteTemplateId: 'hiring' }, deps(false)), 'pro_required');
        assert.equal(regenerateGate({ noteTemplateId: 'hiring', modeId: 'm_general' }, deps(false)), 'pro_required');
        assert.equal(regenerateGate({ noteTemplateId: 'hiring' }, deps(true)), null);
        assert.equal(regenerateGate({ noteTemplateId: null }, deps(false)), null);
    });
});

describe('the wiring (source contracts)', () => {
    const persistence = src('electron/MeetingPersistence.ts');
    const ipc = src('electron/ipcHandlers.ts');
    const preload = src('electron/preload.ts');
    const types = src('src/types/electron.d.ts');
    test('Stop takes the template into the notes\' metadata and clears it before any early exit', () => {
        const stop = persistence.slice(persistence.indexOf('public async stopMeeting'), persistence.indexOf('private captureModeSnapshot'));
        const take = stop.indexOf('this.liveNoteTemplateId = null;');
        assert.ok(take > 0 && take < stop.indexOf('durationMs < 1000'));
        assert.match(stop, /\.\.\.\(noteTemplateId \? \{ noteTemplateId \} : \{\}\)/);
    });
    test('the live copy and the placeholder\'s recovery record carry it', () => {
        assert.match(persistence, /if \(this\.liveNoteTemplateId\) meta\.noteTemplateId = this\.liveNoteTemplateId;/);
        assert.match(persistence, /if \(noteTemplateById\(metadata\.noteTemplateId\)\) meta\.noteTemplateId = metadata\.noteTemplateId;/);
        assert.match(src('electron/services/meeting/LiveMeetingJournal.ts'), /noteTemplateId\?: string;/);
    });
    test('the save and Regenerate apply it after the mode and record it in summary.mode', () => {
        const save = persistence.slice(persistence.indexOf('private async processAndSaveMeeting'));
        assert.ok(save.indexOf('applyNoteTemplate(noteTemplate, modeContextBlock)') > save.indexOf('Failed to load mode sections'));
        assert.equal((persistence.match(/\.\.\.noteTemplateMeta\(noteTemplate\),/g) || []).length, 2);
        const regen = persistence.slice(persistence.indexOf('public async regenerateSavedMeeting'));
        assert.ok(regen.indexOf('resolveRegenerateNoteTemplate({') > regen.indexOf('regenerate mode load failed'));
        assert.match(src('electron/services/meeting/MeetingSummaryV3.ts'), /noteTemplateId: cleanString\(raw\.noteTemplateId\)\.slice\(0, 64\)/);
    });
    test('IPC: set/get template, unknown ids refused before the gate; Regenerate passes it through the gate', () => {
        const setTpl = ipc.slice(ipc.indexOf("safeHandle('live-notes:set-template'"), ipc.indexOf("safeHandle('live-notes:get-template'"));
        assert.ok(setTpl.indexOf("if (id === null)") < setTpl.indexOf('noteTemplateGate('));
        assert.ok(setTpl.indexOf("'unknown_template'") < setTpl.indexOf('noteTemplateGate('));
        assert.match(ipc, /regenerateGate\(\{ modeId, templateType, noteTemplateId \}/);
        assert.match(ipc, /mgr\.regenerateMeetingSummary\(id, \{ templateType, modeId, noteTemplateId, tone \}\)/);
        assert.match(preload, /liveNotesSetTemplate: \(id: string \| null\) => ipcRenderer\.invoke\('live-notes:set-template', id\)/);
        assert.match(preload, /liveNotesGetTemplate: \(\) => ipcRenderer\.invoke\('live-notes:get-template'\)/);
        assert.match(preload, /noteTemplateId: opts\?\.noteTemplateId/);
        assert.match(types, /liveNotesSetTemplate\?: \(id: string \| null\) => Promise<\{ success: boolean; error\?: 'pro_required' \| 'unknown_template' \}>/);
        assert.match(types, /liveNotesGetTemplate\?: \(\) => Promise<string \| null>/);
    });
    test('no emoji: not in the templates, not on any template row (Evin: emoji read as cheap)', () => {
        const files = [
            'electron/services/meeting/noteTemplates.ts',
            'src/components/notes/NoteTemplateGallery.tsx',
            'src/components/notes/NotesTemplateMenu.tsx',
            'src/components/notes/NotesEditor.tsx',
            'src/components/notes/notesEditorModel.ts',
            'src/components/NotesWindow.tsx',
        ];
        for (const f of files) {
            assert.doesNotMatch(src(f), /\p{Extended_Pictographic}/u, `${f} has an emoji`);
            assert.doesNotMatch(src(f), /\bemoji\b/, `${f} still carries an emoji field`);
        }
    });
});

// A mode's Notes template from a note template (2026-10-21): Modes Manager ›
// Notes template › Use a template replaces the mode's sections in one write.
describe('a template as a mode\'s notes template', () => {
    const Database = require('better-sqlite3');
    const { DatabaseManager } = require(dist('db/DatabaseManager.js'));
    const fresh = () => {
        const db = new Database(':memory:');
        db.exec('CREATE TABLE mode_note_sections (id TEXT PRIMARY KEY, mode_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT, sort_order INTEGER)');
        db.prepare('INSERT INTO mode_note_sections VALUES (?, ?, ?, ?, ?)').run('old1', 'm1', 'Mine', 'my own', 0);
        db.prepare('INSERT INTO mode_note_sections VALUES (?, ?, ?, ?, ?)').run('other', 'm2', 'Other mode', 'kept', 0);
        return db;
    };
    const rows = (db, mode) => db.prepare('SELECT id, title, sort_order FROM mode_note_sections WHERE mode_id = ? ORDER BY sort_order').all(mode);
    test('the template\'s sections replace the mode\'s, in order; other modes untouched', () => {
        const db = fresh();
        const t = noteTemplateById('stand-up');
        const ok = DatabaseManager.prototype.replaceNoteSections.call({ db }, 'm1', t.sections.map((s, i) => ({ id: `n${i}`, ...s })));
        assert.equal(ok, true);
        assert.deepEqual(rows(db, 'm1').map((r) => r.title), t.sections.map((s) => s.title));
        assert.deepEqual(rows(db, 'm1').map((r) => r.sort_order), t.sections.map((_, i) => i));
        assert.deepEqual(rows(db, 'm2').map((r) => r.title), ['Other mode']);
    });
    test('a failed insert keeps the old sections (one transaction)', () => {
        const db = fresh();
        // Same id twice: the second insert breaks the primary key.
        const ok = DatabaseManager.prototype.replaceNoteSections.call({ db }, 'm1', [{ id: 'dup', title: 'A', description: 'a' }, { id: 'dup', title: 'B', description: 'b' }]);
        assert.equal(ok, false);
        assert.deepEqual(rows(db, 'm1').map((r) => r.title), ['Mine']);
    });
    test('IPC: Pro gate, then a known template and mode, then one replace; preload and types', () => {
        const ipc = src('electron/ipcHandlers.ts');
        const h = ipc.slice(ipc.indexOf("safeHandle('modes:apply-note-template'"), ipc.indexOf("safeHandle('modes:remove-all-note-sections'"));
        assert.ok(h.indexOf('isProOrTrialActive()') < h.indexOf('noteTemplateById('));
        assert.ok(h.indexOf("'unknown_template'") < h.indexOf('replaceNoteSectionsWith('));
        assert.ok(h.indexOf("'unknown_mode'") < h.indexOf('replaceNoteSectionsWith('));
        assert.match(src('electron/services/ModesManager.ts'), /replaceNoteSections\(modeId, rows\)\) return null;\n\s+this\.compileAllSectionsAsync\(modeId\);/);
        assert.match(src('electron/preload.ts'), /modesApplyNoteTemplate: \(modeId: string, templateId: string\) =>\n\s+ipcRenderer\.invoke\('modes:apply-note-template', modeId, templateId\)/);
        assert.match(src('src/types/electron.d.ts'), /modesApplyNoteTemplate\?: \(modeId: string, templateId: string\)/);
    });
    test('Modes Manager: Use a template beside Remove template, applied only to the mode still open', () => {
        const mm = src('premium/src/ModesSettings.tsx');
        assert.match(mm, /<NotesTemplatePicker[\s\S]*?currentTitles=\{noteSections\.map\(s => s\.title\)\}[\s\S]*?modeDefault=\{modeDefault\}[\s\S]*?onPick=\{applyNoteTemplate\}/);
        const apply = mm.slice(mm.indexOf('const applyNoteTemplate = async'), mm.indexOf('// ─── Render', mm.indexOf('const applyNoteTemplate = async')));
        assert.ok(apply.indexOf('const id = selectedId;') < apply.indexOf('modesApplyNoteTemplate'));
        assert.ok(apply.indexOf('if (selectedIdRef.current !== id) return;') < apply.indexOf('setNoteSections(result.sections)'));
        assert.doesNotMatch(mm.slice(mm.indexOf('function NotesTemplatePicker'), mm.indexOf('// ─── TemplatePicker')), /<select/);
    });
});

// "This mode" (2026-10-21): a mode whose default sections were removed gets
// them back from Use a template (Evin: "if he removes it no way to get there again").
describe('a mode\'s own default back from Use a template', () => {
    const { MODE_DEFAULT_NOTE_TEMPLATE_ID } = require(dist('services/meeting/noteTemplates.js'));
    const { ModesManager, TEMPLATE_NOTE_SECTIONS } = require(dist('services/ModesManager.js'));
    test('the id is no template\'s, so a real template can never be taken for it', () => {
        assert.equal(MODE_DEFAULT_NOTE_TEMPLATE_ID, 'mode-default');
        assert.equal(noteTemplateById(MODE_DEFAULT_NOTE_TEMPLATE_ID), null);
    });
    test('the default is the mode type\'s seed, read from its current type; none for an unknown mode', () => {
        const fake = (type) => ({ getModes: () => [{ id: 'm', templateType: type }] });
        for (const type of ['technical-interview', 'sales', 'general']) {
            assert.deepEqual(ModesManager.prototype.defaultNoteSectionsFor.call(fake(type), 'm'), TEMPLATE_NOTE_SECTIONS[type], type);
            assert.ok(TEMPLATE_NOTE_SECTIONS[type].length > 0, type);
        }
        assert.deepEqual(ModesManager.prototype.defaultNoteSectionsFor.call(fake('sales'), 'other'), []);
    });
    test('IPC takes the default id before the template lookup; the read is wired through preload', () => {
        const ipc = src('electron/ipcHandlers.ts');
        const h = ipc.slice(ipc.indexOf("safeHandle('modes:apply-note-template'"), ipc.indexOf("safeHandle('modes:get-default-note-sections'"));
        assert.match(h, /const toDefault = templateId === MODE_DEFAULT_NOTE_TEMPLATE_ID;/);
        assert.match(h, /if \(!toDefault && !template\) return \{ success: false, error: 'unknown_template' \};/);
        assert.match(h, /toDefault \? mgr\.defaultNoteSectionsFor\(modeId\) : template!\.sections/);
        assert.match(src('electron/preload.ts'), /modesGetDefaultNoteSections: \(modeId: string\) => ipcRenderer\.invoke\('modes:get-default-note-sections', modeId\)/);
    });
    test('Modes Manager: loads the mode-type default and offers it in the template picker', () => {
        const mm = src('premium/src/ModesSettings.tsx');
        assert.match(mm, /api\(\)\?\.modesGetDefaultNoteSections\?\.\(selectedId\)/);
        assert.match(mm, /setDefaultNoteSections\(Array\.isArray\(defaults\) \? defaults : \[\]\)/);
        assert.match(mm, /label: mode\.templateType === 'general' \? 'General' : \(TEMPLATE_MAP\[mode\.templateType\]\?\.label \?\? 'Default'\)/);
        assert.match(mm, /modeDefault=\{modeDefault\}/);
        assert.match(mm, /onPick=\{applyNoteTemplate\}/);
    });
});

describe('each note template has its own icon in the gallery (2026-10-21)', () => {
    test('every template id has a glyph, drawn on the neutral tile in secondary ink (no group colours)', () => {
        const icons = src('src/components/notes/noteTemplateIcons.tsx');
        for (const t of NOTE_TEMPLATES) assert.match(icons, new RegExp(`\\n    '?${t.id}'?: [A-Z]\\w+,`), t.id);
        assert.doesNotMatch(icons, /#[0-9a-f]{6}|gradient|boxShadow/i);
        const gallery = src('src/components/notes/NoteTemplateGallery.tsx');
        assert.match(gallery, /const Glyph = noteTemplateGlyph\(t\.id\);/);
        assert.match(gallery, /background: 'var\(--np-tile\)'[\s\S]{0,200}<Glyph [^>]*var\(--np-tile-ink, var\(--np-ink-secondary\)\)/);
        assert.match(gallery, /<Tile t=\{t\} \/>/);
        assert.match(gallery, /<Tile t=\{picked\} \/>/);
    });

    test("the gallery wears Natively's lavender, not Granola's cream, in both themes", () => {
        const gallery = src('src/components/notes/NoteTemplateGallery.tsx');
        const css = src('src/index.css');
        assert.match(gallery, /className="np-lavender fixed inset-0/);
        assert.match(gallery, /background: 'var\(--np-cta, var\(--np-ink\)\)'/);
        // No rule under the title; the search is a filled pill with a clear button.
        assert.doesNotMatch(gallery, /pl-6 pr-1\.5" style=\{\{ borderBottom/);
        assert.match(gallery, /className="np-search h-8 [^"]*rounded-full"/);
        assert.match(gallery, /aria-label="Clear search" onClick=\{\(\) => onQuery\(''\)\}/);
        assert.match(css, /\.np-search:focus-within \{/);
        const light = css.match(/\.notepad \.np-lavender \{([^}]*)\}/)?.[1] ?? '';
        const dark = css.match(/\.notepad\[data-np-theme="dark"\] \.np-lavender \{([^}]*)\}/)?.[1] ?? '';
        assert.match(light, /--np-surface: #fcfcfd;/);
        assert.match(light, /--np-ink: #1d1d1f;/);
        assert.match(light, /--np-ring: #e3e3e8;/);
        assert.match(light, /--np-cta: #4a5bd4;/);
        for (const v of ['surface', 'ink', 'ring', 'wash', 'tile', 'tile-ink', 'card', 'cta', 'cta-ink', 'scrim']) {
            assert.match(light, new RegExp(`--np-${v}:`), `light ${v}`);
            assert.match(dark, new RegExp(`--np-${v}:`), `dark ${v}`);
        }
    });
});
