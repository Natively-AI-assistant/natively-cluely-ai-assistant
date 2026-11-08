// "Auto-detect coding problems" in Settings › Companion was saved but never
// read: the pre-answer request (phone-mirror:request-auto-context) only looked
// at "Auto-attach coding context", so turning auto-detect off changed nothing.
// buildAutoContextRequest now needs both for the coding branch. "Ask before
// attaching unknown pages" was never read either, and nothing asks: an unsure
// AI verdict attached silently. It is now "Hold back unsure pages". Both rules
// also apply to the AI classifier's /classify verdict (autoContextVerdict),
// whose extract does not see codingEnabled. Pure modules from dist-electron
// (npm test builds them first).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

let buildAutoContextRequest, autoContextVerdict, decideFinalPolicy;
const bc = (m) => pathToFileURL(path.resolve(root, `dist-electron/electron/services/browser-context/${m}.js`)).href;
before(async () => {
  ({ buildAutoContextRequest, autoContextVerdict } = await import(bc('autoContextRequest')));
  ({ decideFinalPolicy } = await import(bc('policy')));
});

// SettingsManager.getBrowserContextSettings() defaults.
const DEFAULTS = {
  autoDetectCoding: true,
  autoAttachCoding: true,
  aiClassifierEnabled: false,
  autoDetectJobDescriptions: false,
  autoDetectDeveloperDocs: false,
  experimentalFullPageCapture: false,
};

describe('buildAutoContextRequest', () => {
  test('defaults ask for coding pages only', () => {
    assert.deepEqual(buildAutoContextRequest(DEFAULTS), {
      codingEnabled: true,
      fullPage: false,
      aiClassify: false,
      extraCategories: undefined,
    });
  });

  test('auto-detect off sends nothing when no other path is on', () => {
    assert.equal(buildAutoContextRequest({ ...DEFAULTS, autoDetectCoding: false }), null);
  });

  test('auto-attach off sends nothing when no other path is on', () => {
    assert.equal(buildAutoContextRequest({ ...DEFAULTS, autoAttachCoding: false }), null);
  });

  test('auto-detect off drops the coding branch but keeps an opted-in category', () => {
    const req = buildAutoContextRequest({ ...DEFAULTS, autoDetectCoding: false, autoDetectJobDescriptions: true });
    assert.equal(req.codingEnabled, false);
    assert.deepEqual(req.extraCategories, ['job_description']);
  });

  test('the AI classifier and full-page mode are independent of the coding switches', () => {
    const req = buildAutoContextRequest({
      ...DEFAULTS,
      autoDetectCoding: false,
      autoAttachCoding: false,
      aiClassifierEnabled: true,
      experimentalFullPageCapture: true,
      autoDetectDeveloperDocs: true,
    });
    assert.deepEqual(req, {
      codingEnabled: false,
      fullPage: true,
      aiClassify: true,
      extraCategories: ['developer_docs'],
    });
  });
});

test('the IPC handler builds its request with buildAutoContextRequest', () => {
  const ipc = fs.readFileSync(path.resolve(root, 'electron/ipcHandlers.ts'), 'utf8');
  const start = ipc.indexOf("safeHandle('phone-mirror:request-auto-context'");
  assert.ok(start > 0, 'handler is registered');
  const body = ipc.slice(start, start + 800);
  assert.match(body, /buildAutoContextRequest\(SettingsManager\.getInstance\(\)\.getBrowserContextSettings\(\)\)/);
  assert.match(body, /requestAutoContext\(request\)/);
});

test('Settings shows Auto-attach coding context disabled while auto-detect is off', () => {
  const ui = fs.readFileSync(path.resolve(root, 'src/components/settings/PhoneMirrorSettings.tsx'), 'utf8');
  assert.match(ui, /field: 'autoAttachCoding',[\s\S]{0,400}requires: 'autoDetectCoding'/);
  assert.match(ui, /disabled=\{o\.requires \? !ctx\[o\.requires\] : undefined\}/);
});

describe('autoContextVerdict (the /classify verdict)', () => {
  const ON = { codingEnabled: true, holdBackUnsure: true };
  const v = (category, autoPolicy, opts) => autoContextVerdict({ category, autoPolicy }, opts);

  test('a sure coding page attaches; an unsure one is held back', () => {
    for (const category of ['coding_problem', 'coding_editor', 'interview_assessment']) {
      assert.equal(v(category, 'auto', ON), 'auto', category);
      assert.equal(v(category, 'ask', ON), 'manual', category);
      assert.equal(v(category, 'auto_if_high_confidence', ON), 'manual', category);
    }
  });

  test('with Hold back off, an unsure coding page attaches as before', () => {
    const opts = { codingEnabled: true, holdBackUnsure: false };
    assert.equal(v('coding_problem', 'ask', opts), 'ask');
    assert.equal(v('coding_editor', 'auto_if_high_confidence', opts), 'auto_if_high_confidence');
  });

  test('with coding off, even a sure coding page is not attached by the AI path', () => {
    for (const holdBackUnsure of [true, false]) {
      assert.equal(v('coding_problem', 'auto', { codingEnabled: false, holdBackUnsure }), 'manual');
      assert.equal(v('coding_editor', 'auto', { codingEnabled: false, holdBackUnsure }), 'manual');
    }
  });

  test('docs and job pages are not held back: they are ask by category, not doubt', () => {
    for (const opts of [ON, { codingEnabled: false, holdBackUnsure: true }]) {
      assert.equal(v('developer_docs', 'ask', opts), 'ask');
      assert.equal(v('job_description', 'ask', opts), 'ask');
    }
  });

  test('blocked and manual verdicts never change', () => {
    for (const opts of [ON, { codingEnabled: false, holdBackUnsure: false }]) {
      assert.equal(v('coding_problem', 'blocked', opts), 'blocked');
      assert.equal(v('email', 'blocked', opts), 'blocked');
      assert.equal(v('article', 'manual', opts), 'manual');
    }
  });

  test('end to end with the policy engine: a high-confidence job page still attaches', () => {
    const decide = (category, confidenceScore) =>
      decideFinalPolicy({ classification: { category, confidenceScore, autoPolicyRecommendation: 'ask' } });
    const job = decide('job_description', 0.97);
    assert.equal(job.autoPolicy, 'ask');
    assert.equal(autoContextVerdict(job, ON), 'ask');
    assert.equal(autoContextVerdict(decide('coding_problem', 0.6), ON), 'manual');
    assert.equal(autoContextVerdict(decide('coding_problem', 0.95), ON), 'auto');
    assert.equal(autoContextVerdict(decide('coding_problem', 0.95), { codingEnabled: false, holdBackUnsure: true }), 'manual');
  });
});

test('the /classify classifier applies the switch to every verdict it returns', () => {
  const ipc = fs.readFileSync(path.resolve(root, 'electron/ipcHandlers.ts'), 'utf8');
  const start = ipc.indexOf('setMetadataClassifier(async (meta: unknown) => {');
  assert.ok(start > 0, 'classifier is injected');
  const body = ipc.slice(start, ipc.indexOf('\n    });', start));
  assert.match(body, /autoContextVerdict\(decision, \{\s*codingEnabled: codingAutoAttachEnabled\(settings\),\s*holdBackUnsure: settings\.askBeforeUnknown,\s*\}\)/);
  assert.doesNotMatch(body, /autoPolicy: decision\.autoPolicy[,\s]/, 'no raw verdict is returned');
});

test('Settings: Hold back unsure pages sits with the AI classifier and waits on it', () => {
  const ui = fs.readFileSync(path.resolve(root, 'src/components/settings/PhoneMirrorSettings.tsx'), 'utf8');
  assert.doesNotMatch(ui, /Ask before attaching unknown pages/);
  const more = ui.slice(ui.indexOf('const MORE_CTX'), ui.indexOf('];', ui.indexOf('const MORE_CTX')));
  assert.match(more, /field: 'askBeforeUnknown',[\s\S]{0,400}label: 'Hold back unsure pages',[\s\S]{0,300}requires: 'aiClassifierEnabled'/);
  // On by default but inert while the classifier is off: not counted as on.
  assert.match(ui, /MORE_CTX\.filter\(\(o\) => ctx\[o\.field\] && \(!o\.requires \|\| ctx\[o\.requires\]\)\)/);
});
