// Reminder drafts (2026-10-15, src/lib/reminderDrafts.mjs): "running late",
// "are you joining?" and "can we move it?" for the people on an upcoming
// meeting, for the user to send. Natively never sends them: they are copied,
// or opened in the user's mail app (mailto:) or Gmail's compose window.
//
// Pure; no DOM. The mailto encoding is what both macOS (Mail, Outlook) and
// Windows (the default mail handler) read the same way: %20 for spaces and
// %0D%0A for line breaks, and the link stays under the length Windows' shell
// accepts. Times are formatted with an explicit time zone so the result is the
// same on any machine.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderDraft, mailtoUrl, reminderGmailUrl, clipboardText, registerFromStyle, greetingNames, MAILTO_MAX_LENGTH } from '../reminderDrafts.mjs';

const event = {
  title: 'Acme weekly',
  startTime: '2026-10-15T10:30:00Z',
  attendees: [
    { email: 'priya@client.com', name: 'Priya Nair' },
    { email: 'rob@client.com', name: 'Rob Lane' },
    { email: 'no@thanks.com', name: 'Declined Dan', response: 'declined' },
    { email: 'PRIYA@client.com', name: 'Priya again' },
  ],
};

describe('the drafts', () => {
  test('addressed to everyone who has not declined, once each, greeted by first name', () => {
    const d = buildReminderDraft({ kind: 'running_late', event, senderName: 'Evin John', minutesLate: 10, timeZone: 'UTC', locale: 'en-GB' });
    assert.deepEqual(d.to, ['priya@client.com', 'rob@client.com']);
    assert.match(d.body, /^Hi Priya and Rob,/);
    assert.equal(d.subject, 'Running 10 minutes late: Acme weekly');
    assert.match(d.body, /about 10 minutes late for Acme weekly/);
    assert.match(d.body, /Thanks,\nEvin$/);
  });

  test('are you joining, and can we move it, name the time', () => {
    const noShow = buildReminderDraft({ kind: 'no_show', event, timeZone: 'UTC', locale: 'en-GB' });
    assert.equal(noShow.subject, 'Are you joining? Acme weekly');
    assert.match(noShow.body, /set for 10:30/);
    const move = buildReminderDraft({ kind: 'reschedule', event, timeZone: 'UTC', locale: 'en-GB' });
    assert.equal(move.subject, 'Can we move Acme weekly?');
    assert.match(move.body, /can't make Acme weekly at 10:30/);
  });

  test('a style string picks the register; nothing else of it is used', () => {
    assert.equal(registerFromStyle('Formal and courteous'), 'formal');
    assert.equal(registerFromStyle('short, casual, lowercase'), 'casual');
    assert.equal(registerFromStyle(''), 'neutral');
    assert.equal(registerFromStyle(undefined), 'neutral');
    const formal = buildReminderDraft({ kind: 'running_late', event, senderName: 'Evin John', style: 'formal', timeZone: 'UTC' });
    assert.match(formal.body, /^Hello Priya and Rob,/);
    assert.match(formal.body, /Best regards,\nEvin John$/);
    const casual = buildReminderDraft({ kind: 'running_late', event, style: 'casual', timeZone: 'UTC' });
    assert.match(casual.body, /Start without me/);
  });

  test('minutes are kept between 1 and 60; no title still reads', () => {
    assert.match(buildReminderDraft({ kind: 'running_late', event, minutesLate: 500 }).subject, /Running 60 minutes late/);
    assert.match(buildReminderDraft({ kind: 'running_late', event: { startTime: event.startTime } }).subject, /our meeting/);
    assert.match(buildReminderDraft({ kind: 'running_late', event: { startTime: event.startTime } }).body, /^Hi all,/);
  });

  test('greeting names: up to four, else "all"', () => {
    assert.equal(greetingNames([{ email: 'a@x.com', name: 'Ann Lee' }]), 'Ann');
    assert.equal(greetingNames([{ email: 'a@x.com' }, { email: 'b@x.com' }, { email: 'c@x.com' }]), 'a, b and c');
    assert.equal(greetingNames(Array.from({ length: 5 }, (_, i) => ({ email: `p${i}@x.com` }))), '');
  });

  test('no dashes in the copy', () => {
    for (const kind of ['running_late', 'no_show', 'reschedule']) {
      const d = buildReminderDraft({ kind, event, senderName: 'Evin', timeZone: 'UTC' });
      assert.doesNotMatch(`${d.subject}\n${d.body}`, /[—–]| - /);
    }
  });
});

describe('mailto encoding', () => {
  test('spaces are %20 (never +), line breaks %0D%0A, addresses readable, every reserved character escaped', () => {
    const url = mailtoUrl({ to: ['priya@client.com', 'rob+work@client.com'], subject: 'Q&A: 50% done?', body: 'Line one\nLine two & more' });
    assert.ok(url.startsWith('mailto:priya@client.com,rob%2Bwork@client.com?'));
    assert.match(url, /subject=Q%26A%3A%2050%25%20done%3F/);
    assert.match(url, /body=Line%20one%0D%0ALine%20two%20%26%20more/);
    assert.doesNotMatch(url.split('?')[1], /\+/);
    assert.equal(decodeURIComponent(url.split('body=')[1]), 'Line one\r\nLine two & more');
  });

  test('a real draft fits; one too long for Windows comes back null', () => {
    const d = buildReminderDraft({ kind: 'reschedule', event, senderName: 'Evin', timeZone: 'UTC' });
    const url = mailtoUrl(d);
    assert.ok(url && url.length <= MAILTO_MAX_LENGTH);
    assert.equal(mailtoUrl({ to: ['a@b.com'], subject: 's', body: 'x'.repeat(3000) }), null);
  });

  test('Gmail opens the same draft, in the calendar\'s account', () => {
    const d = buildReminderDraft({ kind: 'running_late', event, timeZone: 'UTC' });
    const url = reminderGmailUrl(d, 'evin@acme.com');
    assert.ok(url.startsWith('https://mail.google.com/mail/?view=cm&fs=1&authuser=evin%40acme.com&to=priya%40client.com,rob%40client.com'));
    assert.match(url, /su=Running%205%20minutes%20late/);
  });

  test('the clipboard gets the subject, then the body', () => {
    assert.equal(clipboardText({ subject: 'S', body: 'B' }), 'S\n\nB');
  });
});
