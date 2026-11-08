// Granola parity round 2, outputs (2026-10-15): one notes document feeds every
// output. Covers the notes document, Slack blocks, Notion blocks (with the
// 100-block-per-request chunking), the HTML file (escaping!), export file names
// and the darwin / win32 path branches. Network is a fake fetch only.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => require(path.join(REPO, 'dist-electron/electron/services/outputs', p));
const notes = dist('notesDocument.js');
const html = dist('htmlExport.js');
const slack = dist('slack.js');
const notion = dist('notion.js');
const files = dist('exportFiles.js');

const T0 = Date.UTC(2026, 9, 14, 15, 0, 0);
function v3Meeting(over = {}) {
    return {
        id: 'm1',
        title: '**Q4 pricing** review',
        date: '2026-10-14T15:00:00.000Z',
        duration: '45:10',
        detailedSummary: {
            schemaVersion: 3,
            tldr: ['Agreed to hold **list price** flat', 'Discount cap moves to 12%'],
            sectionsV3: [
                { id: 's2', title: 'Risks', order: 2, bullets: [{ text: 'Churn in SMB' }] },
                { id: 's1', title: 'Pricing', order: 1, bullets: [{ text: 'Annual plans get `2 months` free' }, { text: '' }] },
                { id: 's3', title: 'Next steps', order: 3, bullets: [{ text: 'Should be left out' }] },
            ],
            actionItemsV3: [
                { text: 'Send the new price sheet', owner: 'Dana', deadline: 'Friday', status: 'open' },
                { text: 'Update CRM fields', status: 'done' },
            ],
            speakerLabels: { speaker_2: 'Priya' },
            callParticipants: ['Dana', 'Priya'],
        },
        transcript: [
            { speaker: 'user', text: 'Let us start.', timestamp: T0 },
            { speaker: 'interviewer', text: 'Sure.', timestamp: T0 + 5_000 },
            { speaker: 'x', speakerId: 'speaker_2', text: 'Pricing first.', timestamp: T0 + 65_000 },
        ],
        calendarEvent: { attendees: [{ email: 'Dana@Acme.com', name: 'Dana Lee' }, { email: 'dana@acme.com' }, { email: 'me@natively.app' }] },
        ...over,
    };
}

describe('notes document', () => {
    test('V3: Summary from the tl;dr, sections in order, Next steps dropped, action items kept with owner / deadline / done', () => {
        const d = notes.buildNotesDocument(v3Meeting(), { selfName: 'Evin', timeZone: 'UTC' });
        assert.equal(d.title, 'Q4 pricing review');
        assert.deepEqual(d.sections.map((s) => s.heading), ['Summary', 'Pricing', 'Risks']);
        assert.deepEqual(d.sections[1].bullets, ['Annual plans get `2 months` free']);
        assert.deepEqual(d.actionItems, [
            { text: 'Send the new price sheet', owner: 'Dana', deadline: 'Friday', done: false },
            { text: 'Update CRM fields', done: true },
        ]);
        assert.equal(d.durationLabel, '45 min');
        assert.equal(d.dateLabel, 'Wednesday, October 14, 2026');
    });
    test('a template with its own Summary section sends one Summary, the template\'s (2026-10-31)', () => {
        const own = (title) => v3Meeting({ detailedSummary: { schemaVersion: 3, tldr: ['From the tldr'], sectionsV3: [
            { id: 's1', title, order: 1, bullets: [{ text: 'From the template' }] },
            { id: 's2', title: 'Action items', order: 2, bullets: [{ text: 'Send it' }] },
        ] } });
        for (const title of ['Summary', 'summary', 'TL;DR', 'TLDR']) {
            const d = notes.buildNotesDocument(own(title), { timeZone: 'UTC' });
            assert.deepEqual(d.sections.map((s) => s.heading), [title, 'Action items'], title);
            assert.deepEqual(d.sections[0].bullets, ['From the template']);
        }
        // Not the Summary: the tldr still leads.
        assert.deepEqual(notes.buildNotesDocument(own('Study summary'), { timeZone: 'UTC' }).sections.map((s) => s.heading), ['Summary', 'Study summary', 'Action items']);
        // An empty template Summary doesn't hide the tldr.
        const empty = v3Meeting({ detailedSummary: { schemaVersion: 3, tldr: ['From the tldr'], sectionsV3: [{ id: 's1', title: 'Summary', order: 1, bullets: [] }] } });
        assert.deepEqual(notes.buildNotesDocument(empty, { timeZone: 'UTC' }).sections.map((s) => [s.heading, s.bullets]), [['Summary', ['From the tldr']]]);
    });

    test('no template: the decisions stand in for its sections; a template keeps them out (2026-10-31)', () => {
        const bare = v3Meeting({ detailedSummary: { schemaVersion: 3, tldr: ['Plan agreed'], sectionsV3: [],
            decisions: [{ text: 'Dark mode moves to 4.13' }, { text: '' }],
            actionItemsV3: [{ text: 'Fix the crash', owner: 'Ananya', deadline: 'November 9' }] } });
        const d = notes.buildNotesDocument(bare, { timeZone: 'UTC' });
        assert.deepEqual(d.sections.map((s) => [s.heading, s.bullets]), [['Summary', ['Plan agreed']], ['Decisions', ['Dark mode moves to 4.13']]]);
        assert.deepEqual(d.actionItems, [{ text: 'Fix the crash', owner: 'Ananya', deadline: 'November 9', done: false }]);
        const withTemplate = v3Meeting({ detailedSummary: { ...v3Meeting().detailedSummary, decisions: [{ text: 'Hidden behind the template' }] } });
        assert.deepEqual(notes.buildNotesDocument(withTemplate, { timeZone: 'UTC' }).sections.map((s) => s.heading), ['Summary', 'Pricing', 'Risks']);
    });

    test('transcript speakers named like the meeting page; offsets from the first line; attendees deduped and lowercased', () => {
        const d = notes.buildNotesDocument(v3Meeting(), { selfName: 'Evin' });
        assert.deepEqual(d.transcript.map((l) => [l.speaker, l.offsetMs]), [['Evin', 0], ['Speaker 1', 5000], ['Priya', 65000]]);
        assert.deepEqual(d.attendees.map((a) => a.email), ['dana@acme.com', 'me@natively.app']);
        assert.equal(notes.formatOffset(65000), '1:05');
        assert.equal(notes.formatOffset(3_725_000), '1:02:05');
    });
    test('legacy notes: overview, key points, plain action items', () => {
        const d = notes.buildNotesDocument({ id: 'old', title: 'Sync', date: '2026-01-01T00:00:00Z', detailedSummary: { overview: 'We met.', keyPoints: ['A'], actionItems: ['Do B'] } });
        assert.deepEqual(d.sections, [{ heading: 'Summary', paragraph: 'We met.', bullets: [] }, { heading: 'Key points', bullets: ['A'] }]);
        assert.deepEqual(d.actionItems, [{ text: 'Do B', done: false }]);
    });
    test('inline spans split bold, italic and code; unbalanced markers stay literal', () => {
        assert.deepEqual(notes.inlineSpans('a **b** c `d` _e_ *f*'), [
            { text: 'a ' }, { text: 'b', bold: true }, { text: ' c ' }, { text: 'd', code: true }, { text: ' ' }, { text: 'e', italic: true }, { text: ' ' }, { text: 'f', italic: true },
        ]);
        assert.equal(notes.plainText('2 * 3 = 6 and snake_case_name'), '2 * 3 = 6 and snake_case_name');
    });
});

describe('HTML file', () => {
    const hostile = v3Meeting({
        title: '<script>alert(1)</script> & "co"',
        detailedSummary: {
            schemaVersion: 3,
            tldr: ['<img src=x onerror=alert(1)>', '**<b>bold</b>**'],
            sectionsV3: [],
            actionItemsV3: [{ text: 'x', owner: '<i>Eve</i>', deadline: '"soon"', status: 'open' }],
        },
        transcript: [{ speaker: 'user', text: '</div><script>steal()</script>', timestamp: T0 }],
    });
    test('every piece of meeting text is escaped; no tag from the notes survives', () => {
        const d = notes.buildNotesDocument(hostile, { selfName: '<svg onload=x>' });
        const out = html.buildNotesHtml(d, { includeTranscript: true });
        assert.ok(!out.includes('<script>'), 'no script tag');
        assert.ok(!/<img/i.test(out), 'no img tag');
        assert.ok(!out.includes('<svg'), 'no svg tag');
        assert.ok(!out.includes('<i>Eve'), 'owner escaped');
        assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;co&quot;'));
        assert.ok(out.includes('<strong>&lt;b&gt;bold&lt;/b&gt;</strong>'), 'emphasis kept as a tag, its text escaped');
        assert.ok(out.includes('&lt;/div&gt;&lt;script&gt;steal()&lt;/script&gt;'));
    });
    test('inert page: a CSP that allows no script and no network; transcript only when asked', () => {
        const d = notes.buildNotesDocument(v3Meeting());
        const out = html.buildNotesHtml(d, { includeTranscript: false });
        assert.match(out, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"/);
        assert.ok(!out.includes('<h2>Transcript</h2>'));
        assert.ok(html.buildNotesHtml(d, { includeTranscript: true }).includes('<h2>Transcript</h2>'));
        assert.ok(out.includes('<h2>Action items</h2>'));
        assert.ok(out.includes('class="box done"'));
        assert.ok(html.buildNotesHtml(d, { includeTranscript: false, forPrint: true }).includes('<html lang="en" class="print">'));
    });
    test('escapeHtml covers & < > " \' and backtick', () => {
        assert.equal(html.escapeHtml(`&<>"'\``), '&amp;&lt;&gt;&quot;&#39;&#96;');
    });
});

describe('Slack', () => {
    test('draft: headings bold, bullets, **bold** → *bold*, action items optional', () => {
        const d = notes.buildNotesDocument(v3Meeting());
        const draft = slack.composeSlackDraft(d, { includeActionItems: true });
        assert.ok(draft.startsWith('*Summary*\n• Agreed to hold *list price* flat'));
        assert.ok(draft.includes('*Action items*\n☐ Dana: Send the new price sheet (by Friday)\n☑ Update CRM fields'));
        assert.ok(!slack.composeSlackDraft(d, { includeActionItems: false }).includes('Action items'));
    });
    test('payload: header + date context + sections; &, <, > escaped so meeting text cannot mention or link', () => {
        const p = slack.slackPayloadFromDraft('Title', 'Wednesday', 'Hi <!channel> & <https://evil|x>');
        assert.equal(p.blocks[0].type, 'header');
        assert.equal(p.blocks[1].type, 'context');
        assert.equal(p.blocks[2].text.text, 'Hi &lt;!channel&gt; &amp; &lt;https://evil|x&gt;');
        assert.ok(!JSON.stringify(p).includes('<!channel>'));
    });
    test('long drafts: packed into sections under 3000, nothing dropped, many short paragraphs still fit one message', () => {
        // One paragraph over the section cap splits on its lines.
        const long = Array.from({ length: 80 }, (_, i) => `line ${i} ${'x'.repeat(60)}`).join('\n');
        const split = slack.splitForSlack(long);
        assert.ok(split.length >= 2 && split.every((s) => s.length <= slack.SLACK_SECTION_MAX));
        assert.equal(split.join('\n'), long);
        // Sixty short paragraphs (more than 50 blocks one per paragraph): packed, all there.
        const paras = Array.from({ length: 60 }, (_, i) => `para ${i} ${'y'.repeat(500)}`);
        const p = slack.slackPayloadFromDraft('T', 'D', paras.join('\n\n'));
        assert.ok(p.blocks.length <= slack.SLACK_MAX_BLOCKS);
        const sent = p.blocks.slice(2).map((b) => b.text.text).join('\n\n');
        assert.equal(sent, paras.join('\n\n'));
        for (const b of p.blocks.slice(2)) assert.ok(b.text.text.length <= slack.SLACK_SECTION_MAX);
        const header = slack.slackPayloadFromDraft('y'.repeat(400), '', 'a').blocks[0].text.text;
        assert.equal(header.length, slack.SLACK_HEADER_MAX);
    });
    test('only Slack webhook addresses are accepted', () => {
        assert.equal(slack.isSlackWebhookUrl('https://hooks.slack.com/services/T000/B000/XXXX'), true);
        assert.equal(slack.isSlackWebhookUrl('http://hooks.slack.com/services/T/B/X'), false);
        assert.equal(slack.isSlackWebhookUrl('https://hooks.slack.com.evil.io/services/T/B/X'), false);
        assert.equal(slack.isSlackWebhookUrl('https://example.com/hook'), false);
    });
    test('Test connection posts an empty message: a bad-request answer means live, gone means not found; nothing reaches the channel', async () => {
        const calls = [];
        const fake = (status, body) => async (url, init) => { calls.push({ url, body: init.body }); return { ok: status < 300, status, headers: { get: () => null }, text: async () => body }; };
        await slack.testSlackWebhook('https://hooks.slack.com/services/T/B/X', fake(400, 'no_text'));
        assert.equal(calls[0].body, '{}');
        await assert.rejects(slack.testSlackWebhook('https://hooks.slack.com/services/T/B/X', fake(404, 'no_service')), (e) => e.kind === 'not_found');
        await assert.rejects(slack.testSlackWebhook('https://hooks.slack.com/services/T/B/X', fake(500, 'oops')), (e) => e.kind === 'server');
    });
});

describe('Notion', () => {
    test('blocks: heading_2, bulleted items with bold annotations, to_do with checked, transcript packed into paragraphs', () => {
        const d = notes.buildNotesDocument(v3Meeting());
        const blocks = notion.buildNotionBlocks(d, { includeTranscript: true });
        const types = blocks.map((b) => b.type);
        assert.deepEqual(types.slice(0, 3), ['paragraph', 'paragraph', 'heading_2']);
        const bullet = blocks.find((b) => b.type === 'bulleted_list_item');
        assert.deepEqual(bullet.bulleted_list_item.rich_text.map((r) => [r.text.content, r.annotations?.bold === true]), [['Agreed to hold ', false], ['list price', true], [' flat', false]]);
        const todos = blocks.filter((b) => b.type === 'to_do');
        assert.deepEqual(todos.map((b) => b.to_do.checked), [false, true]);
        assert.equal(todos[0].to_do.rich_text[0].text.content, 'Dana: ');
        assert.ok(blocks.at(-1).paragraph.rich_text[0].text.content.includes('[0:00] Me: Let us start.'));
        assert.ok(!types.includes('heading_1'));
    });
    test('text over 2,000 characters is split into several text objects', () => {
        const rt = notion.richText('a'.repeat(4500));
        assert.deepEqual(rt.map((r) => r.text.content.length), [2000, 2000, 500]);
    });
    test('chunking: 250 blocks → create with 100, then append 100 and 50; database parent uses its title property', async () => {
        const blocks = Array.from({ length: 250 }, (_, i) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: String(i) } }] } }));
        const calls = [];
        const fetchImpl = async (url, init) => {
            calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
            if (url.endsWith('/databases/11111111-2222-3333-4444-555555555555')) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ properties: { Tags: { type: 'multi_select' }, 'Meeting': { type: 'title' } } }) };
            if (url.endsWith('/pages')) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: 'page-1', url: 'https://www.notion.so/page-1' }) };
            return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' };
        };
        const res = await notion.createNotionPage(
            { parent: { type: 'database', id: '11111111222233334444555555555555', title: 'Meetings' }, title: 'Sync, Oct 14, 2026', blocks },
            { token: 'ntn_x', fetchImpl },
        );
        assert.deepEqual(res, { url: 'https://www.notion.so/page-1', partial: false, pageId: 'page-1' });
        assert.equal(calls.length, 4);
        const create = calls[1];
        assert.equal(create.body.parent.database_id, '11111111-2222-3333-4444-555555555555');
        assert.equal(create.body.properties.Meeting.title[0].text.content, 'Sync, Oct 14, 2026');
        assert.equal(create.body.children.length, 100);
        assert.deepEqual(calls.slice(2).map((c) => [c.method, c.url.endsWith('/blocks/page-1/children'), c.body.children.length]), [['PATCH', true, 100], ['PATCH', true, 50]]);
        assert.equal(create.headers['Notion-Version'], notion.NOTION_VERSION);
        assert.equal(create.headers.Authorization, 'Bearer ntn_x');
    });
    test('a failed append leaves a partial page, reported as such', async () => {
        const blocks = Array.from({ length: 150 }, () => ({ object: 'block', type: 'divider', divider: {} }));
        let n = 0;
        const fetchImpl = async (url) => {
            n += 1;
            if (url.endsWith('/pages')) return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"id":"p","url":"https://www.notion.so/p"}' };
            return { ok: false, status: 429, headers: { get: () => null }, text: async () => '{}' };
        };
        const res = await notion.createNotionPage({ parent: { type: 'page', id: 'aaaaaaaabbbbccccddddeeeeeeeeeeee', title: 'P' }, title: 'T', blocks }, { token: 't', fetchImpl });
        assert.equal(res.partial, true);
        assert.equal(n, 2);
    });
    test('search results: pages by their title property, databases by title, archived skipped', () => {
        const r = notion.parseNotionSearch({ results: [
            { object: 'page', id: 'a', properties: { Name: { type: 'title', title: [{ plain_text: 'Team ' }, { plain_text: 'notes' }] } } },
            { object: 'database', id: 'b', title: [{ plain_text: 'Meetings DB' }] },
            { object: 'page', id: 'c', archived: true, properties: {} },
        ] });
        assert.deepEqual(r, [{ type: 'page', id: 'a', title: 'Team notes' }, { type: 'database', id: 'b', title: 'Meetings DB' }]);
    });
    test('the block list stops at the cap with a closing line', () => {
        const d = notes.buildNotesDocument(v3Meeting({ transcript: Array.from({ length: 5000 }, (_, i) => ({ speaker: 'user', text: 'word '.repeat(80), timestamp: T0 + i * 1000 })) }));
        const blocks = notion.buildNotionBlocks(d, { includeTranscript: true });
        assert.equal(blocks.length, notion.NOTION_MAX_BLOCKS);
        assert.match(blocks.at(-1).paragraph.rich_text[0].text.content, /rest of this meeting/);
        assert.equal(notion.chunkBlocks(blocks).length, 10);
    });
    test('token and id shapes', () => {
        assert.equal(notion.looksLikeNotionToken('ntn_' + 'a'.repeat(40)), true);
        assert.equal(notion.looksLikeNotionToken('sk-abc'), false);
        assert.equal(notion.normaliseNotionId('https://www.notion.so/Team-1234567890abcdef1234567890ABCDEF'), '12345678-90ab-cdef-1234-567890abcdef');
        assert.equal(notion.normaliseNotionId('nope'), null);
    });
});

describe('export files on both systems', () => {
    test('file stem: reserved characters, hidden dot, trailing dot, Windows device names, date appended', () => {
        assert.equal(files.notesFileStem('Q4: plan/review?', '2026-10-14T15:00:00Z'), 'Q4 plan review 2026-10-14');
        assert.equal(files.notesFileStem('.hidden.', '2026-10-14'), 'hidden 2026-10-14');
        assert.equal(files.notesFileStem('CON', ''), 'Notes CON');
        assert.equal(files.notesFileStem('', undefined), 'Meeting notes');
    });
    test('darwin: posix join; win32: backslash join with the drive kept', () => {
        assert.equal(files.defaultExportPath('darwin', '/Users/a b/Downloads', 'Sync 2026-10-14', 'pdf'), '/Users/a b/Downloads/Sync 2026-10-14.pdf');
        assert.equal(files.defaultExportPath('win32', 'C:\\Users\\a b\\Downloads', 'Sync 2026-10-14', 'html'), 'C:\\Users\\a b\\Downloads\\Sync 2026-10-14.html');
    });
    test('the extension is added only when missing, case-insensitively, per platform', () => {
        assert.equal(files.withExportExtension('darwin', '/x/Notes', 'pdf'), '/x/Notes.pdf');
        assert.equal(files.withExportExtension('darwin', '/x/Notes.PDF', 'pdf'), '/x/Notes.PDF');
        assert.equal(files.withExportExtension('win32', 'C:\\x\\v1.2 notes', 'html'), 'C:\\x\\v1.2 notes.html');
        assert.equal(files.withExportExtension('win32', 'C:\\x\\Notes.html', 'html'), 'C:\\x\\Notes.html');
    });
    test('PDF paper: Letter in the US and Canada, A4 elsewhere', () => {
        assert.equal(files.pdfPageSize('US'), 'Letter');
        assert.equal(files.pdfPageSize('ca'), 'Letter');
        assert.equal(files.pdfPageSize('GB'), 'A4');
        assert.equal(files.pdfPageSize(undefined), 'A4');
    });
});
