// Who a meeting's follow-up goes to, and the Gmail draft that sends it
// (followUpRecipients.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { followUpRecipients, recipientName, recipientSummary, gmailComposeUrl } = await import('../followUpRecipients.mjs');

test('recipients: everyone on the invite who has not declined, once each', () => {
    const got = followUpRecipients([
        { email: 'priya@acme.com', name: 'Priya Nair', response: 'accepted' },
        { email: 'rob@acme.com', name: 'Rob Lane', response: 'needsAction' },
        { email: 'kim@acme.com', name: 'Kim Oh', response: 'declined' },
        { email: 'PRIYA@acme.com', name: 'Priya again' },
        { email: '' },
        { email: 'not-an-address' },
        { email: ' lee@acme.com ', name: '  ' },
    ]);
    assert.deepEqual(got, [
        { email: 'priya@acme.com', name: 'Priya Nair' },
        { email: 'rob@acme.com', name: 'Rob Lane' },
        { email: 'lee@acme.com' },
    ]);
    assert.deepEqual(followUpRecipients(undefined), []);
});

test('names read as names, else the address before the @', () => {
    assert.equal(recipientName({ email: 'priya@acme.com', name: 'Priya Nair' }), 'Priya Nair');
    assert.equal(recipientName({ email: 'lee@acme.com' }), 'lee');
    assert.equal(recipientSummary([{ email: 'p@a.com', name: 'Priya' }]), 'Priya');
    assert.equal(recipientSummary([{ email: 'p@a.com', name: 'Priya' }, { email: 'r@a.com', name: 'Rob' }]), 'Priya, Rob');
    assert.equal(recipientSummary(['Priya', 'Rob', 'Kim', 'Lee'].map((n) => ({ email: `${n}@a.com`, name: n }))), 'Priya, Rob +2');
    assert.equal(recipientSummary([]), '');
});

test('the Gmail draft carries every field, encoded, in the right account', () => {
    const url = gmailComposeUrl({
        to: ['priya@acme.com', 'rob+x@acme.com'],
        subject: 'Follow up: Q2 & next steps',
        body: 'Hi Priya,\n\nThanks — 100% agreed.',
        account: 'evin@acme.com',
    });
    assert.ok(url.startsWith('https://mail.google.com/mail/?view=cm&fs=1&'), 'https, the compose view');
    const q = new URL(url).searchParams;
    assert.equal(q.get('authuser'), 'evin@acme.com');
    assert.equal(q.get('to'), 'priya@acme.com,rob+x@acme.com', 'a + in an address survives');
    assert.equal(q.get('su'), 'Follow up: Q2 & next steps');
    assert.equal(q.get('body'), 'Hi Priya,\n\nThanks — 100% agreed.');
    assert.equal(new URL(gmailComposeUrl({ subject: 'x' })).searchParams.get('to'), null, 'no recipients: no to=');
});
