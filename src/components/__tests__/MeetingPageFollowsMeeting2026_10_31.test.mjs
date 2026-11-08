// The meeting page follows the meeting it is given (2026-10-31). MeetingDetails
// copies its `meeting` prop into state once, so opening another meeting while a
// page was open (the notes window's "Open meeting" after Stop, a search hit,
// Settings › About's demo meeting) kept showing the old meeting, and its Ask
// answered about the old meeting. Found by the Granola benchmark: 20 of 21
// meetings' questions went to the first meeting opened. The Launcher keys the
// page by meeting id, so a new meeting mounts a fresh page (source contract;
// there is no render harness for the Launcher).
//
// Pure renderer logic; no platform branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const launcher = readFileSync(join(HERE, '../Launcher.tsx'), 'utf8');
const details = readFileSync(join(HERE, '../MeetingDetails.tsx'), 'utf8');

test('the Launcher remounts the meeting page when the meeting changes', () => {
    assert.match(launcher, /<MeetingDetails\s+key=\{selectedMeeting\.id\}\s+meeting=\{selectedMeeting\}/);
});

test('the page still copies its meeting once, which is why the key is needed', () => {
    assert.match(details, /const \[baseMeeting, setMeeting\] = useState<Meeting>\(initialMeeting\);/);
});

test('an unmounted page releases the chat layer it raised', () => {
    assert.match(details, /useEffect\(\(\) => \(\) => onChatOpenChange\?\.\(false\), \[onChatOpenChange\]\);/);
});
