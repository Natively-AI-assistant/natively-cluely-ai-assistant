// electron/services/__tests__/SkillUploader.test.mjs
//
// Step 2 of the Skill Upload feature — façade unit tests.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/SkillUploader.test.mjs
//
// The façade is a thin wrapper over validateSkillPayload + installUploadedSkill.
// These tests assert the OUTCOME SHAPE (stage + which fields are populated)
// without duplicating the underlying installer's coverage.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/skills/SkillUploader.js'
);
const mod = await import(pathToFileURL(compiledPath).href);
const { uploadSkill } = mod;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

function makeSkillMd(opts = {}) {
  const name = opts.name ?? 'my-cool-skill';
  const desc = opts.description ?? 'Does X.';
  const body = opts.body ?? 'Step 1: read the input.';
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}`;
}

function makeFilePayload(opts = {}) {
  return {
    kind: 'file',
    filename: opts.filename ?? 'SKILL.md',
    contentBase64: opts.contentBase64 ?? b64(makeSkillMd(opts)),
  };
}

function makeTmpRoots() {
  const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uploader-skills-'));
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uploader-stage-'));
  return { skillsRoot, stagingRoot };
}

let roots;
beforeEach(() => { roots = makeTmpRoots(); });
afterEach(() => {
  try { fs.rmSync(roots.skillsRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(roots.stagingRoot, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// autoInstall: true (default)
// ---------------------------------------------------------------------------

describe('uploadSkill — autoInstall: true (default)', () => {
  test('valid payload returns stage=installed with skill + installedPath + preview', async () => {
    const payload = makeFilePayload({ name: 'one-shot-skill', description: 'Auto install works.' });
    const result = await uploadSkill(payload, { ...roots, autoInstall: true });

    assert.equal(result.stage, 'installed');
    assert.ok(result.preview, 'preview must be populated on success');
    assert.equal(result.preview.id, 'one-shot-skill');
    assert.ok(result.skill, 'skill must be populated on installed stage');
    assert.equal(result.skill.id, 'one-shot-skill');
    assert.equal(result.skill.source, 'userData');
    assert.ok(result.installedPath, 'installedPath must be populated');
    assert.equal(
      result.installedPath,
      path.join(roots.skillsRoot, 'one-shot-skill')
    );
    assert.equal(result.errors, undefined, 'errors must NOT be populated on success');

    // Disk side-effect: SKILL.md exists.
    assert.ok(
      fs.existsSync(path.join(roots.skillsRoot, 'one-shot-skill', 'SKILL.md')),
      'SKILL.md must be written to disk'
    );
  });

  test('autoInstall default (omitted) behaves as autoInstall: true', async () => {
    const payload = makeFilePayload({ name: 'default-auto-skill' });
    // Pass NO autoInstall flag — defaults to true.
    const result = await uploadSkill(payload, roots);
    assert.equal(result.stage, 'installed');
    assert.ok(result.installedPath);
    assert.ok(fs.existsSync(result.installedPath));
  });
});

// ---------------------------------------------------------------------------
// autoInstall: false
// ---------------------------------------------------------------------------

describe('uploadSkill — autoInstall: false', () => {
  test('valid payload returns stage=validated with preview; skill NOT set; nothing installed', async () => {
    const payload = makeFilePayload({ name: 'preview-only-skill', description: 'Will not install yet.' });
    const result = await uploadSkill(payload, { ...roots, autoInstall: false });

    assert.equal(result.stage, 'validated');
    assert.ok(result.preview, 'preview must be populated on validated stage');
    assert.equal(result.preview.id, 'preview-only-skill');
    assert.equal(result.preview.name, 'preview-only-skill');
    assert.equal(result.preview.description, 'Will not install yet.');

    assert.equal(result.skill, undefined, 'skill must NOT be populated on validated stage');
    assert.equal(result.installedPath, undefined, 'installedPath must NOT be populated');
    assert.equal(result.errors, undefined, 'errors must NOT be populated on validated stage');

    // Critical: nothing was installed.
    const entries = fs.readdirSync(roots.skillsRoot);
    assert.deepEqual(entries, [], 'no skill folder should be created on validated-only path');
  });

  test('second call with autoInstall: true (after preview) completes install', async () => {
    const payload = makeFilePayload({ name: 'two-step-skill' });

    const previewResult = await uploadSkill(payload, { ...roots, autoInstall: false });
    assert.equal(previewResult.stage, 'validated');
    assert.equal(fs.readdirSync(roots.skillsRoot).length, 0);

    const installResult = await uploadSkill(payload, { ...roots, autoInstall: true });
    assert.equal(installResult.stage, 'installed');
    assert.ok(installResult.skill);
    assert.ok(installResult.installedPath);
    assert.ok(fs.existsSync(path.join(roots.skillsRoot, 'two-step-skill', 'SKILL.md')));
  });
});

// ---------------------------------------------------------------------------
// Validation failure
// ---------------------------------------------------------------------------

describe('uploadSkill — validation failures', () => {
  test('returns stage=failed with errors; preview NOT set; nothing installed', async () => {
    const payload = makeFilePayload({ name: 'humanize-ai-text' }); // builtin collision
    const result = await uploadSkill(payload, roots);

    assert.equal(result.stage, 'failed');
    assert.ok(result.errors, 'errors must be populated on failure');
    assert.ok(result.errors.some(e => e.code === 'name_collision_builtin'));
    assert.equal(result.preview, undefined, 'preview must NOT be set on validation failure');
    assert.equal(result.skill, undefined);
    assert.equal(result.installedPath, undefined);

    // Nothing installed.
    assert.deepEqual(fs.readdirSync(roots.skillsRoot), []);
  });

  test('malformed base64 → stage=failed, errors include invalid_base64', async () => {
    const payload = {
      kind: 'file',
      filename: 'SKILL.md',
      contentBase64: '!!notbase64!!',
    };
    const result = await uploadSkill(payload, roots);
    assert.equal(result.stage, 'failed');
    assert.ok(result.errors.some(e => e.code === 'invalid_base64'));
  });

  test('oversized payload → stage=failed', async () => {
    const payload = {
      kind: 'file',
      filename: 'SKILL.md',
      contentBase64: b64(makeSkillMd({ name: 'big-skill' })),
    };
    const result = await uploadSkill(payload, { ...roots, maxFileBytes: 50 });
    assert.equal(result.stage, 'failed');
    assert.ok(result.errors.some(e => e.code === 'oversized_file'));
  });
});

// ---------------------------------------------------------------------------
// Install failure after validation
// ---------------------------------------------------------------------------

describe('uploadSkill — install failures', () => {
  test('collision at install time (existingIds given) → stage=failed with name_collision_existing', async () => {
    // First install to set up on-disk state.
    const payload = makeFilePayload({ name: 'collision-skill' });
    const first = await uploadSkill(payload, roots);
    assert.equal(first.stage, 'installed');

    // Second install with the SAME existingIds set (simulates the IPC
    // layer passing a fresh list that already contains the new id).
    const result = await uploadSkill(payload, {
      ...roots,
      existingIds: new Set(['collision-skill']),
    });
    assert.equal(result.stage, 'failed');
    assert.ok(
      result.errors.some(e => e.code === 'name_collision_existing'),
      'validator should reject before installer even runs'
    );
  });

  test('re-install after on-disk creation → stage=failed with already_installed', async () => {
    const payload = makeFilePayload({ name: 'reinstall-skill' });

    // First install.
    const first = await uploadSkill(payload, roots);
    assert.equal(first.stage, 'installed');

    // Second install with empty existingIds (simulates a buggy caller that
    // forgot to refresh). The installer's on-disk check catches this.
    const second = await uploadSkill(payload, roots);
    assert.equal(second.stage, 'failed');
    assert.ok(
      second.errors.some(e => e.code === 'already_installed'),
      `expected already_installed, got: ${JSON.stringify(second.errors)}`
    );
  });

  test('install failure preserves the preview so the UI can show both', async () => {
    const payload = makeFilePayload({ name: 'show-preview-skill' });

    // First install to set up the collision.
    await uploadSkill(payload, roots);

    // Second attempt with the same payload, this time passing the
    // already-installed id in existingIds. The validator would reject
    // it, but we want to also verify that even when the installer's own
    // on-disk guard fires (validator bypassed via empty existingIds), the
    // preview is preserved.
    const result = await uploadSkill(payload, roots);
    assert.equal(result.stage, 'failed');
    assert.ok(result.preview, 'preview should be preserved on install-time failure');
    assert.equal(result.preview.id, 'show-preview-skill');
    assert.ok(result.errors.some(e => e.code === 'already_installed'));
  });
});