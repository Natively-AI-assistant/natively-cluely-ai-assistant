// "Your style" in the follow-up tone picker (2026-10-17). The user's own voice
// (the writing samples of the mode the meeting ran under) is a tone of its own:
// the default when that mode has samples, and never mixed with a preset tone, so
// "Professional" over casual samples drafts professionally. Model calls are fakes.
//
// Run after `npm run build:electron`. No platform branch is involved.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => require(path.join(REPO, 'dist-electron/electron', p));
const style = dist('services/outputs/writingStyle.js');
const { FollowUpDraftGenerator, followUpRedraftPlan } = dist('services/meeting/FollowUpDraftGenerator.js');
const { followUpVoice } = dist('MeetingPersistence.js');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const summary = { title: 'Pricing call', overview: 'Held the list price.', tldr: ['List price held'], decisions: [{ text: 'Hold list price', confidence: 'high' }] };
const fakeLlm = (captured) => ({
    generateMeetingSummary: async (system) => { captured.push(system); return JSON.stringify({ subject: 'Holding the list price for now', body: 'Hi Sam,\n\nWe are holding the list price.\n\nThanks,' }); },
});
const GUIDE = style.renderStyleGuide({ sentenceLength: 'short', avgSentenceWords: 6, formality: 'casual', emoji: 'often', phrases: ['lmk'], description: 'Breezy, emoji-heavy.' });
const draft = async (params) => { const captured = []; const d = await new FollowUpDraftGenerator(fakeLlm(captured)).generate({ summary, mode: 'general', ...params }); return { d, prompt: captured[0] }; };

describe('the generator: one voice per draft', () => {
    test('a style and no tone asked: drafted in "Your style"', async () => {
        const { d, prompt } = await draft({ styleGuide: GUIDE });
        assert.equal(d.tone, 'your_style');
        assert.equal(d.styled, true);
        assert.ok(prompt.includes("WRITE IN THE SENDER'S OWN VOICE"));
        assert.ok(prompt.includes("Tone: the sender's own"));
    });
    test('a preset tone over a style: that tone alone, the style left out', async () => {
        const { d, prompt } = await draft({ tone: 'professional', styleGuide: GUIDE });
        assert.equal(d.tone, 'professional');
        assert.equal(d.styled, undefined);
        assert.ok(prompt.includes('Tone: professional and neutral.'));
        assert.ok(!prompt.includes('OWN VOICE'), 'no casual style pulling against Professional');
    });
    test('"Your style" with no samples left: the mode\'s default tone', async () => {
        const { d, prompt } = await draft({ tone: 'your_style' });
        assert.equal(d.tone, 'professional', "general mode's default");
        assert.ok(!prompt.includes("sender's own"));
    });
    test('no style, no tone: unchanged, the mode default', async () => {
        const { d } = await draft({});
        assert.equal(d.tone, 'professional');
        assert.equal(d.styled, undefined);
    });
    test('in "Your style" the sign-off is the sender\'s alone: the mode\'s "Best," is not offered beside it (2026-10-20)', async () => {
        const styled = await draft({ styleGuide: GUIDE, styleSignOff: 'Cheers,', senderName: 'Evin John' });
        assert.match(styled.prompt, /- Sign-off: Sign off with "Cheers," \(the sender's own\) on its own line after the last paragraph\. One sign-off only\./);
        assert.ok(!styled.prompt.includes('Sign off with "Best," on its own line.'));
        // A preset tone keeps the mode's sign-off, unchanged.
        const preset = await draft({ tone: 'professional', styleGuide: GUIDE, styleSignOff: 'Cheers,', senderName: 'Evin John' });
        assert.ok(preset.prompt.includes('- Sign-off: Sign off with "Best," on its own line.'));
    });
    test('the sender\'s sign-off comes as its own field, not read back out of the prompt text', async () => {
        const guide = style.renderStyleGuide({ sentenceLength: 'short', avgSentenceWords: 6, formality: 'casual', emoji: 'often', phrases: [], signOff: 'Cheers,' });
        const { prompt } = await draft({ styleGuide: guide, senderName: 'Evin John' });
        assert.ok(prompt.includes('- Sign-off: Sign off with "Best," on its own line. One sign-off only, on its own line.'), 'no field: the mode\'s, once');
    });
    test('a "Your style" draft the model left unsigned is signed with the sender\'s own sign-off', async () => {
        const llm = { generateMeetingSummary: async () => JSON.stringify({ subject: 'Holding the list price for now', body: 'Hey Sam,\n\nWe are holding the list price.' }) };
        const d = await new FollowUpDraftGenerator(llm).generate({ summary, mode: 'general', styleGuide: GUIDE, styleSignOff: 'Thanks!', senderName: 'Evin John' });
        assert.equal(d.body, 'Hey Sam,\n\nWe are holding the list price.\n\nThanks!\nEvin');
    });
    test('a preset tone never takes the sender\'s sign-off', async () => {
        const llm = { generateMeetingSummary: async () => JSON.stringify({ subject: 'Holding the list price for now', body: 'Hey Sam,\n\nWe are holding the list price.' }) };
        const d = await new FollowUpDraftGenerator(llm).generate({ summary, mode: 'general', tone: 'concise', styleGuide: GUIDE, styleSignOff: 'Thanks!', senderName: 'Evin John' });
        assert.equal(d.body, 'Hey Sam,\n\nWe are holding the list price.\n\nBest,\nEvin');
    });
    test('a notes Regenerate keeps a "Your style" draft in your style', () => {
        assert.deepEqual(followUpRedraftPlan({ body: 'Hi', tone: 'your_style' }), { redraft: true, tone: 'your_style' });
    });
});

describe('followUpVoice: which tone and style a draft gets', () => {
    const guideFor = (guides) => async (modeId) => guides[modeId];
    const VOICE = { guide: GUIDE, signOff: 'Cheers,' };
    test('a preset tone: that tone, the samples never read', async () => {
        let read = 0;
        assert.deepEqual(await followUpVoice('mode-sales', 'concise', async () => { read += 1; return { guide: GUIDE }; }), { tone: 'concise' });
        assert.equal(read, 0);
    });
    test('no tone asked and the mode has samples: "Your style" is the default', async () => {
        assert.deepEqual(await followUpVoice('mode-sales', undefined, guideFor({ 'mode-sales': VOICE })), { tone: 'your_style', styleGuide: GUIDE, styleSignOff: 'Cheers,' });
        assert.deepEqual(await followUpVoice('mode-sales', 'your_style', guideFor({ 'mode-sales': VOICE })), { tone: 'your_style', styleGuide: GUIDE, styleSignOff: 'Cheers,' });
    });
    test('no samples, no recorded mode, or a failed read: no tone (the mode default)', async () => {
        assert.deepEqual(await followUpVoice('mode-tech', undefined, guideFor({ 'mode-sales': VOICE })), {});
        assert.deepEqual(await followUpVoice(undefined, 'your_style', guideFor({ 'mode-sales': VOICE })), {});
        assert.deepEqual(await followUpVoice('mode-sales', undefined, async () => { throw new Error('disk'); }), {});
    });
});

describe('the wiring', () => {
    test('the draft path goes through followUpVoice', () => {
        const src = read('electron/MeetingPersistence.ts');
        assert.match(src, /const voice = await followUpVoice\(/);
        assert.match(src, /tone: voice\.tone,[\s\S]{0,80}styleGuide: voice\.styleGuide,\s*styleSignOff: voice\.styleSignOff,/);
        assert.match(src, /return guide \? \{ guide, signOff: svc\.signOffForFollowUp\(\) \} : undefined;/);
        assert.match(read('electron/services/meeting/MeetingContextAssembler.ts'), /styleGuide: params\.followUpStyleGuide,/);
    });
    test('every tone list knows "your_style"', () => {
        assert.match(read('electron/services/meeting/MeetingSummaryV3.ts'), /export type FollowUpTone = 'professional' \| 'warm' \| 'concise' \| 'friendly' \| 'your_style';/);
        for (const f of ['electron/preload.ts', 'src/types/electron.d.ts', 'electron/ipcHandlers.ts', 'electron/IntelligenceManager.ts']) {
            assert.doesNotMatch(read(f), /'friendly' \}/, `${f}: a tone union without 'your_style'`);
            assert.match(read(f), /'friendly' \| 'your_style'/, f);
        }
    });
    test('the picker: "Your style" last (next to the upward menu\'s trigger), under a hairline, only when the mode has samples; the first draft takes no tone; Reset keeps the picked tone', () => {
        const src = read('src/components/MeetingDetails.tsx');
        assert.match(src, /\{ value: 'professional'[^\n]*\n\s*\{ value: 'concise'[^\n]*\n\s*\{ value: 'warm'[^\n]*\n\s*\{ value: 'friendly'[^\n]*\n\s*\.\.\.\(offerYourStyle \? \[\{ value: 'your_style' as const, label: t\('Your style'\) \}\] : \[\]\),\n\s*\];/, 'formal to casual, then Your style only when the mode has samples in the Modes Manager');
        assert.match(src, /\{opt\.value === 'your_style' && \(\s*<div role="separator"/, 'a hairline sets Your style apart from the presets');
        assert.match(src, /useEffect\(\(\) => \{ setModeHasStyle\(false\); \}, \[meeting\.id\]\);/, 'another meeting never shows the last one\'s "Your style"');
        assert.match(src, /if \(!followUpOpen\) return;\s*let live = true;/, 'asked when the sheet opens, not when it closes');
        assert.match(src, /api\.getWritingStyleForMeeting\(meeting\.id\)[\s\S]{0,300}\}, \[meeting\.id, followUpStyleModeId, followUpOpen\]\);/, 'asked of main (General when no mode is recorded), again each time the sheet opens');
        assert.match(src, /offerYourStyle=\{modeHasStyle\}/);
        assert.match(src, /if \(!hasFollowUpDraft && !isRegeneratingFollowUp\) void handleRegenerateFollowUp\(\);/);
        assert.match(src, /const resetFollowUp = \(\) => \{[\s\S]{0,300}handleRegenerateFollowUp\(followUpTone\)/);
        assert.match(src, /onClick=\{resetFollowUp\}/);
    });
});
