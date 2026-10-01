// electron/services/__tests__/MeetingTitleListMarker2026_09_29.test.mjs
//
// A meeting was saved as "- Summary was missing and got corrected": the title
// generator's answer began with a list marker and cleanMeetingTitle stripped
// `*`, backticks and `#` but not a leading "- ". The notes and the Home list
// then printed the dash. cleanMeetingTitle now drops a leading list/dash marker
// (hyphen, en dash, em dash, bullet) followed by a space — and only that: a dash
// inside a title, or one with no space after it, is left alone.
//
// Pure string function; identical on darwin and win32.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { cleanMeetingTitle } = await import(pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/services/meeting/MeetingSummaryV3.js')).href);

test('a leading list marker is removed', () => {
  assert.equal(cleanMeetingTitle('- Summary was missing and got corrected'), 'Summary was missing and got corrected');
  assert.equal(cleanMeetingTitle('– Roadmap review'), 'Roadmap review');
  assert.equal(cleanMeetingTitle('— Roadmap review'), 'Roadmap review');
  assert.equal(cleanMeetingTitle('• Roadmap review'), 'Roadmap review');
});

test('it composes with the existing heading, bold and quote cleanup', () => {
  assert.equal(cleanMeetingTitle('## Weekly sync'), 'Weekly sync');
  assert.equal(cleanMeetingTitle('**Q4 planning**'), 'Q4 planning');
  assert.equal(cleanMeetingTitle('"- Q4 planning"'), 'Q4 planning');
  assert.equal(cleanMeetingTitle('# - Q4 planning'), 'Q4 planning');
});

test('dashes that belong to the title are kept', () => {
  assert.equal(cleanMeetingTitle('Sprint 12 - planning'), 'Sprint 12 - planning');
  assert.equal(cleanMeetingTitle('Follow-up call'), 'Follow-up call');
  assert.equal(cleanMeetingTitle('-5% churn review'), '-5% churn review');
});
