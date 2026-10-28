// Issue #679 (2026-10-23): "Voice input is not transcribed". The reporter had
// Ambient AI Chat on (Settings › General: "Meetings start without capturing mic
// or system audio"), so main never started capture or STT for the meeting. The
// overlay did not know: the Answer button still opened a voice recording and
// drew "Listening..." for as long as the user spoke, and nothing could ever
// arrive in it. These checks hold the overlay to what main actually does:
//
//  - main keeps, per meeting, whether it runs without audio: set from the
//    setting at the capture decision, cleared by any capture start (a speech
//    engine change mid-meeting) and at the end, pushed on every change;
//  - the overlay follows that, not the live setting, read on mount and at
//    every meeting start;
//  - while it holds, the notepad's status line says so, and Answer does not
//    open a recording. It goes straight to What to Answer, which is where a
//    Stop with nothing heard already goes (issue #540), and raises a "Mic is
//    off" banner with Turn on mic. (An "Ambient" pill beside the settings
//    button said so too; removed 2026-10-27.);
//  - main does not open the mic in such a meeting from the notepad's mic
//    picker or on wake from sleep (both used to record the meeting anyway).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(SRC, rel));

const NOTICE = 'components/overlay/AmbientChatNotice.tsx';
const TABLE = 'i18n.ambientChat.ts';

test('the overlay has an Ambient AI Chat notice', () => {
  assert.ok(exists(NOTICE), `${NOTICE} is missing`);
});

const MAIN = () => fs.readFileSync(path.resolve(SRC, '../electron/main.ts'), 'utf8');
const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start >= 0, `${from} not found`);
  return text.slice(start, text.indexOf(to, start));
};

test('main owns "this meeting runs without audio", per meeting, and pushes every change', () => {
  const main = MAIN();
  // Set from the setting where the meeting's audio init decides capture.
  assert.match(main, /this\.setMeetingWithoutAudio\(this\._ambientChatEnabled\);\s*if \(!this\._ambientChatEnabled\) \{/, 'not set at the capture decision');
  // Cleared where every capture start goes, only when a capture exists.
  // Only once a capture has actually started: both starts can throw.
  const channels = between(main, 'private startCaptureChannels(', 'return started;');
  const clear = channels.search(/if \(this\.isMeetingActive && \(\(started\.mic && this\.microphoneCapture\) \|\| \(started\.system && this\.systemAudioCapture\)\)\) \{\s*this\.setMeetingWithoutAudio\(false\);/);
  assert.ok(clear > 0, 'a capture started mid-meeting leaves the notice up');
  assert.ok(clear > channels.lastIndexOf('this.googleSTT?.start();'), 'cleared before the captures have started');
  // Cleared when the meeting ends (after the double-Stop guard).
  const end = between(main, 'private async endMeetingTransition(', 'this.cancelAutoAnswer();');
  assert.match(end, /this\.setMeetingWithoutAudio\(false\);\s*$/, 'a finished meeting keeps the flag');
  // Pushed to the meeting surfaces on change only.
  const setter = between(main, 'private setMeetingWithoutAudio(', '\n  }\n');
  assert.match(setter, /if \(this\._meetingWithoutAudio === withoutAudio\) return;/);
  assert.match(setter, /this\.sendToMeetingSurfaces\('meeting-audio-capture', \{ withoutAudio \}\)/);
});

test('main does not open the mic for a meeting that runs without audio', () => {
  const main = MAIN();
  // The notepad's mic picker: reconfigureAudio builds and starts both captures
  // and the pre-warmed speech engines.
  const sw = between(main, 'public switchMeetingInputDevice(', 'this._inputSwitchChain = ');
  const gate = sw.indexOf('if (this._meetingWithoutAudio) {');
  assert.ok(gate > 0, 'no gate on the mic switch');
  assert.ok(gate < sw.indexOf('await this.reconfigureAudio('), 'the gate comes after the mic is opened');
  assert.match(sw.slice(gate), /^if \(this\._meetingWithoutAudio\) \{[\s\S]{0,200}return false;/);
  // Wake from sleep recreated the mic and the speech engines and started them.
  const wake = between(main, 'public async restartCapturesAfterResume(', 'this._systemAudioRecoveryInProgress = false;');
  assert.match(wake, /if \(this\._meetingWithoutAudio\) \{[\s\S]{0,200}return;\s*\}/, 'wake from sleep opens the mic in an Ambient AI Chat meeting');
});

test('the fact crosses to the renderer: a getter and a push', () => {
  const ipc = fs.readFileSync(path.resolve(SRC, '../electron/ipcHandlers.ts'), 'utf8');
  assert.match(ipc, /safeHandle\('meeting:get-audio-capture', async \(\) => \{\s*return \{ withoutAudio: appState\.isMeetingWithoutAudio\(\) \};/);
  const preload = fs.readFileSync(path.resolve(SRC, '../electron/preload.ts'), 'utf8');
  assert.match(preload, /getMeetingAudioCapture: \(\) => ipcRenderer\.invoke\('meeting:get-audio-capture'\)/);
  assert.match(preload, /ipcRenderer\.on\('meeting-audio-capture', subscription\)/);
  assert.match(preload, /ipcRenderer\.removeListener\('meeting-audio-capture', subscription\)/);
  const types = read('types/electron.d.ts');
  assert.match(types, /getMeetingAudioCapture\?: \(\) => Promise<\{ withoutAudio: boolean \}>/);
  assert.match(types, /onMeetingAudioCapture\?: /);
});

test('the notice follows main, not the setting: read on mount and at every meeting start, pushes win', () => {
  const notice = read(NOTICE);
  assert.doesNotMatch(notice, /getAmbientChatEnabled/, 'the notice reads the live setting, which can differ from this meeting');
  assert.match(notice, /getMeetingAudioCapture\?\.\(\)/, 'never read on mount');
  const reset = between(notice, 'onSessionReset?.(', ');');
  assert.match(reset, /read/, 'a meeting start does not re-read');
  assert.match(notice, /onMeetingAudioCapture\?\.\(/, 'changes are not followed');
  // A read already in flight when a push lands must not overwrite the push.
  assert.match(notice, /pushes === pushesAtRead/);
  assert.match(notice, /unsubPush\?\.\(\)/, 'the push listener is never removed');
});

const BANNER_MESSAGE = 'Ambient AI Chat is on, so this meeting is not being heard or transcribed.';

// 2026-10-27: the "Ambient" pill went, and the "Mic is off" banner
// (fold-ambient-mic) shows from the meeting's start instead.
test('the overlay has no "Ambient" pill; the "Mic is off" banner says it instead', () => {
  const ui = read('components/NativelyInterface.tsx');
  assert.match(ui, /useAmbientChatMeeting\(\)/, 'the overlay does not use the hook');
  assert.doesNotMatch(ui, /AmbientChip|ambient-label/, 'the pill is back beside the settings button');
  assert.ok(!exists('components/overlay/AmbientChip.tsx'), 'the pill component is back');
});

test('the notepad says it too, before any other audio line (the overlay is hidden there)', () => {
  const notes = read('components/NotesWindow.tsx');
  assert.match(notes, /api\.getMeetingAudioCapture\?\.\(\)\.then\(\(state\) => setWithoutAudio\(state\?\.withoutAudio === true\)\)/);
  assert.match(notes, /api\.onMeetingAudioCapture\?\.\(\(state\) => setWithoutAudio\(state\?\.withoutAudio === true\)\)/);
  assert.match(notes, /const problem = \(withoutAudio \? 'Audio is off because Ambient AI Chat is on\. Turn it off in Settings › General\.' : null\)\s*\?\? Object\.values\(problems\)\[0\] \?\? null;/);
});

test('with Ambient AI Chat on, Answer goes to What to Answer instead of recording', () => {
  const ui = read('components/NativelyInterface.tsx');
  const start = ui.indexOf('const handleAnswerNow = async () => {');
  assert.ok(start > 0, 'handleAnswerNow not found');
  const body = ui.slice(start, ui.indexOf('const selectSkill', start));
  const recordStart = body.indexOf('// Start recording');
  assert.ok(recordStart > 0, 'the start-recording branch moved');
  const startBranch = body.slice(recordStart);
  const gate = startBranch.search(/ambientChat(?:Ref\.current|\.on)\b/);
  const opens = startBranch.indexOf('setIsManualRecording(true)');
  assert.ok(gate >= 0, 'the start branch never checks Ambient AI Chat');
  assert.ok(gate < opens, 'the Ambient AI Chat check comes after the recording opens');
  const gated = startBranch.slice(gate, opens);
  assert.match(gated, /handleWhatToSay\(\)/, 'with Ambient AI Chat on, Answer does not hand off to What to Answer');
  assert.match(gated, /return;/, 'with Ambient AI Chat on, the recording still opens');
});

test('the mic banner has a row in every language, and no row is left over', async () => {
  const own = [BANNER_MESSAGE, 'Mic is off', 'Turn on mic'];
  const mod = await import(pathToFileURL(path.join(SRC, TABLE)).href);
  assert.deepEqual([...mod.AMBIENT_CHAT_EN].sort(), own.sort());
  for (const [lang, table] of Object.entries({ ru: mod.AMBIENT_CHAT_RU, zh: mod.AMBIENT_CHAT_ZH, ja: mod.AMBIENT_CHAT_JA, es: mod.AMBIENT_CHAT_ES })) {
    for (const en of own) {
      assert.ok(typeof table[en] === 'string' && table[en].trim(), `${lang} has no row for "${en}"`);
      assert.notEqual(table[en], en, `${lang} left "${en}" in English`);
      // The setting keeps its English name everywhere, as Settings shows it.
      if (en.includes('Ambient AI Chat')) assert.ok(table[en].includes('Ambient AI Chat'), `${lang} renamed the setting`);
    }
  }
  const i18n = read('i18n.tsx');
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) {
    assert.ok(i18n.includes(`...AMBIENT_CHAT_${lang},`), `the ${lang} dictionary does not include the table`);
  }
});

// Users turned Ambient AI Chat on thinking it was something good, then reported
// the mic as broken. The overlay says why from the meeting's start and turns it
// off from there; main then starts the meeting's capture instead of waiting for
// the next one.
test('an Ambient AI Chat meeting says "Mic is off" from its start and can turn the mic on', () => {
  const ui = read('components/NativelyInterface.tsx');
  assert.match(ui, /const showAmbientMicNotice = ambientChat\.on && !ambientMicDismissed;/, 'not shown from the start, or outlives the audio-less meeting');
  assert.match(ui, /if \(!ambientChat\.on\) setAmbientMicDismissed\(false\);/, 'a dismissal carries into the next meeting');
  const start = ui.indexOf('const handleAnswerNow = async () => {');
  const body = ui.slice(start, ui.indexOf('const selectSkill', start));
  assert.match(body, /if \(ambientChat\.on\) \{\s*setAmbientMicDismissed\(false\);/, 'the mic button does not bring a dismissed notice back');
  const fold = between(ui, 'testId="fold-ambient-mic"', '</ChromeFold>');
  assert.match(fold, /title=\{t\('Mic is off'\)\}/);
  assert.match(fold, /message=\{t\('Ambient AI Chat is on, so this meeting is not being heard or transcribed\.'\)\}/);
  assert.match(fold, /onClick=\{\(\) => window\.electronAPI\?\.setAmbientChatEnabled\?\.\(false\)\}/);
  assert.match(fold, /\{t\('Turn on mic'\)\}/);

  const main = MAIN();
  const setter = between(main, 'public setAmbientChatEnabled(', 'private startAudioForMeetingWithoutAudio(');
  assert.match(setter, /if \(!enabled\) void this\.startAudioForMeetingWithoutAudio\(\);/, 'turning it off mid-meeting leaves the meeting silent');
  const starter = between(main, 'private startAudioForMeetingWithoutAudio(', 'return this._inputSwitchChain;');
  assert.match(starter, /if \(!this\.isMeetingActive \|\| !this\._meetingWithoutAudio\) return;/, 'opens the mic outside an audio-less meeting');
  assert.match(starter, /ensureMacMicrophoneAccess\(/, 'skips the macOS mic permission');
  assert.ok(starter.indexOf('setupSystemAudioPipeline()') < starter.indexOf("startCaptureChannels('ambientChatOff')"), 'starts channels before the pipeline exists');
  // The meeting's own devices, not the system defaults setupSystemAudioPipeline opens.
  assert.match(starter, /const meetingAudio = this\._meetingAudioRequest;/, 'opens the system defaults, not the meeting\'s devices');
  assert.match(starter, /this\.followedInputDeviceId\(meetingAudio\.inputDeviceId\)/, 'ignores Follow the meeting app\'s mic');
  assert.ok(starter.indexOf('reconfigureAudio(') < starter.indexOf('setupSystemAudioPipeline()'), 'the devices are picked after the pipeline is built');
  assert.match(starter, /\{ start: false \}/, 'the device pick starts the channels itself');
  assert.match(starter, /else if \(!this\.isMeetingActive\) \{[\s\S]*?this\.releaseOrphanedRebuild\(\);/, 'a Stop during the setup leaves its captures built for nobody');
  assert.match(starter, /this\._inputSwitchChain\.then\(run, run\)/, 'not serialised with mic switches');
});
