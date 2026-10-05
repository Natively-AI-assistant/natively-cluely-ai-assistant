// What the extension tells the desktop about meeting tabs (meeting-tabs.ts):
// meetings only, as keys only. No address (a Zoom link carries its passcode),
// no other tab, no incognito tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/meeting-tabs.js');
const { meetingTabsReport, MAX_MEETING_TABS } = await import(pathToFileURL(modPath).href);

test('only meetings, as keys, and never the address', () => {
  const report = meetingTabsReport([
    { url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Inbox (3)', active: true },
    { url: 'https://us02web.zoom.us/j/81234567890?pwd=SECRET', title: 'Zoom Meeting', audible: true },
    { url: 'https://meet.google.com/abc-defg-hij?authuser=0', title: 'Meet – Weekly sync' },
    { url: 'https://meet.google.com/landing', title: 'Google Meet' },
  ]);
  assert.deepEqual(report.map((t) => t.key), ['zoom:81234567890', 'meet:abc-defg-hij']);
  const wire = JSON.stringify(report);
  assert.ok(!wire.includes('SECRET') && !wire.includes('https://') && !wire.includes('Inbox'), wire);
});

test('the likeliest call first: sound, then the tab in front, then the most recent', () => {
  const report = meetingTabsReport([
    { url: 'https://meet.google.com/aaa-aaaa-aaa', lastAccessed: 5 },
    { url: 'https://meet.google.com/bbb-bbbb-bbb', active: true, lastAccessed: 1 },
    { url: 'https://meet.google.com/ccc-cccc-ccc', audible: true, lastAccessed: 0 },
    { url: 'https://meet.google.com/ddd-dddd-ddd', lastAccessed: 9 },
  ]);
  assert.deepEqual(report.map((t) => t.key.slice(5, 8)), ['ccc', 'bbb', 'ddd', 'aaa']);
});

test('incognito never; one entry per meeting; a small, bounded report', () => {
  assert.deepEqual(meetingTabsReport([{ url: 'https://meet.google.com/abc-defg-hij', incognito: true }]), []);
  assert.equal(meetingTabsReport([
    { url: 'https://meet.google.com/abc-defg-hij' },
    { url: 'https://meet.google.com/ABC-DEFG-HIJ?hs=1' },
  ]).length, 1, 'the same meeting in two tabs');
  const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://zoom.us/j/8123456${String(i).padStart(4, '0')}`, title: 'x'.repeat(500) }));
  const report = meetingTabsReport(many);
  assert.equal(report.length, MAX_MEETING_TABS);
  assert.ok(report.every((t) => t.title.length <= 120));
  assert.ok(JSON.stringify({ type: 'meeting-tabs', tabs: report }).length < 4096, 'fits even the phone-sized frame cap');
  assert.deepEqual(meetingTabsReport([{ pendingUrl: 'https://meet.google.com/abc-defg-hij' }]).map((t) => t.key), ['meet:abc-defg-hij'], 'a tab still loading');
});
