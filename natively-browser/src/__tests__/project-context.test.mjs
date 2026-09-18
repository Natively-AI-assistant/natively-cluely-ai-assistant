import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectContext = await import(
  pathToFileURL(path.resolve(__dirname, '../../dist-test/capture/project-context.js')).href
);

const {
  PROJECT_CONTEXT_MAX_CHARS,
  PROJECT_FILE_MAX_CHARS,
  PROJECT_CONTEXT_PROVIDERS,
  normalizeProjectPath,
  languageForPath,
  discoverProject,
  assembleProjectContext,
} = projectContext;

function fakeElement({ attrs = {}, text = '', value, className = '', childrenBySelector = {}, safety } = {}) {
  const element = {
    attrs: { ...attrs },
    className,
    textContent: text,
    value,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    querySelectorAll(selector) {
      return childrenBySelector[selector] || [];
    },
    click() { if (safety) safety.click += 1; },
    focus() { if (safety) safety.focus += 1; },
    blur() { if (safety) safety.blur += 1; },
    dispatchEvent() { if (safety) safety.dispatch += 1; return true; },
    setAttribute(name, next) {
      if (safety) safety.write += 1;
      this.attrs[name] = next;
    },
    appendChild() { if (safety) safety.write += 1; },
    remove() { if (safety) safety.write += 1; },
  };
  return element;
}

function fakeDocument(selectorMap = {}, title = 'Workspace') {
  return {
    title,
    querySelectorAll(selector) {
      return selectorMap[selector] || [];
    },
  };
}

function externalDocument() {
  return fakeDocument({}, 'Challenge Workspace');
}

const page = {
  host: 'www.hackerrank.com',
  url: 'https://www.hackerrank.com/challenges/acme-project?token=secret',
  title: 'Acme Project - HackerRank',
};

describe('project context path and language normalization', () => {
  test('normalizes URI, Windows, dot, and traversal segments into relative paths', () => {
    assert.equal(normalizeProjectPath('file:///workspace/src/main/App.java?x=1#L2'), 'workspace/src/main/App.java');
    assert.equal(normalizeProjectPath('C:\\repo\\src\\.\\ui\\..\\App.tsx'), 'repo/src/App.tsx');
    assert.equal(normalizeProjectPath('./src//hooks/useThing.ts'), 'src/hooks/useThing.ts');
  });

  test('derives stable language labels without reading content', () => {
    assert.equal(languageForPath('src/main/UserController.java'), 'java');
    assert.equal(languageForPath('src/App.tsx'), 'typescript');
    assert.equal(languageForPath('config/application.yml'), 'yaml');
    assert.equal(languageForPath('assets/logo.png'), undefined);
    assert.equal(languageForPath('build.gradle'), 'gradle');
    assert.equal(languageForPath('go.mod'), 'go.mod');
    assert.equal(languageForPath('Gemfile'), 'ruby');
  });

  test('exports providers in conservative priority order', () => {
    assert.deepEqual(
      PROJECT_CONTEXT_PROVIDERS.map((provider) => provider.id),
      ['loaded-editor-models', 'cooperative-dom', 'visible-file-tree'],
    );
  });
});

describe('external Monaco-model discovery and Spring project assembly', () => {
  const springFiles = [
    {
      path: 'src/main/java/com/acme/UserController.java',
      language: 'java',
      content: 'package com.acme;\nclass UserController { UserService service; }',
    },
    // Duplicate unreadable tree record must not replace the readable model.
    {
      path: 'src/main/java/com/acme/UserController.java',
      readable: false,
      reason: 'tree entry only',
    },
    {
      path: 'src/main/java/com/acme/UserService.java',
      content: 'package com.acme;\nclass UserService { User find(long id) { return null; } }',
    },
    {
      path: 'src/main/java/com/acme/User.java',
      content: 'package com.acme;\nrecord User(long id, String name) {}',
    },
    {
      path: 'src/main/resources/application.yml',
      content: 'spring:\n  datasource:\n    url: jdbc:h2:mem:test',
    },
    {
      path: 'src/test/java/com/acme/UserControllerTest.java',
      content: 'class UserControllerTest { /* integration contract */ }',
    },
    { path: 'target/classes/com/acme/User.class', content: 'not really source' },
    { path: 'assets/logo.png', content: 'binary-looking data' },
  ];

  test('discovers, deduplicates, orders, hashes, and discloses ignored files', () => {
    const project = discoverProject(externalDocument(), page, springFiles);
    assert.ok(project);
    assert.equal(project.provider, 'loaded-editor-models');
    assert.equal(project.files.filter((file) => file.path.endsWith('UserController.java')).length, 1);
    assert.match(project.files.find((file) => file.path.endsWith('UserController.java')).content, /UserService/);
    assert.deepEqual(
      project.files.map((file) => file.path),
      [...project.files.map((file) => file.path)].sort((a, b) => a.localeCompare(b)),
    );
    assert.ok(project.files.every((file) => /^[\w.-]+$/.test(file.revision)));
    assert.equal(project.files.find((file) => file.path.startsWith('target/')).readable, false);
    assert.match(project.files.find((file) => file.path.endsWith('.png')).reason, /binary/i);
    assert.ok(project.warnings.some((warning) => /ignored/i.test(warning)));

    // URL query tokens do not affect stable workspace identity.
    const second = discoverProject(externalDocument(), { ...page, url: `${page.url}&again=1` }, springFiles);
    assert.equal(second.workspaceId, project.workspaceId);
    const activeFileTitle = discoverProject(externalDocument(), { ...page, title: 'UserService.java - HackerRank' }, springFiles);
    assert.equal(activeFileTitle.workspaceId, project.workspaceId);

    const otherWorkspace = discoverProject(
      externalDocument(),
      { ...page, url: 'https://ide.example/workbench?workspaceId=another-project' },
      springFiles,
    );
    const firstWorkspace = discoverProject(
      externalDocument(),
      { ...page, url: 'https://ide.example/workbench?workspaceId=first-project' },
      springFiles,
    );
    assert.notEqual(firstWorkspace.workspaceId, otherWorkspace.workspaceId);

    // Sibling editor frames can share the same top-tab identity and project
    // root. Their frame-scoped workspace ids prevent capture from switching to
    // a weaker sibling after discovery selected the stronger provider.
    const firstFrame = discoverProject(externalDocument(), { ...page, frameId: 31 }, springFiles);
    const secondFrame = discoverProject(externalDocument(), { ...page, frameId: 32 }, springFiles);
    assert.notEqual(firstFrame.workspaceId, secondFrame.workspaceId);

    // Chrome may reuse a frame id after navigation. Its document id must keep
    // a freshly loaded document from inheriting the previous page's workspace.
    const firstDocument = discoverProject(
      externalDocument(),
      { ...page, frameId: 31, documentId: 'document-before-navigation' },
      springFiles,
    );
    const expandedFirstDocument = discoverProject(
      externalDocument(),
      { ...page, frameId: 31, documentId: 'document-before-navigation' },
      [...springFiles, { path: 'docs/architecture.md', content: '# Architecture' }],
    );
    const secondDocument = discoverProject(
      externalDocument(),
      { ...page, frameId: 31, documentId: 'document-after-navigation' },
      springFiles,
    );
    assert.equal(
      firstDocument.workspaceId,
      expandedFirstDocument.workspaceId,
      'newly discovered directories must not change workspace identity',
    );
    assert.notEqual(firstDocument.workspaceId, secondDocument.workspaceId);
  });

  test('selects exact files and folder prefixes while retaining exact file boundaries', () => {
    const project = discoverProject(externalDocument(), page, springFiles);
    const result = assembleProjectContext(project, {
      contextId: 'ctx-spring',
      capturedAt: 1234,
      selectedPaths: ['src/main/java/com/acme', 'src/main/resources/application.yml'],
      problemStatement: 'Fix the controller/service contract and configuration.',
    });

    const paths = result.envelope.payload.files.map((file) => file.path);
    assert.ok(paths.includes('src/main/java/com/acme/UserController.java'));
    assert.ok(paths.includes('src/main/java/com/acme/UserService.java'));
    assert.ok(paths.includes('src/main/resources/application.yml'));
    assert.ok(!paths.some((filePath) => filePath.startsWith('src/test/')));
    assert.match(result.dom, /PROBLEM_STATEMENT:\nFix the controller\/service contract/);
    assert.match(result.dom, /PROJECT_MANIFEST:/);
    assert.match(result.dom, /--- FILE: src\/main\/java\/com\/acme\/UserController\.java ---/);
    assert.match(result.dom, /--- END FILE: src\/main\/java\/com\/acme\/UserController\.java ---/);
    assert.equal(result.envelope.category, 'coding_project');
    assert.equal(result.envelope.captureMode, 'manual');
    assert.equal(result.envelope.meta.extractionSource, 'editor-dom');
    assert.equal(result.envelope.payload.refreshMode, 'full');
  });

  test('keeps descriptor-only Monaco models selectable without pretending to have content', () => {
    const project = discoverProject(externalDocument(), page, [
      { path: 'src/A.java', language: 'java', readable: true, charCount: 120, revision: 'a1' },
      { path: 'src/B.java', language: 'java', readable: true, charCount: 80, revision: 'b1' },
    ]);
    assert.ok(project);
    assert.equal(project.files[0].readable, true);
    assert.equal(project.files[0].charCount, 120);
    assert.equal(project.files[0].content, undefined);
  });

  test('still prefers a readable editor model over an earlier unreadable model for the same path', () => {
    const project = discoverProject(externalDocument(), page, [
      { path: 'src/App.ts', readable: false, reason: 'virtualized viewport only' },
      { path: 'src/App.ts', content: 'export const app = true;' },
      { path: 'src/other.ts', content: 'export const other = true;' },
    ]);

    const app = project.files.find((file) => file.path === 'src/App.ts');
    assert.equal(app.readable, true);
    assert.equal(app.content, 'export const app = true;');
  });

  test('keeps common Gradle, Go, Python, Ruby, and environment config files discoverable', () => {
    const configFiles = [
      'build.gradle', 'go.mod', 'requirements.txt', '.env', 'Gemfile', 'CMakeLists.txt',
    ].map((filePath) => ({ path: filePath, content: `content for ${filePath}` }));
    const project = discoverProject(externalDocument(), page, configFiles);

    assert.ok(project);
    assert.deepEqual(project.files.map((file) => file.path),
      ['.env', 'CMakeLists.txt', 'Gemfile', 'build.gradle', 'go.mod', 'requirements.txt']);
    const environment = project.files.find((file) => file.path === '.env');
    assert.equal(environment.readable, false);
    assert.equal(environment.content, undefined);
    assert.match(environment.reason, /secret-bearing environment/i);
  });

  test('excludes known secret files by default while retaining explicit templates', () => {
    const project = discoverProject(externalDocument(), page, [
      { path: '.env.local', content: 'API_TOKEN=never-include-this' },
      { path: '.env.example', content: 'API_TOKEN=replace-me' },
      { path: 'config/production.env', content: 'API_TOKEN=never-include-this' },
      { path: 'config/sample.env', content: 'API_TOKEN=replace-me' },
      { path: 'config/credentials.json', content: '{"private_key":"never-include-this"}' },
      { path: 'home/user/.docker/config.json', content: '{"auths":{"registry":"never-include-this"}}' },
      { path: 'composer/auth.json', content: '{"github-oauth":{"github.com":"never-include-this"}}' },
      { path: 'oauth/token.json', content: '{"access_token":"never-include-this"}' },
      { path: 'composer/auth.example.json', content: '{"github-oauth":{"github.com":"replace-me"}}' },
      { path: 'oauth/token.sample.json', content: '{"access_token":"replace-me"}' },
      { path: 'src/index.ts', content: 'export const ready = true;' },
    ]);

    assert.ok(project);
    for (const secretPath of [
      '.env.local',
      'config/production.env',
      'config/credentials.json',
      'home/user/.docker/config.json',
      'composer/auth.json',
      'oauth/token.json',
    ]) {
      const secret = project.files.find((file) => file.path === secretPath);
      assert.equal(secret.readable, false);
      assert.equal(secret.content, undefined);
      assert.match(secret.reason, /secret|credential/i);
    }
    assert.equal(project.files.find((file) => file.path === '.env.example').readable, true);
    assert.equal(project.files.find((file) => file.path === 'config/sample.env').readable, true);
    assert.equal(project.files.find((file) => file.path === 'composer/auth.example.json').readable, true);
    assert.equal(project.files.find((file) => file.path === 'oauth/token.sample.json').readable, true);
  });

  test('does not dereference lazy editor bodies for path-qualified credential files', () => {
    let bodyReads = 0;
    const secrets = [
      'home/user/.docker/config.json',
      'composer/auth.json',
      'oauth/token.json',
      'config/production.env',
    ].map((filePath) => {
      const file = { path: filePath };
      Object.defineProperty(file, 'content', {
        enumerable: true,
        get() {
          bodyReads += 1;
          return 'must-never-be-read';
        },
      });
      return file;
    });

    const project = discoverProject(externalDocument(), page, [
      ...secrets,
      { path: 'src/index.ts', content: 'export const ready = true;' },
      { path: 'src/other.ts', content: 'export const other = true;' },
    ]);

    assert.ok(project);
    assert.equal(bodyReads, 0);
    assert.ok(secrets.every(({ path: filePath }) => {
      const file = project.files.find((candidate) => candidate.path === filePath);
      return file?.readable === false && file.content === undefined;
    }));
  });
});

describe('cooperative React workspace provider', () => {
  test('captures explicit data attributes and supports directory selection', () => {
    const nodes = [
      fakeElement({
        attrs: {
          'data-natively-file-path': 'src/components/Profile.tsx',
          'data-natively-language': 'typescript',
          'data-natively-file-content': 'export function Profile() { return <Avatar />; }',
        },
      }),
      fakeElement({
        attrs: {
          'data-natively-file-path': 'src/hooks/useProfile.ts',
          'data-natively-file-content': 'export const useProfile = () => fetchProfile();',
        },
      }),
      fakeElement({
        attrs: {
          'data-natively-file-path': 'src/api/profile.ts',
          'data-natively-file-content': 'export async function fetchProfile() { return fetch("/api/profile"); }',
        },
      }),
      fakeElement({
        attrs: {
          'data-natively-file-path': 'src/components/Profile.test.tsx',
          'data-natively-file-content': 'test("renders profile", () => {});',
        },
      }),
    ];
    const doc = fakeDocument({ '[data-natively-file-path]': nodes }, 'React Challenge');
    const project = discoverProject(doc, { host: 'codesandbox.io', url: 'https://codesandbox.io/p/sandbox/x', title: doc.title });
    assert.ok(project);
    assert.equal(project.provider, 'cooperative-dom');
    assert.equal(project.files.length, 4);

    const result = assembleProjectContext(project, {
      contextId: 'ctx-react',
      capturedAt: 2000,
      selectedPaths: ['src/components'],
    });
    assert.deepEqual(
      result.envelope.payload.files.map((file) => file.path),
      ['src/components/Profile.test.tsx', 'src/components/Profile.tsx'],
    );
    assert.ok(result.envelope.payload.files.every((file) => file.language === 'typescript'));
  });

  test('does not mistake path-tagged tab labels for file contents', () => {
    const nodes = [
      fakeElement({ attrs: { 'data-natively-file-path': 'src/App.tsx' }, text: 'App.tsx' }),
      fakeElement({ attrs: { 'data-natively-file-path': 'src/api.ts' }, text: 'api.ts' }),
    ];
    const project = discoverProject(
      fakeDocument({ '[data-natively-file-path]': nodes }),
      { host: 'ide.example', url: 'https://ide.example/project', title: 'Project' },
    );

    assert.ok(project);
    assert.ok(project.files.every((file) => file.readable === false && file.content === undefined));
  });

  test('does not read an explicit cooperative body for a known secret path', () => {
    let contentReads = 0;
    const secretNode = {
      textContent: '',
      getAttribute(name) {
        if (name === 'data-natively-file-path') return '.env.local';
        if (name === 'data-natively-file-content') {
          contentReads += 1;
          return 'API_TOKEN=never-read-this';
        }
        return null;
      },
      querySelectorAll() { return []; },
    };
    const project = discoverProject(
      fakeDocument({ '[data-natively-file-path]': [secretNode] }),
      { host: 'ide.example', url: 'https://ide.example/project', title: 'Project' },
      [{ path: 'src/index.ts', content: 'export const ready = true;' }],
      { minimumFiles: 0 },
    );

    assert.equal(contentReads, 0);
    assert.equal(project.files.find((file) => file.path === '.env.local').readable, false);
  });
});

describe('generic visible file-tree provider', () => {
  test('uses open VS Code tabs as unreadable descriptors when Explorer is not rendered', () => {
    const appLabel = fakeElement({
      attrs: { 'aria-label': '\\projects\\challenge\\src\\App.js' },
      className: 'monaco-icon-label tab-label',
    });
    const packageLabel = fakeElement({
      attrs: { 'aria-label': '\\projects\\challenge\\package.json' },
      className: 'monaco-icon-label tab-label',
    });
    const appTab = fakeElement({
      attrs: { role: 'tab', 'aria-label': 'App.js', 'aria-selected': 'true' },
      childrenBySelector: { '[aria-label]': [appLabel], '.monaco-icon-label': [appLabel] },
    });
    const packageTab = fakeElement({
      attrs: { role: 'tab', 'aria-label': 'package.json', 'aria-selected': 'false' },
      childrenBySelector: { '[aria-label]': [packageLabel], '.monaco-icon-label': [packageLabel] },
    });
    const project = discoverProject(
      fakeDocument({
        '[role="tab"]': [appTab, packageTab],
        '[role="tab"][aria-selected="true"]': [appTab],
      }, 'HackerRank IDE'),
      { host: 'candidate-assets.hrcdn.net', url: 'https://candidate-assets.hrcdn.net/ide', title: 'IDE' },
    );

    assert.ok(project);
    assert.deepEqual(project.files.map((file) => file.path), [
      'projects/challenge/package.json',
      'projects/challenge/src/App.js',
    ]);
    assert.ok(project.files.every((file) => file.readable === false && file.content === undefined));
    assert.ok(!project.files.some((file) => file.path === 'App.js'));
  });

  test('recognizes nested VS Code explorer aria-label paths', () => {
    const packageLabel = fakeElement({ attrs: { 'aria-label': '\\projects\\challenge\\package.json' } });
    const sourceLabel = fakeElement({ attrs: { 'aria-label': '\\projects\\challenge\\src\\index.ts, modified' } });
    const packageRow = fakeElement({
      attrs: { role: 'treeitem' },
      childrenBySelector: { '[aria-label]': [packageLabel] },
    });
    const sourceRow = fakeElement({
      attrs: { role: 'treeitem' },
      childrenBySelector: { '[aria-label]': [sourceLabel] },
    });
    const project = discoverProject(
      fakeDocument({ '[role="treeitem"]': [packageRow, sourceRow] }, 'HackerRank IDE'),
      { host: 'candidate-assets.hrcdn.net', url: 'https://candidate-assets.hrcdn.net/ide', title: 'IDE' },
    );

    assert.ok(project);
    assert.deepEqual(project.files.map((file) => file.path), [
      'projects/challenge/package.json',
      'projects/challenge/src/index.ts',
    ]);
    assert.ok(project.files.every((file) => file.readable === false));
  });

  test('reconciles a basename-only VS Code tab with its unique full explorer path', () => {
    const fullLabel = fakeElement({ attrs: { 'aria-label': '\\projects\\challenge\\PROJECT_FILES_INSTRUCTIONS.md' } });
    const explorerRow = fakeElement({
      attrs: { role: 'treeitem', 'aria-label': 'PROJECT_FILES_INSTRUCTIONS.md' },
      childrenBySelector: { '[aria-label]': [fullLabel] },
    });
    const tabLabel = fakeElement({
      attrs: { 'aria-label': 'PROJECT_FILES_INSTRUCTIONS.md' },
      className: 'monaco-icon-label tab-label',
    });
    const tab = fakeElement({
      attrs: { role: 'tab', 'aria-label': 'PROJECT_FILES_INSTRUCTIONS.md' },
      childrenBySelector: { '[aria-label]': [tabLabel], '.monaco-icon-label': [tabLabel] },
    });
    const otherRow = fakeElement({ attrs: { role: 'treeitem', 'data-path': 'projects/challenge/README.md' } });
    const project = discoverProject(
      fakeDocument({
        '[role="treeitem"]': [explorerRow, otherRow],
        '[role="tab"]': [tab],
        '.tab-label': [tabLabel],
      }, 'HackerRank IDE'),
      { host: 'candidate-assets.hrcdn.net', url: 'https://candidate-assets.hrcdn.net/ide', title: 'IDE' },
    );

    assert.ok(project);
    assert.deepEqual(project.files.map((file) => file.path), [
      'projects/challenge/PROJECT_FILES_INSTRUCTIONS.md',
      'projects/challenge/README.md',
    ]);
  });

  test('re-keys a unique basename editor descriptor to its exact explorer path', () => {
    const exactInstructions = fakeElement({
      attrs: { role: 'treeitem', 'data-path': 'projects/challenge/PROJECT_FILES_INSTRUCTIONS.md' },
    });
    const readme = fakeElement({
      attrs: { role: 'treeitem', 'data-path': 'projects/challenge/README.md' },
    });
    const project = discoverProject(
      fakeDocument({ '[role="treeitem"]': [exactInstructions, readme] }, 'HackerRank IDE'),
      { host: 'candidate-assets.hrcdn.net', url: 'https://candidate-assets.hrcdn.net/ide', title: 'IDE' },
      [{
        path: 'PROJECT_FILES_INSTRUCTIONS.md',
        content: 'Read-only files: src/App.test.js',
      }],
    );

    assert.ok(project);
    assert.equal(project.files.some((file) => file.path === 'PROJECT_FILES_INSTRUCTIONS.md'), false);
    const exact = project.files.find((file) =>
      file.path === 'projects/challenge/PROJECT_FILES_INSTRUCTIONS.md');
    assert.equal(exact.readable, true);
    assert.match(exact.content, /App\.test\.js/);
  });

  test('does not replace an authoritative virtualized descriptor with viewport DOM text', () => {
    const row = fakeElement({ attrs: { role: 'treeitem', 'data-path': 'src/App.ts' } });
    const otherRow = fakeElement({ attrs: { role: 'treeitem', 'data-path': 'src/other.ts' } });
    const activeTab = fakeElement({ attrs: {
      role: 'tab', 'aria-selected': 'true', 'data-path': 'src/App.ts',
    } });
    const editor = fakeElement({ childrenBySelector: {
      '.view-line': [fakeElement({ text: 'only the mounted viewport' })],
    } });
    const document = fakeDocument({
      '[role="treeitem"]': [row, otherRow],
      '[role="tab"][aria-selected="true"]': [activeTab],
      '.monaco-editor': [editor],
    });
    const project = discoverProject(document, page, [
      {
        path: 'src/App.ts',
        charCount: 1_000,
        readable: false,
        reason: 'CodeMirror 6 exposes only a virtualized viewport; the full document is unavailable',
      },
      { path: 'src/other.ts', charCount: 0, readable: false, reason: 'full document is unavailable' },
    ]);

    const app = project.files.find((file) => file.path === 'src/App.ts');
    assert.equal(app.readable, false);
    assert.equal(app.content, undefined);
    assert.match(app.reason, /virtualized viewport/i);
  });

  test('does not mistake a virtualized active-editor viewport for a complete file', () => {
    const controller = fakeElement({ attrs: { role: 'treeitem', 'data-path': 'src/Controller.java' }, text: 'Controller.java' });
    const service = fakeElement({ attrs: { role: 'treeitem', 'data-path': 'src/Service.java' }, text: 'Service.java' });
    const activeTab = fakeElement({ attrs: { role: 'tab', 'aria-selected': 'true', 'data-path': 'src/Controller.java' }, text: 'Controller.java' });
    const lines = [
      fakeElement({ text: 'class Controller {' }),
      fakeElement({ text: '  Service service;' }),
      fakeElement({ text: '}' }),
    ];
    const editor = fakeElement({ childrenBySelector: { '.view-line': lines } });
    const doc = fakeDocument({
      '[role="treeitem"]': [controller, service],
      '[data-path]': [controller, service, activeTab],
      '[role="tab"][aria-selected="true"]': [activeTab],
      '.monaco-editor': [editor],
    }, 'Generic Browser IDE');

    const project = discoverProject(doc, { host: 'ide.example', url: 'https://ide.example/challenge', title: doc.title });
    assert.ok(project);
    assert.equal(project.provider, 'visible-file-tree');
    assert.equal(project.files.find((file) => file.path === 'src/Controller.java').content, undefined);
    assert.equal(project.files.find((file) => file.path === 'src/Controller.java').readable, false);
    assert.equal(project.files.find((file) => file.path === 'src/Service.java').readable, false);
    assert.match(project.files.find((file) => file.path === 'src/Service.java').reason, /unopened|virtualized/);
  });

  test('does not concatenate ambiguous split editors into the active file', () => {
    const active = fakeElement({ attrs: { role: 'tab', 'aria-selected': 'true', 'data-path': 'src/A.ts' } });
    const files = [
      fakeElement({ attrs: { role: 'treeitem', 'data-path': 'src/A.ts' } }),
      fakeElement({ attrs: { role: 'treeitem', 'data-path': 'src/B.ts' } }),
    ];
    const editors = [
      fakeElement({ childrenBySelector: { '.view-line': [fakeElement({ text: 'const a = 1;' })] } }),
      fakeElement({ childrenBySelector: { '.view-line': [fakeElement({ text: 'const b = 2;' })] } }),
    ];
    const project = discoverProject(fakeDocument({
      '[role="treeitem"]': files,
      '[data-path]': [...files, active],
      '[role="tab"][aria-selected="true"]': [active],
      '.monaco-editor': editors,
    }), { host: 'ide.example', url: 'https://ide.example/split', title: 'Split' });

    assert.ok(project);
    assert.equal(project.files.find((file) => file.path === 'src/A.ts').readable, false);
    assert.ok(!project.files.some((file) => /const [ab]/.test(file.content || '')));
  });
});

describe('deterministic budgets, truncation, and omissions', () => {
  test('caps each file and the complete legacy DOM with explicit records', () => {
    const hugeFiles = Array.from({ length: 5 }, (_, index) => ({
      path: `src/feature${index}.ts`,
      content: `export const feature${index} = "${'x'.repeat(9_000)}";`,
    }));
    hugeFiles.push({ path: 'node_modules/pkg/index.js', content: 'ignored dependency' });
    const project = discoverProject(externalDocument(), page, hugeFiles);
    const result = assembleProjectContext(project, {
      contextId: 'ctx-budget',
      capturedAt: 3000,
      selectedPaths: [],
      problemStatement: 'Solve the multi-file bug. '.repeat(600),
    });

    assert.ok(PROJECT_FILE_MAX_CHARS <= 7_000);
    assert.ok(PROJECT_CONTEXT_MAX_CHARS <= 22_000);
    assert.ok(result.dom.length <= PROJECT_CONTEXT_MAX_CHARS);
    assert.equal(result.envelope.payload.usedChars, result.dom.length);
    assert.ok(result.envelope.payload.files.every((file) => !file.content || file.content.length <= PROJECT_FILE_MAX_CHARS + 60));
    assert.ok(result.envelope.payload.files.some((file) => file.status === 'truncated'));
    assert.ok(result.envelope.payload.files.some((file) => file.status === 'ignored'));
    assert.ok(result.envelope.payload.omitted.some((entry) => /truncated|budget/i.test(entry.reason)));
    assert.ok(result.envelope.payload.omitted.some((entry) => /dependency|build/i.test(entry.reason)));
    assert.match(result.dom, /OMITTED_OR_TRUNCATED_FILES:/);
  });

  test('keeps an empty readable file as included context', () => {
    const project = discoverProject(externalDocument(), page, [
      { path: 'src/empty.ts', content: '', revision: 'empty-r1' },
      { path: 'src/helper.ts', content: 'export const helper = 1;', revision: 'helper-r1' },
    ]);
    const result = assembleProjectContext(project, {
      contextId: 'ctx-empty', capturedAt: 1, selectedPaths: ['src/empty.ts'],
    });
    const file = result.envelope.payload.files[0];

    assert.equal(file.content, '');
    assert.equal(file.status, 'included');
    assert.equal(result.envelope.payload.capturedFileCount, 1);
    assert.deepEqual(result.envelope.payload.omitted, []);
    assert.match(result.dom, /--- FILE: src\/empty\.ts ---[\s\S]*--- END FILE: src\/empty\.ts ---/);
  });
});

describe('changed-file refresh semantics', () => {
  const initialExternal = [
    { path: 'src/App.tsx', content: 'export const App = () => <Panel />;', revision: 'app-r1' },
    { path: 'src/Panel.tsx', content: 'export const Panel = () => <div>old</div>;', revision: 'panel-r1' },
    { path: 'src/types.ts', content: 'export type PanelProps = { title: string };', revision: 'types-r1' },
  ];

  test('merges previous unchanged files around a changed-only discovery snapshot', () => {
    const initialProject = discoverProject(externalDocument(), page, initialExternal);
    const initial = assembleProjectContext(initialProject, {
      contextId: 'ctx-initial',
      capturedAt: 4000,
      selectedPaths: ['src'],
    });

    // Providers may report only the models refreshed on this pass. The assembler
    // restores the rest from the prior selected snapshot.
    const changedOnly = {
      ...initialProject,
      files: [{
        path: 'src/Panel.tsx',
        language: 'typescript',
        content: 'export const Panel = () => <div>new</div>;',
        charCount: 43,
        revision: 'panel-r2',
        readable: true,
      }],
      estimatedChars: 43,
    };
    const refreshed = assembleProjectContext(changedOnly, {
      contextId: 'ctx-refresh',
      baseContextId: 'ctx-initial',
      capturedAt: 5000,
      selectedPaths: ['src'],
      refresh: true,
      previousFiles: initial.envelope.payload.files,
    });

    assert.equal(refreshed.unchanged, false);
    assert.equal(refreshed.envelope.payload.refreshMode, 'changed');
    assert.equal(refreshed.envelope.payload.baseContextId, 'ctx-initial');
    assert.equal(refreshed.envelope.payload.files.find((file) => file.path === 'src/Panel.tsx').status, 'included');
    assert.equal(refreshed.envelope.payload.files.find((file) => file.path === 'src/App.tsx').status, 'unchanged');
    assert.equal(refreshed.envelope.payload.files.find((file) => file.path === 'src/types.ts').status, 'unchanged');
    assert.match(refreshed.dom, /<div>new<\/div>/);
    assert.match(refreshed.dom, /PanelProps/);
  });

  test('reports unchanged when a refresh contains no new revision', () => {
    const initialProject = discoverProject(externalDocument(), page, initialExternal);
    const initial = assembleProjectContext(initialProject, {
      contextId: 'ctx-initial', capturedAt: 1, selectedPaths: ['src'],
    });
    const same = assembleProjectContext(initialProject, {
      contextId: 'ctx-same',
      baseContextId: 'ctx-initial',
      capturedAt: 2,
      selectedPaths: ['src'],
      refresh: true,
      previousFiles: initial.envelope.payload.files,
    });
    assert.equal(same.unchanged, true);
    assert.ok(same.envelope.payload.files.every((file) => file.status === 'unchanged'));
  });

  test('treats a changed file selection as a refresh update', () => {
    const initialProject = discoverProject(externalDocument(), page, initialExternal);
    const initial = assembleProjectContext(initialProject, {
      contextId: 'ctx-selection-initial',
      capturedAt: 1,
      selectedPaths: ['src/App.tsx', 'src/Panel.tsx'],
    });
    const refreshed = assembleProjectContext(initialProject, {
      contextId: 'ctx-selection-refresh',
      capturedAt: 2,
      selectedPaths: ['src/App.tsx'],
      previousSelectedPaths: initial.envelope.payload.selectedPaths,
      refresh: true,
      previousFiles: initial.envelope.payload.files,
    });

    assert.equal(refreshed.unchanged, false);
    assert.deepEqual(refreshed.envelope.payload.selectedPaths, ['src/App.tsx']);
    assert.deepEqual(refreshed.envelope.payload.files.map((file) => file.path), ['src/App.tsx']);
  });

  test('preserves truncation disclosure when an unchanged revision is reused', () => {
    const external = [
      { path: 'src/large.ts', content: 'x'.repeat(PROJECT_FILE_MAX_CHARS + 500), revision: 'large-r1' },
      { path: 'src/helper.ts', content: 'export const helper = true;', revision: 'helper-r1' },
    ];
    const initialProject = discoverProject(externalDocument(), page, external);
    const initial = assembleProjectContext(initialProject, {
      contextId: 'ctx-truncated-initial', capturedAt: 1, selectedPaths: ['src/large.ts'],
    });
    const descriptorOnly = {
      ...initialProject,
      files: initialProject.files.map((file) => ({ ...file, content: undefined })),
    };
    const refreshed = assembleProjectContext(descriptorOnly, {
      contextId: 'ctx-truncated-refresh', capturedAt: 2, selectedPaths: ['src/large.ts'],
      previousSelectedPaths: initial.envelope.payload.selectedPaths,
      refresh: true,
      previousFiles: initial.envelope.payload.files,
    });
    const file = refreshed.envelope.payload.files[0];

    assert.equal(refreshed.unchanged, true);
    assert.equal(file.status, 'truncated');
    assert.match(file.reason, /truncated/i);
    assert.ok(refreshed.envelope.payload.omitted.some((entry) =>
      entry.path === 'src/large.ts' && /truncated/i.test(entry.reason)));
  });

  test('reconsiders a previously budget-truncated file when the selection shrinks', () => {
    const external = ['a', 'b', 'c', 'd'].map((name) => ({
      path: `src/${name}.ts`,
      content: `${name}:${'x'.repeat(5_900)}`,
      revision: `${name}-r1`,
    }));
    const project = discoverProject(externalDocument(), page, external);
    const initial = assembleProjectContext(project, {
      contextId: 'ctx-budget-initial', capturedAt: 1,
      selectedPaths: external.map((file) => file.path),
    });
    const truncated = initial.envelope.payload.files.find((file) => file.status === 'truncated');
    assert.ok(truncated, 'fixture should exhaust the total project budget');

    const refreshed = assembleProjectContext(project, {
      contextId: 'ctx-budget-refresh', capturedAt: 2,
      selectedPaths: [truncated.path],
      previousSelectedPaths: initial.envelope.payload.selectedPaths,
      refresh: true,
      previousFiles: initial.envelope.payload.files,
    });
    const restored = refreshed.envelope.payload.files[0];

    assert.equal(refreshed.unchanged, false);
    assert.equal(restored.path, truncated.path);
    assert.equal(restored.status, 'included');
    assert.equal(restored.content, external.find((file) => file.path === truncated.path).content);
    assert.ok(!refreshed.envelope.payload.omitted.some((entry) => entry.path === truncated.path));
  });

  test('discloses an exactly selected file removed since the prior capture', () => {
    const initialProject = discoverProject(externalDocument(), page, initialExternal);
    const initial = assembleProjectContext(initialProject, {
      contextId: 'ctx-initial', capturedAt: 1, selectedPaths: ['src/Panel.tsx'],
    });
    const withoutPanel = {
      ...initialProject,
      files: initialProject.files.filter((file) => file.path !== 'src/Panel.tsx'),
    };
    const refreshed = assembleProjectContext(withoutPanel, {
      contextId: 'ctx-removed',
      capturedAt: 2,
      selectedPaths: ['src/Panel.tsx'],
      refresh: true,
      previousFiles: initial.envelope.payload.files,
    });
    const removed = refreshed.envelope.payload.files.find((file) => file.path === 'src/Panel.tsx');
    assert.equal(refreshed.unchanged, false);
    assert.equal(removed.status, 'removed');
    assert.equal(removed.content, undefined);
    assert.match(removed.reason, /no longer exposed/);
    assert.ok(refreshed.envelope.payload.omitted.some((entry) => entry.path === 'src/Panel.tsx'));
  });

  test('an unreadable file with a changed revision makes refresh non-unchanged', () => {
    const initialProject = discoverProject(externalDocument(), page, initialExternal);
    const initial = assembleProjectContext(initialProject, {
      contextId: 'ctx-initial', capturedAt: 1, selectedPaths: ['src'],
    });
    const inaccessible = {
      ...initialProject,
      files: [{
        path: 'src/Panel.tsx', language: 'typescript', charCount: 0,
        revision: 'panel-r2', readable: false, reason: 'model became inaccessible',
      }],
    };
    const refreshed = assembleProjectContext(inaccessible, {
      contextId: 'ctx-inaccessible', capturedAt: 2, selectedPaths: ['src'], refresh: true,
      previousFiles: initial.envelope.payload.files,
    });
    assert.equal(refreshed.unchanged, false);
    assert.equal(refreshed.envelope.payload.files.find((file) => file.path === 'src/Panel.tsx').status, 'unreadable');
  });
});

describe('capture safety and single-file fallback', () => {
  test('does not click, focus, dispatch, submit, or mutate host DOM', () => {
    const safety = { click: 0, focus: 0, blur: 0, dispatch: 0, write: 0 };
    const nodes = [
      fakeElement({ attrs: {
        'data-natively-file-path': 'src/a.ts',
        'data-natively-file-content': 'export const a = 1;',
      }, safety }),
      fakeElement({ attrs: {
        'data-natively-file-path': 'src/b.ts',
        'data-natively-file-content': 'export const b = 2;',
      }, safety }),
    ];
    const doc = fakeDocument({ '[data-natively-file-path]': nodes }, 'Safe Workspace');
    const before = JSON.stringify(nodes.map((node) => ({ attrs: node.attrs, text: node.textContent })));

    const project = discoverProject(doc, { host: 'safe.example', url: 'https://safe.example/ide', title: doc.title });
    assembleProjectContext(project, { contextId: 'ctx-safe', capturedAt: 1, selectedPaths: [] });

    assert.deepEqual(safety, { click: 0, focus: 0, blur: 0, dispatch: 0, write: 0 });
    assert.equal(JSON.stringify(nodes.map((node) => ({ attrs: node.attrs, text: node.textContent }))), before);
  });

  test('returns null for unsupported and single-file pages', () => {
    assert.equal(discoverProject(fakeDocument({}, 'Article'), { host: 'example.com', url: 'https://example.com', title: 'Article' }), null);
    assert.equal(discoverProject(externalDocument(), page, [{ path: 'main.py', content: 'print("hello")' }]), null);
  });

  test('allows an existing project refresh to report every selected file removed', () => {
    const initialProject = discoverProject(externalDocument(), page, [
      { path: 'src/a.ts', content: 'export const a = 1;', revision: 'a1' },
      { path: 'src/b.ts', content: 'export const b = 2;', revision: 'b1' },
    ]);
    const initial = assembleProjectContext(initialProject, {
      contextId: 'ctx-before-delete', capturedAt: 1, selectedPaths: ['src/a.ts', 'src/b.ts'],
    });
    const emptyProject = discoverProject(externalDocument(), page, [], { minimumFiles: 0 });
    const refreshed = assembleProjectContext(emptyProject, {
      contextId: 'ctx-after-delete', capturedAt: 2,
      selectedPaths: initial.envelope.payload.selectedPaths,
      previousSelectedPaths: initial.envelope.payload.selectedPaths,
      previousFiles: initial.envelope.payload.files,
      refresh: true,
    });

    assert.equal(refreshed.unchanged, false);
    assert.deepEqual(refreshed.envelope.payload.files.map((file) => file.status), ['removed', 'removed']);
    assert.equal(refreshed.envelope.payload.omitted.length, 2);
  });
});
