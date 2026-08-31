import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const distDirectAssist = path.resolve(root, 'dist-electron/electron/direct-assist/index.js');

async function loadDirectAssist() {
  return import(pathToFileURL(distDirectAssist).href);
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
  for (const adapter of [liteLlm, nvidiaNim]) {
    assert.match(adapter, /const \{ mimeType, data \} = await this\.processImage\(p\)/);
    assert.match(adapter, /`data:\$\{mimeType\};base64,\$\{data\}`/);
    assert.doesNotMatch(adapter, /data:image\/png;base64/);
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
  assert.match(custom, /this\.parseStreamLine\(lineBuffer\)/);
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
