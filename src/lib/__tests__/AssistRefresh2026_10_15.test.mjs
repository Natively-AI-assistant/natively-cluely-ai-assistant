// The calendar reminder's "Running late" draft reaches the launcher (2026-10-15,
// PR #653 review). The launcher's own assist lists (Coming up today, Catch up,
// Yours to do) and their timed re-reads were taken out on 2026-11-01: the
// meeting list holds meeting names only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(dirname, '../..');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

test('the Running late request is received where it is always mounted (App) and handed down through the Launcher', () => {
  const app = read('App.tsx');
  assert.match(app, /onAssistReminderDraft\?\.\(\(req\) => \{[\s\S]{0,300}setLauncherRequest\(\{ kind: 'reminder-draft'/);
  const launcher = read('components/Launcher.tsx');
  assert.match(launcher, /request\.kind === 'reminder-draft'[\s\S]{0,200}setSelectedMeeting\(null\)/);
  assert.match(launcher, /draftRequest=\{reminderDraftRequest\}/);
  assert.doesNotMatch(read('components/assist/AssistToday.tsx'), /onAssistReminderDraft/);
});

test('the launcher no longer reads the assist lists on a timer', () => {
  const src = read('components/assist/AssistToday.tsx');
  assert.doesNotMatch(src, /setInterval|msUntilNextLocalMidnight|assistGetCatchUp|assistGetDailyBrief/);
  assert.match(src, /<ReminderDraftPanel/);
});
