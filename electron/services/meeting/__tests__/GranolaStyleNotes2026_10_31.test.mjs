// Notes without a template, written the way Granola's default notes are (2026-10-31).
// The 21-meeting Natively vs Granola benchmark ran with no mode active: every
// Natively note had no sections at all (the chunk prompt asked for "Section title"
// findings and the reducer dropped them as undeclared), so the notes were an
// overview and a three-line Summary while Granola's had 3-5 topic headings and
// Next Steps. Now: the model names the topics (at most the heading budget), the
// reducer keeps them, and the action items close the notes as their own section.
// Also the "What did I miss" contract: Granola's two or three plain bullets.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test <this file>
//
// Pure logic; no platform branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../../dist-electron/electron');
const load = (p) => import(pathToFileURL(path.join(dist, p)).href);
const { MeetingSummaryReducer, AUTO_ACTION_ITEMS_SECTION_ID } = await load('services/meeting/MeetingSummaryReducer.js');
const { TranscriptNormalizer } = await load('services/meeting/TranscriptNormalizer.js');
const { buildChunkPrompt, autoHeadingsTask } = await load('services/meeting/ChunkSummaryGenerator.js');
const { buildNotesDocument } = await load('services/outputs/notesDocument.js');
const { resolveV2SystemPrompt } = await load('llm/promptSystemV2.js');

const ev = [{ speakerName: 'Mei', quote: 'said so', timestampMs: 1000 }];
const atom = (over = {}) => ({
    chunkIndex: 0, timeRange: { startMs: 0, endMs: 60000 },
    brief: '', decisions: [], actionItems: [],
    openQuestions: [], risks: [], topics: [], people: [], deadlines: [], modeSpecificFindings: {},
    sourceQualityWarnings: [], ...over,
});
const finding = (text) => ({ text, evidence: ev, confidence: 'high' });
const reduce = (atoms, modeNoteSections = []) => new MeetingSummaryReducer().reduce({
    title: 't', atoms,
    normalizedTranscript: new TranscriptNormalizer().normalize([{ speaker: 'user', text: 'We met.', timestamp: 0 }]),
    modeTemplateType: 'general', modeNoteSections,
});
const chunk = { chunkIndex: 0, text: '[0s] Me: hello', timeRange: { startMs: 0, endMs: 1000 }, segments: [] };

test('no template: the chunk prompt asks for topic headings within the heading budget, not "Section title"', () => {
    const { systemPrompt, jsonShapeHint } = buildChunkPrompt({ chunk, totalChunks: 1, modeNoteSections: [], meetingTotalChars: 5000 });
    assert.match(systemPrompt, /topic headings you name yourself/);
    assert.match(systemPrompt, /At most 4 headings for the whole meeting/);
    assert.match(systemPrompt, /Never generic/);
    assert.doesNotMatch(jsonShapeHint, /"Section title"/);
    assert.match(autoHeadingsTask(30000, undefined), /At most 5 headings/);
    // The user's own "#" headings come first.
    assert.match(autoHeadingsTask(5000, '# Pricing\nflat\n# Timeline\nQ1'), /"Pricing", "Timeline"/);
});

test('a template keeps its own task; no topic headings are asked for', () => {
    const { systemPrompt } = buildChunkPrompt({ chunk, totalChunks: 1, modeNoteSections: [{ title: 'Pricing', description: 'Prices' }], meetingTotalChars: 5000 });
    assert.doesNotMatch(systemPrompt, /topic headings you name yourself/);
    assert.match(systemPrompt, /SECTION "Pricing"/);
});

test('bullets are asked for in a note-taker\'s shorthand, figures kept', () => {
    const { systemPrompt } = buildChunkPrompt({ chunk, totalChunks: 1, modeNoteSections: [], meetingTotalChars: 5000 });
    assert.match(systemPrompt, /lead with the subject, then its specifics/);
    assert.match(systemPrompt, /\$7\.20, not \$720/);
});

test('no template: the model\'s headings become sections, merged across chunks; generic ones are dropped; action items close the notes', () => {
    const s = reduce([
        atom({ modeSpecificFindings: { 'Resolution rate drop': [finding('Resolution: 61% to 48% since September')], 'Summary': [finding('Should not appear')] },
            actionItems: [{ text: 'Reconnect the catalog feed', owner: 'Kemal', deadline: 'November 6', explicitness: 'explicit', confidence: 'high', evidence: ev }] }),
        atom({ chunkIndex: 1, modeSpecificFindings: { 'resolution rate drop': [finding('Root cause: feed stopped syncing on September 9')], 'Deal agreed': [finding('90-day extension at $2,400/month')], 'Next steps': [finding('Send paperwork')] } }),
    ]);
    assert.deepEqual(s.sections.map((x) => x.title), ['Resolution rate drop', 'Deal agreed', 'Action items']);
    assert.equal(s.sections[0].bullets.length, 2);
    const actions = s.sections.at(-1);
    assert.equal(actions.id, AUTO_ACTION_ITEMS_SECTION_ID);
    assert.deepEqual(actions.bullets.map((b) => b.text), ['Kemal: Reconnect the catalog feed (by November 6)']);
    assert.ok(actions.bullets[0].evidence?.length, 'the action keeps its source for jump-to-transcript');
    // The Summary still leaves the action items out.
    assert.ok(!s.tldr.some((l) => /catalog feed/i.test(l) && /Kemal/.test(l)), JSON.stringify(s.tldr));
});

test('a template\'s notes are unchanged: only its sections, no added action items section', () => {
    const s = reduce([atom({ modeSpecificFindings: { Pricing: [finding('Flat')], Invented: [finding('x')] },
        actionItems: [{ text: 'Send it', explicitness: 'explicit', confidence: 'high', evidence: ev }] })], [{ title: 'Pricing', description: '' }]);
    assert.deepEqual(s.sections.map((x) => x.title), ['Pricing']);
});

test('exports skip the action items section; they list the action items themselves', () => {
    const d = buildNotesDocument({ id: 'm', title: 'T', date: '2026-10-31T10:00:00Z', detailedSummary: { schemaVersion: 3, tldr: ['A'], sectionsV3: [
        { id: 'deal', title: 'Deal agreed', order: 0, bullets: [{ text: '90 days' }] },
        { id: AUTO_ACTION_ITEMS_SECTION_ID, title: 'Action items', order: 1, bullets: [{ text: 'Kemal: Reconnect (by November 6)' }] },
    ], actionItemsV3: [{ text: 'Reconnect', owner: 'Kemal', deadline: 'November 6' }] } }, { timeZone: 'UTC' });
    assert.deepEqual(d.sections.map((x) => x.heading), ['Summary', 'Deal agreed']);
    assert.equal(d.actionItems.length, 1);
});

test('"What did I miss" is two or three plain bullets with the figures said, no labels, no "the interviewer"', () => {
    const prompt = resolveV2SystemPrompt({ action: 'catch_me_up', tier: 'cloud' }) ?? '';
    assert.match(prompt, /two or three "- " bullets/);
    assert.match(prompt, /never call anyone "the interviewer"/);
    assert.match(prompt, /No labels, headings or bold/);
    assert.doesNotMatch(prompt, /four short labelled lines/);
});

test('a six-minute meeting is not "short": 3-8 findings per section, as Granola\'s notes carry', async () => {
    const { chunkDensityTarget, SHORT_MEETING_CHARS } = await load('services/meeting/meetingNotesContext.js');
    assert.deepEqual(chunkDensityTarget(5500), { range: '3-8', short: false });
    assert.deepEqual(chunkDensityTarget(SHORT_MEETING_CHARS - 1), { range: '1-4', short: true });
    assert.deepEqual(chunkDensityTarget(12000), { range: '3-8', short: false });
    assert.deepEqual(chunkDensityTarget(60000), { range: '5-12', short: false });
});

test('each heading carries its topic\'s decisions and open questions as short findings, as Granola\'s do', () => {
    const task = autoHeadingsTask(5500, undefined);
    assert.match(task, /usually 4-8 of them, each about 6-15 words/);
    assert.match(task, /goes in its own field AND as a finding under its heading/);
});

test('an overview over its cap ends on its last whole sentence, never mid-clause', async () => {
    const { capAtSentence } = await load('services/meeting/MeetingSummaryReducer.js');
    assert.equal(capAtSentence('Scope is set. Code freeze is Nov 10. The Android 15 crash, 1.8% against'), 'Scope is set. Code freeze is Nov 10.');
    assert.equal(capAtSentence('One long clause about the release, the crash, and'), 'One long clause about the release, the crash, and…');
});

test('deadlines are kept as said: no guessed year, no numeric date', () => {
    const { systemPrompt } = buildChunkPrompt({ chunk, totalChunks: 1, modeNoteSections: [], meetingTotalChars: 5000 });
    assert.match(systemPrompt, /never add a year nobody said and never turn it into a numeric date/);
});

test('the polished overview over its band also ends on a whole sentence', async () => {
    const { SummaryPolisher } = await load('services/meeting/SummaryPolisher.js');
    const sentence = 'Code freeze is November 10 and submission is November 12.';
    const long = Array.from({ length: 30 }, () => sentence).join(' ') + ' The Android crash, 1.8% against';
    const llm = { generateMeetingSummary: async () => JSON.stringify({ title: 'Release planning', overview: long }) };
    const out = await new SummaryPolisher(llm).polishOverview({
        deterministicSummary: [long], decisions: [], actionItems: [], risks: [], sections: [], mode: 'general',
        briefs: [long], topics: ['release'], totalTokensEstimate: 1000,
    });
    assert.ok(out.overview, 'the polish was kept');
    assert.match(out.overview, /November 12\.$/, out.overview.slice(-80));
    assert.ok(out.overview.split(/\s+/).length <= 180);
});

test('the user\'s notes reach the notes model as typed, not with the editor\'s HTML escapes', async () => {
    const { formatUserNotesBlock, decodeNoteEntities } = await load('services/meeting/meetingNotesContext.js');
    assert.match(formatUserNotesBlock('resolution 61% -&gt; 48%'), /resolution 61% -> 48%/);
    assert.equal(decodeNoteEntities('a &lt;b&gt; &quot;c&quot; &#39;d&#39; &amp;gt;'), 'a <b> "c" \'d\' &gt;');
});

test('the user\'s spelling of a name wins over the transcript\'s', async () => {
    const { USER_NOTES_RULES } = await load('services/meeting/meetingNotesContext.js');
    assert.match(USER_NOTES_RULES, /Their spelling of a name wins/);
});
