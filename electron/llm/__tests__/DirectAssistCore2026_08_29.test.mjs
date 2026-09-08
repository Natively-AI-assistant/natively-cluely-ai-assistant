import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const distDirectAssist = path.resolve(root, 'dist-electron/electron/direct-assist/index.js');
const require = createRequire(import.meta.url);

async function loadDirectAssist() {
  return import(pathToFileURL(distDirectAssist).href);
}

/** Bare LLMHelper instance (prototype methods only — no network, no settings
 *  store, no provider clients), the pattern established in
 *  ProviderDataScopeOutbound2026_08_01.test.mjs, so the REAL privacy-scope
 *  regexes run against a REAL prepareDirectAssistPrompt() output instead of
 *  matching a hand-typed fixture string. */
function llmHelperCaller() {
  const { LLMHelper } = require(path.resolve(root, 'dist-electron/electron/LLMHelper.js'));
  const self = Object.create(LLMHelper.prototype);
  return (name, ...args) => LLMHelper.prototype[name].call(self, ...args);
}

function baseInput(overrides = {}) {
  return {
    requestId: 'direct-test-1',
    source: 'typed',
    selection: { provider: 'gemini', model: 'gemini-3.7-flash' },
    currentRequest: 'Solve this in C++ and give me the code.',
    ...overrides,
  };
}

async function collect(generator) {
  const events = [];
  let result;
  while (true) {
    const item = await generator.next();
    if (item.done) {
      result = item.value;
      break;
    }
    events.push(item.value);
  }
  return { events, result };
}

function createFakeTimerScheduler() {
  const handles = [];
  const scheduler = {
    set(callback, delayMs) {
      const handle = { callback, delayMs, active: true };
      handles.push(handle);
      return handle;
    },
    clear(handle) {
      if (handle) handle.active = false;
    },
  };
  return {
    scheduler,
    handles,
    active: () => handles.filter((handle) => handle.active),
    fire(handle = handles.findLast((candidate) => candidate.active)) {
      if (!handle?.active) return false;
      handle.active = false;
      handle.callback();
      return true;
    },
  };
}

test('current request detects and preserves C++ over stale explicit language', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const prepared = prepareDirectAssistPrompt(baseInput({ requestedLanguage: 'Java' }));

  assert.equal(prepared.request.requestedLanguage, 'C++');
  assert.equal(prepared.request.requestedFormat, 'code');
  assert.match(prepared.userPrompt, /Programming language: C\+\+/);
  assert.doesNotMatch(prepared.userPrompt, /Programming language: Java/);
  assert.match(prepared.userPrompt, /Solve this in C\+\+ and give me the code\./);

  const correctedLanguage = prepareDirectAssistPrompt(baseInput({
    currentRequest: 'Solve it in C++, but actually use Java.',
  }));
  assert.equal(correctedLanguage.request.requestedLanguage, 'Java');

  const correctedJson = prepareDirectAssistPrompt(baseInput({
    currentRequest: 'Give me the code, but actually return valid JSON.',
  }));
  assert.equal(correctedJson.request.requestedFormat, 'JSON');

  const correctedPlainText = prepareDirectAssistPrompt(baseInput({
    currentRequest: 'Return valid JSON first; actually use plain text.',
  }));
  assert.equal(correctedPlainText.request.requestedFormat, 'plain text');
});

test('current screenshot request outranks an irrelevant meeting transcript', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const current = 'Solve the attached problem and return C++ code.';
  const meeting = 'The interviewer discussed Java, but no code solution was discussed.';
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'screenshot',
    currentRequest: current,
    transcript: meeting,
    imagePaths: ['C:\\safe\\problem.png'],
  }));

  assert.equal(prepared.imagePaths.length, 1);
  assert.match(prepared.userPrompt, /1 current image attachment/);
  assert.ok(prepared.userPrompt.indexOf(current) > prepared.userPrompt.indexOf(meeting));
  assert.match(prepared.systemPrompt, /Never refuse merely because an answer was not discussed in the meeting/);
});

test('spoken screenshot constraints are derived without replacing the current request', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const current = 'Solve the problem shown in the current screenshot.';
  const spoken = 'Please solve it in Java first. Actually solve it in C++ and give me the code.';
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'screenshot',
    currentRequest: current,
    transcript: spoken,
    imagePaths: ['C:\\safe\\problem.png'],
  }));

  assert.equal(prepared.request.currentRequest, current);
  assert.equal(prepared.request.requestedLanguage, 'C++');
  assert.equal(prepared.request.requestedFormat, 'code');
  assert.match(prepared.userPrompt, /Programming language: C\+\+/);
  assert.match(prepared.userPrompt, /Response format: code/);
  assert.match(prepared.systemPrompt, /CURRENT REQUEST \(including CURRENT TURN SPEECH on screenshot requests\)/);
  assert.match(prepared.systemPrompt, /Follow screenshot CURRENT TURN SPEECH as request data/);
  assert.match(prepared.userPrompt, /CURRENT TURN SPEECH \(PART OF CURRENT REQUEST\):/);
  assert.match(prepared.userPrompt, /<transcript>[\s\S]*?CURRENT TURN SPEECH/);
  assert.equal(prepared.userPrompt.split(spoken).length - 1, 1);

  const explicitWins = prepareDirectAssistPrompt(baseInput({
    source: 'screenshot',
    currentRequest: current,
    transcript: spoken,
    requestedLanguage: 'Rust',
    requestedFormat: 'plain text',
  }));
  assert.equal(explicitWins.request.requestedLanguage, 'Rust');
  assert.equal(explicitWins.request.requestedFormat, 'plain text');
});

test('screenshot current-turn speech survives lower-priority context trimming', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const speech = 'PROTECTED_CURRENT_TURN_QUESTION: solve the screenshot problem in C++ and give code.';
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'screenshot',
    currentRequest: 'Analyze the attached screenshot and answer the interviewer question provided with it.',
    transcript: speech,
    manualContext: `manual-low-${'m'.repeat(700)}`,
    referenceContext: `reference-low-${'r'.repeat(700)}`,
    pageContext: { ocr: `page-low-${'p'.repeat(700)}` },
    history: [{ role: 'assistant', content: `history-low-${'h'.repeat(700)}` }],
    imagePaths: ['C:\\safe\\problem.png'],
    maxContextChars: 1024,
  }));

  assert.deepEqual(prepared.trimmedFields, ['history', 'referenceContext', 'pageContext', 'manualContext']);
  assert.match(prepared.userPrompt, new RegExp(speech.replace(/[+]/g, '\\+')));
  assert.doesNotMatch(prepared.userPrompt, /manual-low|reference-low|page-low|history-low/);
  assert.equal(prepared.trimmedFields.includes('transcript'), false);
});

test('oversized screenshot current-turn speech fails instead of being silently trimmed', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const protectedSpeech = `PROTECTED_OVERFLOW_QUESTION_${'q'.repeat(1800)}`;

  assert.throws(
    () => prepareDirectAssistPrompt(baseInput({
      source: 'screenshot',
      currentRequest: 'Analyze the attached screenshot and answer its current spoken question.',
      transcript: protectedSpeech,
      manualContext: `optional-${'x'.repeat(800)}`,
      maxContextChars: 1024,
    })),
    (error) => error?.code === 'CONTEXT_TOO_LARGE',
  );
});

test('selected skill is injected exactly once and context uses privacy scope tags', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const skill = 'UNIQUE_SKILL_INSTRUCTION_7429';
  const prepared = prepareDirectAssistPrompt(baseInput({
    skill: { id: 'coding', name: 'Coding', instructions: skill },
    manualContext: 'Manual profile facts',
    referenceContext: 'Reference file facts',
    pageContext: { dom: '<main>problem</main>', ocr: 'problem text' },
    history: [{ role: 'assistant', content: 'Prior direct answer' }],
    transcript: 'Meeting words',
  }));

  assert.equal(prepared.userPrompt.split(skill).length - 1, 1);
  assert.match(prepared.userPrompt, /<active_mode_custom_instructions>/);
  assert.match(prepared.userPrompt, /<user_context>/);
  assert.match(prepared.userPrompt, /<reference_file>/);
  assert.match(prepared.userPrompt, /<evidence source_type="SCREEN_CONTEXT">/);
  assert.match(prepared.userPrompt, /<recent_transcript>/);
  assert.match(prepared.userPrompt, /<transcript>/);
  assert.match(prepared.userPrompt, /&lt;main&gt;problem&lt;\/main&gt;/);
});

test('context trimming removes transcript first and never truncates current request or skill', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const current = 'CURRENT_REQUEST_MUST_SURVIVE: return C++ code.';
  const skill = 'SKILL_MUST_SURVIVE';
  const prepared = prepareDirectAssistPrompt(baseInput({
    currentRequest: current,
    skill: { instructions: skill },
    manualContext: 'manual-short',
    pageContext: { ocr: 'page-short' },
    referenceContext: 'reference-short',
    history: [{ role: 'user', content: 'history-short' }],
    transcript: `transcript-low-priority-${'x'.repeat(700)}`,
    maxContextChars: 1024,
  }));

  assert.deepEqual(prepared.trimmedFields, ['transcript']);
  assert.doesNotMatch(prepared.userPrompt, /transcript-low-priority/);
  assert.match(prepared.userPrompt, /manual-short/);
  assert.match(prepared.userPrompt, /page-short/);
  assert.match(prepared.userPrompt, /reference-short/);
  assert.match(prepared.userPrompt, /history-short/);
  assert.match(prepared.userPrompt, new RegExp(current.replace(/[+]/g, '\\+')));
  assert.equal(prepared.userPrompt.split(skill).length - 1, 1);
});

test('meetingTranscript renders as its own block for every source, alongside whatever transcript already carries', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const meeting = 'MEETING_TRANSCRIPT_LAST_180S: the interviewer just asked about Big-O.';
  for (const source of ['typed', 'stt', 'screenshot']) {
    const prepared = prepareDirectAssistPrompt(baseInput({
      source,
      meetingTranscript: meeting,
      ...(source === 'screenshot' ? { transcript: 'current turn speech snippet' } : {}),
    }));
    assert.match(prepared.userPrompt, /<evidence source_type="MEETING_TRANSCRIPT">/, `source=${source}`);
    assert.match(prepared.userPrompt, new RegExp(meeting.replace(/[+-]/g, '\\$&')), `source=${source}`);
  }
});

test('typed requests sacrifice meetingTranscript before referenceContext, shortening it before dropping it', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  // Enough newest turns to be worth keeping, so this exercises the SHRINK
  // branch: the oldest turns go, the most recent ones and every other field
  // survive. A field is only dropped outright once shrinking cannot help.
  const meeting = Array.from(
    { length: 40 },
    (_, index) => `[INTERVIEWER]: meeting-turn-${index} ${'m'.repeat(40)}`,
  ).join('\n');
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'typed',
    meetingTranscript: meeting,
    referenceContext: 'reference-must-survive',
    manualContext: 'manual-short',
    pageContext: { ocr: 'page-short' },
    history: [{ role: 'user', content: 'history-short' }],
    maxContextChars: 1024,
  }));

  assert.deepEqual(prepared.trimmedFields, []);
  assert.deepEqual(prepared.shortenedFields, ['meetingTranscript']);
  assert.match(prepared.userPrompt, /meeting-turn-39/, 'the newest turn is what the question is about');
  assert.doesNotMatch(prepared.userPrompt, /meeting-turn-0\b/, 'the oldest turns are the ones given up');
  assert.match(prepared.userPrompt, /\[\.\.\.earlier transcript omitted\]/);
  assert.match(prepared.userPrompt, /reference-must-survive/);
  assert.match(prepared.userPrompt, /history-short/);
  assert.ok(prepared.userPrompt.length <= 1024);
});

test('typed requests still DROP meetingTranscript when no useful amount of it fits', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'typed',
    meetingTranscript: `meeting-low-${'m'.repeat(700)}`,
    referenceContext: `reference-must-survive-${'r'.repeat(600)}`,
    maxContextChars: 1024,
  }));

  assert.deepEqual(prepared.trimmedFields, ['meetingTranscript']);
  assert.doesNotMatch(prepared.userPrompt, /meeting-low/);
  assert.match(prepared.userPrompt, /reference-must-survive/);
});

test('stt and screenshot requests drop referenceContext before meetingTranscript when oversized', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  for (const source of ['stt', 'screenshot']) {
    const prepared = prepareDirectAssistPrompt(baseInput({
      source,
      meetingTranscript: 'meeting-transcript-must-survive',
      referenceContext: `reference-low-${'r'.repeat(700)}`,
      manualContext: 'manual-short',
      pageContext: { ocr: 'page-short' },
      history: [{ role: 'user', content: 'history-short' }],
      maxContextChars: 1024,
    }));

    // referenceContext is the field this source class gives up first — whether
    // that means shortened or dropped depends on how much room is left, and
    // either way meetingTranscript is untouched.
    assert.ok(
      prepared.trimmedFields.includes('referenceContext')
      || prepared.shortenedFields.includes('referenceContext'),
      `source=${source}`,
    );
    assert.equal(prepared.trimmedFields.includes('meetingTranscript'), false, `source=${source}`);
    assert.equal(prepared.shortenedFields.includes('meetingTranscript'), false, `source=${source}`);
    assert.match(prepared.userPrompt, /meeting-transcript-must-survive/, `source=${source}`);
    assert.ok(prepared.userPrompt.length <= 1024, `source=${source}`);
  }
});

test('full per-source trim order: typed protects referenceContext longer, stt/screenshot protect meetingTranscript longest', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  // Padded so the LAST-standing field alone still exceeds maxContextChars
  // (the requestBuilder floor is 1024) — otherwise the cascade can stop early
  // and the test would pass without actually exercising the full order.
  const pad = (label) => `${label}-${label[0].repeat(950)}`;

  const typed = prepareDirectAssistPrompt(baseInput({
    source: 'typed',
    transcript: pad('transcript-low'),
    meetingTranscript: pad('meeting-low'),
    manualContext: pad('manual-low'),
    pageContext: { ocr: pad('page-low') },
    referenceContext: pad('reference-low'),
    history: [{ role: 'user', content: pad('history-low') }],
    maxContextChars: 1024,
  }));
  assert.deepEqual(
    typed.trimmedFields,
    ['transcript', 'meetingTranscript', 'history', 'referenceContext', 'pageContext', 'manualContext'],
  );

  const stt = prepareDirectAssistPrompt(baseInput({
    source: 'stt',
    transcript: pad('transcript-low'),
    meetingTranscript: pad('meeting-low'),
    manualContext: pad('manual-low'),
    pageContext: { ocr: pad('page-low') },
    referenceContext: pad('reference-low'),
    history: [{ role: 'user', content: pad('history-low') }],
    maxContextChars: 1024,
  }));
  // meetingTranscript is the LAST thing this source class gives up, so by the
  // time its turn comes everything else is already gone and a useful tail of
  // it fits — shortened, not dropped. That it comes last is the contract here.
  assert.deepEqual(
    stt.trimmedFields,
    ['transcript', 'history', 'referenceContext', 'pageContext', 'manualContext'],
  );
  assert.deepEqual(stt.shortenedFields, ['meetingTranscript']);
  assert.match(stt.userPrompt, /\[\.\.\.earlier transcript omitted\]/);
  assert.match(
    stt.userPrompt,
    /<evidence source_type="MEETING_TRANSCRIPT">[\s\S]{400,}<\/evidence>/,
    'a useful amount of the newest transcript is kept, not a token stub',
  );
});

test('buildDirectAssistReferenceContext concatenates raw file content with no cap under budget', async () => {
  const { buildDirectAssistReferenceContext } = await loadDirectAssist();
  const built = buildDirectAssistReferenceContext([
    { fileName: 'notes.md', content: 'first file content' },
    { fileName: 'spec.md', content: 'second file content' },
  ]);
  assert.match(built, /# notes\.md/);
  assert.match(built, /first file content/);
  assert.match(built, /# spec\.md/);
  assert.match(built, /second file content/);
  assert.doesNotMatch(built, /\[TRUNCATED/);
});

test('buildDirectAssistReferenceContext caps a single oversized file with a truncation marker, not an all-or-nothing drop', async () => {
  const { buildDirectAssistReferenceContext } = await loadDirectAssist();
  const huge = 'x'.repeat(50_000);
  const built = buildDirectAssistReferenceContext(
    [{ fileName: 'huge.md', content: huge }],
    1_000,
  );
  assert.ok(built.length <= 1_000 + 200, 'capped output should be close to the requested budget');
  assert.match(built, /\[TRUNCATED: only the beginning of "huge\.md" is included\. The file is 50000 characters long/);
  assert.match(built, /Do not infer or extrapolate anything from the missing part/);
  assert.match(built, /# huge\.md/, 'the file name survives even when its content is truncated');
});

test('buildDirectAssistReferenceContext shares the cross-file total instead of letting the first file take it all', async () => {
  const { buildDirectAssistReferenceContext } = await loadDirectAssist();
  const built = buildDirectAssistReferenceContext(
    [
      { fileName: 'first.md', content: 'a'.repeat(600) },
      { fileName: 'second.md', content: 'b'.repeat(600) },
    ],
    1_000,
  );
  assert.match(built, /# first\.md/);
  assert.match(built, /# second\.md/, 'the later file must not be starved by the earlier one');
  assert.match(built, /a{200}/);
  assert.match(built, /b{200}/);
  assert.match(built, /\[TRUNCATED/);
  assert.ok(built.length <= 1_000 + 200);
});

test('one oversized attachment cannot starve the small files beside it', async () => {
  const { allocateDirectAssistReferenceFiles } = await loadDirectAssist();
  // The shape that broke a real profile: a 420 KB document uploaded first,
  // then five small files including the resume. Under the old first-come
  // walk the 200 000-char ceiling was spent entirely on the big document and
  // the other five never reached the model at all.
  const allocation = allocateDirectAssistReferenceFiles(
    [
      { fileName: 'huge.md', content: 'H'.repeat(420_000) },
      { fileName: 'anchors.md', content: 'ANCHOR-A02 is 180 ms. '.repeat(50) },
      { fileName: 'resume.md', content: 'RESUME_MARKER Arjun Nair. '.repeat(50) },
    ],
    64_000,
  );

  assert.equal(allocation.totalFiles, 3);
  assert.equal(allocation.includedFiles, 3);
  assert.equal(allocation.truncatedFiles, 1, 'only the file that genuinely does not fit is cut');
  assert.match(allocation.text, /# huge\.md/);
  assert.match(allocation.text, /ANCHOR-A02 is 180 ms/);
  assert.match(allocation.text, /RESUME_MARKER Arjun Nair/);
  assert.ok(allocation.text.length <= 64_000);
});

test('a starved reference file is reported even when the prompt as a whole fits', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const prepared = prepareDirectAssistPrompt(baseInput({
    referenceFiles: [
      { fileName: 'huge.md', content: 'H'.repeat(300_000) },
      { fileName: 'resume.md', content: 'RESUME_MARKER Arjun Nair.' },
    ],
  }));

  // Nothing was dropped and the request is well inside the budget, but the
  // big file could not arrive whole — silence here is exactly what made the
  // old starvation impossible to notice.
  assert.deepEqual(prepared.trimmedFields, []);
  assert.deepEqual(prepared.shortenedFields, ['referenceContext']);
  assert.match(prepared.userPrompt, /RESUME_MARKER Arjun Nair/);
  assert.match(prepared.userPrompt, /\[TRUNCATED: only the beginning of "huge\.md" is included/);
});

test('structured reference files are re-shared rather than dropped when the budget is tight', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'stt',
    referenceFiles: [
      { fileName: 'huge.md', content: 'H'.repeat(50_000) },
      { fileName: 'resume.md', content: `RESUME_MARKER ${'r'.repeat(500)}` },
    ],
    meetingTranscript: 'meeting-must-survive',
    maxContextChars: 4_000,
  }));

  assert.deepEqual(prepared.trimmedFields, []);
  assert.deepEqual(prepared.shortenedFields, ['referenceContext']);
  assert.match(prepared.userPrompt, /RESUME_MARKER/, 'the small file survives the big one');
  assert.match(prepared.userPrompt, /# huge\.md/);
  assert.match(prepared.userPrompt, /meeting-must-survive/);
  assert.ok(prepared.userPrompt.length <= 4_000);
});

test('buildDirectAssistReferenceContext skips empty/blank file content without emitting an empty section', async () => {
  const { buildDirectAssistReferenceContext } = await loadDirectAssist();
  const built = buildDirectAssistReferenceContext([
    { fileName: 'empty.md', content: '   ' },
    { fileName: 'real.md', content: 'actual content' },
  ]);
  assert.doesNotMatch(built, /# empty\.md/);
  assert.match(built, /# real\.md/);
});

test('request builder rejects a forged provider identifier at runtime', async () => {
  const { buildDirectAssistRequest } = await loadDirectAssist();
  assert.throws(
    () => buildDirectAssistRequest(baseInput({ selection: { provider: 'auto-fallback', model: 'anything' } })),
    (error) => error?.code === 'NO_PROVIDER_CONFIGURED',
  );
});

test('service dispatches exactly once to the frozen provider/model and preserves raw deltas', async () => {
  const { DirectAssistService } = await loadDirectAssist();
  const calls = [];
  const controller = new AbortController();
  const transport = {
    streamDirectAssist(request, signal) {
      calls.push({ request, signal });
      return (async function* () {
        yield 'raw ';
        yield 'provider output';
      })();
    },
  };
  const service = new DirectAssistService(transport);
  const { events, result } = await collect(service.stream(baseInput({
    selection: { provider: 'openai', model: 'gpt-5.4' },
  }), controller.signal));

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request.selection, { provider: 'openai', model: 'gpt-5.4' });
  assert.notEqual(calls[0].signal, controller.signal);
  assert.equal(calls[0].signal.aborted, false);
  assert.equal(Object.isFrozen(calls[0].request), true);
  assert.equal(Object.isFrozen(calls[0].request.selection), true);
  assert.deepEqual(events.map((event) => event.type), ['start', 'delta', 'delta', 'done']);
  assert.deepEqual(events.filter((event) => event.type === 'delta').map((event) => event.text), ['raw ', 'provider output']);
  assert.deepEqual(events.filter((event) => event.type === 'delta').map((event) => event.sequence), [1, 2]);
  assert.equal(result.state, 'complete');
});

test('the start event reports which fields prepareDirectAssistPrompt trimmed, so the renderer can notify the user', async () => {
  const { DirectAssistService } = await loadDirectAssist();
  const transport = {
    streamDirectAssist() {
      return (async function* () { yield 'ok'; })();
    },
  };
  const service = new DirectAssistService(transport);

  const untrimmed = await collect(service.stream(baseInput()));
  const start1 = untrimmed.events.find((event) => event.type === 'start');
  assert.deepEqual(start1.trimmedFields, []);

  assert.deepEqual(start1.shortenedFields, []);

  const trimmed = await collect(service.stream(baseInput({
    source: 'typed',
    meetingTranscript: `meeting-low-${'m'.repeat(700)}`,
    referenceContext: `reference-must-survive-${'r'.repeat(600)}`,
    maxContextChars: 1024,
  })));
  const start2 = trimmed.events.find((event) => event.type === 'start');
  assert.deepEqual(start2.trimmedFields, ['meetingTranscript']);
  assert.deepEqual(start2.shortenedFields, []);

  // Shortened is its own signal: nothing was lost outright, but the reference
  // set could not arrive whole, and the card has to be able to say so.
  const shortened = await collect(service.stream(baseInput({
    source: 'stt',
    referenceFiles: [
      { fileName: 'huge.md', content: 'H'.repeat(40_000) },
      { fileName: 'resume.md', content: `RESUME_MARKER ${'r'.repeat(400)}` },
    ],
    maxContextChars: 4_000,
  })));
  const start3 = shortened.events.find((event) => event.type === 'start');
  assert.deepEqual(start3.trimmedFields, []);
  assert.deepEqual(start3.shortenedFields, ['referenceContext']);
});

test('stream idle watchdog aborts a stalled sole dispatch with a stable error', async () => {
  const { DirectAssistService } = await loadDirectAssist();
  const fakeTimer = createFakeTimerScheduler();
  let providerSignal;
  const service = new DirectAssistService({
    streamDirectAssist(_request, signal) {
      providerSignal = signal;
      return (async function* () {
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      })();
    },
  }, { streamIdleTimeoutMs: 25, timerScheduler: fakeTimer.scheduler });
  const stream = service.stream(baseInput());

  assert.equal((await stream.next()).value.type, 'start');
  const terminal = stream.next();
  await Promise.resolve();
  assert.equal(fakeTimer.active().length, 1);
  assert.equal(fakeTimer.fire(), true);

  const event = (await terminal).value;
  assert.equal(event.type, 'error');
  assert.equal(event.error.code, 'STREAM_IDLE_TIMEOUT');
  assert.equal(event.partial, false);
  assert.equal(providerSignal.aborted, true);
  const outcome = await stream.next();
  assert.equal(outcome.done, true);
  assert.equal(outcome.value.state, 'failed');
});

test('a provider iterator that rejects after the idle watchdog wins the race never becomes an unhandled rejection', async () => {
  const { DirectAssistService } = await loadDirectAssist();
  const fakeTimer = createFakeTimerScheduler();
  let rejectProviderNext;
  const service = new DirectAssistService({
    streamDirectAssist() {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise((_resolve, reject) => { rejectProviderNext = reject; }),
            return: async () => ({ done: true, value: undefined }),
          };
        },
      };
    },
  }, { streamIdleTimeoutMs: 25, timerScheduler: fakeTimer.scheduler });

  const unhandled = [];
  const onUnhandledRejection = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    const stream = service.stream(baseInput());
    assert.equal((await stream.next()).value.type, 'start');
    const terminal = stream.next();
    await Promise.resolve();
    assert.equal(fakeTimer.fire(), true);
    const event = (await terminal).value;
    assert.equal(event.type, 'error');
    assert.equal(event.error.code, 'STREAM_IDLE_TIMEOUT');
    await stream.next();

    // The idle watchdog already won the race and the terminal event is out
    // the door — this is the loser settling LATE, the exact shape of a
    // socket reset arriving after a local timeout gave up on it.
    rejectProviderNext(new Error('socket reset after idle timeout'));
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
  assert.deepEqual(unhandled, [], 'the loser of the race must not surface as an unhandledRejection');
});

test('stream idle watchdog is reset by every non-empty provider delta', async () => {
  const { DirectAssistService } = await loadDirectAssist();
  const fakeTimer = createFakeTimerScheduler();
  const service = new DirectAssistService({
    streamDirectAssist() {
      return (async function* () {
        yield 'first';
        yield 'second';
      })();
    },
  }, { streamIdleTimeoutMs: 25, timerScheduler: fakeTimer.scheduler });
  const stream = service.stream(baseInput());

  assert.equal((await stream.next()).value.type, 'start');
  assert.equal((await stream.next()).value.text, 'first');
  const afterFirst = fakeTimer.active()[0];
  assert.ok(afterFirst);
  assert.equal((await stream.next()).value.text, 'second');
  const afterSecond = fakeTimer.active()[0];
  assert.ok(afterSecond);
  assert.notEqual(afterSecond, afterFirst);
  assert.equal(afterFirst.active, false);
  assert.equal(fakeTimer.fire(afterFirst), false, 'a stale watchdog cannot abort the stream');
  assert.equal((await stream.next()).value.type, 'done');
  assert.equal((await stream.next()).done, true);
  assert.equal(fakeTimer.active().length, 0);
});

test('empty upstream stream is INCOMPLETE_STREAM and never done', async () => {
  const { DirectAssistService } = await loadDirectAssist();
  const service = new DirectAssistService({
    streamDirectAssist() {
      return (async function* () {})();
    },
  });
  const { events, result } = await collect(service.stream(baseInput()));

  assert.deepEqual(events.map((event) => event.type), ['start', 'error']);
  assert.equal(events.at(-1).error.code, 'INCOMPLETE_STREAM');
  assert.equal(events.at(-1).partial, false);
  assert.equal(result.state, 'failed');
});

test('provider error normalization never exposes prompt, context, or response bodies', async () => {
  const { DirectAssistService, normalizeDirectAssistError } = await loadDirectAssist();
  const secret = 'RAW_PRIVATE_PROMPT_981276';
  const normalized = normalizeDirectAssistError({
    status: 500,
    message: `upstream echoed ${secret}`,
    response: { data: { error: secret } },
  });
  assert.doesNotMatch(normalized.message, new RegExp(secret));

  const service = new DirectAssistService({
    streamDirectAssist() {
      return (async function* () {
        throw new Error(`provider echoed ${secret}`);
      })();
    },
  });
  const { events } = await collect(service.stream(baseInput({ manualContext: secret })));
  assert.equal(events.at(-1).type, 'error');
  assert.doesNotMatch(events.at(-1).error.message, new RegExp(secret));
});

test('already-aborted request emits one cancel terminal and performs no dispatch', async () => {
  const { DirectAssistService } = await loadDirectAssist();
  let calls = 0;
  const service = new DirectAssistService({
    streamDirectAssist() {
      calls += 1;
      return (async function* () { yield 'never'; })();
    },
  });
  const controller = new AbortController();
  controller.abort();
  const { events, result } = await collect(service.stream(baseInput(), controller.signal));

  assert.equal(calls, 0);
  assert.deepEqual(events.map((event) => event.type), ['cancel']);
  assert.equal(result.state, 'cancelled');
});

test('LLMHelper Direct boundary contains no legacy stream/fallback entrypoint', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');
  const start = source.indexOf('private async *streamDirectAssistFrozen(');
  const end = source.indexOf('\n  /**', start + 20);
  const boundary = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(boundary, /_streamChatInner|streamChatWithOutcome|runStreaming(?:Text|Vision)Fallback|groqFallbackFor/);
  assert.match(boundary, /const directScopes = this\.inferEmbeddedMessageScopes\(request\.userPrompt\)/);
  assert.match(boundary, /this\.getDeniedOutboundScopes\(request\.userPrompt, imagePaths, directScopes\)/);
  assert.match(boundary, /deniedScopes\.includes\('screenshots'\)[\s\S]*?'SCREENSHOT_BLOCKED_BY_PRIVACY'/);
  assert.match(boundary, /deniedScopes\.includes\('transcript'\)[\s\S]*?'TRANSCRIPT_BLOCKED_BY_PRIVACY'/);
  assert.match(boundary, /streamWithGroq\(directUserPrompt, model, request\.systemPrompt, abortSignal, true\)/);
  assert.match(boundary, /streamWithGroqMultimodal\(directUserPrompt, imagePaths, request\.systemPrompt, abortSignal, model\)/);
  assert.match(boundary, /streamWithCodexCli\(directUserPrompt, request\.systemPrompt, false, imagePaths, abortSignal, model\)/);
});

test('transcript privacy denial only hard-blocks Direct Assist when the CURRENT REQUEST itself depends on protected speech', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');
  const start = source.indexOf('private async *streamDirectAssistFrozen(');
  const end = source.indexOf('\n  /**', start + 20);
  const boundary = source.slice(start, end);

  // scopesForPayload()'s 'transcript' tag is a last-boundary backstop that
  // fires on ANY non-empty prompt text — Direct Assist's userPrompt always
  // has a "CURRENT REQUEST" section, so deniedScopes.includes('transcript')
  // used to be true for every request. The naive fix — gate on
  // directScopes.includes('transcript') — is ALSO wrong: meetingTranscript is
  // now correctly tagged <evidence source_type="MEETING_TRANSCRIPT"> (so it
  // gets stripped, not leaked), which makes directScopes include 'transcript'
  // on almost every request during a live meeting. Gating the HARD BLOCK on
  // that would re-fail every typed/reference-file question the instant any
  // meeting audio exists, regardless of relevance — the exact over-blocking
  // this file's next test up (looking-for-work-style) was already fixed for.
  //
  // The only case that must hard-fail rather than silently strip-and-continue
  // is screenshot's CURRENT TURN SPEECH: it IS the current request (the
  // system prompt's own authority line says so), so answering with it removed
  // would be answering a different, incomplete question. meetingTranscript,
  // ordinary history and everything else are optional context by design (the
  // system prompt: 'meeting transcript' is explicitly the LOWEST-authority
  // item) — silently dropping them and continuing is correct, not a leak.
  assert.match(
    boundary,
    /if \(deniedScopes\.includes\('transcript'\) && request\.userPrompt\.includes\(DIRECT_ASSIST_CURRENT_TURN_SPEECH_MARKER\)\) \{\s*\n\s*throw new DirectAssistError\(\s*\n\s*'TRANSCRIPT_BLOCKED_BY_PRIVACY'/,
  );
});

test('meetingTranscript is classified as transcript-scoped and actually stripped from the dispatched prompt when denied (real regex, real prepared prompt)', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const call = llmHelperCaller();
  const secret = 'SECRET_MEETING_CONTENT_marcus_said_launch_slips_to_q3';

  for (const source of ['typed', 'stt', 'screenshot']) {
    const prepared = prepareDirectAssistPrompt(baseInput({ source, meetingTranscript: secret }));
    assert.match(prepared.userPrompt, /<evidence source_type="MEETING_TRANSCRIPT">/, `source=${source}`);

    const directScopes = call('inferEmbeddedMessageScopes', prepared.userPrompt);
    assert.ok(directScopes.includes('transcript'), `source=${source} meetingTranscript must classify as transcript scope`);

    const scrubbed = call('stripDeniedScopedBlocksFromMessage', prepared.userPrompt, ['transcript']);
    assert.doesNotMatch(scrubbed, new RegExp(secret), `source=${source} meetingTranscript leaked past a denied transcript scope`);
  }
});

test('a typed or stt request carries no CURRENT_TURN_SPEECH marker, so meetingTranscript alone never trips the hard block', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  for (const source of ['typed', 'stt']) {
    const prepared = prepareDirectAssistPrompt(baseInput({
      source,
      meetingTranscript: 'ambient meeting content, not the current request',
    }));
    assert.doesNotMatch(prepared.userPrompt, /CURRENT TURN SPEECH \(PART OF CURRENT REQUEST\)/, `source=${source}`);
  }
});

test('screenshot current-turn speech still carries the CURRENT_TURN_SPEECH marker, so the hard block still protects it', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'screenshot',
    transcript: 'What is the time complexity of this approach?',
  }));
  assert.match(prepared.userPrompt, /CURRENT TURN SPEECH \(PART OF CURRENT REQUEST\)/);
});

test('Direct private-vision guard blocks cloud images before Natively transport', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');
  const policyStart = source.indexOf('private assertOutboundImagesAllowed(');
  const policyEnd = source.indexOf('\n  /**', policyStart + 20);
  const imagePolicy = source.slice(policyStart, policyEnd);
  const start = source.indexOf('private async *streamDirectAssistFrozen(');
  const end = source.indexOf('\n  /**', start + 20);
  const boundary = source.slice(start, end);
  const localClassification = boundary.indexOf('const directProviderIsLocal =');
  const imagePolicyGuard = boundary.indexOf('this.assertOutboundImagesAllowed(provider, true);');
  const providerSwitch = boundary.indexOf('switch (provider)');
  const nativelyTransport = boundary.indexOf('this.streamWithNatively(');

  assert.ok(policyStart >= 0 && policyEnd > policyStart);
  assert.match(
    imagePolicy,
    /hasImages[\s\S]*?readScreenUnderstandingMode\(\) === 'private_vision'[\s\S]*?throw new VisionPolicyError/,
  );
  assert.ok(start >= 0 && end > start);
  assert.ok(localClassification >= 0 && localClassification < imagePolicyGuard);
  assert.ok(imagePolicyGuard >= 0 && imagePolicyGuard < providerSwitch);
  assert.ok(providerSwitch < nativelyTransport, 'Natively transport must remain behind the common guard');
  assert.match(
    boundary,
    /if \(imagePaths\.length > 0 && !directProviderIsLocal\) \{\s*this\.assertOutboundImagesAllowed\(provider, true\);\s*\}/,
  );
  assert.doesNotMatch(
    boundary.slice(localClassification, imagePolicyGuard),
    /inferEmbeddedMessageScopes|SCREEN_CONTEXT/,
    'text-only page context must not be reclassified as a private-vision image',
  );
});

test('Direct selection classifies LiteLLM and NVIDIA gateways before generic vendors', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');
  const start = source.indexOf('public getDirectAssistSelection()');
  const end = source.indexOf('\n  /**', start + 20);
  const selection = source.slice(start, end);
  const liteLlm = selection.indexOf('this.isLiteLLMModel(selected)');
  const nvidiaNim = selection.indexOf('this.isNvidiaNimModel(selected)');
  const genericOpenAi = selection.indexOf('this.isOpenAiModel(selected)');
  const genericGroq = selection.indexOf('this.isGroqModel(selected)');

  assert.ok(start >= 0 && end > start);
  assert.ok(liteLlm >= 0 && liteLlm < genericOpenAi, 'litellm/openai/... must stay on LiteLLM');
  assert.ok(nvidiaNim >= 0 && nvidiaNim < genericOpenAi, 'nvidia_nim/openai/... must stay on NIM');
  assert.ok(nvidiaNim < genericGroq, 'nvidia_nim/openai/gpt-oss... must not be claimed by Groq');
  assert.match(selection, /isLiteLLMModel\(selected\)\) provider = 'litellm'/);
  assert.match(selection, /isNvidiaNimModel\(selected\)\) provider = 'nvidia_nim'/);
});

test('Direct vision preflight preserves images for LiteLLM and NVIDIA gateways', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');
  const start = source.indexOf('private directSelectionSupportsImages(');
  const end = source.indexOf('\n  private async *streamDirectAssistFrozen(', start);
  const capabilityBoundary = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(
    capabilityBoundary,
    /case 'litellm':\s*case 'nvidia_nim':[\s\S]*?return true;/,
  );
  assert.doesNotMatch(
    capabilityBoundary,
    /getModelCapabilities\(selection\.model\.replace\(\/\^\(litellm|nvidia_nim\)/,
  );
});

test('LiteLLM and NVIDIA streaming adapters preserve processed image MIME types', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');
  const liteStart = source.indexOf('private async * streamWithLiteLLM(');
  const nimStart = source.indexOf('private async * streamWithNvidiaNim(', liteStart);
  const nextAdapter = source.indexOf('private async * streamWithOpenaiMultimodal(', nimStart);
  const liteLlm = source.slice(liteStart, nimStart);
  const nvidiaNim = source.slice(nimStart, nextAdapter);

  assert.ok(liteStart >= 0 && nimStart > liteStart && nextAdapter > nimStart);

  // The encoding may sit inline in each adapter, or in the shared helper they
  // delegate to. This test arrived on main asserting the inline form, while
  // feat/extension-system had lifted four copies of that loop into
  // buildOpenAiImageParts(); merging the two turned a de-duplication into a red
  // MIME test. Wherever it lives, it is checked — and checking the helper as
  // well as the adapters is stricter than the original, which could not see it.
  const helperStart = source.indexOf('private async buildOpenAiImageParts(');
  const helper = helperStart >= 0
    ? source.slice(helperStart, source.indexOf('\n  private ', helperStart + 10))
    : '';

  for (const adapter of [liteLlm, nvidiaNim]) {
    const inline = /const \{ mimeType, data \} = await this\.processImage\(p\)/.test(adapter);
    const delegates = /buildOpenAiImageParts\(imagePaths\)/.test(adapter);
    assert.ok(inline || delegates,
      'the adapter must either encode images itself or delegate to buildOpenAiImageParts');
    const body = inline ? adapter : helper;
    assert.match(body, /const \{ mimeType, data \} = await this\.processImage\(p\)/);
    assert.match(body, /`data:\$\{mimeType\};base64,\$\{data\}`/);
    // The property this test exists for: never a hardcoded MIME type.
    assert.doesNotMatch(adapter, /data:image\/png;base64/);
    assert.doesNotMatch(body, /data:image\/png;base64/);
  }
});

test('Direct Natively diagnostics never log or rethrow raw server error content', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');
  const start = source.indexOf('private async * streamWithNatively(');
  const end = source.indexOf('private async * streamWithGroq(', start);
  const natively = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(natively, /error: directMode \? '\[omitted for Direct Assist\]' : chunk\.error/);
  assert.match(natively, /if \(directMode\) \{\s*throw new DirectAssistError\(\s*'PROVIDER_ERROR',\s*'The selected provider reported a streaming failure\.'/);
  assert.match(natively, /error: directMode \? '\[omitted for Direct Assist\]' : summarizeFetchError\(streamErr\)/);
  assert.match(natively, /if \(streamErr instanceof DirectAssistError\) throw streamErr/);
});

test('custom provider carries split SSE lines and Direct system instructions safely', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');
  const start = source.indexOf('private async * streamWithCustom(');
  const end = source.indexOf('\n  private parseStreamLine(', start);
  const custom = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(custom, /const directCustomMode = strictErrors && Boolean\(providerOverride\)/);
  assert.match(custom, /templateUsesSystemPrompt = \/\\\{\\\{\\s\*SYSTEM_PROMPT/);
  assert.match(custom, /TEXT: genericPromptValue,\s*PROMPT: genericPromptValue/);
  assert.match(custom, /const streamDecoder = new TextDecoder\(\);\s*let lineBuffer = ""/);
  assert.match(custom, /streamDecoder\.decode\(chunk, \{ stream: true \}\)/);
  assert.match(custom, /lineBuffer = lines\.pop\(\) \?\? ""/);
  assert.match(custom, /const parseCompleteChunkFrame = \(\): \{ complete: boolean; item: string \| null \}/);
  assert.match(custom, /const chunkFrame = parseCompleteChunkFrame\(\)/);
  assert.match(custom, /const decoderTail = streamDecoder\.decode\(\)/);
  // The decoder tail must be flushed THROUGH parseStreamLine — that is the
  // property. The argument list is not: this branch honours the user's
  // configured responsePath, so the call carries a second argument, and
  // pinning the exact signature turned that feature into a red test.
  assert.match(custom, /this\.parseStreamLine\(lineBuffer[,)]/);
});

test('custom vision injection follows optimized MIME and restores raw fallback MIME', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');
  const start = source.indexOf('private async * streamWithCustom(');
  const end = source.indexOf('\n  private parseStreamLine(', start);
  const custom = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(custom, /let preparedImagePath: string \| undefined/);
  assert.match(custom, /preparedImagePath = sourcePath;[\s\S]*?getImageOptimizer\(\)\.optimize/);
  assert.match(custom, /base64Image = await getImageOptimizer\(\)\.getBase64\(optimized\);\s*preparedImagePath = optimized\.path/);
  assert.match(custom, /readFile\(sourcePath\)[\s\S]*?preparedImagePath = sourcePath/);
  assert.match(custom, /injectImageIntoMessages\(body, base64Image, preparedImagePath\)/);
  assert.doesNotMatch(custom, /injectImageIntoMessages\(body, base64Image, imagePaths\[0\]\)/);
});

test('the Direct natively dispatch gets its own connect budget, not the live path\'s hand-off deadline', () => {
  const helperSource = fs.readFileSync(path.resolve(root, 'electron/LLMHelper.ts'), 'utf8');

  // Slice ONLY the dispatch arm, so this cannot pass on a comment elsewhere in
  // a 10k-line file (the failure mode that has made source assertions lie
  // before).
  // Line-ending agnostic on purpose: a CRLF checkout (Windows default with
  // core.autocrlf) would make a literal "\n" search silently find nothing and
  // this assertion would pass vacuously on an empty slice.
  const armMatch = /case 'natively':\s*\r?\n\s*yield\* this\.streamWithNatively\(/.exec(helperSource);
  assert.ok(armMatch, 'Direct Assist natively dispatch arm not found');
  const armEnd = helperSource.indexOf("case 'gemini':", armMatch.index);
  assert.ok(armEnd > armMatch.index, 'Direct Assist dispatch arm end not found');
  const arm = helperSource.slice(armMatch.index, armEnd);
  assert.ok(arm.length > 50, 'sliced dispatch arm is suspiciously short');

  assert.match(arm, /DIRECT_ASSIST_VISION_CONNECT_TIMEOUT_MS/);
  assert.match(arm, /DIRECT_ASSIST_CONNECT_TIMEOUT_MS/);
  assert.doesNotMatch(
    arm,
    /INTERACTIVE_CONNECT_TIMEOUT_MS/,
    'the 4s live-path deadline assumes a provider ladder to fall through to; Direct Assist has none',
  );

  const numberOf = (name) => {
    const match = helperSource.match(new RegExp(`^const ${name} = ([0-9_]+);`, 'm'));
    assert.ok(match, `${name} declaration not found`);
    return Number(match[1].replace(/_/g, ''));
  };
  const text = numberOf('DIRECT_ASSIST_CONNECT_TIMEOUT_MS');
  const vision = numberOf('DIRECT_ASSIST_VISION_CONNECT_TIMEOUT_MS');
  const live = numberOf('INTERACTIVE_CONNECT_TIMEOUT_MS');

  // Measured vision time-to-first-byte on the shipping default reached 4.0s,
  // which is what made screenshot answers fail against the live deadline.
  assert.ok(vision >= 20_000, `vision connect budget ${vision}ms leaves no room over a ~4s TTFB`);
  assert.ok(text > live, 'the text budget must not inherit the hand-off deadline either');

  const serviceSource = fs.readFileSync(
    path.resolve(root, 'electron/direct-assist/DirectAssistService.ts'),
    'utf8',
  );
  const idle = Number(
    serviceSource
      .match(/DEFAULT_DIRECT_ASSIST_STREAM_IDLE_TIMEOUT_MS = ([0-9_]+);/)[1]
      .replace(/_/g, ''),
  );
  // A connect budget past the idle watchdog would surface as the generic
  // STREAM_IDLE_TIMEOUT instead of the specific CONNECT_TIMEOUT.
  assert.ok(vision < idle, `vision connect budget ${vision}ms must stay inside the ${idle}ms idle watchdog`);
});

test('a big reference set cannot crowd the live transcript out of the prompt', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  // The live failure: a typed question about the meeting came back
  // "NOT_IN_TRANSCRIPT" because 200 KB of attached reference files had already
  // claimed the whole 64 000-char budget, leaving the transcript's most recent
  // line — the one the question was about — with nowhere to go.
  const transcript = Array.from(
    { length: 400 },
    (_, index) => `[INTERVIEWER]: rollout detail ${index} ${'t'.repeat(150)}`,
  ).concat(['[INTERVIEWER]: the launch codeword is ORCHID-77.']).join('\n');
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'typed',
    referenceFiles: [{ fileName: 'huge.md', content: 'H'.repeat(300_000) }],
    meetingTranscript: transcript,
  }));

  assert.deepEqual(prepared.trimmedFields, []);
  assert.match(prepared.userPrompt, /ORCHID-77/, 'the newest transcript line must reach the model');
  assert.match(prepared.userPrompt, /# huge\.md/, 'the reference set still gets its share');
  assert.deepEqual(
    [...prepared.shortenedFields].sort(),
    ['meetingTranscript', 'referenceContext'],
    'both were reduced to share the budget, and the card is told so',
  );
  assert.ok(prepared.userPrompt.length <= 64_000);
});

test('a small transcript takes only what it needs and leaves the rest to the reference files', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  // Realistic proportions: 180s of speech is a couple of thousand characters,
  // so fair sharing must not hand it an equal half of the budget.
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'typed',
    referenceFiles: [{ fileName: 'huge.md', content: 'H'.repeat(300_000) }],
    meetingTranscript: '[INTERVIEWER]: short live exchange.',
  }));

  assert.deepEqual(prepared.trimmedFields, []);
  assert.deepEqual(prepared.shortenedFields, ['referenceContext']);
  assert.match(prepared.userPrompt, /short live exchange/);
  assert.ok(
    prepared.userPrompt.length > 60_000,
    'the reference set should still fill the budget the transcript did not need',
  );
});

test('XML-escaping expansion is re-aimed, not paid for by sacrificing a whole field', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  // Attached documents are full of `<`, `>` and `&` (markdown, code, HTML).
  // Each becomes 4-5 chars once escaped, so shares computed on raw lengths
  // overshoot. Measured live: that overshoot alone made a typed request drop
  // the entire meeting transcript, and the answer became "I don't have access
  // to a meeting transcript".
  const angly = '<div a="1"> & </div> '.repeat(15_000);
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'typed',
    referenceFiles: [{ fileName: 'markup.md', content: angly }],
    meetingTranscript: '[INTERVIEWER]: the launch codeword is ORCHID-77.',
  }));

  assert.deepEqual(prepared.trimmedFields, [], 'nothing may be dropped over an escaping overshoot');
  assert.match(prepared.userPrompt, /ORCHID-77/);
  assert.match(prepared.userPrompt, /# markup\.md/);
  assert.ok(
    prepared.userPrompt.length <= 64_000,
    `escaped prompt must respect the budget, was ${prepared.userPrompt.length}`,
  );
});

test('a truncated file says so by name, and the system prompt forbids extrapolating past the cut', async () => {
  const { prepareDirectAssistPrompt, DIRECT_ASSIST_SYSTEM_PROMPT } = await loadDirectAssist();
  // Measured on a live session: with only a bare "[...truncated]" marker, a
  // model reading a numbered document continued the series and stated the
  // invented value as fact — every sample on a 589 KB single attachment, about
  // a third of samples on a mixed 817 KB set. A cut has to be legible AS a cut.
  const numbered = Array.from(
    { length: 400 },
    (_, i) => `FACT-N${i}: the widget tolerance ${i} is ${100 + i} microns.\n${'filler text. '.repeat(60)}`,
  ).join('\n');
  const prepared = prepareDirectAssistPrompt(baseInput({
    referenceFiles: [{ fileName: 'series.md', content: numbered }],
  }));

  assert.match(prepared.userPrompt, /\[TRUNCATED: only the beginning of "series\.md" is included\./);
  // The builder trims file content, so assert the shape, not a length computed
  // from the untrimmed source string.
  assert.match(prepared.userPrompt, /The file is \d{6} characters long/);
  assert.match(prepared.userPrompt, /remainder is NOT available/);
  assert.match(prepared.userPrompt, /Do not infer or extrapolate anything from the missing part/);
  assert.deepEqual(prepared.shortenedFields, ['referenceContext']);
  assert.match(DIRECT_ASSIST_SYSTEM_PROMPT, /marked TRUNCATED is cut off/);
  assert.match(DIRECT_ASSIST_SYSTEM_PROMPT, /Never continue a numbering, series or pattern/);
  assert.ok(prepared.userPrompt.length <= 64_000);
});

// ── Screenshots that outlive the turn they were sent on ──────────────────────
// Reported symptom: a user attaches a screenshot, asks about it two turns
// later, and Natively cannot see it. The renderer clears its attachment tray
// the instant a turn dispatches, and history was {role, content} only — so the
// image was unreachable and nothing in the prompt even said one had existed.

function screenshotFixtures(t, count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-history-images-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Array.from({ length: count }, (_, index) => {
    const file = path.join(dir, `shot-${index + 1}.png`);
    fs.writeFileSync(file, png);
    return file;
  });
}

test('content that fits raw but not once escaped is re-aimed, not paid for by the transcript', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  // Both fields fit by RAW character count, so the shared-budget pass used to
  // report "fits" without ever rendering. Escaping then pushed the real prompt
  // over, and the drop-order loop resolved it the only way it can for a typed
  // request: by taking the meeting transcript — over markup in an attachment
  // that has nothing to do with the question.
  const angly = '<a href="x">&amp;</a> '.repeat(1_400);   // ~30k raw, ~2x escaped
  const prepared = prepareDirectAssistPrompt(baseInput({
    source: 'typed',
    referenceFiles: [{ fileName: 'markup.md', content: angly }],
    meetingTranscript: '[INTERVIEWER]: the launch codeword is ORCHID-77.',
    maxContextChars: 40_000,
  }));

  assert.ok(angly.length < 40_000, 'the fixture must fit unescaped, or it tests the wrong branch');
  assert.deepEqual(prepared.trimmedFields, []);
  assert.match(prepared.userPrompt, /ORCHID-77/, 'the transcript must not pay for the escaping');
  assert.match(prepared.userPrompt, /# markup\.md/);
  assert.ok(
    prepared.userPrompt.length <= 40_000,
    `escaped prompt must respect the budget, was ${prepared.userPrompt.length}`,
  );
});

test('a mode with many large attachments is bounded before any fitting work', async () => {
  const { prepareDirectAssistPrompt, buildDirectAssistRequest } = await loadDirectAssist();
  // 400 files x 1 MB. Unbounded, prompt fitting re-walked all 400 MB on the
  // main process for every request. Neither bound can change the output: no one
  // file can be given more than the budget, and past budget/MIN_REFERENCE_BODY
  // files there is no useful share left to hand out.
  const many = Array.from({ length: 400 }, (_, i) => ({
    fileName: `bulk-${i}.md`,
    content: `FACT-${i}: value ${i}. ${'z'.repeat(1_000_000)}`,
  }));
  const request = buildDirectAssistRequest(baseInput({ referenceFiles: many }));
  assert.ok(request.referenceFiles.length <= 320, `kept ${request.referenceFiles.length} files`);
  for (const file of request.referenceFiles) {
    assert.ok(file.content.length <= request.maxContextChars, `${file.fileName} kept ${file.content.length} chars`);
  }

  const started = Date.now();
  const prepared = prepareDirectAssistPrompt(baseInput({ referenceFiles: many }));
  const elapsed = Date.now() - started;
  assert.ok(prepared.userPrompt.length <= 64_000);
  assert.deepEqual(prepared.shortenedFields, ['referenceContext']);
  assert.match(prepared.userPrompt, /# bulk-0\.md/, 'the first file still arrives');
  assert.ok(elapsed < 4_000, `prompt fitting took ${elapsed}ms for 400 x 1MB attachments`);
});

test('the TRUNCATED notice quotes the file\'s real size, not the size after the processing bound', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  // The bound keeps at most one budget's worth of any file. If the notice then
  // quoted the BOUNDED length it would tell the model a 900 KB attachment was
  // 64 000 characters long — understating what is missing, which is the exact
  // thing the notice exists to prevent.
  const real = 'Z'.repeat(900_000);
  const prepared = prepareDirectAssistPrompt(baseInput({
    referenceFiles: [{ fileName: 'huge.md', content: real }],
  }));
  assert.match(prepared.userPrompt, new RegExp(`The file is ${real.length} characters long`));
  assert.doesNotMatch(prepared.userPrompt, /The file is 64000 characters long/);
});

test('a file the caller already sliced still reports the size it was sliced FROM', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  // main slices each attachment to DIRECT_ASSIST_MAX_CONTEXT_FIELD_CHARS before
  // handing it over. Reading the size off the SLICED content would make the
  // notice announce a 590 KB file as 200 000 characters.
  const prepared = prepareDirectAssistPrompt(baseInput({
    referenceFiles: [{ fileName: 'huge.md', content: 'Z'.repeat(200_000), totalChars: 589_503 }],
  }));
  assert.match(prepared.userPrompt, /The file is 589503 characters long/);
  assert.doesNotMatch(prepared.userPrompt, /The file is 200000 characters long/);
});

test('a totalChars smaller than the content it arrives with is ignored, not trusted', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  // Defensive: a wrong or stale count must never make the notice claim LESS
  // material is missing than the prompt itself proves is there.
  const prepared = prepareDirectAssistPrompt(baseInput({
    referenceFiles: [{ fileName: 'odd.md', content: 'Y'.repeat(300_000), totalChars: 12 }],
  }));
  assert.match(prepared.userPrompt, /The file is 300000 characters long/);
});

test('a screenshot sent two turns ago is re-attached and named, not silently lost', async (t) => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const [shot] = screenshotFixtures(t, 1);

  const prepared = prepareDirectAssistPrompt(baseInput({
    currentRequest: 'What was the error code in the screenshot I sent?',
    history: [
      { role: 'user', content: 'Analyze the attached screenshot.', imagePaths: [shot] },
      { role: 'assistant', content: 'The screen shows a build log.' },
      { role: 'user', content: 'Which step failed?' },
      { role: 'assistant', content: 'The link step.' },
    ],
  }));

  assert.deepEqual([...prepared.historyImagePaths], [shot]);
  // The breadcrumb has to bind the image to the turn it came from, or the model
  // receives a picture with no idea which question it belongs to.
  assert.match(prepared.userPrompt, /USER \[attached 1 screenshot: re-sent here as earlier screenshot 1\]: Analyze the attached screenshot\./);
  assert.match(prepared.userPrompt, /earlier screenshot 1/);
  // A turn with no attachment keeps the plain, unannotated form.
  assert.match(prepared.userPrompt, /USER: Which step failed\?/);
});

test('an earlier screenshot that is not being sent is still announced, so the model cannot invent it', async () => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();

  // imageCount without imagePaths is exactly what main produces once the
  // screenshot queue has unlinked the file (ScreenshotHelper keeps 5).
  const prepared = prepareDirectAssistPrompt(baseInput({
    currentRequest: 'What was the error code in that screenshot?',
    history: [
      { role: 'user', content: 'Analyze this.', imagePaths: [], imageCount: 2 },
      { role: 'assistant', content: 'A build log.' },
    ],
  }));

  assert.deepEqual([...prepared.historyImagePaths], []);
  assert.match(prepared.userPrompt, /USER \[attached 2 screenshots: 2 not included in this request\]: Analyze this\./);
});

test('the current turn wins the payload cap, and earlier screenshots take only what is left', async (t) => {
  const { prepareDirectAssistPrompt, DIRECT_ASSIST_MAX_DISPATCH_IMAGES } = await loadDirectAssist();
  assert.equal(DIRECT_ASSIST_MAX_DISPATCH_IMAGES, 5);
  const shots = screenshotFixtures(t, 6);
  const [current1, current2, old1, old2, old3, old4] = shots;

  const prepared = prepareDirectAssistPrompt(baseInput({
    currentRequest: 'Compare these with the ones from before.',
    imagePaths: [current1, current2],
    history: [
      { role: 'user', content: 'First batch.', imagePaths: [old1, old2] },
      { role: 'assistant', content: 'Seen.' },
      { role: 'user', content: 'Second batch.', imagePaths: [old3, old4] },
      { role: 'assistant', content: 'Seen.' },
    ],
  }));

  // 5 - 2 current = 3 free slots, filled newest-first but emitted in history
  // order so the "earlier screenshot N" numbering matches what the model reads.
  assert.deepEqual([...prepared.imagePaths], [current1, current2]);
  assert.deepEqual([...prepared.historyImagePaths], [old2, old3, old4]);
  assert.match(prepared.userPrompt, /USER \[attached 2 screenshots: re-sent here as earlier screenshot 1; 1 not included in this request\]: First batch\./);
  assert.match(prepared.userPrompt, /USER \[attached 2 screenshots: re-sent here as earlier screenshot 2, 3\]: Second batch\./);
  assert.match(prepared.userPrompt, /2 current image attachments accompanies this request\. 3 screenshots from earlier turns follow them/);
});

test('history shed for budget takes its carried screenshots with it, so no image outlives its breadcrumb', async (t) => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const [shot] = screenshotFixtures(t, 1);

  const history = [
    { role: 'user', content: `old turn ${'x'.repeat(6_000)}`, imagePaths: [shot] },
    { role: 'assistant', content: 'ok' },
  ];

  const roomy = prepareDirectAssistPrompt(baseInput({ history }));
  assert.deepEqual([...roomy.historyImagePaths], [shot], 'precondition: it is carried when it fits');

  // stt/screenshot requests drop `history` FIRST, so this is the realistic
  // shape of the failure: the turn is gone but its image would still ship.
  const squeezed = prepareDirectAssistPrompt(baseInput({
    source: 'stt',
    history,
    maxContextChars: 4_000,
  }));
  // Shedding the oldest turns is reported as a shortening; either way the turn
  // that carried the image is gone from the prompt.
  assert.ok(
    squeezed.shortenedFields.includes('history') || squeezed.trimmedFields.includes('history'),
    'precondition: history was shed',
  );
  assert.doesNotMatch(squeezed.userPrompt, /old turn/, 'precondition: the attaching turn is gone');
  assert.deepEqual([...squeezed.historyImagePaths], []);
  assert.doesNotMatch(squeezed.userPrompt, /earlier screenshot/);
});

/** Drives the REAL streamDirectAssistFrozen boundary on a bare prototype: only
 *  the provider call and the two policy lookups are stubbed, so the actual
 *  ordering of the image checks is what runs. Returns what the provider was
 *  handed. */
async function dispatchDirect(request, { deniedScopes = [], imagesAllowed = true } = {}) {
  const { LLMHelper } = require(path.resolve(root, 'dist-electron/electron/LLMHelper.js'));
  const self = Object.create(LLMHelper.prototype);
  const seen = { imagePaths: null, userPrompt: null };
  self.isLocalOnlyMode = false;
  self.isProviderDisabled = () => false;
  self.assertOutboundImagesAllowed = () => {
    if (!imagesAllowed) throw new Error('private_vision');
  };
  self.getDeniedOutboundScopes = () => deniedScopes;
  const record = async function* (userPrompt, imagePaths) {
    seen.userPrompt = userPrompt;
    seen.imagePaths = imagePaths ? [...imagePaths] : [];
    yield 'ok';
  };
  self.streamWithGeminiModel = (userPrompt, _model, imagePaths) => record(userPrompt, imagePaths);
  self.streamWithDeepseek = (userPrompt) => record(userPrompt, []);

  const chunks = [];
  for await (const chunk of LLMHelper.prototype.streamDirectAssistFrozen.call(
    self, request, null, null, undefined,
  )) {
    chunks.push(chunk);
  }
  return { ...seen, chunks };
}

test('carried screenshots reach the provider appended after the current turn own attachments', async (t) => {
  const [current, older] = screenshotFixtures(t, 2);
  const seen = await dispatchDirect({
    requestId: 'direct-carry-1',
    selection: { provider: 'gemini', model: 'gemini-3.7-flash' },
    systemPrompt: 'system',
    userPrompt: '<recent_transcript>\nUSER [attached 1 screenshot: re-sent here as earlier screenshot 1]: earlier\n</recent_transcript>\n\n[CURRENT REQUEST - HIGHEST AUTHORITY]\nread it\n[/CURRENT REQUEST - HIGHEST AUTHORITY]',
    imagePaths: [current],
    historyImagePaths: [older],
  });
  assert.deepEqual(seen.imagePaths, [current, older]);
});

test('a denied transcript scope drops the carried screenshots with the block that explains them', async (t) => {
  const [older] = screenshotFixtures(t, 1);
  const seen = await dispatchDirect(
    {
      requestId: 'direct-carry-2',
      selection: { provider: 'gemini', model: 'gemini-3.7-flash' },
      systemPrompt: 'system',
      userPrompt: '<recent_transcript>\nUSER [attached 1 screenshot: re-sent here as earlier screenshot 1]: earlier\n</recent_transcript>\n\n[CURRENT REQUEST - HIGHEST AUTHORITY]\nwhat did I show you\n[/CURRENT REQUEST - HIGHEST AUTHORITY]',
      imagePaths: [],
      historyImagePaths: [older],
    },
    { deniedScopes: ['transcript'] },
  );
  // The breadcrumb is stripped, so the image must go too — otherwise the model
  // gets an unexplained picture of a stale screen and answers from it.
  assert.doesNotMatch(seen.userPrompt, /recent_transcript|earlier screenshot/);
  assert.deepEqual(seen.imagePaths, []);
  assert.deepEqual(seen.chunks, ['ok'], 'and the request still answers');
});

test('private vision drops carried screenshots rather than failing a turn that attached none', async (t) => {
  const [older] = screenshotFixtures(t, 1);
  const seen = await dispatchDirect(
    {
      requestId: 'direct-carry-3',
      selection: { provider: 'gemini', model: 'gemini-3.7-flash' },
      systemPrompt: 'system',
      userPrompt: '<recent_transcript>\nUSER [attached 1 screenshot: re-sent here as earlier screenshot 1]: earlier\n</recent_transcript>\n\n[CURRENT REQUEST - HIGHEST AUTHORITY]\nsummarize\n[/CURRENT REQUEST - HIGHEST AUTHORITY]',
      imagePaths: [],
      historyImagePaths: [older],
    },
    { imagesAllowed: false },
  );
  assert.deepEqual(seen.imagePaths, []);
  assert.deepEqual(seen.chunks, ['ok']);
});

test('a text-only model drops carried screenshots instead of failing the follow-up question', async (t) => {
  const [older] = screenshotFixtures(t, 1);
  const seen = await dispatchDirect({
    requestId: 'direct-carry-4',
    selection: { provider: 'deepseek', model: 'deepseek-chat' },
    systemPrompt: 'system',
    userPrompt: '[CURRENT REQUEST - HIGHEST AUTHORITY]\nsummarize\n[/CURRENT REQUEST - HIGHEST AUTHORITY]',
    imagePaths: [],
    historyImagePaths: [older],
  });
  assert.deepEqual(seen.chunks, ['ok']);

  // The current turn's OWN attachment still hard-fails on the same model.
  await assert.rejects(
    dispatchDirect({
      requestId: 'direct-carry-5',
      selection: { provider: 'deepseek', model: 'deepseek-chat' },
      systemPrompt: 'system',
      userPrompt: '[CURRENT REQUEST - HIGHEST AUTHORITY]\nread this\n[/CURRENT REQUEST - HIGHEST AUTHORITY]',
      imagePaths: [older],
      historyImagePaths: [],
    }),
    /does not support image input/,
  );
});

test('a carried screenshot the queue has already unlinked is skipped, not fatal', async (t) => {
  const [current, older] = screenshotFixtures(t, 2);
  fs.rmSync(older);
  const seen = await dispatchDirect({
    requestId: 'direct-carry-6',
    selection: { provider: 'gemini', model: 'gemini-3.7-flash' },
    systemPrompt: 'system',
    userPrompt: '[CURRENT REQUEST - HIGHEST AUTHORITY]\nread this\n[/CURRENT REQUEST - HIGHEST AUTHORITY]',
    imagePaths: [current],
    historyImagePaths: [older],
  });
  assert.deepEqual(seen.imagePaths, [current]);
  assert.deepEqual(seen.chunks, ['ok']);
});

test('a transcribed screenshot reaches a later turn as TEXT, and its bytes are not re-sent', async (t) => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const [shot] = screenshotFixtures(t, 1);

  const prepared = prepareDirectAssistPrompt(baseInput({
    currentRequest: 'what was the error code in the screenshot I sent?',
    history: [
      {
        role: 'user',
        content: 'Analyze the attached screenshot.',
        imagePaths: [shot],
        imageDescription: 'Errors on screen:\nerror LNK2019: unresolved external symbol _main',
      },
      { role: 'assistant', content: 'The link step failed.' },
      { role: 'user', content: 'Which step failed?' },
      { role: 'assistant', content: 'The link step.' },
    ],
  }));

  // The transcription answers the same question for a fraction of the tokens,
  // and unlike the image it survives a text-only model, a provider that may not
  // receive images, and the file being unlinked. Bytes are for screens nothing
  // has described yet.
  assert.match(prepared.userPrompt, /\[screen attached that turn\] Errors on screen:/);
  assert.match(prepared.userPrompt, /LNK2019/);
  assert.deepEqual([...prepared.historyImagePaths], []);

  // "Transcribed below" and "not included" are different things to a reader
  // judging an answer: telling the model to disclaim a screen whose full text
  // is directly underneath is worse than saying nothing.
  assert.match(prepared.userPrompt, /USER \[attached 1 screenshot: transcribed below\]/);
  assert.doesNotMatch(prepared.userPrompt, /not included in this request/);
});

test('an undescribed screenshot still falls back to carrying its bytes', async (t) => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const [described, undescribed] = screenshotFixtures(t, 2);

  const prepared = prepareDirectAssistPrompt(baseInput({
    currentRequest: 'compare those two screens',
    history: [
      { role: 'user', content: 'First.', imagePaths: [described], imageDescription: 'a build log' },
      { role: 'assistant', content: 'Seen.' },
      { role: 'user', content: 'Second.', imagePaths: [undescribed] },
      { role: 'assistant', content: 'Seen.' },
    ],
  }));

  // Only the one nothing has transcribed costs image tokens.
  assert.deepEqual([...prepared.historyImagePaths], [undescribed]);
  assert.match(prepared.userPrompt, /USER \[attached 1 screenshot: transcribed below\]: First\./);
  assert.match(prepared.userPrompt, /USER \[attached 1 screenshot: re-sent here as earlier screenshot 1\]: Second\./);
});

test('a MULTI-image turn is transcribed as one set, and none of its bytes are re-sent', async (t) => {
  const { prepareDirectAssistPrompt } = await loadDirectAssist();
  const shots = screenshotFixtures(t, 3);

  const prepared = prepareDirectAssistPrompt(baseInput({
    currentRequest: 'what were those three screens showing?',
    history: [
      {
        role: 'user',
        content: 'Look at these.',
        imagePaths: shots,
        // ONE description for the SET. A single understand() call over N images
        // returns one result about all of them, so per-image attribution was
        // never honest — and it made a multi-image turn uncacheable in BOTH
        // directions, since it could not be written it was never read either.
        imageDescription: 'Three terminal windows; the middle one shows error LNK2019.',
      },
      { role: 'assistant', content: 'Seen.' },
    ],
  }));

  assert.deepEqual([...prepared.historyImagePaths], [], 'three images of bytes replaced by one string');
  assert.match(prepared.userPrompt, /USER \[attached 3 screenshots: transcribed below\]: Look at these\./);
  assert.match(prepared.userPrompt, /\[screen attached that turn\] Three terminal windows/);
});

test('normalizeDirectAssistError unwraps an engine aggregate to the first rung error', async () => {
  const { normalizeDirectAssistError, DirectAssistError } = await loadDirectAssist();

  // The aggregate's message must contain NO word the pre-existing keyword
  // classifier already matches — no "timeout", "rate limit", "not configured",
  // "model not found". Otherwise this test passes against the OLD code and
  // proves nothing: the classifier would match the SENTENCE and never reach
  // the unwrap. Without the unwrap this fixture is PROVIDER_ERROR.
  const first = new DirectAssistError('RATE_LIMITED', 'The selected provider is rate limited.', true);
  const aggregate = new Error('All providers failed: rung natively | rung gemini');
  aggregate.firstProviderError = first;

  const normalized = normalizeDirectAssistError(aggregate);
  assert.equal(normalized.code, 'RATE_LIMITED');
  assert.equal(normalized.retryable, true);
  // The aggregate's prose names providers and must never reach the renderer.
  assert.ok(!normalized.message.includes('gemini'));
});

test('normalizeDirectAssistError does NOT follow a bare .cause', async () => {
  const { normalizeDirectAssistError } = await loadDirectAssist();
  // Node's fetch sets .cause on TypeError; following it would discard the
  // correct top-level classification carried by .status.
  const inner = new Error('socket hang up');
  const outer = Object.assign(new Error('fetch failed'), { status: 429, cause: inner });
  assert.equal(normalizeDirectAssistError(outer).code, 'RATE_LIMITED');
});

test('normalizeDirectAssistError still handles a bare provider error', async () => {
  const { normalizeDirectAssistError } = await loadDirectAssist();
  const normalized = normalizeDirectAssistError(Object.assign(new Error('nope'), { status: 429 }));
  assert.equal(normalized.code, 'RATE_LIMITED');
});

test('direct assist fallback config never hedges', async () => {
  const {
    DEFAULT_DIRECT_ASSIST_FALLBACK_CONFIG,
    DIRECT_ASSIST_TOTAL_BUDGET_MS,
    DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS,
    DIRECT_ASSIST_FALLBACK_MAX_ATTEMPTS,
    DEFAULT_DIRECT_ASSIST_STREAM_IDLE_TIMEOUT_MS,
  } = await loadDirectAssist();
  // Hedging bills two providers per turn. Direct Assist is the path chosen for
  // provider determinism, so this must stay off.
  assert.equal(DEFAULT_DIRECT_ASSIST_FALLBACK_CONFIG.hedgeEnabled, false);
  assert.equal(DEFAULT_DIRECT_ASSIST_FALLBACK_CONFIG.logPrefix, 'DirectAssist');
  // The budget must be AT LEAST two full idle windows — a lower bound, not an
  // upper bound: the ladder must not be able to outlive the per-attempt idle
  // windows it contains.
  assert.ok(DIRECT_ASSIST_TOTAL_BUDGET_MS >= DEFAULT_DIRECT_ASSIST_STREAM_IDLE_TIMEOUT_MS * 2);
  // Depth on the user's choice, breadth after it fails — see the constants' docs.
  assert.ok(DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS > DIRECT_ASSIST_FALLBACK_MAX_ATTEMPTS);
});

// ── Task 4: listDirectAssistRungs — the ladder is a FILTER, never a refusal ─
//
// Every case asserts a provider's ABSENCE from the returned ladder, never
// that some later call threw. `rungCaller` builds a bare LLMHelper instance
// (prototype methods only, matching llmHelperCaller() above) with just enough
// stubbed state to drive the filter chain.
//
// isProviderDisabled is shadowed rather than left to the real implementation:
// the real isProviderDisabled() reads CredentialsManager, whose MODULE BODY
// calls Electron's app.getPath() at import time — that throws outside a real
// Electron process, so getDisabledProviderFamilies() silently fails open and
// the real check would never see `disabledProviders` below. Own-property
// shadowing (the same mechanism note 5 uses for directAssistFallbackEnabled)
// is what makes the family-disable test exercise the actual code path.
function rungCaller(overrides = {}) {
  const { LLMHelper } = require(path.resolve(root, 'dist-electron/electron/LLMHelper.js'));
  const self = Object.create(LLMHelper.prototype);
  Object.assign(self, {
    isLocalOnlyMode: false,
    _client: {}, _groqClient: {}, _openaiClient: {}, _claudeClient: {},
    disabledProviders: new Set(),
    isProviderDisabled: (family) => self.disabledProviders.has(family),
    // A FUNCTION, not a boolean: listDirectAssistRungs calls
    // this.directAssistFallbackEnabled(). An own boolean property would shadow
    // the prototype method and throw "not a function".
    directAssistFallbackEnabled: () => true,
    ...overrides,
  });
  return (request) => LLMHelper.prototype.listDirectAssistRungs.call(self, request);
}

const directAssistTextRequest = {
  requestId: 'r1',
  selection: { provider: 'natively', model: 'natively' },
  systemPrompt: 's', userPrompt: 'u', imagePaths: [], historyImagePaths: [],
};

test('the selected provider is always rung 0', async () => {
  const rungs = rungCaller()(directAssistTextRequest);
  assert.equal(rungs[0].provider, 'natively');
  assert.equal(rungs[0].priority, 0);
  assert.equal(rungs[0].isFallback, false);
});

test('local-only mode leaves no cloud rung on the ladder', async () => {
  const rungs = rungCaller({ isLocalOnlyMode: true })({
    ...directAssistTextRequest,
    selection: { provider: 'ollama', model: 'llama3' },
  });
  assert.deepEqual(rungs.map((r) => r.provider), ['ollama']);
});

test('a ladder-ineligible selection gets exactly one rung', async () => {
  const rungs = rungCaller()({ ...directAssistTextRequest, selection: { provider: 'codex-cli', model: 'gpt-5' } });
  assert.equal(rungs.length, 1);
  assert.equal(rungs[0].provider, 'codex-cli');
});

// directFallbackCandidates() never structurally yields codex-cli/curl/deepseek,
// so a naive absence assertion against the real candidate list would still
// pass with the DIRECT_ASSIST_LADDER_INELIGIBLE_PROVIDERS / image-capability
// guards inside eligible() deleted outright — false assurance. Shadowing
// directFallbackCandidates (same technique as the isProviderDisabled shadow
// above) forces the candidates the guard is actually supposed to reject to
// reach eligible(), so the assertion depends on the guard, not on the
// candidate list omitting them.
test('codex-cli and curl never appear as fallback rungs', async () => {
  const rungs = rungCaller({
    directFallbackCandidates: () => [
      { provider: 'codex-cli', model: 'gpt-5' },
      { provider: 'curl', model: 'curl-1' },
    ],
    // directProviderHasCredential's switch has no case for codex-cli/curl and
    // defaults to false, which would ALSO exclude them and mask the guard
    // under test. Force credentials "present" so the only thing that can
    // still remove these two is DIRECT_ASSIST_LADDER_INELIGIBLE_PROVIDERS.
    directProviderHasCredential: () => true,
  })(directAssistTextRequest);
  assert.ok(!rungs.some((r) => r.isFallback && (r.provider === 'codex-cli' || r.provider === 'curl')));
});

test('a disabled provider family is absent, not merely refused', async () => {
  const rungs = rungCaller({ disabledProviders: new Set(['groq']) })(directAssistTextRequest);
  assert.ok(!rungs.some((r) => r.provider === 'groq'));
});

test('an image request drops providers that cannot take images', async () => {
  const rungs = rungCaller({
    directFallbackCandidates: () => [{ provider: 'deepseek', model: 'deepseek-chat' }],
    // deepseek has no client stubbed (_deepseekClient is unset), so
    // directProviderHasCredential would ALSO exclude it and mask the guard
    // under test. Force credentials "present" so the only thing that can
    // still remove it is directSelectionSupportsImages's deepseek: false case.
    directProviderHasCredential: () => true,
  })({ ...directAssistTextRequest, imagePaths: ['/tmp/shot.png'] });
  assert.ok(!rungs.some((r) => r.provider === 'deepseek'));
});

// The single area flagged for the hardest review scrutiny: private_vision.
// assertOutboundImagesAllowed is shadowed to throw exactly the way the real
// VisionPolicyError throw does on a refused cloud provider, proving eligible()
// actually catches it and drops the rung — a LOCAL rung (ollama) is exempt
// from the same call in the real code and must survive.
test('a privacy refusal on images removes cloud rungs but spares a local one', async () => {
  const rungs = rungCaller({
    useOllama: true,
    directFallbackCandidates: () => [
      { provider: 'gemini', model: 'gemini-3.8-flash' },
      { provider: 'ollama', model: 'llama3' },
    ],
    // Capability is not what this test is about — always allow images so the
    // only thing that can remove a rung is the privacy guard below.
    directSelectionSupportsImages: () => true,
    assertOutboundImagesAllowed: (provider, hasImages) => {
      if (hasImages && provider !== 'ollama') {
        const err = new Error('private_vision refuses this provider');
        err.name = 'VisionPolicyError';
        throw err;
      }
    },
  })({ ...directAssistTextRequest, imagePaths: ['/tmp/shot.png'] });
  assert.ok(!rungs.some((r) => r.provider === 'gemini'));
  assert.ok(rungs.some((r) => r.provider === 'ollama'));
});

test('fallback disabled yields the selected rung alone', async () => {
  const rungs = rungCaller({ directAssistFallbackEnabled: () => false })(directAssistTextRequest);
  assert.equal(rungs.length, 1);
  assert.equal(rungs[0].provider, 'natively');
});

// ── Task 5: streamDirectAssist dispatches the SUPPLIED rung, not the selection ─

test('streamDirectAssist honours the rung over request.selection', async () => {
  const { LLMHelper } = require(path.resolve(root, 'dist-electron/electron/LLMHelper.js'));
  const self = Object.create(LLMHelper.prototype);
  let dispatched = null;
  Object.assign(self, {
    isLocalOnlyMode: false,
    streamWithGeminiModel: async function* (_u, model) { dispatched = { provider: 'gemini', model }; yield 'ok'; },
  });
  const gen = LLMHelper.prototype.streamDirectAssist.call(
    self,
    { ...directAssistTextRequest, selection: { provider: 'natively', model: 'natively' } },
    undefined,
    { provider: 'gemini', model: 'gemini-3.7-flash', priority: 1, isFallback: true },
  );
  for await (const _ of gen) { /* drain */ }
  assert.deepEqual(dispatched, { provider: 'gemini', model: 'gemini-3.7-flash' });
});
