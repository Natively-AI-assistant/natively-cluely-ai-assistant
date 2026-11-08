// PR #652 review fixes (2026-10-15), renderer side: the pure decisions behind
// the follow-up edit (1), Send to CRM (3), Send to Notion (6) and the Slack
// composer's limit (7). Run: node --experimental-strip-types --test <this file>
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const v = await import('../outputsView.ts');
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');

describe('1. the follow-up edit is kept until it is saved', () => {
    const saved = { subject: 'Pricing', body: 'Hi Sam,\n\nHeld the price.' };
    test('only changed fields are sent; an emptied body is never sent', () => {
        assert.deepEqual(v.followUpChanges({ subject: 'Pricing', body: 'Hi Sam,\n\nHeld it.' }, saved), { body: 'Hi Sam,\n\nHeld it.' });
        assert.deepEqual(v.followUpChanges({ subject: '  New\n subject ', body: saved.body }, saved), { subject: 'New subject' });
        assert.deepEqual(v.followUpChanges({ subject: 'Pricing', body: '   ' }, saved), {});
        assert.deepEqual(v.followUpChanges({ subject: 'x', body: 'y' }, { body: 'z' }), { body: 'y' }, 'no subject line stays without one');
        assert.deepEqual(v.followUpChanges(null, saved), {});
    });
    test('a failed or rejected save keeps the edit and says so, with a retry', () => {
        const sent = { subject: 'Pricing', body: 'Edited' };
        assert.deepEqual(v.settleFollowUpSave(sent, sent, { ok: false, message: 'Your edit could not be saved. Try again.' }), { pending: sent, error: 'Your edit could not be saved. Try again.' });
        assert.deepEqual(v.settleFollowUpSave(sent, sent, null), { pending: sent, error: v.FOLLOW_UP_SAVE_FAILED });
        assert.deepEqual(v.settleFollowUpSave(null, sent, undefined).pending, sent, 'even if it was cleared meanwhile');
        assert.ok(!/\d{3}/.test(v.FOLLOW_UP_SAVE_FAILED));
    });
    test('a save that worked clears the edit, unless the user typed more since', () => {
        const sent = { subject: 'Pricing', body: 'Edited' };
        assert.deepEqual(v.settleFollowUpSave(sent, sent, { ok: true }), { pending: null, error: null });
        const more = { subject: 'Pricing', body: 'Edited more' };
        assert.deepEqual(v.settleFollowUpSave(more, sent, { ok: true }), { pending: more, error: null });
    });
    test('the page no longer clears the edit before the save answers, and offers Try again', () => {
        const src = read('../../MeetingDetails.tsx');
        const fn = src.slice(src.indexOf('const saveFollowUp = async'), src.indexOf('const followUpEdit: FollowUpCardEdit'));
        assert.ok(!/setFuEditing\(null\);\s*setFuText\(null\);/.test(fn), 'no clearing up front');
        assert.match(fn, /setFuText\(\(cur\) => settleFollowUpSave\(cur, pending, res\)\.pending\)/);
        assert.match(src, /<span role="alert">\{t\(fuSaveError\)\}<\/span>/);
        assert.ok(!/fuTextRef\.current = fuText/.test(src), 'no ref written during render');
    });
});

describe('3. CRM Send needs a preview of the CRM picked now', () => {
    const preview = { ok: true, service: 'hubspot', attendees: [{ email: 'a@x.com', matched: true }, { email: 'b@x.com', matched: false }] };
    test('people come only from a working preview of the current target', () => {
        assert.deepEqual(v.crmSendable('hubspot', preview, new Set(['a@x.com', 'b@x.com'])), ['a@x.com']);
        assert.deepEqual(v.crmSendable('attio', preview, new Set(['a@x.com'])), [], 'switched CRM, old preview');
        assert.deepEqual(v.crmSendable('attio', null, new Set(['a@x.com'])), [], 'new preview failed or pending');
        assert.deepEqual(v.crmSendable('hubspot', { ...preview, ok: false }, new Set(['a@x.com'])), []);
        assert.deepEqual(v.crmSendable(null, preview, new Set(['a@x.com'])), []);
    });
    test('switching CRM clears the picks and the preview', () => {
        const src = read('../ShareMenu.tsx');
        assert.match(src, /onChange=\{\(e\) => \{ setMatches\(null\); setChosen\(new Set\(\)\); setCrm\(e\.target\.value as CrmService\); \}\}/);
        assert.match(src, /setMatches\(null\); setChosen\(new Set\(\)\); setError\(null\); setBusy\(true\);/);
        assert.match(src, /const sendable = crmSendable\(crm, matches, chosen\);/);
        assert.match(src, /sendable\.length > 0,/);
    });
});

describe('6. a half-made Notion page is shown, with two clear choices', () => {
    test('the result view', () => {
        assert.deepEqual(v.notionResultView({ ok: true, url: 'u' }), { state: 'done', url: 'u' });
        const partial = v.notionResultView({ ok: false, partial: true, url: 'u', message: 'm' });
        assert.deepEqual(partial, { state: 'partial', url: 'u', message: 'm' });
        assert.equal(v.notionResultView(null).state, 'error');
    });
    test('the dialog links the partial page and offers add-the-rest or start-over, not Create page', () => {
        const src = read('../ShareMenu.tsx');
        assert.match(src, /t\('Open the partial page'\)/);
        assert.match(src, /api\(\)\?\.resumeNotion\(meetingId\)/);
        assert.match(src, /sendNotion\(meetingId, \{ includeTranscript, startOver: true \}\)/);
        const partialBranch = src.slice(src.indexOf(': partialPage'), src.indexOf(": n?.connected && n.parent ? <>{closeBtn()}{primary(t('Create page')"));
        assert.ok(!partialBranch.includes("t('Create page')"));
    });
});

describe('7. the Slack composer shows the limit', () => {
    test('length, limit and how far over', () => {
        assert.deepEqual(v.slackDraftStatus('  hi  '), { length: 2, max: 40000, over: 0, empty: false });
        assert.equal(v.slackDraftStatus('x'.repeat(40005)).over, 5);
        assert.equal(v.slackDraftStatus(' ').empty, true);
    });
});
