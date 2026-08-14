import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ReleaseNotesManager } = await import(
  pathToFileURL(path.resolve(__dirname, '../../dist-electron/electron/update/ReleaseNotesManager.js')).href
);

const parse = (body) => {
  const manager = ReleaseNotesManager.getInstance();
  return manager.parseReleaseNotes(body, 'v9.9.9', 'https://example.test/release');
};

test('release notes parser accepts GitHub H3 headings and emoji-decorated titles', () => {
  const parsed = parse(`
### 🚀 What's New
- Added automatic update diagnostics

### 🛠 Improvements & Fixes
- Fixed updater release metadata lookup
- Improved release note parsing

### Technical Notes
- Hardened auto-update state transitions
`);

  assert.equal(parsed.version, 'v9.9.9');
  assert.deepEqual(parsed.sections, [
    { title: "What's New", items: ['Added automatic update diagnostics'] },
    { title: 'Improvements', items: ['Fixed updater release metadata lookup', 'Improved release note parsing'] },
    { title: 'Technical', items: ['Hardened auto-update state transitions'] },
  ]);
});

test('release notes manager points at the published GitHub repository', () => {
  const manager = ReleaseNotesManager.getInstance();
  assert.equal(manager.repoOwner, 'Natively-AI-assistant');
  assert.equal(manager.repoName, 'natively-cluely-ai-assistant');
});
