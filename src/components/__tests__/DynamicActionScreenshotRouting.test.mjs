import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  actionNeedsScreenCapture,
  appendScreenshotAttachment,
  mergePendingScreenshotAttachment,
} from '../../lib/screenshotAttachment.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const componentPath = resolve(here, '../NativelyInterface.tsx');
const componentSource = readFileSync(componentPath, 'utf8');
const sourceFile = ts.createSourceFile(
  componentPath,
  componentSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const handlerNames = [
  'handleScreenshotAttach',
  'showWhatToSayBusyMessage',
  'runWhatToSay',
  'handleWhatToSay',
  'captureScreenshotForDynamicAction',
  'handleDynamicActionAccept',
];
const handlerSet = new Set(handlerNames);
const declarations = new Map();

function collectHandlers(node) {
  if (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && handlerSet.has(node.name.text)
  ) {
    let statement = node;
    while (statement && !ts.isVariableStatement(statement)) statement = statement.parent;
    assert.ok(statement, `${node.name.text} must be declared in a variable statement`);
    declarations.set(node.name.text, {
      start: statement.getStart(sourceFile),
      source: statement.getText(sourceFile),
    });
  }
  ts.forEachChild(node, collectHandlers);
}
collectHandlers(sourceFile);

assert.deepEqual(
  [...declarations.keys()].sort(),
  [...handlerNames].sort(),
  'all routing handlers must remain extractable from NativelyInterface.tsx',
);

const extractedTypeScript = [...declarations.values()]
  .sort((a, b) => a.start - b.start)
  .map(({ source }) => source)
  .join('\n');
const extractedJavaScript = ts.transpileModule(extractedTypeScript, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
    jsx: ts.JsxEmit.ReactJSX,
  },
  fileName: componentPath,
}).outputText;

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createHarness({
  directAssistEnabled = false,
  initialAttachments = [],
  initialBusy = false,
  takeScreenshot = async () => undefined,
  setIsExpanded,
} = {}) {
  let attachedState = [...initialAttachments];
  let messages = [];
  let messageId = 0;
  let captureCalls = 0;
  const activeActions = new Set(initialBusy ? ['what_to_say'] : []);
  const generateCalls = [];
  const directCalls = [];
  const screenStatuses = [];
  const consoleErrors = [];
  const pendingCaptureRef = { current: null };
  const dynamicActionAcceptInFlightRef = { current: false };

  const syntheticWindow = {
    lastCapturedDOM: '',
    electronAPI: {
      takeScreenshot: async () => {
        captureCalls += 1;
        return takeScreenshot(captureCalls);
      },
      generateWhatToSay: async (...args) => {
        generateCalls.push(args);
        return { answer: 'legacy answer', usedImageInput: true };
      },
    },
  };

  const scope = {
    window: syntheticWindow,
    attachedContext: [...initialAttachments],
    pendingCaptureRef,
    dynamicActionAcceptInFlightRef,
    directAssistEnabled,
    actionNeedsScreenCapture,
    appendScreenshotAttachment,
    mergePendingScreenshotAttachment,
    setIsExpanded: setIsExpanded ?? (() => {}),
    setIsProcessing: () => {},
    setAttachedContext: (update) => {
      attachedState = typeof update === 'function' ? update(attachedState) : update;
    },
    setMessages: (update) => {
      messages = typeof update === 'function' ? update(messages) : update;
    },
    setScreenContextStatus: (status) => screenStatuses.push(status),
    setLatestUsedImageInput: () => {},
    setLatestVisionProviderUsed: () => {},
    setLatestVisionModelUsed: () => {},
    setLatestVisionFailureReason: () => {},
    setPageContext: () => {},
    genMessageId: () => `message-${++messageId}`,
    QUICK_ACTION_LABELS: { what_to_say: 'What should I say?' },
    analytics: { trackCommandExecuted: () => {} },
    messagesEndRef: { current: null },
    legacyIntelligenceTombstonedRef: { current: false },
    liveAnswerGenIdRef: { current: null },
    prepareIntelligenceStreamPlaceholder: () => {},
    consumeDirectPageContext: () => null,
    pendingRollingPartialRef: { current: null },
    rollingTranscript: '',
    mergeRollingTranscriptPartial: (complete, partial) => `${complete}${partial}`,
    buildDirectWhatToSayPayload: ({ dynamicPromptInstruction, hasScreenshots }) => ({
      source: hasScreenshots ? 'screenshot' : 'transcript',
      currentRequest: dynamicPromptInstruction ?? '',
      transcript: '',
    }),
    beginDirectAssist: async (payload) => {
      directCalls.push(payload);
    },
    pendingPageCaptureAtRef: { current: null },
    capturedEnvelopeRef: { current: null },
    capturedMetaRef: { current: null },
    DOM_CONTEXT_MAX_CHARS: 16_000,
    streamingNodeRef: { current: null },
    streamingTextRef: { current: '' },
    streamingMsgIdRef: { current: null },
    streamingIntentRef: { current: null },
    streamingRenderModeRef: { current: 'imperative' },
    eagerCodeExpansionHoldRef: { current: false },
    streamingRafRef: { current: null },
    streamingCodeRafRef: { current: null },
    applyWhatToAnswerNullFeedbackMessages: (previous) => previous,
    pinAnswerPanel: () => {},
    tryBeginOverlayAction: (action) => {
      if (activeActions.has(action)) return false;
      activeActions.add(action);
      return true;
    },
    endOverlayAction: (action) => activeActions.delete(action),
    setTimeout: () => 0,
    cancelAnimationFrame: () => {},
    console: {
      error: (...args) => consoleErrors.push(args),
      warn: () => {},
      debug: () => {},
    },
  };

  const parameterNames = Object.keys(scope);
  const factory = new Function(
    ...parameterNames,
    `${extractedJavaScript}\nreturn { ${handlerNames.join(', ')} };`,
  );
  const handlers = factory(...parameterNames.map((name) => scope[name]));

  return {
    handlers,
    pendingCaptureRef,
    dynamicActionAcceptInFlightRef,
    activeActions,
    generateCalls,
    directCalls,
    screenStatuses,
    consoleErrors,
    get captureCalls() { return captureCalls; },
    get messages() { return messages; },
    get attachments() { return attachedState; },
    removeAttachments() { attachedState = []; },
  };
}

describe('dynamic action screenshot routing', () => {
  for (const route of ['legacy', 'direct']) {
    test(`screen action captures once and sends the fresh image through the ${route} route`, async () => {
      const oldPath = route === 'legacy'
        ? '/Users/test/Library/Caches/Natively/old.png'
        : String.raw`C:\Users\test\AppData\Local\Natively\old.png`;
      const freshPath = route === 'legacy'
        ? '/Users/test/Library/Caches/Natively/fresh.png'
        : String.raw`C:\Users\test\AppData\Local\Natively\fresh.png`;
      const harness = createHarness({
        directAssistEnabled: route === 'direct',
        initialAttachments: [{ path: oldPath, preview: 'old-preview' }],
        takeScreenshot: async () => ({ path: freshPath, preview: 'fresh-preview' }),
      });

      await harness.handlers.handleDynamicActionAccept({
        requiresScreen: true,
        promptInstruction: 'Explain the visible problem',
      });

      assert.equal(harness.captureCalls, 1);
      if (route === 'legacy') {
        assert.equal(harness.generateCalls.length, 1);
        assert.deepEqual(harness.generateCalls[0][1], [oldPath, freshPath]);
        assert.equal(harness.directCalls.length, 0);
      } else {
        assert.equal(harness.directCalls.length, 1);
        assert.deepEqual(harness.directCalls[0].imagePaths, [oldPath, freshPath]);
        assert.equal(harness.generateCalls.length, 0);
      }
      assert.equal(harness.pendingCaptureRef.current, null);
      assert.equal(harness.activeActions.size, 0);
    });
  }

  test('plain dynamic action does not capture the screen', async () => {
    const harness = createHarness({ takeScreenshot: async () => {
      throw new Error('plain action must not capture');
    } });

    await harness.handlers.handleDynamicActionAccept({
      type: 'recap',
      promptInstruction: 'Summarize the discussion',
    });

    assert.equal(harness.captureCalls, 0);
    assert.equal(harness.generateCalls.length, 1);
    assert.equal(harness.generateCalls[0][1], undefined);
  });

  for (const failure of ['empty result', 'throw']) {
    test(`fresh capture ${failure} blocks generation even with an old attachment`, async () => {
      const oldPath = failure === 'empty result'
        ? '/Users/test/Library/Caches/Natively/old-stale.png'
        : String.raw`C:\Users\test\AppData\Local\Natively\old-stale.png`;
      const harness = createHarness({
        initialAttachments: [{ path: oldPath, preview: 'stale-preview' }],
        takeScreenshot: failure === 'throw'
          ? async () => { throw new Error('capture unavailable'); }
          : async () => ({ path: '', preview: '' }),
      });

      await harness.handlers.handleDynamicActionAccept({ requiresScreen: true });

      assert.equal(harness.captureCalls, 1);
      assert.equal(harness.generateCalls.length, 0);
      assert.equal(harness.directCalls.length, 0);
      assert.deepEqual(harness.screenStatuses, ['failed']);
      assert.match(harness.messages.at(-1).text, /Could not capture the screen/);
      assert.equal(harness.consoleErrors.length, failure === 'throw' ? 1 : 0);
      assert.equal(harness.activeActions.size, 0);
    });
  }

  test('busy what-to-say slot blocks capture and surfaces the busy message', async () => {
    const harness = createHarness({
      initialBusy: true,
      takeScreenshot: async () => ({ path: '/tmp/should-not-exist.png', preview: 'nope' }),
    });

    await harness.handlers.handleDynamicActionAccept({ requiresScreen: true });

    assert.equal(harness.captureCalls, 0);
    assert.equal(harness.generateCalls.length, 0);
    assert.match(harness.messages.at(-1).text, /Still finishing the previous answer/);
  });

  test('rapid double accept performs one capture and one generation', async () => {
    const capture = deferred();
    const harness = createHarness({
      directAssistEnabled: true,
      takeScreenshot: () => capture.promise,
    });

    const first = harness.handlers.handleDynamicActionAccept({ requiresScreen: true });
    const second = harness.handlers.handleDynamicActionAccept({ requiresScreen: true });
    capture.resolve({
      path: String.raw`C:\Users\test\AppData\Local\Natively\rapid.png`,
      preview: 'rapid-preview',
    });
    await Promise.all([first, second]);

    assert.equal(harness.captureCalls, 1);
    assert.equal(harness.directCalls.length, 1);
    assert.equal(harness.dynamicActionAcceptInFlightRef.current, false);
    assert.equal(harness.activeActions.size, 0);
  });

  test('capture failure releases the slot so a retry can capture and generate', async () => {
    const retryPath = '/Users/test/Library/Caches/Natively/retry.png';
    const harness = createHarness({
      takeScreenshot: async (call) => call === 1
        ? undefined
        : { path: retryPath, preview: 'retry-preview' },
    });

    await harness.handlers.handleDynamicActionAccept({ requiresScreen: true });
    assert.equal(harness.activeActions.size, 0);
    await harness.handlers.handleDynamicActionAccept({ requiresScreen: true });

    assert.equal(harness.captureCalls, 2);
    assert.equal(harness.generateCalls.length, 1);
    assert.deepEqual(harness.generateCalls[0][1], [retryPath]);
    assert.equal(harness.activeActions.size, 0);
  });

  test('setup throw releases handleWhatToSay slot for the next attempt', async () => {
    let setupCalls = 0;
    const harness = createHarness({
      setIsExpanded: () => {
        setupCalls += 1;
        if (setupCalls === 1) throw new Error('setup failed');
      },
    });

    await assert.rejects(
      harness.handlers.handleWhatToSay('first attempt'),
      /setup failed/,
    );
    assert.equal(harness.activeActions.size, 0);

    await harness.handlers.handleWhatToSay('retry');
    assert.equal(harness.generateCalls.length, 1);
    assert.equal(harness.activeActions.size, 0);
  });

  test('setup throw releases dynamic action slot for the next attempt', async () => {
    let setupCalls = 0;
    const harness = createHarness({
      setIsExpanded: () => {
        setupCalls += 1;
        if (setupCalls === 1) throw new Error('dynamic setup failed');
      },
    });

    await assert.rejects(
      harness.handlers.handleDynamicActionAccept({ type: 'recap' }),
      /dynamic setup failed/,
    );
    assert.equal(harness.activeActions.size, 0);
    assert.equal(harness.dynamicActionAcceptInFlightRef.current, false);

    await harness.handlers.handleDynamicActionAccept({ type: 'recap' });
    assert.equal(harness.generateCalls.length, 1);
    assert.equal(harness.activeActions.size, 0);
  });

  test('removed generic attachment is not resurrected through the pending ref', async () => {
    const removedPath = String.raw`C:\Users\test\Pictures\removed.png`;
    const harness = createHarness();

    harness.handlers.handleScreenshotAttach({ path: removedPath, preview: 'removed-preview' });
    assert.deepEqual(harness.attachments.map(({ path }) => path), [removedPath]);
    assert.equal(harness.pendingCaptureRef.current, null);
    harness.removeAttachments();

    await harness.handlers.handleWhatToSay('continue without the removed image');

    assert.equal(harness.generateCalls.length, 1);
    assert.equal(harness.generateCalls[0][1], undefined);
    assert.equal(harness.pendingCaptureRef.current, null);
  });
});
