// natively-browser/src/__tests__/service-worker.test.mjs
//
// Tests the pure service-worker core: the loopback POST classifier and the
// pairing-string parser. Imports compiled JS from dist-test/. The chrome.*
// event wiring is import-guarded (hasChrome) so it never runs under node --test.
//
// Run: npm run build:test && node --test src/__tests__/service-worker.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/service-worker.js');
const {
  postDomToDesktop,
  parsePairingString,
  extractFromTab,
  smartExtractFromTab,
  discoverProjectFromTab,
  effectiveProjectSelection,
  findProjectIframePermissionCandidatesInPage,
  permissionFailureForTab,
  projectPageIdentityForTab,
  readBrowserFsIndexedDbProjectFilesInPage,
  readLoadedProjectEditors,
  readLoadedProjectEditorsInPage,
  readMonacoProjectModelsInPage,
  sendProjectMessage,
} = await import(pathToFileURL(modPath).href);

const PAIRING = { port: 4123, token: 'A'.repeat(32) };

describe('top-frame page extraction routing', () => {
  test('routes legacy extraction to frame 0', async () => {
    const previousChrome = globalThis.chrome;
    const deliveries = [];
    globalThis.chrome = {
      scripting: {
        async executeScript(details) {
          assert.deepEqual(details.target, { tabId: 42 });
        },
      },
      tabs: {
        async sendMessage(tabId, message, options) {
          deliveries.push({ tabId, message, options });
          return { ok: true, result: { text: 'top-frame page' } };
        },
      },
    };

    try {
      assert.deepEqual(await extractFromTab(42), { text: 'top-frame page' });
      assert.deepEqual(deliveries, [{
        tabId: 42,
        message: { type: 'natively:extract' },
        options: { frameId: 0 },
      }]);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  test('routes smart extraction to frame 0', async () => {
    const previousChrome = globalThis.chrome;
    const deliveries = [];
    globalThis.chrome = {
      scripting: {
        async executeScript(details) {
          assert.deepEqual(details.target, { tabId: 43 });
        },
      },
      tabs: {
        async sendMessage(tabId, message, options) {
          deliveries.push({ tabId, message, options });
          return {
            ok: true,
            smart: {
              candidate: { autoPolicy: 'manual', confidenceScore: 0 },
              envelope: null,
              dom: 'top-frame smart page',
              blocked: false,
            },
          };
        },
      },
    };

    try {
      const smart = await smartExtractFromTab(43, {
        contextId: 'ctx-top-frame',
        capturedAt: 1234,
        mode: 'manual',
      });
      assert.equal(smart.dom, 'top-frame smart page');
      assert.equal(deliveries.length, 1);
      assert.equal(deliveries[0].tabId, 43);
      assert.equal(deliveries[0].message.type, 'natively:smart-extract');
      assert.deepEqual(deliveries[0].options, { frameId: 0 });
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });
});

function fakeResponse(status, body) {
  return {
    status,
    json: async () => body,
  };
}

function fakeElement({ attrs = {}, className = '', parentElement = null, children = {}, ...properties } = {}) {
  const element = {
    className,
    parentElement,
    getAttribute(name) {
      return Object.hasOwn(attrs, name) ? attrs[name] : null;
    },
    querySelector(selector) {
      return children[selector]?.[0] || null;
    },
    querySelectorAll(selector) {
      return children[selector] || [];
    },
    closest(selector) {
      let current = this;
      while (current) {
        const names = typeof current.className === 'string' ? current.className.split(/\s+/) : [];
        if (selector.split(',').some((part) => names.includes(part.trim().replace(/^\./, '')))) return current;
        current = current.parentElement;
      }
      return null;
    },
    ...properties,
  };
  return element;
}

function fakeDocument(selectors = {}) {
  return {
    querySelectorAll(selector) {
      return selectors[selector] || [];
    },
  };
}

function withEditorGlobals({ monaco, document }, run) {
  const previousMonaco = globalThis.monaco;
  const previousDocument = globalThis.document;
  if (monaco === undefined) delete globalThis.monaco;
  else globalThis.monaco = monaco;
  if (document === undefined) delete globalThis.document;
  else globalThis.document = document;
  try {
    return run();
  } finally {
    if (previousMonaco === undefined) delete globalThis.monaco;
    else globalThis.monaco = previousMonaco;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

const textEncoder = new TextEncoder();

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function browserFsUuid(number) {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
}

function browserFsInode(dataId, size, kind) {
  const bytes = new Uint8Array(66);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, size, true);
  view.setUint16(4, kind === 'directory' ? 0x41ff : 0x81a4, true);
  bytes.set(textEncoder.encode(dataId), 30);
  return bytes.buffer;
}

function browserFsDirectory(entries) {
  return exactArrayBuffer(textEncoder.encode(JSON.stringify(entries)));
}

function browserFsText(text) {
  return exactArrayBuffer(textEncoder.encode(text));
}

function fakeBrowserFsIndexedDb(records, { databaseName = 'vscode-memfs', storeName = databaseName } = {}) {
  const trace = { opens: [], reads: [], modes: [], closed: 0 };
  const database = {
    name: databaseName,
    objectStoreNames: [storeName],
    close() { trace.closed += 1; },
    transaction(requestedStore, mode) {
      assert.equal(requestedStore, storeName);
      trace.modes.push(mode);
      const transaction = {
        objectStore() {
          return {
            keyPath: null,
            autoIncrement: false,
            get(key) {
              trace.reads.push(key);
              const request = {};
              queueMicrotask(() => {
                request.result = records.get(key);
                request.onsuccess?.();
              });
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };
  const indexedDB = {
    async databases() {
      return [{ name: databaseName, version: 1 }];
    },
    open(name) {
      trace.opens.push(name);
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { indexedDB, trace };
}

describe('postDomToDesktop', () => {
  test('uses port + token from pairing in the loopback URL', async () => {
    let seenUrl = '';
    let seenInit = null;
    const fetchImpl = async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return fakeResponse(200, { success: true });
    };
    const out = await postDomToDesktop(PAIRING, 'hello', fetchImpl);
    assert.equal(out.kind, 'success');
    assert.match(seenUrl, /^http:\/\/127\.0\.0\.1:4123\/dom\?t=/);
    assert.match(seenUrl, new RegExp('t=' + 'A'.repeat(32)));
    assert.equal(seenInit.method, 'POST');
    assert.equal(seenInit.headers['Content-Type'], 'application/json');
    assert.equal(seenInit.body, JSON.stringify({ dom: 'hello' }));
  });

  test('200 without success:true is an error, not success', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(200, { success: false }));
    assert.equal(out.kind, 'error');
  });

  test('401 maps to unauthorized (triggers re-pair)', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(401, null));
    assert.equal(out.kind, 'unauthorized');
  });

  test('409 maps to no-session (Natively running but no active overlay)', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () =>
      fakeResponse(409, { error: 'no_active_session' }),
    );
    assert.equal(out.kind, 'no-session');
  });

  test('400 maps to bad-request', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(400, null));
    assert.equal(out.kind, 'bad-request');
  });

  test('413 maps to too-large', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(413, null));
    assert.equal(out.kind, 'too-large');
  });

  test('429 maps to rate-limited', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(429, null));
    assert.equal(out.kind, 'rate-limited');
  });

  test('fetch throw (connection refused) maps to refused', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => {
      throw new TypeError('Failed to fetch');
    });
    assert.equal(out.kind, 'refused');
  });

  test('unknown status maps to http-error with the status', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(500, null));
    assert.equal(out.kind, 'http-error');
    assert.equal(out.status, 500);
  });

  test('the dom payload is the only body — token never appears in body', async () => {
    let bodySeen = '';
    await postDomToDesktop(PAIRING, 'page text', async (_url, init) => {
      bodySeen = init.body;
      return fakeResponse(200, { success: true });
    });
    assert.equal(bodySeen, JSON.stringify({ dom: 'page text' }));
    assert.ok(!bodySeen.includes(PAIRING.token), 'token must not be in the request body');
  });
});

describe('parsePairingString', () => {
  test('parses valid port:token', () => {
    const p = parsePairingString('4123:AbC123_-xyzAbC123_-xyz98765432');
    assert.deepEqual(p, { port: 4123, token: 'AbC123_-xyzAbC123_-xyz98765432' });
  });

  test('trims surrounding whitespace', () => {
    const p = parsePairingString('  4130:' + 'Z'.repeat(32) + '  ');
    assert.equal(p.port, 4130);
    assert.equal(p.token, 'Z'.repeat(32));
  });

  test('rejects missing colon', () => {
    assert.equal(parsePairingString('4123AbC'), null);
  });

  test('rejects non-numeric port', () => {
    assert.equal(parsePairingString('abc:' + 'A'.repeat(32)), null);
  });

  test('rejects out-of-range port', () => {
    assert.equal(parsePairingString('70000:' + 'A'.repeat(32)), null);
  });

  test('rejects too-short token', () => {
    assert.equal(parsePairingString('4123:short'), null);
  });

  test('rejects token with illegal characters', () => {
    assert.equal(parsePairingString('4123:has spaces and !!! chars here xx'), null);
  });
});

describe('readMonacoProjectModelsInPage', () => {
  test('discovers models with a stable content revision without returning content or changing editor state', () => {
    let getValueCalls = 0;
    let mutationCalls = 0;
    const previousMonaco = globalThis.monaco;
    globalThis.monaco = {
      editor: {
        getModels: () => [{
          uri: { path: '/workspace/src/App.tsx' },
          getLanguageId: () => 'typescriptreact',
          getVersionId: () => 4,
          getValueLength: () => 42,
          getValue: () => { getValueCalls += 1; return 'export default App'; },
          setValue: () => { mutationCalls += 1; },
        }],
      },
    };
    try {
      const files = readMonacoProjectModelsInPage({ includeContent: false });
      assert.equal(files.length, 1);
      assert.equal(files[0].path, 'workspace/src/App.tsx');
      assert.match(files[0].revision, /^content-[0-9a-f]{8}$/);
      assert.equal(files[0].charCount, 18);
      assert.equal(files[0].content, undefined);
      assert.equal(getValueCalls, 1, 'discovery hashes one snapshot but must not return the body');
      assert.equal(mutationCalls, 0, 'capture must never edit an editor model');
    } finally {
      if (previousMonaco === undefined) delete globalThis.monaco;
      else globalThis.monaco = previousMonaco;
    }
  });

  test('refresh returns content only for selected models whose content revision changed', () => {
    const reads = [];
    const previousMonaco = globalThis.monaco;
    let changedContent = 'before!';
    globalThis.monaco = {
      editor: {
        getModels: () => [
          {
            uri: { path: '/src/unchanged.ts' },
            getLanguageId: () => 'typescript',
            getVersionId: () => 1,
            getValueLength: () => 10,
            getValue: () => { reads.push('unchanged'); return 'unchanged'; },
          },
          {
            uri: { path: '/src/changed.ts' },
            getLanguageId: () => 'typescript',
            getVersionId: () => 1,
            getValueLength: () => 7,
            getValue: () => { reads.push('changed'); return changedContent; },
          },
          {
            uri: { path: '/test/unselected.test.ts' },
            getLanguageId: () => 'typescript',
            getVersionId: () => 9,
            getValueLength: () => 10,
            getValue: () => { reads.push('unselected'); return 'unselected'; },
          },
        ],
      },
    };
    try {
      const descriptors = readMonacoProjectModelsInPage({ includeContent: false });
      const previousRevisions = Object.fromEntries(
        descriptors.map((file) => [file.path, file.revision]),
      );
      reads.length = 0;
      changedContent = 'changed';
      const files = readMonacoProjectModelsInPage({
        includeContent: true,
        selectedPaths: ['src'],
        previousRevisions,
      });
      assert.deepEqual(reads, ['unchanged', 'changed', 'unselected']);
      assert.equal(files.find((file) => file.path === 'src/unchanged.ts').content, undefined);
      assert.equal(files.find((file) => file.path === 'src/changed.ts').content, 'changed');
      assert.equal(files.find((file) => file.path === 'test/unselected.test.ts').content, undefined);
    } finally {
      if (previousMonaco === undefined) delete globalThis.monaco;
      else globalThis.monaco = previousMonaco;
    }
  });

  test('detects changed source when a reloaded Monaco model reuses its version id', () => {
    const previousMonaco = globalThis.monaco;
    let source = 'export const value = "old";';
    globalThis.monaco = {
      editor: {
        getModels: () => [{
          uri: { path: '/src/reloaded.ts' },
          getLanguageId: () => 'typescript',
          getVersionId: () => 1,
          getValueLength: () => source.length,
          getValue: () => source,
        }],
      },
    };
    try {
      const before = readMonacoProjectModelsInPage({ includeContent: false })[0];
      assert.equal(before.content, undefined);

      // Simulate a page/model reload: the version counter restarts at 1 even
      // though the loaded source is different.
      source = 'export const value = "new";';
      const after = readMonacoProjectModelsInPage({
        includeContent: true,
        previousRevisions: { 'src/reloaded.ts': before.revision },
      })[0];

      assert.notEqual(after.revision, before.revision);
      assert.equal(after.content, source);
    } finally {
      if (previousMonaco === undefined) delete globalThis.monaco;
      else globalThis.monaco = previousMonaco;
    }
  });
});

describe('readLoadedProjectEditorsInPage', () => {
  test('reads an already-mounted CodeMirror 5 instance with an exact path', () => {
    const counters = { getValue: 0, click: 0, focus: 0, dispatch: 0, setValue: 0 };
    const editor = fakeElement({
      attrs: { 'data-file-path': '/workspace/src/cm5.ts', 'data-language': 'typescript' },
      className: 'CodeMirror',
      CodeMirror: {
        getValue: () => { counters.getValue += 1; return 'export const cm5 = true;'; },
        getOption: () => 'javascript',
        setValue: () => { counters.setValue += 1; },
      },
      click: () => { counters.click += 1; },
      focus: () => { counters.focus += 1; },
      dispatchEvent: () => { counters.dispatch += 1; },
    });
    const document = fakeDocument({ '.CodeMirror': [editor] });

    const files = withEditorGlobals({ document }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));

    assert.equal(files.length, 1);
    assert.deepEqual(files[0], {
      path: 'workspace/src/cm5.ts',
      language: 'typescript',
      revision: files[0].revision,
      charCount: 24,
      readable: true,
      content: 'export const cm5 = true;',
    });
    assert.match(files[0].revision, /^content-[0-9a-f]{8}$/);
    assert.deepEqual(counters, { getValue: 1, click: 0, focus: 0, dispatch: 0, setValue: 0 });
  });

  test('reads CodeMirror 6 from attached state and discloses virtualized DOM fallback as unreadable', () => {
    const stateEditor = fakeElement({
      attrs: { 'data-resource-path': 'src/state.ts', 'data-language': 'typescript' },
      className: 'cm-editor',
      cmView: { view: { state: { doc: { toString: () => 'const state = 6;' } } } },
    });
    const lineOne = fakeElement({ textContent: 'fallback' });
    const lineTwo = fakeElement({ textContent: 'content' });
    const content = fakeElement({
      textContent: 'fallbackcontent',
      children: { '.cm-line': [lineOne, lineTwo] },
    });
    const fallbackEditor = fakeElement({
      attrs: { 'data-model-uri': 'file:///workspace/src/fallback.js' },
      className: 'cm-editor',
      children: { '.cm-content': [content] },
    });
    const document = fakeDocument({ '.cm-editor': [stateEditor, fallbackEditor] });

    const files = withEditorGlobals({ document }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));

    assert.equal(files.find((file) => file.path === 'src/state.ts').content, 'const state = 6;');
    const fallback = files.find((file) => file.path === 'workspace/src/fallback.js');
    assert.equal(fallback.content, undefined);
    assert.equal(fallback.readable, false);
    assert.equal(fallback.charCount, 'fallback\ncontent'.length);
    assert.match(fallback.reason, /virtualized viewport/i);
  });

  test('reads Ace only through an existing env editor/session and infers its mode', () => {
    const counters = { getValue: 0, edit: 0 };
    const ace = fakeElement({
      attrs: { 'aria-label': 'src/ace.py' },
      className: 'ace_editor',
      env: {
        editor: {
          session: {
            getValue: () => { counters.getValue += 1; return 'print("ace")'; },
            getMode: () => ({ $id: 'ace/mode/python' }),
          },
        },
      },
    });
    // If the implementation ever calls the global initializer, this test fails.
    const previousAce = globalThis.ace;
    globalThis.ace = { edit: () => { counters.edit += 1; throw new Error('must not initialize Ace'); } };
    try {
      const files = withEditorGlobals({ document: fakeDocument({ '.ace_editor': [ace] }) }, () =>
        readLoadedProjectEditorsInPage({ includeContent: true }));
      assert.equal(files[0].path, 'src/ace.py');
      assert.equal(files[0].language, 'python');
      assert.equal(files[0].content, 'print("ace")');
      assert.deepEqual(counters, { getValue: 1, edit: 0 });
    } finally {
      if (previousAce === undefined) delete globalThis.ace;
      else globalThis.ace = previousAce;
    }
  });

  test('reads exact-path textarea and contenteditable editors but skips pathless editors', () => {
    const wrapper = fakeElement({ attrs: { 'data-natively-file-path': 'src/input.json' } });
    const textarea = fakeElement({ parentElement: wrapper, value: '{"ok":true}' });
    const editable = fakeElement({
      attrs: { 'data-path': 'README.md' },
      textContent: '# Loaded project',
    });
    const pathless = fakeElement({ value: 'do not capture me' });
    const document = fakeDocument({
      textarea: [textarea, pathless],
      '[contenteditable="true"]': [editable],
    });

    const files = withEditorGlobals({ document }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));

    assert.deepEqual(files.map((file) => file.path).sort(), ['README.md', 'src/input.json']);
    assert.equal(files.find((file) => file.path === 'src/input.json').content, '{"ok":true}');
    assert.equal(files.find((file) => file.path === 'README.md').content, '# Loaded project');
    assert.ok(!files.some((file) => file.content === 'do not capture me'));
  });

  test('descriptor discovery omits bodies and refresh returns only selected changed content', () => {
    let unchanged = 'const unchanged = 1;';
    let changed = 'const changed = 1;';
    let unselected = 'const outside = 1;';
    const makeCm = (path, read) => fakeElement({
      attrs: { 'data-file-path': path },
      className: 'CodeMirror',
      CodeMirror: { getValue: read, getOption: () => ({ name: 'typescript' }) },
    });
    const document = fakeDocument({
      '.CodeMirror': [
        makeCm('src/unchanged.ts', () => unchanged),
        makeCm('src/changed.ts', () => changed),
        makeCm('test/unselected.ts', () => unselected),
      ],
    });

    const descriptors = withEditorGlobals({ document }, () =>
      readLoadedProjectEditorsInPage({ includeContent: false }));
    assert.ok(descriptors.every((file) => file.content === undefined));
    assert.ok(descriptors.every((file) => file.charCount > 0 && file.revision));

    const previousRevisions = Object.fromEntries(descriptors.map((file) => [file.path, file.revision]));
    changed = 'const changed = 2;';
    // Ensure the test does not accidentally rely on object identity or a cached body.
    unchanged = `${unchanged}`;
    unselected = `${unselected}`;
    const refreshed = withEditorGlobals({ document }, () =>
      readLoadedProjectEditorsInPage({
        includeContent: true,
        selectedPaths: ['src'],
        previousRevisions,
      }));

    assert.equal(refreshed.find((file) => file.path === 'src/unchanged.ts').content, undefined);
    assert.equal(refreshed.find((file) => file.path === 'src/changed.ts').content, 'const changed = 2;');
    assert.equal(refreshed.find((file) => file.path === 'test/unselected.ts').content, undefined);
  });

  test('uses a single active mounted tab only when it safely identifies the editor', () => {
    const editor = fakeElement({ className: 'cm-editor', cmView: { state: { doc: { toString: () => 'tab path' } } } });
    const tab = fakeElement({
      attrs: { role: 'tab', 'aria-selected': 'true', title: 'src/from-tab.ts' },
    });
    const document = fakeDocument({ '.cm-editor': [editor], '[role="tab"]': [tab] });

    const files = withEditorGlobals({ document }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));
    assert.equal(files[0].path, 'src/from-tab.ts');
    assert.equal(files[0].content, 'tab path');
  });

  test('does not pair multiple mounted editors to tabs by DOM order', () => {
    const reads = [];
    const firstEditor = fakeElement({
      className: 'CodeMirror',
      CodeMirror: { getValue: () => { reads.push('first'); return 'first body'; } },
    });
    const secondEditor = fakeElement({
      className: 'CodeMirror',
      CodeMirror: { getValue: () => { reads.push('second'); return 'second body'; } },
    });
    // Deliberately reverse the tab order. Neither tab explicitly owns an editor
    // through aria-controls, so assigning by index would corrupt path/body pairs.
    const secondTab = fakeElement({ attrs: { role: 'tab', title: 'src/second.ts' } });
    const firstTab = fakeElement({ attrs: { role: 'tab', title: 'src/first.ts' } });
    const document = fakeDocument({
      '.CodeMirror': [firstEditor, secondEditor],
      '[role="tab"]': [secondTab, firstTab],
    });

    const files = withEditorGlobals({ document }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));

    assert.deepEqual(files, []);
    assert.deepEqual(reads, [], 'ambiguous editor bodies must not be read');
  });

  test('reads decorated nested VS Code resource labels from mounted tabs', () => {
    const editor = fakeElement({
      className: 'cm-editor',
      cmView: { state: { doc: { toString: () => '{"scripts":{"test":"node --test"}}' } } },
    });
    const resourceLabel = fakeElement({
      attrs: { 'aria-label': '\\projects\\challenge\\package.json, modified' },
      className: 'monaco-icon-label explorer-item',
    });
    const tab = fakeElement({
      attrs: { role: 'tab', 'aria-selected': 'true' },
      children: {
        '[aria-label]': [resourceLabel],
        '.monaco-icon-label': [resourceLabel],
        '.explorer-item': [resourceLabel],
      },
    });
    const document = fakeDocument({ '.cm-editor': [editor], '[role="tab"]': [tab] });

    const files = withEditorGlobals({ document }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));

    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'projects/challenge/package.json');
    assert.match(files[0].content, /node --test/);
  });

  test('never reads bodies from known secret-bearing editor paths', () => {
    let bodyReads = 0;
    const monaco = {
      editor: {
        getModels: () => [
          {
            uri: { path: '/workspace/.env.production' },
            getValueLength: () => 42,
            getValue: () => { bodyReads += 1; return 'API_TOKEN=must-not-be-read'; },
          },
          {
            uri: { path: '/workspace/config/production.env' },
            getValueLength: () => 42,
            getValue: () => { bodyReads += 1; return 'API_TOKEN=must-not-be-read'; },
          },
        ],
      },
    };

    const files = withEditorGlobals({ monaco, document: fakeDocument() }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));

    assert.equal(bodyReads, 0);
    assert.equal(files.length, 2);
    assert.ok(files.every((file) => file.content === undefined && file.readable === false));
    assert.ok(files.every((file) => /secret-bearing environment/i.test(file.reason || '')));
  });

  test('keeps an explicit suffix-env sample readable', () => {
    const monaco = {
      editor: {
        getModels: () => [{
          uri: { path: '/workspace/config/sample.env' },
          getValueLength: () => 20,
          getValue: () => 'API_TOKEN=replace-me',
        }],
      },
    };

    const files = withEditorGlobals({ monaco, document: fakeDocument() }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));

    assert.equal(files.length, 1);
    assert.equal(files[0].readable, true);
    assert.equal(files[0].content, 'API_TOKEN=replace-me');
  });

  test('never calls editor body getters for Docker, Composer, or token credential paths', () => {
    const bodyReads = [];
    const monaco = {
      editor: {
        getModels: () => [{
          uri: { path: '/home/user/.docker/config.json' },
          getLanguageId: () => { bodyReads.push('monaco-language'); return 'json'; },
          getValueLength: () => { bodyReads.push('monaco-length'); return 99; },
          getValue: () => { bodyReads.push('monaco-value'); return 'must-never-be-read'; },
        }],
      },
    };
    const codeMirror = fakeElement({
      attrs: { 'data-file-path': 'composer/auth.json' },
      className: 'CodeMirror',
      CodeMirror: {
        getValue: () => { bodyReads.push('codemirror-value'); return 'must-never-be-read'; },
        getOption: () => { bodyReads.push('codemirror-mode'); return 'json'; },
      },
    });
    const ace = fakeElement({
      attrs: { 'data-file-path': 'oauth/token.json' },
      className: 'ace_editor',
      env: {
        editor: {
          getValue: () => { bodyReads.push('ace-value'); return 'must-never-be-read'; },
          getSession: () => { bodyReads.push('ace-session'); return undefined; },
        },
      },
    });
    const document = fakeDocument({
      '.CodeMirror': [codeMirror],
      '.ace_editor': [ace],
    });

    const files = withEditorGlobals({ monaco, document }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));

    assert.deepEqual(bodyReads, []);
    for (const secretPath of [
      'home/user/.docker/config.json',
      'composer/auth.json',
      'oauth/token.json',
    ]) {
      const secret = files.find((file) => file.path === secretPath);
      assert.equal(secret?.readable, false);
      assert.equal(secret?.content, undefined);
      assert.match(secret?.reason || '', /secret|credential/i);
    }
  });

  test('deduplicates paths and prefers the in-memory Monaco model', () => {
    const cm5 = fakeElement({
      attrs: { 'data-file-path': 'src/shared.ts' },
      className: 'CodeMirror',
      CodeMirror: { getValue: () => 'stale CodeMirror value' },
    });
    const monaco = {
      editor: {
        getModels: () => [{
          uri: { path: '/src/shared.ts' },
          getLanguageId: () => 'typescript',
          getVersionId: () => 7,
          getValueLength: () => 18,
          getValue: () => 'live Monaco value',
        }],
      },
    };
    const files = withEditorGlobals({ monaco, document: fakeDocument({ '.CodeMirror': [cm5] }) }, () =>
      readLoadedProjectEditorsInPage({ includeContent: true }));

    assert.equal(files.length, 1);
    assert.match(files[0].revision, /^content-[0-9a-f]{8}$/);
    assert.equal(files[0].content, 'live Monaco value');
  });
});

describe('readBrowserFsIndexedDbProjectFilesInPage', () => {
  test('walks the BrowserFS inode graph read-only and captures complete selected text files', async () => {
    const ids = Array.from({ length: 24 }, (_, index) => browserFsUuid(index + 1));
    const [
      rootData, projectsInode, projectsData, challengeInode, challengeData,
      srcInode, srcData, appInode, appData, packageInode, packageData,
      readmeInode, readmeData, secretInode, secretData, templateInode,
      templateData, binaryInode, binaryData, hugeInode, hugeData,
    ] = ids;
    const appSource = 'export default function App() { return "BrowserFS"; }';
    const packageSource = '{"scripts":{"test":"node --test"}}';
    const readmeSource = '# Complete project\n';
    const templateSource = 'API_TOKEN=replace-me\n';
    const records = new Map([
      ['/', browserFsInode(rootData, 4096, 'directory')],
      [rootData, browserFsDirectory({ projects: projectsInode })],
      [projectsInode, browserFsInode(projectsData, 4096, 'directory')],
      [projectsData, browserFsDirectory({ challenge: challengeInode })],
      [challengeInode, browserFsInode(challengeData, 4096, 'directory')],
      [challengeData, browserFsDirectory({
        src: srcInode,
        'package.json': packageInode,
        'README.md': readmeInode,
        '.env.production': secretInode,
        '.env.example': templateInode,
        'logo.png': binaryInode,
        'huge.ts': hugeInode,
      })],
      [srcInode, browserFsInode(srcData, 4096, 'directory')],
      [srcData, browserFsDirectory({ 'App.js': appInode })],
      [appInode, browserFsInode(appData, textEncoder.encode(appSource).byteLength, 'file')],
      [appData, browserFsText(appSource)],
      [packageInode, browserFsInode(packageData, textEncoder.encode(packageSource).byteLength, 'file')],
      [packageData, browserFsText(packageSource)],
      [readmeInode, browserFsInode(readmeData, textEncoder.encode(readmeSource).byteLength, 'file')],
      [readmeData, browserFsText(readmeSource)],
      [secretInode, browserFsInode(secretData, 28, 'file')],
      [secretData, browserFsText('TOKEN=must-never-be-read')],
      [templateInode, browserFsInode(templateData, textEncoder.encode(templateSource).byteLength, 'file')],
      [templateData, browserFsText(templateSource)],
      [binaryInode, browserFsInode(binaryData, 4, 'file')],
      [binaryData, new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer],
      [hugeInode, browserFsInode(hugeData, 600 * 1024, 'file')],
    ]);
    const { indexedDB, trace } = fakeBrowserFsIndexedDb(records);
    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = indexedDB;
    try {
      const files = await readBrowserFsIndexedDbProjectFilesInPage({
        includeContent: true,
        selectedPaths: ['projects/challenge'],
      });

      assert.equal(files.find((file) => file.path === 'projects/challenge/src/App.js').content, appSource);
      assert.equal(files.find((file) => file.path === 'projects/challenge/package.json').content, packageSource);
      assert.equal(files.find((file) => file.path === 'projects/challenge/README.md').content, readmeSource);
      assert.equal(files.find((file) => file.path === 'projects/challenge/.env.example').content, templateSource);
      const secret = files.find((file) => file.path === 'projects/challenge/.env.production');
      assert.equal(secret.readable, false);
      assert.match(secret.reason, /secret-bearing environment/i);
      assert.equal(files.find((file) => file.path === 'projects/challenge/logo.png').readable, false);
      assert.match(files.find((file) => file.path === 'projects/challenge/huge.ts').reason, /read limit/i);
      assert.ok(!trace.reads.includes(secretData), 'secret body was not requested from IndexedDB');
      assert.ok(!trace.reads.includes(binaryData), 'binary body was not requested from IndexedDB');
      assert.ok(!trace.reads.includes(hugeData), 'oversize body was not requested from IndexedDB');
      assert.deepEqual(new Set(trace.modes), new Set(['readonly']));
      assert.deepEqual(trace.opens, ['vscode-memfs']);
      assert.equal(trace.closed, 1);
    } finally {
      if (previousIndexedDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = previousIndexedDB;
    }
  });

  test('never reads BrowserFS body records for path-qualified credential files', async () => {
    const ids = Array.from({ length: 19 }, (_, index) => browserFsUuid(index + 101));
    const [
      rootData,
      dockerInode, dockerData, dockerConfigInode, dockerConfigData,
      composerInode, composerData, authInode, authData,
      oauthInode, oauthData, tokenInode, tokenData,
      envInode, envData,
      srcInode, srcData, appInode, appData,
    ] = ids;
    const appSource = 'export const ready = true;';
    const records = new Map([
      ['/', browserFsInode(rootData, 4096, 'directory')],
      [rootData, browserFsDirectory({
        '.docker': dockerInode,
        composer: composerInode,
        oauth: oauthInode,
        'production.env': envInode,
        src: srcInode,
      })],
      [dockerInode, browserFsInode(dockerData, 4096, 'directory')],
      [dockerData, browserFsDirectory({ 'config.json': dockerConfigInode })],
      [dockerConfigInode, browserFsInode(dockerConfigData, 37, 'file')],
      [dockerConfigData, browserFsText('{"auths":{"registry":"never-read"}}')],
      [composerInode, browserFsInode(composerData, 4096, 'directory')],
      [composerData, browserFsDirectory({ 'auth.json': authInode })],
      [authInode, browserFsInode(authData, 32, 'file')],
      [authData, browserFsText('{"github-oauth":"never-read"}')],
      [oauthInode, browserFsInode(oauthData, 4096, 'directory')],
      [oauthData, browserFsDirectory({ 'token.json': tokenInode })],
      [tokenInode, browserFsInode(tokenData, 29, 'file')],
      [tokenData, browserFsText('{"access_token":"never-read"}')],
      [envInode, browserFsInode(envData, 20, 'file')],
      [envData, browserFsText('API_TOKEN=never-read')],
      [srcInode, browserFsInode(srcData, 4096, 'directory')],
      [srcData, browserFsDirectory({ 'App.ts': appInode })],
      [appInode, browserFsInode(appData, textEncoder.encode(appSource).byteLength, 'file')],
      [appData, browserFsText(appSource)],
    ]);
    const { indexedDB, trace } = fakeBrowserFsIndexedDb(records);
    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = indexedDB;
    try {
      const files = await readBrowserFsIndexedDbProjectFilesInPage({ includeContent: true });

      assert.equal(files.find((file) => file.path === 'src/App.ts')?.content, appSource);
      for (const [secretPath, dataId] of [
        ['.docker/config.json', dockerConfigData],
        ['composer/auth.json', authData],
        ['oauth/token.json', tokenData],
        ['production.env', envData],
      ]) {
        const secret = files.find((file) => file.path === secretPath);
        assert.equal(secret?.readable, false);
        assert.equal(secret?.content, undefined);
        assert.match(secret?.reason || '', /secret|credential/i);
        assert.ok(!trace.reads.includes(dataId), `${secretPath} body record was not requested from IndexedDB`);
      }
      assert.deepEqual(new Set(trace.modes), new Set(['readonly']));
    } finally {
      if (previousIndexedDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = previousIndexedDB;
    }
  });

  test('descriptor discovery reads no file data and never opens an unlisted database', async () => {
    const previousIndexedDB = globalThis.indexedDB;
    let opens = 0;
    globalThis.indexedDB = {
      async databases() { return []; },
      open() { opens += 1; throw new Error('must not create a guessed database'); },
    };
    try {
      assert.deepEqual(await readBrowserFsIndexedDbProjectFilesInPage({ includeContent: false }), []);
      assert.equal(opens, 0);
    } finally {
      if (previousIndexedDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = previousIndexedDB;
    }
  });

  test('fails closed when the root record is not a 66-byte BrowserFS directory inode', async () => {
    const records = new Map([['/', browserFsText('not-an-inode')]]);
    const { indexedDB, trace } = fakeBrowserFsIndexedDb(records);
    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = indexedDB;
    try {
      assert.deepEqual(await readBrowserFsIndexedDbProjectFilesInPage({ includeContent: true }), []);
      assert.deepEqual(new Set(trace.modes), new Set(['readonly']));
    } finally {
      if (previousIndexedDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = previousIndexedDB;
    }
  });
});

describe('project iframe host-permission diagnostics', () => {
  test('chooses a later readable BrowserFS frame over an earlier explorer-only frame', async () => {
    const previousChrome = globalThis.chrome;
    const unreadableFiles = Array.from({ length: 8 }, (_, index) => ({
      path: `projects/challenge/src/unreadable-${index}.js`,
      readable: false,
      charCount: 0,
    }));
    const readableFiles = Array.from({ length: 4 }, (_, index) => ({
      path: `projects/challenge/src/readable-${index}.js`,
      readable: true,
      charCount: 100 + index,
    }));
    globalThis.chrome = {
      scripting: {
        async executeScript() {
          return [{ frameId: 0 }, { frameId: 31 }, { frameId: 32 }];
        },
      },
      tabs: {
        async sendMessage(_tabId, _message, { frameId }) {
          if (frameId === 31) {
            return { ok: true, project: { workspaceId: 'dom-frame', files: unreadableFiles, estimatedChars: 0 } };
          }
          if (frameId === 32) {
            return { ok: true, project: { workspaceId: 'browserfs-frame', files: readableFiles, estimatedChars: 406 } };
          }
          return { ok: true, project: null };
        },
      },
    };
    try {
      const response = await sendProjectMessage(42, { type: 'natively:project-discover' });
      assert.equal(response.project.workspaceId, 'browserfs-frame');
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  test('routes reused frame ids to each exact injected document', async () => {
    const previousChrome = globalThis.chrome;
    const deliveries = [];
    globalThis.chrome = {
      scripting: {
        async executeScript() {
          return [
            { frameId: 17, documentId: 'document-before-navigation' },
            { frameId: 17, documentId: 'document-after-navigation' },
            { frameId: 18 },
          ];
        },
      },
      tabs: {
        async sendMessage(_tabId, message, options) {
          deliveries.push({
            identityFrameId: message.pageIdentity?.frameId,
            identityDocumentId: message.pageIdentity?.documentId,
            options,
          });
          if (message.type === 'natively:project-capture') {
            return {
              ok: true,
              projectCapture: { project: { workspaceId: 'workspace-exact-owner' } },
            };
          }
          return { ok: true, project: null };
        },
      },
    };

    try {
      await sendProjectMessage(42, {
        type: 'natively:project-discover',
        pageIdentity: {
          host: 'ide.example',
          frameId: 999,
          documentId: 'stale-caller-document',
        },
      });
      assert.deepEqual(deliveries, [
        {
          identityFrameId: 17,
          identityDocumentId: 'document-after-navigation',
          options: { frameId: 17, documentId: 'document-after-navigation' },
        },
        {
          identityFrameId: 17,
          identityDocumentId: 'document-before-navigation',
          options: { frameId: 17, documentId: 'document-before-navigation' },
        },
        {
          identityFrameId: 18,
          identityDocumentId: undefined,
          options: { frameId: 18 },
        },
      ]);

      deliveries.length = 0;
      const captured = await sendProjectMessage(
        42,
        { type: 'natively:project-capture' },
        undefined,
        'workspace-exact-owner',
        { frameId: 17, documentId: 'document-before-navigation' },
      );
      assert.deepEqual(captured.ownerTarget, {
        frameId: 17,
        documentId: 'document-before-navigation',
      });
      assert.deepEqual(deliveries, [{
        identityFrameId: undefined,
        identityDocumentId: undefined,
        options: { frameId: 17, documentId: 'document-before-navigation' },
      }]);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  test('does not pass MAIN-world files from a replaced document to its successor', async () => {
    const previousChrome = globalThis.chrome;
    const staleFiles = [{
      path: 'src/stale.ts',
      content: 'export const stale = true;',
      charCount: 26,
      readable: true,
    }];
    const deliveries = [];
    globalThis.chrome = {
      scripting: {
        async executeScript(details) {
          if (details.world === 'MAIN') {
            return [{ frameId: 17, documentId: 'document-before-navigation', result: staleFiles }];
          }
          return [{ frameId: 17, documentId: 'document-after-navigation' }];
        },
      },
      tabs: {
        async sendMessage(_tabId, message, options) {
          deliveries.push({ externalFiles: message.externalFiles, options });
          return { ok: true, project: null };
        },
      },
    };

    try {
      const filesByTarget = await readLoadedProjectEditors(42, { includeContent: true });
      const response = await sendProjectMessage(
        42,
        { type: 'natively:project-discover', externalFiles: [] },
        filesByTarget,
      );
      assert.deepEqual(response.ownerTarget, {
        frameId: 17,
        documentId: 'document-after-navigation',
      });
      assert.deepEqual(deliveries, [{
        externalFiles: [],
        options: { frameId: 17, documentId: 'document-after-navigation' },
      }]);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  test('capture ignores an allow-empty top-frame response and returns the selected iframe workspace', async () => {
    const previousChrome = globalThis.chrome;
    const deliveries = [];
    globalThis.chrome = {
      scripting: {
        async executeScript() {
          return [{ frameId: 0 }, { frameId: 17 }];
        },
      },
      tabs: {
        async sendMessage(_tabId, message, options) {
          assert.equal(message.type, 'natively:project-capture');
          deliveries.push(options.frameId);
          const workspaceId = options.frameId === 0 ? 'workspace-top-frame' : 'workspace-iframe';
          return {
            ok: true,
            projectCapture: {
              project: { workspaceId },
              marker: options.frameId,
            },
          };
        },
      },
    };

    try {
      const response = await sendProjectMessage(
        42,
        { type: 'natively:project-capture', allowEmpty: true },
        undefined,
        'workspace-iframe',
      );
      assert.equal(response.projectCapture.project.workspaceId, 'workspace-iframe');
      assert.equal(response.projectCapture.marker, 17);
      assert.deepEqual(deliveries, [0, 17]);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  test('capture rejects when no frame owns the selected workspace', async () => {
    const previousChrome = globalThis.chrome;
    globalThis.chrome = {
      scripting: {
        async executeScript() {
          return [{ frameId: 0 }, { frameId: 17 }];
        },
      },
      tabs: {
        async sendMessage(_tabId, _message, options) {
          return {
            ok: true,
            projectCapture: { project: { workspaceId: `workspace-${options.frameId}` } },
          };
        },
      },
    };

    try {
      await assert.rejects(
        sendProjectMessage(
          42,
          { type: 'natively:project-capture', allowEmpty: true },
          undefined,
          'workspace-missing',
        ),
        /No page frame exposed the selected workspace \(workspace-missing\)/,
      );
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  test('keeps MAIN-world editor models in their owning iframe', async () => {
    const previousChrome = globalThis.chrome;
    const deliveries = [];
    const iframeFiles = [
      {
        path: 'projects/challenge/src/App.js',
        language: 'javascript',
        charCount: 24,
        revision: 'content-deadbeef',
        readable: true,
      },
      {
        path: 'projects/challenge/package.json',
        language: 'json',
        charCount: 24,
        revision: 'content-feedface',
        readable: true,
      },
    ];
    const iframeProject = {
      workspaceId: 'workspace-iframe',
      name: 'HackerRank VSCode',
      provider: 'loaded-editor-models',
      files: iframeFiles,
      warnings: [],
      estimatedChars: 48,
    };

    globalThis.chrome = {
      scripting: {
        async executeScript(details) {
          if (details.world === 'MAIN') {
            return [
              { frameId: 0, result: [] },
              { frameId: 17, result: iframeFiles },
            ];
          }
          if (details.target?.allFrames) return [{ frameId: 0 }, { frameId: 17 }];
          return [{ frameId: 0 }];
        },
      },
      tabs: {
        async sendMessage(_tabId, message, options) {
          if (message.type === 'natively:smart-extract') {
            return { ok: true, smart: { blocked: false } };
          }
          assert.equal(message.type, 'natively:project-discover');
          deliveries.push({
            frameId: options.frameId,
            identityFrameId: message.pageIdentity?.frameId,
            externalFiles: message.externalFiles,
          });
          if (options.frameId === 0) {
            // This deliberately models the old failure: if iframe models leak
            // into this message, the top frame can form a project and wins the
            // service worker's first-success traversal.
            return {
              ok: true,
              project: message.externalFiles.length
                ? { ...iframeProject, workspaceId: 'workspace-stolen-by-top' }
                : null,
            };
          }
          return { ok: true, project: iframeProject };
        },
      },
    };

    try {
      const discovery = await discoverProjectFromTab({
        id: 42,
        url: 'https://www.hackerrank.com/challenges/item-list/problem',
        title: 'Item List Manager | HackerRank',
      });
      assert.equal(discovery.project.workspaceId, 'workspace-iframe');
      assert.deepEqual(discovery.ownerTarget, { frameId: 17 });
      assert.deepEqual(deliveries, [
        { frameId: 0, identityFrameId: 0, externalFiles: [] },
        { frameId: 17, identityFrameId: 17, externalFiles: iframeFiles },
      ]);
    } finally {
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  });

  test('identifies an inaccessible HackerRank IDE iframe by origin only', () => {
    const previousDocument = globalThis.document;
    const previousLocation = globalThis.location;
    const frame = fakeElement({
      attrs: { src: 'https://candidate-assets.hrcdn.net/ide/index.html?attempt=secret' },
      contentDocument: null,
    });
    globalThis.document = fakeDocument({ 'iframe[src]': [frame] });
    globalThis.location = {
      href: 'https://www.hackerrank.com/challenges/project/problem',
    };
    try {
      assert.deepEqual(findProjectIframePermissionCandidatesInPage(), [
        'https://candidate-assets.hrcdn.net/*',
      ]);
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousLocation === undefined) delete globalThis.location;
      else globalThis.location = previousLocation;
    }
  });

  test('passes bounded top-frame problem text to the project-owning frame', () => {
    const serviceWorkerSource = fs.readFileSync(path.resolve(__dirname, '../service-worker.ts'), 'utf8');
    const contentScriptSource = fs.readFileSync(path.resolve(__dirname, '../content-script.ts'), 'utf8');

    assert.match(serviceWorkerSource, /topFrame\.text\.slice\(0, 5_000\)/);
    assert.match(serviceWorkerSource, /externalFiles:\s*\[\],[\s\S]{0,200}problemStatement,[\s\S]{0,100}\}, externalFilesByTarget, workspaceId, ownerTarget\)/);
    assert.match(contentScriptSource, /typeof message\.problemStatement === 'string'[\s\S]{0,120}: runExtraction\(\)\.text/);
  });

  test('passes a token-free top-tab identity into embedded project frames', () => {
    const identity = projectPageIdentityForTab({
      title: 'Item List Manager | HackerRank',
      url: 'https://www.hackerrank.com/challenges/item-list/problem?attempt=secret&workspaceId=abc-123#token',
    });
    assert.equal(identity.title, 'Item List Manager | HackerRank');
    assert.equal(identity.host, 'www.hackerrank.com');
    assert.match(identity.url, /^https:\/\/hackerrank\.com\/challenges\/item-list\/problem\?workspaceid=h-[0-9a-f]{8}$/);
    assert.doesNotMatch(identity.url, /secret|abc-123|token/);
    assert.deepEqual({ title: identity.title, host: identity.host }, {
      title: 'Item List Manager | HackerRank',
      host: 'www.hackerrank.com',
    });
  });

  test('maps a missing embedded-frame permission to that frame, not the top page', () => {
    const outcome = permissionFailureForTab(
      { url: 'https://www.hackerrank.com/challenges/project/problem' },
      new Error('Cannot access contents of url "https://candidate-assets.hrcdn.net/ide/index.html". Extension manifest must request permission to access this host.'),
    );
    assert.equal(outcome.kind, 'needs-host-permission');
    assert.equal(outcome.origin, 'https://candidate-assets.hrcdn.net/*');
    assert.match(outcome.message, /project editor iframe/i);
  });
});

describe('effectiveProjectSelection', () => {
  const file = (path, readable = true, reason) => ({
    path,
    readable,
    reason,
    charCount: readable ? 10 : 0,
    revision: `revision:${path}`,
  });
  const project = (files) => ({
    workspaceId: 'workspace-project',
    name: 'Project',
    provider: 'loaded-editor-models',
    files,
    warnings: [],
    estimatedChars: 0,
  });
  const snapshotFile = (path, status = 'included') => ({
    path,
    status,
    charCount: 10,
    revision: `revision:${path}`,
    ...(status === 'included' || status === 'unchanged' ? { content: `content:${path}` } : {}),
  });

  test('adds unreadable and ignored descriptors for explicit omission disclosure', () => {
    const selected = effectiveProjectSelection(
      project([
        file('src/App.ts'),
        file('src/closed.ts', false, 'file content is not readable'),
        file('.env.production', false, 'ignored known secret-bearing environment file'),
      ]),
      ['src/App.ts'],
      null,
      false,
    );

    assert.deepEqual(selected, [
      'src/App.ts',
      'src/closed.ts',
      '.env.production',
    ]);
  });

  test('a whole-project refresh automatically includes newly discovered readable files', () => {
    const previous = {
      selectedPaths: ['src/App.ts', '.env.production'],
      files: [
        snapshotFile('src/App.ts'),
        snapshotFile('.env.production', 'ignored'),
      ],
      totalFileCount: 2,
      wholeProjectSelected: true,
    };
    const selected = effectiveProjectSelection(
      project([
        file('src/App.ts'),
        file('src/new.ts'),
        file('.env.production', false, 'ignored known secret-bearing environment file'),
      ]),
      ['src/App.ts'],
      previous,
      true,
    );

    assert.deepEqual(selected, [
      'src/App.ts',
      '.env.production',
      'src/new.ts',
    ]);
  });

  test('a prior subset stays a subset when new readable files appear', () => {
    const previous = {
      selectedPaths: ['src/App.ts'],
      files: [snapshotFile('src/App.ts')],
      totalFileCount: 2,
      wholeProjectSelected: false,
    };
    const selected = effectiveProjectSelection(
      project([
        file('src/App.ts'),
        file('src/existing-unselected.ts'),
        file('src/new.ts'),
      ]),
      ['src/App.ts'],
      previous,
      true,
    );

    assert.deepEqual(selected, ['src/App.ts']);
  });

  test('deselecting a previously captured file prevents whole-project auto-expansion', () => {
    const previous = {
      selectedPaths: ['src/App.ts', 'src/util.ts'],
      files: [
        snapshotFile('src/App.ts'),
        snapshotFile('src/util.ts'),
      ],
      totalFileCount: 2,
      wholeProjectSelected: true,
    };
    const selected = effectiveProjectSelection(
      project([
        file('src/App.ts'),
        file('src/util.ts'),
        file('src/new.ts'),
      ]),
      ['src/App.ts'],
      previous,
      true,
    );

    assert.deepEqual(selected, ['src/App.ts']);
  });
});

// 2026-08-18: hotkey capture on an ungranted site used to dead-end (desktop
// falls back to a screenshot; the grant needs a user gesture the hotkey can't
// provide). The SW now nudges via the toolbar badge — pin the pure mapping.
describe('badgeForCaptureOutcome', () => {
  test('needs-host-permission → badge with a grant call-to-action', async () => {
    const { badgeForCaptureOutcome } = await import(pathToFileURL(modPath).href);
    const b = badgeForCaptureOutcome('needs-host-permission');
    assert.ok(b);
    assert.equal(b.text, '!');
    assert.match(b.title, /Capture once/i);
  });

  test('non-user-fixable outcomes get no badge', async () => {
    const { badgeForCaptureOutcome } = await import(pathToFileURL(modPath).href);
    for (const kind of ['success', 'error', 'unauthorized', 'no-session', 'timeout']) {
      assert.equal(badgeForCaptureOutcome(kind), null, kind);
    }
  });
});
