// The meeting page's notes feedback and templates (2026-10-15): thumbs
// sampling (about one meeting in ten, the same meetings every time),
// "Regenerate as" options, which versions a Compare opens with, and the
// wiring in the components (source contracts; there is no render harness).
//
// Pure renderer logic; no platform branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
    RATING_PROMPT_RATE, FRESH_NOTES_MS, ratingSampleBucket, inRatingSample, notesWrittenAt, shouldPromptRating,
    templatePickerOptions, comparePair,
} = await import('../notesFeedback.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, rel), 'utf8');
const live = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

test('sampling: deterministic per meeting id, about 10% of ids', () => {
    assert.equal(RATING_PROMPT_RATE, 0.1);
    const ids = Array.from({ length: 20000 }, (_, i) => `meeting-${i}-${(i * 7919).toString(36)}`);
    const picked = ids.filter((id) => inRatingSample(id)).length / ids.length;
    assert.ok(picked > 0.085 && picked < 0.115, `sampled ${picked}`);
    for (const id of ids.slice(0, 500)) {
        assert.equal(inRatingSample(id), inRatingSample(id), 'same id, same answer');
        assert.equal(ratingSampleBucket(id), ratingSampleBucket(id));
        const b = ratingSampleBucket(id);
        assert.ok(b >= 0 && b < 1000);
    }
    assert.equal(inRatingSample(''), false);
    assert.equal(inRatingSample('x', 0), false);
    assert.equal(ids.every((id) => inRatingSample(id, 1)), true);
});

test('sampling: only new notes are prompted', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    const fresh = { generation: { completedAt: '2026-10-15T11:00:00Z' } };
    const old = { generation: { completedAt: '2026-10-13T11:00:00Z' } };
    assert.equal(notesWrittenAt(fresh), Date.parse('2026-10-15T11:00:00Z'));
    assert.equal(notesWrittenAt({ generation: { startedAt: '2026-10-15T10:00:00Z' } }), Date.parse('2026-10-15T10:00:00Z'));
    assert.equal(notesWrittenAt({}), null);
    assert.equal(notesWrittenAt({ generation: { startedAt: new Date(0).toISOString() } }), null, 'the reducer\'s epoch placeholder is not a time');
    const inSample = Array.from({ length: 200 }, (_, i) => `id-${i}`).find((id) => inRatingSample(id));
    const outSample = Array.from({ length: 200 }, (_, i) => `id-${i}`).find((id) => !inRatingSample(id));
    assert.equal(shouldPromptRating(inSample, fresh, now), true);
    assert.equal(shouldPromptRating(inSample, old, now), false, 'older than a day');
    assert.equal(shouldPromptRating(inSample, {}, now), false, 'no time, no prompt');
    assert.equal(shouldPromptRating(outSample, fresh, now), false);
    assert.equal(FRESH_NOTES_MS, 86_400_000);
});

test('Regenerate as: General first, the template that wrote the notes marked once', () => {
    const modes = [
        { id: 'm_sales', name: 'Sales call', templateType: 'sales' },
        { id: 'm_gen', name: 'General', templateType: 'general' },
        { id: 'm_tech', name: 'Interview', templateType: 'technical-interview' },
        { id: '', name: 'broken', templateType: 'sales' },
        { id: 'm_blank', name: '  ', templateType: 'sales' },
    ];
    const byId = templatePickerOptions(modes, { selectedModeId: 'm_sales', selectedModeName: 'Sales call', selectedTemplateType: 'sales' });
    assert.deepEqual(byId.map((o) => o.id), ['m_gen', 'm_sales', 'm_tech']);
    assert.deepEqual(byId.filter((o) => o.current).map((o) => o.id), ['m_sales']);
    const byTemplate = templatePickerOptions(modes, { selectedTemplateType: 'general' });
    assert.deepEqual(byTemplate.filter((o) => o.current).map((o) => o.id), ['m_gen']);
    assert.deepEqual(templatePickerOptions(null, null), []);
    assert.equal(templatePickerOptions(modes, null).some((o) => o.current), false);
});

test('Compare: the version shown against the current notes, else the latest earlier one', () => {
    const versions = [{ id: 3, createdAt: 10 }, { id: 9, createdAt: 30 }, { id: 5, createdAt: 20 }];
    assert.deepEqual(comparePair('current', versions), [9, 'current']);
    assert.deepEqual(comparePair(5, versions), [5, 'current']);
    assert.deepEqual(comparePair(42, versions), [9, 'current'], 'an unknown version falls back to the latest');
    assert.equal(comparePair('current', []), null);
});

test('wiring: the picker goes through the same regenerate (and gate) as the suggestion', () => {
    const page = live(read('../../MeetingDetails.tsx'));
    assert.match(page, /<NotesTemplatePicker[\s\S]*?onPick=\{\(opt\) => \{[^}]*handleRegenerate\(\{ modeId: opt\.id \}\)/);
    // A refusal from main marks that template and shows the way to the plans.
    assert.match(page, /res\?\.error === 'pro_required'[\s\S]{0,600}setTemplatesNeedingPro/);
    assert.match(page, /openSettingsTab\?\.\('plans'\)/);
    // The suggestion's refusal still reads as before.
    assert.match(page, /else setDetectedNeedsPro\(true\)/);
});

test('wiring: Compare shows nothing naming the versions until the pick', () => {
    const page = live(read('../../MeetingDetails.tsx'));
    // In place of the notes (their tabs would give it away).
    assert.match(page, /\) : compare \? \([\s\S]*?<NotesCompare/);
    const cmp = live(read('../NotesCompare.tsx'));
    // Names come only from the reveal; the notes columns read content fields only.
    assert.match(cmp, /\{side && <span[^>]*>\{describe\(side\)\}/);
    assert.match(cmp, /sideTitle\('A', reveal\?\.a \?\? null\)/);
    assert.doesNotMatch(cmp, /\.mode\b|\.generation\b/);
});

test('wiring: the rating is asked above the notes for the sample, the quiet row otherwise (never both)', () => {
    const page = live(read('../../MeetingDetails.tsx'));
    assert.match(page, /isV3Summary && promptRating && \(\s*<NotesRating[\s\S]*?prompted/);
    assert.match(page, /isV3Summary && !promptRating && \(\s*<NotesRating/);
    assert.match(page, /shouldPromptRating\(baseMeeting\.id, baseMeeting\.detailedSummary, Date\.now\(\)\)/);
});

test('a template refused for want of Pro stays pickable (main checks again), keeps its label, and the refusal is forgotten when the plan changes', () => {
    const picker = live(read('../NotesTemplatePicker.tsx'));
    assert.match(picker, /onClick=\{\(\) => \{ close\(true\); if \(!opt\.current\) onPick\(opt\); \}\}/, 'no gate in the click');
    assert.match(picker, /gated && <span[^>]*>\{t\('Needs Natively Pro'\)\}/, 'the label stays');
    const page = live(read('../../MeetingDetails.tsx'));
    const forget = page.slice(page.indexOf('const forget = () => {'), page.indexOf('const forget = () => {') + 600);
    assert.match(forget, /setTemplatesNeedingPro\(new Set\(\)\)/);
    for (const ev of ['onLicenseStatusChanged', 'onTrialStarted', 'onTrialEnded']) assert.ok(forget.includes(ev), ev);
    assert.match(page, /next\.delete\(okId\)/, 'a success clears that template\'s mark');
});

test('Compare shows each version\'s overview with its sections, so an overview-only difference shows', () => {
    const cmp = live(read('../NotesCompare.tsx'));
    const col = cmp.slice(cmp.indexOf('const NotesColumn'), cmp.indexOf('const NotesColumn') + 2500);
    assert.match(col, /const overview = typeof notes\?\.overview === 'string' \? notes\.overview\.trim\(\) : ''/);
    assert.match(col, /\{overview && <p[^>]*>\{overview\}<\/p>\}/);
    assert.doesNotMatch(col, /tldr\.length === 0 && sections\.length === 0 && actions\.length === 0/, 'no longer only when nothing else is there');
    // Main sends the overview through untouched (only identifying fields are taken out).
    const main = readFileSync(join(HERE, '../../../../electron/services/meeting/notesCompare.ts'), 'utf8');
    assert.match(main, /const IDENTIFYING_FIELDS = \[[^\]]*\]/);
    assert.doesNotMatch(main.match(/const IDENTIFYING_FIELDS = \[[^\]]*\]/)[0], /overview/);
});
