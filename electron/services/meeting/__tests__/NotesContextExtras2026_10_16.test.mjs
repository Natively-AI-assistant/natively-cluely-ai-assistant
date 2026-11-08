// Granola parity round 5 (2026-10-16): three more inputs to the notes prompt,
// as Granola's summary takes them: the links in the user's notes, the user's
// own "About you" bio, and pictures the user attached (described). Pure.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ctx = require(path.join(REPO, 'dist-electron/electron/services/meeting/meetingNotesContext.js'));

describe('links in the user\'s notes', () => {
    test('each link once, in order, trailing punctuation dropped, capped at 20', () => {
        const notes = 'See https://acme.com/deck. Also http://x.io/a, and https://acme.com/deck again\nhttps://y.org/(spec)';
        assert.deepEqual(ctx.extractNoteLinks(notes), ['https://acme.com/deck', 'http://x.io/a', 'https://y.org/']);
        const many = Array.from({ length: 30 }, (_, i) => `https://l${i}.io`).join(' ');
        assert.equal(ctx.extractNoteLinks(many).length, 20);
        assert.deepEqual(ctx.extractNoteLinks(''), []);
    });
    test('the block lists them under a heading, or is empty', () => {
        assert.equal(ctx.formatNoteLinksBlock('nothing here'), '');
        assert.equal(ctx.formatNoteLinksBlock('go to https://a.io'), "LINKS IN THE USER'S NOTES:\n- https://a.io");
        assert.match(ctx.NOTE_LINKS_RULES, /never invent/i);
    });
});

describe('attached images', () => {
    test('described images are numbered with their caption; undescribed ones are skipped; capped at 12', () => {
        const block = ctx.formatAttachedImagesBlock([
            { name: 'whiteboard.jpg', description: 'A whiteboard with a Q3 timeline: launch in July, beta in June.', at: 1 },
            { description: '', at: 2 },
            { description: 'A slide titled Pricing with three tiers.', at: 3 },
        ]);
        assert.equal(block, 'IMAGES THE USER ATTACHED:\n1. whiteboard.jpg: A whiteboard with a Q3 timeline: launch in July, beta in June.\n2. A slide titled Pricing with three tiers.');
        assert.equal(ctx.formatAttachedImagesBlock([]), '');
        assert.equal(ctx.formatAttachedImagesBlock(null), '');
        const many = Array.from({ length: 20 }, (_, i) => ({ description: `img ${i}` }));
        assert.equal(ctx.formatAttachedImagesBlock(many).split('\n').length - 1, 12);
        assert.match(ctx.ATTACHED_IMAGES_RULES, /never invent/i);
    });
});
