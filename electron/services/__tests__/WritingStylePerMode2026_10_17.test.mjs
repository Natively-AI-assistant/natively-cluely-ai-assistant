// Follow-ups in your style, per mode (2026-10-17). Each mode keeps its own
// samples, switch and profile in its own file; the one global file from before
// moves to the built-in General mode once; deleting a mode forgets its samples.
// The IPC side (calls name their mode, a meeting's edit teaches only its own
// mode) is covered in MeetingOutputsFollowUpEdit2026_10_15.test.mjs.
//
// Run after `npm run build:electron`. Paths go through node:path and
// os.tmpdir(); no platform branch is involved.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);
const style = require(dist('services/outputs/writingStyle.js'));
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const SAMPLE_A = 'Hi Sam,\n\nQuick note on the plan. I will send the sheet on Friday.\n\nThanks,\nEvin';
const SAMPLE_B = 'Hey team,\n\nShipping today! More soon, promise.\n\nCheers,\nEvin';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'natively-style-mode-'));

describe('per-mode style files', () => {
    test('two modes keep separate samples, across a restart', () => {
        const dir = tmp();
        try {
            const sales = new style.WritingStyleService({ dir, modeId: 'mode-sales' });
            const tech = new style.WritingStyleService({ dir, modeId: 'mode-tech' });
            sales.addSample(SAMPLE_A, 'pasted');
            tech.addSample(SAMPLE_B, 'pasted');
            tech.removeSample(tech.listSamples()[0].id);
            assert.equal(new style.WritingStyleService({ dir, modeId: 'mode-sales' }).status().sampleCount, 1);
            assert.equal(new style.WritingStyleService({ dir, modeId: 'mode-tech' }).status().sampleCount, 0);
            assert.ok(fs.existsSync(path.join(dir, style.styleFileForMode('mode-sales'))));
            assert.ok(!fs.existsSync(path.join(dir, style.WRITING_STYLE_FILE)), 'no global file is written');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    test('a mode id that is not a plain file name is hashed, never a path', () => {
        const name = style.styleFileForMode('../../evil\\mode id');
        assert.match(name, /^writing_style\.mode-[0-9a-f]{32}\.json$/);
        assert.equal(style.styleFileForMode('mode_general_default'), 'writing_style.mode-mode_general_default.json');
    });
});

describe('the old global style goes to General', () => {
    test('moved once, and never over a style General already has', () => {
        const dir = tmp();
        try {
            new style.WritingStyleService({ dir }).addSample(SAMPLE_A, 'pasted');
            assert.equal(style.migrateLegacyStyleFile(dir, 'mode-general'), true);
            assert.equal(new style.WritingStyleService({ dir, modeId: 'mode-general' }).status().pastedCount, 1);
            assert.ok(!fs.existsSync(path.join(dir, style.WRITING_STYLE_FILE)));
            assert.equal(style.migrateLegacyStyleFile(dir, 'mode-general'), false, 'nothing left to move');

            new style.WritingStyleService({ dir }).addSample(SAMPLE_B, 'pasted');
            assert.equal(style.migrateLegacyStyleFile(dir, 'mode-general'), false, 'General keeps its own');
            assert.equal(new style.WritingStyleService({ dir, modeId: 'mode-general' }).status().pastedCount, 1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('deleting a mode', () => {
    test('removes its style file and nothing else', () => {
        const dir = tmp();
        try {
            new style.WritingStyleService({ dir, modeId: 'mode-a' }).addSample(SAMPLE_A, 'pasted');
            new style.WritingStyleService({ dir, modeId: 'mode-b' }).addSample(SAMPLE_B, 'pasted');
            style.removeModeStyleFile(dir, 'mode-a');
            style.removeModeStyleFile(dir, 'mode-never-had-one');
            assert.ok(!fs.existsSync(path.join(dir, style.styleFileForMode('mode-a'))));
            assert.equal(new style.WritingStyleService({ dir, modeId: 'mode-b' }).status().pastedCount, 1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    test('ModesManager.deleteMode calls it', () => {
        assert.match(read('electron/services/ModesManager.ts'), /require\('\.\/outputs\/outputsIpc'\)\.forgetWritingStyleForMode\(id\)/);
    });
});

describe('a follow-up uses its meeting\'s mode', () => {
    test('MeetingPersistence asks for the style of the mode the meeting ran under, and none without one', () => {
        const src = read('electron/MeetingPersistence.ts');
        assert.match(src, /styleModeId = require\('\.\/services\/outputs\/outputsIpc'\)\.meetingStyleModeId\(detailed\)/);
        assert.match(src, /voice = modeId \? await guideFor\(modeId\) : undefined/);
    });
    test('no on/off anywhere: the meeting page says it is in your style, with nothing to turn off', () => {
        const details = read('src/components/MeetingDetails.tsx');
        assert.match(details, /\) : followUpStyled && hasFollowUpDraft && !writingFirst \? t\('Written in your style'\) : null;/);
        for (const f of ['src/components/MeetingDetails.tsx', 'electron/preload.ts', 'src/types/meetingOutputs.ts', 'electron/services/outputs/outputsIpc.ts', 'premium/src/ModesSettings.tsx']) {
            assert.doesNotMatch(read(f), /setWritingStyleEnabled|style-set-enabled/, f);
        }
    });
});
