// electron/services/__tests__/SkillValidator.test.mjs
//
// Step 1 of the Skill Upload feature — pure validator unit tests.
//
// What's covered here:
//
//   1. Frontmatter parsing — happy path (single file, folder, block scalars,
//      case-insensitive fileTree sort)
//   2. Validation errors — every error code listed in the spec
//   3. Edge cases — base64 round-trip, decoder error code, instruction
//      preview truncation, existing-ids, duplicate SKILL.md case-fold
//
// Run via: npm run build:electron && node --test electron/services/__tests__/SkillValidator.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/skills/SkillValidator.js'
);
const mod = await import(pathToFileURL(compiledPath).href);
const { validateSkillPayload, decodeBase64ToUtf8 } = mod;

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Frontmatter parsing — happy path
// ---------------------------------------------------------------------------

describe('validateSkillPayload — frontmatter parsing happy path', () => {
  test('valid single-file payload with simple frontmatter', () => {
    const result = validateSkillPayload(makeFilePayload());
    assert.equal(result.ok, true);
    assert.equal(result.preview.id, 'my-cool-skill');
    assert.equal(result.preview.name, 'my-cool-skill');
    assert.equal(result.preview.description, 'Does X.');
    assert.ok(result.preview.instructionsPreview.startsWith('Step 1: read the input.'));
    assert.equal(result.preview.referenceCount, 0);
    assert.equal(result.preview.assetCount, 0);
    assert.equal(result.preview.scriptCount, 0);
    assert.equal(result.preview.otherCount, 1); // SKILL.md itself
    assert.equal(result.preview.fileTree.length, 1);
    assert.equal(result.preview.fileTree[0], 'SKILL.md');
  });

  test('single-file payload with a non-SKILL.md filename normalizes fileTree to SKILL.md', () => {
    // REGRESSION: the preview's fileTree (which the installer iterates to
    // write files) must show SKILL.md, not the user's original filename, so
    // the on-disk layout matches SkillsManager.loadUserSkills()'s
    // <id>/SKILL.md contract. A file written as code_simplifier.md is
    // invisible to the loader.
    const result = validateSkillPayload(makeFilePayload({
      filename: 'code_simplifier.md',
      name: 'code-simplifier',
      description: 'Simplifies code.',
    }));
    assert.equal(result.ok, true);
    assert.equal(result.preview.id, 'code-simplifier');
    assert.deepEqual(result.preview.fileTree, ['SKILL.md'],
      'fileTree must be normalized to SKILL.md regardless of uploaded filename');
    assert.equal(result.preview.otherCount, 1);
  });

  test('folder payload classifies references/assets/scripts/other correctly', () => {
    const payload = makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('references/spec.md', b64('# reference')),
      folderFile('assets/logo.png', b64('png-bytes')),
      folderFile('scripts/run.sh', b64('#!/bin/sh')),
      folderFile('LICENSE', b64('MIT')),
    ]);
    const result = validateSkillPayload(payload);
    assert.equal(result.ok, true);
    assert.equal(result.preview.referenceCount, 1);
    assert.equal(result.preview.assetCount, 1);
    assert.equal(result.preview.scriptCount, 1);
    assert.equal(result.preview.otherCount, 2); // SKILL.md + LICENSE
  });

  test('description: > block scalar collapses to single space', () => {
    const md = `---\nname: my-cool-skill\ndescription: >\n  Multi-line\n  folded description\n  here.\n---\n\nbody`;
    const result = validateSkillPayload(makeFilePayload({ contentBase64: b64(md) }));
    assert.equal(result.ok, true);
    assert.equal(result.preview.description, 'Multi-line folded description here.');
  });

  test('description: | block scalar preserves newlines', () => {
    const md = `---\nname: my-cool-skill\ndescription: |\n  Line A\n  Line B\n---\n\nbody`;
    const result = validateSkillPayload(makeFilePayload({ contentBase64: b64(md) }));
    assert.equal(result.ok, true);
    assert.equal(result.preview.description, 'Line A\nLine B');
  });

  test('fileTree is case-insensitive sorted', () => {
    const payload = makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('Banana.md', b64('# b')),
      folderFile('apple.md', b64('# a')),
      folderFile('Cherry.md', b64('# c')),
    ]);
    const result = validateSkillPayload(payload);
    assert.equal(result.ok, true);
    // Sort by toLowerCase then localeCompare: apple, Banana, Cherry, SKILL.md
    assert.deepEqual(result.preview.fileTree, ['apple.md', 'Banana.md', 'Cherry.md', 'SKILL.md']);
  });

  test('directory prefix matching is case-insensitive', () => {
    const payload = makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('References/spec.md', b64('r')),
      folderFile('ASSETS/img.png', b64('a')),
      folderFile('Scripts/build.sh', b64('s')),
    ]);
    const result = validateSkillPayload(payload);
    assert.equal(result.ok, true);
    assert.equal(result.preview.referenceCount, 1);
    assert.equal(result.preview.assetCount, 1);
    assert.equal(result.preview.scriptCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Validation errors — every code
// ---------------------------------------------------------------------------

describe('validateSkillPayload — validation errors', () => {
  test('missing_yaml when there is no frontmatter block', () => {
    const result = validateSkillPayload(makeFilePayload({
      contentBase64: b64('Just some text, no frontmatter at all.'),
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'missing_yaml'));
  });

  test('missing_name when name is empty', () => {
    const result = validateSkillPayload(makeFilePayload({
      contentBase64: b64('---\nname: \ndescription: Does X.\n---\n\nbody'),
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'missing_name'));
  });

  test('name_not_kebab_case when name has uppercase', () => {
    const result = validateSkillPayload(makeFilePayload({ name: 'MySkill' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'name_not_kebab_case'));
  });

  test('name_not_kebab_case when name has space + special chars', () => {
    const result = validateSkillPayload(makeFilePayload({ name: 'my skill!' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'name_not_kebab_case'));
  });

  test('name_collision_builtin when slug equals the default reserved id', () => {
    // The default reserved id is `humanize-ai-text` (the visible name-derived
    // slug, NOT the on-disk folder name `humanize-text`). Use the explicit
    // builtinIds opt for the legacy-folder case below.
    const result = validateSkillPayload(makeFilePayload({ name: 'humanize-ai-text' }));
    assert.equal(result.ok, false);
    const e = result.errors.find(x => x.code === 'name_collision_builtin');
    assert.ok(e, 'name_collision_builtin must be present');
    assert.equal(e.conflictingId, 'humanize-ai-text');
  });

  test('name_collision_builtin can be overridden via opts.builtinIds (legacy folder-name id)', () => {
    // Even though the default set no longer includes the folder name, callers
    // can still reserve it explicitly — useful for tests and for any future
    // migration where the on-disk folder name is reserved.
    const result = validateSkillPayload(
      makeFilePayload({ name: 'humanize-text' }),
      { builtinIds: new Set(['humanize-text']) }
    );
    assert.equal(result.ok, false);
    const e = result.errors.find(x => x.code === 'name_collision_builtin');
    assert.ok(e, 'name_collision_builtin must be present when explicitly reserved');
    assert.equal(e.conflictingId, 'humanize-text');
  });

  test('non-kebab name that resolves to a builtin id surfaces BOTH kebab and collision errors', () => {
    // "Humanize Text" has a space + capital — it would slugify to "humanize-text"
    // which is the on-disk folder name of the built-in `humanize-ai-text` skill
    // (reserved by DEFAULT_BUILTIN_SKILL_IDS). We surface BOTH errors so the
    // user knows both that the name is malformed AND that even after fixing it,
    // the id is still reserved.
    const result = validateSkillPayload(makeFilePayload({ name: 'Humanize Text' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'name_not_kebab_case'),
      'name_not_kebab_case must be present');
    assert.ok(result.errors.some(e => e.code === 'name_collision_builtin'),
      'name_collision_builtin must ALSO be present — even after fixing the kebab, the id is reserved');
  });

  test('name_collision_builtin fires for a CLEAN kebab name that resolves to the builtin', () => {
    // The builtin's visible id is `humanize-ai-text` (the name-derived slug)
    // — see DEFAULT_BUILTIN_SKILL_IDS.
    const result = validateSkillPayload(makeFilePayload({ name: 'humanize-ai-text' }));
    assert.equal(result.ok, false);
    const e = result.errors.find(x => x.code === 'name_collision_builtin');
    assert.ok(e, 'name_collision_builtin must be present for clean kebab collision');
    assert.equal(e.conflictingId, 'humanize-ai-text');
  });

  test('name_collision_builtin fires for the on-disk folder name (REGRESSION for builtin shadow)', () => {
    // REGRESSION: prior to reserving both visible id + folder name, a user
    // upload with `name: "humanize-text"` (a clean kebab slug) bypassed
    // validation because only `humanize-ai-text` was reserved. The install
    // then landed in <userData>/skills/humanize-text/SKILL.md — the
    // built-in's folder — and SkillsManager.loadUserSkills() labelled it
    // `source: 'builtin'`, silently shadowing the seeded built-in.
    // Both ids MUST now be reserved so the user gets a clean rejection.
    const result = validateSkillPayload(makeFilePayload({ name: 'humanize-text' }));
    assert.equal(result.ok, false);
    const e = result.errors.find(x => x.code === 'name_collision_builtin');
    assert.ok(e, 'name_collision_builtin must fire for the built-in folder name');
    assert.equal(e.conflictingId, 'humanize-text');
  });

  test('name_collision_existing when slug matches an existing id', () => {
    const result = validateSkillPayload(
      makeFilePayload({ name: 'already-installed' }),
      { existingIds: new Set(['already-installed']) }
    );
    assert.equal(result.ok, false);
    const e = result.errors.find(x => x.code === 'name_collision_existing');
    assert.ok(e, 'name_collision_existing must be present');
    assert.equal(e.conflictingId, 'already-installed');
  });

  test('missing_description when description is missing', () => {
    const result = validateSkillPayload(makeFilePayload({
      contentBase64: b64('---\nname: ok\n---\n\nbody'),
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'missing_description'));
  });

  test('missing_instructions when body is empty after frontmatter', () => {
    const result = validateSkillPayload(makeFilePayload({
      contentBase64: b64('---\nname: ok\ndescription: ok\n---\n\n   '),
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'missing_instructions'));
  });

  test('missing_skill_md when folder has no SKILL.md', () => {
    const result = validateSkillPayload(makeFolderPayload([
      folderFile('references/spec.md', b64('x')),
    ]));
    assert.equal(result.ok, false);
    assert.equal(result.errors.filter(e => e.code === 'missing_skill_md').length, 1);
    assert.equal(result.errors.length, 1); // catches any future duplicate-emission
  });

  test('duplicate_skill_md when folder has two SKILL.md case variations', () => {
    const result = validateSkillPayload(makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('skill.md', b64(makeSkillMd())),
    ]));
    assert.equal(result.ok, false);
    assert.equal(result.errors.filter(e => e.code === 'duplicate_skill_md').length, 1);
    assert.equal(result.errors.length, 1); // catches any future duplicate-emission
  });

  test('duplicate_skill_md with SKILL.MD uppercase variant', () => {
    const result = validateSkillPayload(makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('SKILL.MD', b64(makeSkillMd())),
    ]));
    assert.equal(result.ok, false);
    assert.equal(result.errors.filter(e => e.code === 'duplicate_skill_md').length, 1);
    assert.equal(result.errors.length, 1); // catches any future duplicate-emission
  });

  test('path_traversal when folder contains ../escape', () => {
    const result = validateSkillPayload(makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('../escape.md', b64('evil')),
    ]));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'path_traversal'));
  });

  test('path_traversal when folder contains absolute path /etc/passwd', () => {
    const result = validateSkillPayload(makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('/etc/passwd', b64('evil')),
    ]));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'path_traversal'));
  });

  test('path_traversal when path contains a backslash', () => {
    const result = validateSkillPayload(makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('windows\\style.md', b64('evil')),
    ]));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'path_traversal'));
  });

  test('oversized_file when a single file exceeds maxFileBytes (default 100 KiB)', () => {
    const big = 'x'.repeat(101 * 1024);
    const result = validateSkillPayload(
      makeFolderPayload([
        folderFile('SKILL.md', b64(makeSkillMd())),
        folderFile('big.bin', b64(big)),
      ])
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'oversized_file'));
  });

  test('oversized_payload when total exceeds maxTotalBytes (default 5 MiB)', () => {
    // Use a small maxTotalBytes so the test runs fast.
    const just = 'y'.repeat(1024);
    const payload = makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('a.bin', b64(just)),
      folderFile('b.bin', b64(just)),
      folderFile('c.bin', b64(just)),
    ]);
    const result = validateSkillPayload(payload, { maxTotalBytes: 2 * 1024 + 200 });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'oversized_payload'));
  });

  test('invalid_filename when file payload ends in .txt', () => {
    const result = validateSkillPayload(makeFilePayload({
      filename: 'notes.txt',
      contentBase64: b64('hello'),
    }));
    assert.equal(result.ok, false);
    const e = result.errors.find(x => x.code === 'invalid_filename');
    assert.ok(e, 'invalid_filename must be present');
    assert.equal(e.field, 'structure');
  });

  test('multiple errors at once — all codes present', () => {
    const result = validateSkillPayload(makeFilePayload({
      filename: 'notes.txt',
      contentBase64: b64('no frontmatter at all'),
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 1);
    const codes = new Set(result.errors.map(e => e.code));
    assert.ok(codes.has('invalid_filename') || codes.has('missing_yaml'));
    // Specifically: invalid_filename is structural, missing_yaml is from
    // the no-frontmatter body. Both should appear.
    assert.ok(codes.has('invalid_filename'));
    assert.ok(codes.has('missing_yaml'));
  });

  test('too_many_errors sentinel appended when stage-1 errors hit MAX_ERRORS', () => {
    const files = [folderFile('SKILL.md', b64(makeSkillMd()))];
    for (let i = 0; i < 26; i++) {
      files.push(folderFile(`references/r${i}.md`, b64('x'.repeat(1024))));
    }
    const result = validateSkillPayload(makeFolderPayload(files), { maxFileBytes: 500 });
    assert.equal(result.ok, false);
    assert.equal(result.errors.filter(e => e.code === 'oversized_file').length, 25);
    assert.ok(result.errors.some(e => e.code === 'too_many_errors'),
      'too_many_errors sentinel must be appended when stage-1 errors hit the cap');
    assert.equal(result.errors.length, 26);
  });

  test('invalid_base64 when file payload base64 is malformed', () => {
    const result = validateSkillPayload({
      kind: 'file',
      filename: 'SKILL.md',
      contentBase64: '!!notbase64!!',
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'invalid_base64'));
  });

  test('empty_payload for folder with zero files', () => {
    const result = validateSkillPayload({ kind: 'folder', files: [] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'empty_payload'));
  });

  test('empty_payload for file with zero bytes', () => {
    const result = validateSkillPayload({
      kind: 'file',
      filename: 'SKILL.md',
      contentBase64: '',
    });
    assert.equal(result.ok, false);
    // Empty string decodes to empty buffer (0 bytes) → empty_payload.
    // The implementation does NOT raise invalid_base64 here because
    // `Buffer.from('', 'base64')` succeeds with an empty buffer.
    const codes = result.errors.map(e => e.code);
    assert.ok(codes.includes('empty_payload'),
      `expected empty_payload, got: ${JSON.stringify(codes)}`);
    assert.ok(!codes.includes('invalid_base64'),
      `did NOT expect invalid_base64, got: ${JSON.stringify(codes)}`);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('validateSkillPayload — edge cases', () => {
  test('inline-built payload from spec example returns ok', () => {
    const result = validateSkillPayload({
      kind: 'file',
      filename: 'a.md',
      contentBase64: btoa('---\nname: ok\ndescription: ok\n---\n\nhello'),
    });
    assert.equal(result.ok, true);
    assert.equal(result.preview.id, 'ok');
  });

  test('decodeBase64ToUtf8 throws with code INVALID_BASE64 on garbage', () => {
    assert.throws(
      () => decodeBase64ToUtf8('!!notbase64!!'),
      err => err.code === 'INVALID_BASE64'
    );
  });

  test('decodeBase64ToUtf8 round-trips valid UTF-8 and reports bytes', () => {
    const text = 'héllo — world';
    const result = decodeBase64ToUtf8(b64(text));
    assert.equal(result.text, text);
    assert.equal(result.bytes, Buffer.byteLength(text, 'utf8'));
    assert.ok(result.bytes > text.length); // multi-byte chars inflate bytes
  });

  test('instructionsPreview is body trimmed to 280 chars + … when longer', () => {
    const longBody = 'a'.repeat(500);
    const result = validateSkillPayload(
      makeFilePayload({ body: longBody }),
      { maxInstructionsPreview: 280 }
    );
    assert.equal(result.ok, true);
    assert.equal(result.preview.instructionsPreview.length, 281); // 280 + ellipsis
    assert.ok(result.preview.instructionsPreview.endsWith('…'));
  });

  test('instructionsPreview is raw body when ≤ 280 chars', () => {
    const shortBody = 'A short body that fits.';
    const result = validateSkillPayload(
      makeFilePayload({ body: shortBody }),
      { maxInstructionsPreview: 280 }
    );
    assert.equal(result.ok, true);
    assert.equal(result.preview.instructionsPreview, shortBody);
    assert.ok(!result.preview.instructionsPreview.endsWith('…'));
  });

  test('existingIds empty → no collision reported', () => {
    const result = validateSkillPayload(
      makeFilePayload({ name: 'my-cool-skill' }),
      { existingIds: new Set() }
    );
    assert.equal(result.ok, true);
  });

  test('existingIds non-empty but does not include the new id', () => {
    const result = validateSkillPayload(
      makeFilePayload({ name: 'my-cool-skill' }),
      { existingIds: new Set(['some-other-skill']) }
    );
    assert.equal(result.ok, true);
  });

  test('totalBytes sums every file in folder payload', () => {
    const skillBytes = Buffer.byteLength(makeSkillMd(), 'utf8');
    const refBytes = 42;
    const result = validateSkillPayload(makeFolderPayload([
      folderFile('SKILL.md', b64(makeSkillMd())),
      folderFile('references/spec.md', b64('x'.repeat(refBytes))),
    ]));
    assert.equal(result.ok, true);
    assert.equal(result.preview.totalBytes, skillBytes + refBytes);
  });

  test('name that already matches kebab round-trip passes', () => {
    // `humanize-ai-text` is now the default reserved builtin id and will be
    // rejected as a collision; use a non-reserved clean-kebab name here to
    // exercise the round-trip pass-through. The reserved-id case is covered
    // separately in `name_collision_builtin fires for a CLEAN kebab name...`.
    const result = validateSkillPayload(makeFilePayload({ name: 'my-cool-skill-2026' }));
    assert.equal(result.ok, true);
    assert.equal(result.preview.id, 'my-cool-skill-2026');
  });

  test('builtinIds override via opts (e.g. for testing a different builtin)', () => {
    const result = validateSkillPayload(
      makeFilePayload({ name: 'my-cool-skill' }),
      { builtinIds: new Set(['my-cool-skill']) }
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'name_collision_builtin'));
  });

  test('body is trimmed before previewing', () => {
    const result = validateSkillPayload(makeFilePayload({
      contentBase64: b64('---\nname: ok\ndescription: ok\n---\n\n   padded body   '),
    }));
    assert.equal(result.ok, true);
    assert.equal(result.preview.instructionsPreview, 'padded body');
  });

  test('file payload with filename containing separator triggers path_traversal', () => {
    const result = validateSkillPayload({
      kind: 'file',
      filename: 'sub/dir/skill.md',
      contentBase64: b64(makeSkillMd()),
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'path_traversal'));
  });

  test('null payload returns ok:false with invalid_payload (does not throw)', () => {
    // Regression for the contract: the validator must always return a
    // SkillValidationResult, never throw — even for malformed payloads.
    const result = validateSkillPayload(null);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'invalid_payload'));
  });

  test('undefined payload returns ok:false with invalid_payload', () => {
    const result = validateSkillPayload(undefined);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'invalid_payload'));
  });

  test('payload with missing kind returns ok:false with invalid_payload', () => {
    const result = validateSkillPayload({ filename: 'x.md', contentBase64: b64('y') });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'invalid_payload'));
  });

  test('folder payload without name: in SKILL.md uses folder name as fallbackId', () => {
    // Regression for fallbackId divergence: when SKILL.md is missing a
    // `name:` field, the validator must use the top-level folder name
    // (matching SkillsManager.loadUserSkills) so preview.id matches
    // post-install id.
    const md = '---\ndescription: Does X.\n---\n\nbody';
    const result = validateSkillPayload(makeFolderPayload([
      folderFile('my-cool-folder/SKILL.md', b64(md)),
      folderFile('my-cool-folder/references/spec.md', b64('# spec')),
    ]));
    assert.equal(result.ok, true);
    assert.equal(result.preview.id, 'my-cool-folder');
    assert.equal(result.preview.name, 'my-cool-folder');
  });

  test('folder payload with mixed top-level folders does NOT use a folder fallback', () => {
    // If the user dropped two unrelated folders into one payload, there is no
    // single canonical folder name. In that case the validator falls back to
    // 'skill' (the same fallback a file payload uses).
    const md = '---\ndescription: Does X.\n---\n\nbody';
    const result = validateSkillPayload(makeFolderPayload([
      folderFile('folder-a/SKILL.md', b64(md)),
      folderFile('folder-b/spec.md', b64('x')),
    ]));
    // The validator can't determine a single folder name; should still
    // return ok:true with a fallbackId of 'skill'.
    assert.equal(result.ok, true);
    assert.equal(result.preview.id, 'skill');
  });
});