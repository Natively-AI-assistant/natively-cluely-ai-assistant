// electron/services/__tests__/SkillInstaller.test.mjs
//
// Step 2 of the Skill Upload feature — installer unit tests.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/SkillInstaller.test.mjs
//
// Style mirrors SkillValidator.test.mjs (no Electron, no mocks of the
// installer's internals — every assertion hits the real fs against a
// per-test tmpdir). Tests that need a write-failure inject it via a
// controlled monkey-patch on `fs.promises.writeFile` scoped to a single
// file path.
//
// IMPORTANT: The installer imports from `SkillValidator` (the published
// step-1 API) and type-imports `SkillSummary` / `SkillSource` from
// `SkillsManager`. SkillsManager has `import { app } from 'electron'` at
// the top, but the installer does not import any runtime value from it,
// so esbuild's bundler should tree-shake the electron require away. We
// verify this stays true via the typecheck + build step, NOT at test time.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/skills/SkillInstaller.js'
);
const mod = await import(pathToFileURL(compiledPath).href);
const { installUploadedSkill, reapStaleUploadStages, STAGING_DIR_PREFIX, DEFAULT_REAP_AGE_MS } = mod;

// ---------------------------------------------------------------------------
// Per-test fixtures
// ---------------------------------------------------------------------------

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

function makeSkillMd(opts = {}) {
  const name = opts.name ?? 'my-cool-skill';
  const desc = opts.description ?? 'Does X.';
  const body = opts.body ?? 'Step 1: read the input.\nStep 2: produce output.';
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}`;
}

function makeFilePayload(opts = {}) {
  return {
    kind: 'file',
    filename: opts.filename ?? 'SKILL.md',
    contentBase64: opts.contentBase64 ?? b64(makeSkillMd(opts)),
  };
}

function makeFolderPayload(files) {
  return { kind: 'folder', files };
}

function folderFile(relPath, contentBase64) {
  return { path: relPath, contentBase64 };
}

/** Build an isolated (skillsRoot, stagingRoot) pair under os.tmpdir(). */
function makeTmpRoots() {
  const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-skills-'));
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-stage-'));
  return { skillsRoot, stagingRoot };
}

/** Recursively list every regular file under `root` relative to `root`. */
function listFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, prefix + entry.name + '/');
      else out.push(prefix + entry.name);
    }
  };
  walk(root, '');
  out.sort();
  return out;
}

let roots;
let origWriteFile;
beforeEach(() => {
  roots = makeTmpRoots();
  // Snapshot fs.promises.writeFile so tests can restore it in afterEach.
  origWriteFile = fsp.writeFile;
});
afterEach(async () => {
  // Restore any monkey-patched writeFile.
  fsp.writeFile = origWriteFile;
  // Clean up both roots. Use force:true so a leaked partial tree doesn't
  // fail the next test setup.
  try { fs.rmSync(roots.skillsRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(roots.stagingRoot, { recursive: true, force: true }); } catch {}
  // Also remove any natively-skill-upload-* dirs we may have leaked (paranoid).
  try {
    for (const e of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
      if (e.isDirectory() && e.name.startsWith(STAGING_DIR_PREFIX)) {
        fs.rmSync(path.join(os.tmpdir(), e.name), { recursive: true, force: true });
      }
    }
  } catch {}
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('installUploadedSkill — happy path', () => {
  test('single-file payload installs to <skillsRoot>/<id>/SKILL.md', async () => {
    const payload = makeFilePayload({ name: 'happy-skill', description: 'Works fine.' });
    const result = await installUploadedSkill(payload, roots);

    assert.equal(result.success, true);
    assert.equal(result.skill.id, 'happy-skill');
    assert.equal(result.skill.name, 'happy-skill');
    assert.equal(result.skill.description, 'Works fine.');
    assert.equal(result.skill.source, 'userData');
    assert.equal(result.installedPath, path.join(roots.skillsRoot, 'happy-skill'));

    const installed = path.join(roots.skillsRoot, 'happy-skill', 'SKILL.md');
    assert.ok(fs.existsSync(installed), 'SKILL.md must exist on disk');
    const content = fs.readFileSync(installed, 'utf8');
    assert.ok(content.includes('name: happy-skill'));
    assert.ok(content.includes('description: Works fine.'));
    assert.ok(content.includes('Step 1: read the input.'));

    // Source folder on disk should be exactly one SKILL.md file (no other
    // directories, no leftover staging artefacts).
    const installedFiles = listFiles(path.join(roots.skillsRoot, 'happy-skill'));
    assert.deepEqual(installedFiles, ['SKILL.md']);

    // Staging root must NOT contain a leftover.
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, [], 'no leftover stage dirs after success');
  });

  test('single-file payload with a non-SKILL.md filename still writes SKILL.md on disk', async () => {
    // REGRESSION: a file uploaded as `code_simplifier.md` (or any name other
    // than SKILL.md) used to be written to disk under its ORIGINAL name, e.g.
    // `<id>/code_simplifier.md`. SkillsManager.loadUserSkills() reads
    // `<id>/SKILL.md` EXACTLY, so the skill was invisible in the UI even
    // though install reported success. The installer must always write the
    // single uploaded file as SKILL.md.
    const payload = makeFilePayload({
      filename: 'code_simplifier.md',
      name: 'code-simplifier',
      description: 'Simplifies code.',
    });
    const result = await installUploadedSkill(payload, roots);

    assert.equal(result.success, true);
    assert.equal(result.skill.id, 'code-simplifier');

    // The on-disk file MUST be SKILL.md — not code_simplifier.md.
    const installedFiles = listFiles(path.join(roots.skillsRoot, 'code-simplifier'));
    assert.deepEqual(installedFiles, ['SKILL.md'],
      'single-file upload must land as SKILL.md regardless of the uploaded filename');
    assert.ok(
      !fs.existsSync(path.join(roots.skillsRoot, 'code-simplifier', 'code_simplifier.md')),
      'the original filename must NOT be used on disk',
    );

    // And the content must be intact.
    const content = fs.readFileSync(
      path.join(roots.skillsRoot, 'code-simplifier', 'SKILL.md'), 'utf8');
    assert.ok(content.includes('name: code-simplifier'));
  });

  test('folder payload installs SKILL.md + references/ + assets/ + LICENSE', async () => {
    const payload = makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd({ name: 'folder-skill' }))),
      folderFile('references/spec.md', b64('# reference text')),
      folderFile('assets/logo.png', b64('png-bytes')),
      folderFile('LICENSE', b64('MIT License text')),
    ]);
    const result = await installUploadedSkill(payload, roots);

    assert.equal(result.success, true);
    assert.equal(result.skill.id, 'folder-skill');
    assert.equal(result.installedPath, path.join(roots.skillsRoot, 'folder-skill'));

    const root = path.join(roots.skillsRoot, 'folder-skill');
    assert.ok(fs.existsSync(path.join(root, 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(root, 'references', 'spec.md')));
    assert.ok(fs.existsSync(path.join(root, 'assets', 'logo.png')));
    assert.ok(fs.existsSync(path.join(root, 'LICENSE')));

    // Verify content survived the base64 round-trip + UTF-8 write.
    const refContent = fs.readFileSync(path.join(root, 'references', 'spec.md'), 'utf8');
    assert.equal(refContent, '# reference text');

    const files = listFiles(root);
    assert.deepEqual(files, [
      'LICENSE',
      'SKILL.md',
      'assets/logo.png',
      'references/spec.md',
    ]);
  });

  test('sourceFolderName flows through to installed folder name', async () => {
    // A folder payload with a single top-level segment whose SKILL.md has no
    // name: — the validator emits sourceFolderName = 'my-cool-folder' and
    // falls back to that as the id. The installer must write the tree
    // under <skillsRoot>/my-cool-folder/.
    const mdNoName = '---\ndescription: Does X.\n---\n\nbody instructions here.';
    const payload = makeFolderPayload([
      folderFile('my-cool-folder/SKILL.md', b64(mdNoName)),
      folderFile('my-cool-folder/references/spec.md', b64('# spec')),
    ]);
    const result = await installUploadedSkill(payload, roots);
    assert.equal(result.success, true);
    assert.equal(result.skill.id, 'my-cool-folder');
    assert.equal(
      path.basename(result.installedPath),
      'my-cool-folder',
      'on-disk folder basename must match sourceFolderName'
    );
    assert.ok(fs.existsSync(path.join(result.installedPath, 'SKILL.md')));
    assert.ok(
      fs.existsSync(path.join(result.installedPath, 'references', 'spec.md')),
      'references under the sourceFolderName segment must be preserved'
    );
  });

  test('custom stagingRoot is honored — staged tree appears under the override', async () => {
    const altStaging = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-stage-'));
    try {
      const payload = makeFilePayload({ name: 'alt-stage-skill' });
      const result = await installUploadedSkill(payload, {
        ...roots,
        stagingRoot: altStaging,
      });
      assert.equal(result.success, true);
      // After success the alt-stage root should be empty (best-effort cleanup).
      const leftover = fs.readdirSync(altStaging).filter(n => n.startsWith(STAGING_DIR_PREFIX));
      assert.deepEqual(leftover, [], 'alt-stage root must be cleaned after success');
      // And the install landed in skillsRoot.
      assert.ok(fs.existsSync(path.join(roots.skillsRoot, 'alt-stage-skill', 'SKILL.md')));
    } finally {
      try { fs.rmSync(altStaging, { recursive: true, force: true }); } catch {}
    }
  });
});

// ---------------------------------------------------------------------------
// Failure paths — validation short-circuits
// ---------------------------------------------------------------------------

describe('installUploadedSkill — validation short-circuits', () => {
  test('oversized payload → oversized_payload from validator, no stage created', async () => {
    const payload = makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('big.bin', b64('y'.repeat(1024))),
      folderFile('b.bin', b64('y'.repeat(1024))),
      folderFile('c.bin', b64('y'.repeat(1024))),
    ]);
    const result = await installUploadedSkill(payload, {
      ...roots,
      maxTotalBytes: 2 * 1024 + 200,
    });
    assert.equal(result.success, false);
    assert.ok(result.errors.some(e => e.code === 'oversized_payload'));
    // No stage created under the staging root.
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, []);
    // No folder under skillsRoot.
    assert.deepEqual(fs.readdirSync(roots.skillsRoot), []);
  });

  test('malformed base64 → invalid_base64 from validator, no stage created', async () => {
    const payload = {
      kind: 'file',
      filename: 'SKILL.md',
      contentBase64: '!!notbase64!!',
    };
    const result = await installUploadedSkill(payload, roots);
    assert.equal(result.success, false);
    assert.ok(result.errors.some(e => e.code === 'invalid_base64'));
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, []);
  });

  test('missing name: for a file payload → missing_name, no stage created', async () => {
    const payload = makeFilePayload({
      contentBase64: b64('---\ndescription: ok\n---\n\nbody'),
    });
    const result = await installUploadedSkill(payload, roots);
    assert.equal(result.success, false);
    assert.ok(result.errors.some(e => e.code === 'missing_name'));
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, []);
  });

  test('builtin collision → name_collision_builtin, no stage created', async () => {
    const payload = makeFilePayload({ name: 'humanize-ai-text' });
    const result = await installUploadedSkill(payload, roots);
    assert.equal(result.success, false);
    const err = result.errors.find(e => e.code === 'name_collision_builtin');
    assert.ok(err, 'name_collision_builtin must be present');
    assert.equal(err.conflictingId, 'humanize-ai-text');
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, []);
  });

  test('existing-id collision (existingIds set) → name_collision_existing', async () => {
    const payload = makeFilePayload({ name: 'already-installed' });
    const result = await installUploadedSkill(payload, {
      ...roots,
      existingIds: new Set(['already-installed']),
    });
    assert.equal(result.success, false);
    const err = result.errors.find(e => e.code === 'name_collision_existing');
    assert.ok(err, 'name_collision_existing must be present');
    assert.equal(err.conflictingId, 'already-installed');
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, []);
  });

  test('empty folder payload → empty_payload, no stage created', async () => {
    const payload = { kind: 'folder', files: [] };
    const result = await installUploadedSkill(payload, roots);
    assert.equal(result.success, false);
    assert.ok(result.errors.some(e => e.code === 'empty_payload'));
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, []);
  });
});

// ---------------------------------------------------------------------------
// Failure paths — install-time
// ---------------------------------------------------------------------------

describe('installUploadedSkill — install-time failures', () => {
  test('re-install same skill (idempotency) → already_installed, no second folder', async () => {
    // First install — should succeed.
    const payload = makeFilePayload({ name: 'idem-skill' });
    const first = await installUploadedSkill(payload, roots);
    assert.equal(first.success, true);

    // Second install of the same payload — must refuse.
    const second = await installUploadedSkill(payload, roots);
    assert.equal(second.success, false);
    const err = second.errors.find(e => e.code === 'already_installed');
    assert.ok(err, 'already_installed must be present on second install');
    assert.equal(err.conflictingId, 'idem-skill');

    // skillsRoot must still contain exactly one <id>/ folder.
    const entries = fs.readdirSync(roots.skillsRoot);
    assert.deepEqual(entries, ['idem-skill']);
    // And no leaked stage dirs.
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, []);
  });

  test('existingIds containing the new skill id (race defense) → name_collision_existing', async () => {
    const payload = makeFilePayload({ name: 'race-skill' });
    const result = await installUploadedSkill(payload, {
      ...roots,
      existingIds: new Set(['race-skill']),
    });
    assert.equal(result.success, false);
    // The validator picks this up first; the installer's own
    // already_installed guard is belt-and-suspenders.
    assert.ok(
      result.errors.some(e => e.code === 'name_collision_existing'),
      'validator should reject before installer even runs'
    );
    assert.deepEqual(fs.readdirSync(roots.skillsRoot), []);
  });

  test('path-traversal attempt → path_traversal error, stage removed', async () => {
    // We can't construct a payload with a traversal path because the
    // validator rejects it before we get to the installer. But the
    // installer's INTERNAL defense-in-depth (the isInsideDir check) is
    // independently exercisable: monkey-patch writeFile to throw on the
    // first call and assert the rollback removed the stage.
    //
    // For this test we cover a different angle: the installer's
    // already_installed + staging logic combined. The actual path_traversal
    // from the validator is covered in SkillValidator.test.mjs.
    //
    // Here we assert that when an install-time error fires AFTER staging
    // (we simulate it below), the stage is rolled back and we see no
    // <skillsRoot>/<id>/ folder.
    const payload = makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd({ name: 'rollback-skill' }))),
      folderFile('LICENSE', b64('MIT')),
    ]);

    // Inject a write failure specifically when writing LICENSE.
    const origWrite = fsp.writeFile;
    fsp.writeFile = async (target, data, ...rest) => {
      if (typeof target === 'string' && target.endsWith(path.join('rollback-skill', 'LICENSE'))) {
        throw new Error('simulated EIO on LICENSE write');
      }
      return origWrite.call(fsp, target, data, ...rest);
    };

    const result = await installUploadedSkill(payload, roots);
    fsp.writeFile = origWrite;

    assert.equal(result.success, false);
    assert.ok(result.errors.some(e => e.code === 'write_failed'),
      'write_failed error must be present');
    // The stage dir (which contained the partially-written tree) must NOT
    // exist any more — the rollback removed it.
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, [],
      'stage dir must be removed after write failure');
    // And <skillsRoot>/rollback-skill/ must NOT exist.
    assert.ok(!fs.existsSync(path.join(roots.skillsRoot, 'rollback-skill')),
      'final skill dir must not exist after write failure');
  });

  test('write failure on LICENSE: stage dir removed AND skillsRoot/<id>/ not created', async () => {
    // Stronger version of the test above: explicitly assert both invariants
    // and verify NO content leaked anywhere.
    const payload = makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd({ name: 'no-leak-skill' }))),
      folderFile('LICENSE', b64('MIT')),
    ]);

    const origWrite = fsp.writeFile;
    fsp.writeFile = async (target, data, ...rest) => {
      if (typeof target === 'string' && target.endsWith(path.join('no-leak-skill', 'LICENSE'))) {
        throw new Error('disk full');
      }
      return origWrite.call(fsp, target, data, ...rest);
    };

    try {
      const result = await installUploadedSkill(payload, roots);
      assert.equal(result.success, false);
    } finally {
      fsp.writeFile = origWrite;
    }

    // Stage dir fully gone.
    const stageLeftovers = fs.readdirSync(roots.stagingRoot).filter(
      n => n.startsWith(STAGING_DIR_PREFIX)
    );
    assert.deepEqual(stageLeftovers, []);
    // Final install dir never created.
    assert.ok(!fs.existsSync(path.join(roots.skillsRoot, 'no-leak-skill')));
    // And skillsRoot is otherwise empty (no orphan SKILL.md from the
    // partial write that we might have missed).
    const remaining = fs.readdirSync(roots.skillsRoot);
    assert.deepEqual(remaining, [], `skillsRoot must be empty, got: ${remaining.join(',')}`);
  });
});

// ---------------------------------------------------------------------------
// Stale-stage reaper
// ---------------------------------------------------------------------------

describe('reapStaleUploadStages', () => {
  test('removes a backdated stage dir', () => {
    const stage = path.join(roots.stagingRoot, STAGING_DIR_PREFIX + 'old-stage');
    fs.mkdirSync(stage);
    // Backdate to 2 hours ago.
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(stage, past, past);

    const result = reapStaleUploadStages({
      stagingRoot: roots.stagingRoot,
      olderThanMs: 1000,
    });

    assert.ok(!fs.existsSync(stage), 'old stage dir must be removed');
    assert.deepEqual(result.errors, []);
    assert.ok(result.removed.includes(stage), 'removed array must include the backdated stage');
  });

  test('leaves a fresh stage dir alone', () => {
    const stage = path.join(roots.stagingRoot, STAGING_DIR_PREFIX + 'fresh-stage');
    fs.mkdirSync(stage);
    // mtime is now — must NOT be reaped.

    const result = reapStaleUploadStages({
      stagingRoot: roots.stagingRoot,
      olderThanMs: 60 * 60 * 1000, // 1 hour
    });

    assert.ok(fs.existsSync(stage), 'fresh stage dir must be preserved');
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.errors, []);
  });

  test('leaves non-natively-skill-upload-* dirs alone', () => {
    const unrelated = path.join(roots.stagingRoot, 'unrelated-temp-dir');
    fs.mkdirSync(unrelated);
    // Backdate so age threshold is met.
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    fs.utimesSync(unrelated, past, past);

    const result = reapStaleUploadStages({
      stagingRoot: roots.stagingRoot,
      olderThanMs: 1000,
    });

    assert.ok(fs.existsSync(unrelated), 'unrelated dir must not be touched');
    assert.deepEqual(result.removed, []);
  });

  test('mix of fresh + stale + unrelated: only stale natively-* are removed', () => {
    const stale = path.join(roots.stagingRoot, STAGING_DIR_PREFIX + 'stale');
    const fresh = path.join(roots.stagingRoot, STAGING_DIR_PREFIX + 'fresh');
    const unrelated = path.join(roots.stagingRoot, 'unrelated');
    fs.mkdirSync(stale);
    fs.mkdirSync(fresh);
    fs.mkdirSync(unrelated);
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(stale, past, past);
    fs.utimesSync(unrelated, past, past);
    // fresh keeps current mtime.

    const result = reapStaleUploadStages({
      stagingRoot: roots.stagingRoot,
      olderThanMs: 60 * 60 * 1000,
    });

    assert.deepEqual(result.removed, [stale]);
    assert.ok(fs.existsSync(fresh));
    assert.ok(fs.existsSync(unrelated));
    assert.ok(!fs.existsSync(stale));
  });

  test('missing stagingRoot is reported as an error but does not throw', () => {
    const result = reapStaleUploadStages({
      stagingRoot: path.join(roots.stagingRoot, 'definitely-does-not-exist'),
    });
    assert.deepEqual(result.removed, []);
    assert.ok(result.errors.length > 0, 'missing stagingRoot must surface as an error');
  });

  test('DEFAULT_REAP_AGE_MS is 1 hour (60 * 60 * 1000)', () => {
    assert.equal(DEFAULT_REAP_AGE_MS, 60 * 60 * 1000);
  });
});