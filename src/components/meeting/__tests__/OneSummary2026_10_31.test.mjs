// One Summary on the meeting page (2026-10-31). New installs seed the General
// mode as Summary / Action items / Key points, and the page drew the tldr under
// its own "Summary" above the template's "Summary" section, so a General-mode
// note showed "Summary" twice. When the template has a Summary section with
// lines, that section is the Summary (source contract; there is no render
// harness). The notepad and the exports are covered in NotepadModel2026_10_20
// and MeetingOutputsBlocks2026_10_15.
//
// Pure renderer logic; no platform branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '../../MeetingDetails.tsx'), 'utf8');

test('the tldr block is skipped when the template has its own Summary section', () => {
    assert.match(src, /const templateHasSummary = \(meeting\.detailedSummary\?\.sectionsV3 \|\| \[\]\)\.some\(\(s\) => s\.bullets\?\.length > 0 && isSummarySectionTitle\(s\.title\)\);/);
    assert.match(src, /\{isV3Summary && v3Tldr\.length > 0 && !templateHasSummary && \(\(\) => \{/);
});

test('only an exact Summary / TL;DR title counts, the same test as the notepad', () => {
    const m = src.match(/const isSummarySectionTitle = \(title\?: string \| null\): boolean => (\/.+\/i)\.test\(title \|\| ''\);/);
    assert.ok(m, 'isSummarySectionTitle not found');
    const re = new Function(`return ${m[1]}`)();
    for (const t of ['Summary', 'summary:', 'TL;DR', 'TLDR']) assert.equal(re.test(t), true, t);
    for (const t of ['Study summary', 'Opportunity summary', 'Summary of risks']) assert.equal(re.test(t), false, t);
    const notepad = readFileSync(join(HERE, '../../notes/notepadView.ts'), 'utf8');
    assert.ok(notepad.includes(m[1]), 'notepadView isSummaryTitle uses a different test');
});
