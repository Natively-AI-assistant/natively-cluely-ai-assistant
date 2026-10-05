// Covers electron/utils/emailUtils.ts: transcript email extraction, mailto / Gmail
// compose links, subject generation, the follow-up prompt payload and recipient names.
// copyToClipboard is not covered: it needs the renderer's navigator.clipboard.
// Run from the repo root: node --test electron/utils/__tests__/emailUtils.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const {
    extractEmailsFromTranscript,
    buildMailtoLink,
    buildGmailComposeUrl,
    generateEmailSubject,
    buildFollowUpEmailPromptInput,
    extractRecipientName,
} = require(path.join(repoRoot, 'dist-electron/electron/utils/emailUtils.js'));

describe('extractEmailsFromTranscript', () => {
    test('finds addresses across entries, in first-seen order', () => {
        assert.deepEqual(extractEmailsFromTranscript([
            { text: 'Send it to ana@example.com please' },
            { text: 'and cc bo.lee+notes@mail.example.co.uk' },
        ]), ['ana@example.com', 'bo.lee+notes@mail.example.co.uk']);
    });

    test('several addresses in one entry', () => {
        assert.deepEqual(
            extractEmailsFromTranscript([{ text: 'a_1@x.io, b-2@y.org; c%3@z.dev' }]),
            ['a_1@x.io', 'b-2@y.org', 'c%3@z.dev'],
        );
    });

    test('lowercases and de-duplicates', () => {
        assert.deepEqual(extractEmailsFromTranscript([
            { text: 'John.Doe@Example.com' },
            { text: 'again: JOHN.DOE@EXAMPLE.COM and john.doe@example.com' },
        ]), ['john.doe@example.com']);
    });

    test('sentence punctuation after an address is not captured', () => {
        assert.deepEqual(extractEmailsFromTranscript([{ text: 'Mail me at a@b.co.' }]), ['a@b.co']);
        assert.deepEqual(extractEmailsFromTranscript([{ text: '(a@b.co), <c@d.com>!' }]), ['a@b.co', 'c@d.com']);
    });

    test('things that are not addresses are ignored', () => {
        assert.deepEqual(extractEmailsFromTranscript([
            { text: 'no at sign here' },
            { text: 'user@localhost and x@y and a@b.c' }, // no TLD / one-letter TLD
            { text: '@handle and trailing@' },
            { text: '' },
        ]), []);
    });

    test('empty transcript', () => {
        assert.deepEqual(extractEmailsFromTranscript([]), []);
    });
});

describe('buildMailtoLink', () => {
    const parse = link => {
        const q = link.indexOf('?');
        return { to: link.slice('mailto:'.length, q), query: link.slice(q + 1) };
    };

    test('subject and body survive a round trip', () => {
        const subject = 'Hi there & you?';
        const body = 'Line one\nLine two = 100% + "quotes" #1 — café';
        const link = buildMailtoLink('ana@example.com', subject, body);
        assert.ok(link.startsWith('mailto:'));
        const { to, query } = parse(link);
        assert.equal(decodeURIComponent(to), 'ana@example.com');
        const [subjectPart, bodyPart] = query.split('&');
        assert.equal(decodeURIComponent(subjectPart.replace(/^subject=/, '')), subject);
        assert.equal(decodeURIComponent(bodyPart.replace(/^body=/, '')), body);
    });

    test('spaces are %20, never +, and a literal + is %2B', () => {
        const { query } = parse(buildMailtoLink('ana@example.com', 'Hello big world', 'one + two'));
        assert.equal(query, 'subject=Hello%20big%20world&body=one%20%2B%20two');
        assert.ok(!query.includes('+'));
    });

    test('newlines are percent-encoded', () => {
        const { query } = parse(buildMailtoLink('ana@example.com', 's', 'a\nb\r\nc'));
        assert.equal(query, 'subject=s&body=a%0Ab%0D%0Ac');
    });

    test('empty recipient, subject and body still give a well-formed link', () => {
        assert.equal(buildMailtoLink('', '', ''), 'mailto:?subject=&body=');
    });
});

describe('buildGmailComposeUrl', () => {
    test('points at Gmail compose with every field round-tripping', () => {
        const to = 'ana@example.com,bo@example.com';
        const subject = 'Hi there & you?';
        const body = 'Line one\nLine two = 100% + "quotes" — café';
        const url = new URL(buildGmailComposeUrl(to, subject, body));
        assert.equal(url.origin, 'https://mail.google.com');
        assert.equal(url.pathname, '/mail/');
        assert.equal(url.searchParams.get('view'), 'cm');
        assert.equal(url.searchParams.get('fs'), '1');
        assert.equal(url.searchParams.get('to'), to);
        assert.equal(url.searchParams.get('su'), subject);
        assert.equal(url.searchParams.get('body'), body);
        assert.deepEqual([...url.searchParams.keys()], ['view', 'fs', 'to', 'su', 'body']);
    });

    test('exact encoding for a simple case', () => {
        assert.equal(
            buildGmailComposeUrl('a@b.com', 'Hi there', 'l1\nl2'),
            'https://mail.google.com/mail/?view=cm&fs=1&to=a%40b.com&su=Hi+there&body=l1%0Al2',
        );
    });

    test('empty fields are kept as empty parameters', () => {
        assert.equal(buildGmailComposeUrl('', '', ''), 'https://mail.google.com/mail/?view=cm&fs=1&to=&su=&body=');
    });
});

describe('generateEmailSubject', () => {
    test('defaults to the generic meeting subject', () => {
        assert.equal(generateEmailSubject('Q3 Planning'), 'Following up - Q3 Planning');
        assert.equal(generateEmailSubject('Q3 Planning', 'meeting'), 'Following up - Q3 Planning');
    });

    test('interviews get their own wording', () => {
        assert.equal(generateEmailSubject('Backend role', 'interview'), 'Following up on our conversation - Backend role');
    });

    test('other meeting types use the generic wording', () => {
        for (const type of ['call', 'demo', 'discussion', 'Interview']) {
            assert.equal(generateEmailSubject('Acme sync', type), 'Following up - Acme sync', type);
        }
    });

    test('strips double quotes and asterisks, then trims', () => {
        assert.equal(generateEmailSubject('  **"Q3" Planning**  '), 'Following up - Q3 Planning');
        assert.equal(generateEmailSubject('"Onsite"', 'interview'), 'Following up on our conversation - Onsite');
    });

    test('keeps other punctuation', () => {
        assert.equal(generateEmailSubject("Ana's 1:1 (weekly) #4"), "Following up - Ana's 1:1 (weekly) #4");
    });
});

describe('buildFollowUpEmailPromptInput', () => {
    test('minimal input: only type and title', () => {
        assert.equal(
            buildFollowUpEmailPromptInput({ meeting_type: 'call', title: 'Intro call' }),
            'Meeting Type: call\n\nTitle: Intro call',
        );
    });

    test('full input, in a fixed order regardless of key order', () => {
        assert.equal(buildFollowUpEmailPromptInput({
            tone: 'formal',
            key_points: ['Pricing', 'Timeline'],
            action_items: ['Send deck', 'Book follow-up'],
            summary: 'Went well.',
            sender_name: 'Ana',
            recipient_name: 'Bo',
            title: 'Acme demo',
            meeting_type: 'demo',
        }), [
            'Meeting Type: demo',
            'Title: Acme demo',
            'Recipient Name: Bo',
            'Sender Name: Ana',
            'Summary: Went well.',
            'Action Items:\n- Send deck\n- Book follow-up',
            'Key Points:\n- Pricing\n- Timeline',
            'Tone: formal',
        ].join('\n\n'));
    });

    test('empty strings and empty arrays are omitted', () => {
        assert.equal(buildFollowUpEmailPromptInput({
            meeting_type: 'meeting',
            title: 'Sync',
            summary: '',
            recipient_name: '',
            sender_name: '',
            action_items: [],
            key_points: [],
            tone: undefined,
        }), 'Meeting Type: meeting\n\nTitle: Sync');
    });

    test('a single action item or key point', () => {
        assert.equal(
            buildFollowUpEmailPromptInput({ meeting_type: 'interview', title: 'T', action_items: ['One'] }),
            'Meeting Type: interview\n\nTitle: T\n\nAction Items:\n- One',
        );
        assert.equal(
            buildFollowUpEmailPromptInput({ meeting_type: 'interview', title: 'T', key_points: ['One'] }),
            'Meeting Type: interview\n\nTitle: T\n\nKey Points:\n- One',
        );
    });
});

describe('extractRecipientName', () => {
    test('email: first token of the local part, capitalised', () => {
        assert.equal(extractRecipientName('john.doe@example.com'), 'John');
        assert.equal(extractRecipientName('mary_ann@example.com'), 'Mary');
        assert.equal(extractRecipientName('lee-wong@example.com'), 'Lee');
        assert.equal(extractRecipientName('sam@example.com'), 'Sam');
    });

    test('email: case is normalised', () => {
        assert.equal(extractRecipientName('JOHN.DOE@EXAMPLE.COM'), 'John');
        assert.equal(extractRecipientName('jOhN@example.com'), 'John');
    });

    test('full name: first word, capitalised', () => {
        assert.equal(extractRecipientName('jane smith'), 'Jane');
        assert.equal(extractRecipientName('JANE Smith-Jones'), 'Jane');
        assert.equal(extractRecipientName('Cher'), 'Cher');
    });

    test('empty input gives an empty name', () => {
        assert.equal(extractRecipientName(''), '');
    });
});
