// electron/services/skills/SkillValidator.ts
//
// Step 1 of the Skill Upload feature — a pure, side-effect-free validator
// for user-uploaded skills. Accepts a `SkillUploadPayload` (either a single
// .md file or a folder of files including a top-level `SKILL.md`) and returns
// either a preview or a structured error list.
//
// This module deliberately does NOT import SkillsManager:
//   - SkillsManager is a class singleton whose constructor throws if
//     `app.isReady()` is false, which would break headless unit tests.
//   - It also mixes I/O (fs.readdir, path.join, atomic writes) with parsing.
//   - Keeping this validator pure makes it safe to call from the IPC layer
//     (step 3) before any disk write.
//
// INTENTIONALLY DUPLICATED CODE BELOW:
//   - `parseFrontmatter` is a verbatim semantic copy of `parseSkillMarkdown`
//     from SkillsManager.ts:503-551. We cannot import the original because
//     it lives inside a class file with side effects and throws on
//     `!app.isReady()`. If SkillsManager's parser changes, this copy must
//     be updated in lockstep (or extracted to a shared module).
//   - `slugify` is a verbatim copy of SkillsManager.ts:473-480.
//
// SILENT-FALLBACK POLICY:
// When SKILL.md is missing `name:` AND the payload is `kind: 'folder'` with a
// usable folder name, we accept the folder name as the id silently (matching
// SkillsManager.loadUserSkills behavior). File payloads always require an
// explicit `name:` to prevent accidental `id='skill'` overwrites.

export type SkillValidationField =
  | 'name'
  | 'description'
  | 'instructions'
  | 'structure'
  | 'yaml'
  | 'name_collision'
  | 'size';

export interface SkillValidationError {
  field: SkillValidationField;
  code: string;
  message: string;
  conflictingId?: string;
}

export interface SkillUploadFile {
  path: string;
  contentBase64: string;
}

export interface SkillUploadPreview {
  id: string;
  name: string;
  description: string;
  instructionsPreview: string;
  referenceCount: number;
  assetCount: number;
  scriptCount: number;
  otherCount: number;
  totalBytes: number;
  fileTree: string[];
  /**
   * The top-level folder segment for `kind: 'folder'` payloads whose files
   * all share one root (e.g. `my-skill/SKILL.md`, `my-skill/references/...`).
   * Lets SkillInstaller (step 2) recreate the on-disk folder name without
   * re-parsing the file tree. Undefined for `kind: 'file'` payloads and for
   * folder payloads whose top-level segments are mixed.
   */
  sourceFolderName?: string;
}

export type SkillValidationResult =
  | { ok: true; preview: SkillUploadPreview }
  | { ok: false; errors: SkillValidationError[] };

export type SkillUploadPayload =
  | { kind: 'file'; filename: string; contentBase64: string }
  | { kind: 'folder'; files: SkillUploadFile[] };

export interface ValidateSkillOptions {
  existingIds?: ReadonlySet<string>;
  builtinIds?: ReadonlySet<string>;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxInstructionsPreview?: number;
}

// ---------------------------------------------------------------------------
// Constants — mirror SkillsManager.ts defaults (MAX_SKILL_FILE_BYTES=100KiB).
// 5 MiB is a generous cap that fits a folder of references/assets without
// inviting drive-by abuse; SkillInstaller (step 2) re-checks on disk.
// ---------------------------------------------------------------------------
const DEFAULT_MAX_FILE_BYTES = 100 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_INSTRUCTIONS_PREVIEW = 280;
// IMPORTANT: reserve BOTH the visible id (the slug of the SKILL.md `name:`
// field, which is what the renderer sees in `SkillsManager.listSkills()`) AND
// the on-disk folder name. A user upload whose `name:` slugifies to the
// folder name would land in the built-in's folder slot and silently get
// relabelled `source: 'builtin'` by `SkillsManager.loadUserSkills()` —
// shadowing the built-in's content without warning. See:
//   - SkillsManager.ts:587 (visible id is name-derived slug)
//   - SkillsManager.ts:678 (`BUILTIN_SKILL_IDS.has(entry.name)` uses folder name)
//   - SkillsIpcWiring.test.mjs:200 (ground-truth visible id)
export const DEFAULT_BUILTIN_SKILL_IDS: ReadonlySet<string> = new Set([
    'humanize-ai-text',  // visible id (slug of `name:` field)
    'humanize-text',     // on-disk folder name
]);
const MAX_ERRORS = 25;
const SLUG_MAX_LEN = 80;

// ---------------------------------------------------------------------------
// Verbatim copy of SkillsManager.ts:473-480.
// ---------------------------------------------------------------------------
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LEN);
}

// ---------------------------------------------------------------------------
// Verbatim semantic copy of SkillsManager.ts:503-551 `parseSkillMarkdown`.
// We only need the {id, name, description, instructions} tuple, so the
// `source` and `filePath` fields are dropped here. Throws on invalid input;
// the validator wraps these throws and converts them to structured errors.
//
// IMPORTANT: the SKILL.md `name:` field, if missing or empty, falls back to
// `fallbackId` here (matching SkillsManager). The validator catches this
// case BEFORE calling parseFrontmatter by inspecting the raw metadata so
// it can emit a clean `missing_name` error instead of silently succeeding.
// ---------------------------------------------------------------------------
function parseFrontmatterRaw(
  content: string
): { metadata: Record<string, string>; body: string } {
  const normalized = content.replace(/^﻿/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error('Missing YAML frontmatter');
  }

  const frontmatter = match[1];
  const body = normalized.slice(match[0].length).trim();
  const metadata: Record<string, string> = {};
  const lines = frontmatter.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1].trim();
    let value = keyMatch[2].trim();

    if (value === '>' || value === '|') {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i += 1;
        block.push(lines[i].trim());
      }
      value = block.join(value === '|' ? '\n' : ' ');
    }

    metadata[key] = value.replace(/^['"]|['"]$/g, '').trim();
  }

  return { metadata, body };
}

function parseFrontmatter(
  content: string,
  fallbackId: string
): { id: string; name: string; description: string; instructions: string } {
  const { metadata, body } = parseFrontmatterRaw(content);

  const name = metadata.name || fallbackId;
  const id = slugify(name || fallbackId);
  const description = (metadata.description || '').trim();

  if (!id) throw new Error('Invalid skill name');
  if (!description) throw new Error('Missing description');
  if (!body) throw new Error('Missing instructions');

  return { id, name, description, instructions: body };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode a base64 string to UTF-8 text and measure its byte length.
 * Throws an Error with `code: 'INVALID_BASE64'` on decode failure so the
 * IPC layer can map it to `SkillValidationError` with code `invalid_base64`.
 *
 * Node's `Buffer.from(s, 'base64')` is permissive (silently strips invalid
 * chars), so we round-trip the buffer back to base64 and compare to detect
 * non-base64 inputs. Any whitespace in the original is normalized away so
 * paddings/multi-line splits don't cause spurious failures.
 */
export function decodeBase64ToUtf8(contentBase64: string): { text: string; bytes: number } {
  try {
    if (typeof contentBase64 !== 'string') {
      throw new Error('contentBase64 must be a string');
    }
    const buf = Buffer.from(contentBase64, 'base64');
    const reencoded = buf.toString('base64');
    const norm = (s: string) => s.replace(/\s+/g, '');
    if (norm(reencoded) !== norm(contentBase64)) {
      throw new Error('base64 round-trip mismatch');
    }
    const text = buf.toString('utf8');
    return { text, bytes: Buffer.byteLength(text, 'utf8') };
  } catch (cause) {
    const err = new Error('Invalid base64 payload');
    Object.assign(err, { code: 'INVALID_BASE64' });
    throw err;
  }
}

/**
 * Classify a relative path into one of the four buckets: references / assets
 * / scripts / other. Case-insensitive prefix match. Top-level SKILL.md is
 * `other` (the caller excludes it from the counts anyway).
 */
function classifyPath(relPath: string): 'reference' | 'asset' | 'script' | 'other' {
  const lower = relPath.toLowerCase();
  if (lower.startsWith('references/')) return 'reference';
  if (lower.startsWith('assets/')) return 'asset';
  if (lower.startsWith('scripts/')) return 'script';
  return 'other';
}

/**
 * POSIX-style path traversal check. We deliberately use `path.posix` for
 * the traversal logic so behavior is identical on Windows and macOS, but
 * we still scan the raw input for `..` segments, leading slashes, drive
 * letters, and NUL bytes (the kind of garbage that could come in from a
 * Windows-zip extraction even when the host is macOS).
 */
function hasInvalidPath(rawPath: string): boolean {
  if (!rawPath) return true;
  if (rawPath.indexOf('\0') !== -1) return true;
  // Drive letter: "C:..." or "C:\..." on Windows-style inputs.
  if (/^[A-Za-z]:[\\/]/.test(rawPath)) return true;
  // Absolute path on any platform.
  if (rawPath.startsWith('/') || rawPath.startsWith('\\')) return true;
  // Backslash on a forward-slash world is suspicious — the IPC contract
  // says forward slashes only.
  if (rawPath.includes('\\')) return true;
  // `..` segment, anywhere.
  const segments = rawPath.split('/');
  for (const seg of segments) {
    if (seg === '..') return true;
  }
  return false;
}

/**
 * Strict kebab-case check. The user's `name:` field should already be a
 * valid kebab identifier so that `slugify()` is a no-op on it.
 *
 * Spec catches:
 *   - "MySkill"        → uppercase present
 *   - "my skill!"      → space + bang
 *   - "Café"           → non-ASCII accent
 *   - "--leading--"    → leading/trailing dashes
 *   - ""               → empty (caught earlier by `missing_name`)
 *
 * AND should pass:
 *   - "humanize-ai-text", "my-cool-skill"
 *
 * The literal-name check is stricter than `slugify()` itself (which
 * silently coerces), but matches user intent: if you wrote "MySkill!"
 * you almost certainly meant to write "my-skill".
 */
function isStrictKebabCase(name: string): boolean {
  if (!name) return false;
  if (name.length > SLUG_MAX_LEN) return false;
  // Only lowercase ASCII alnum, underscore, hyphen.
  if (!/^[a-z0-9_-]+$/.test(name)) return false;
  // No leading or trailing dashes.
  if (name.startsWith('-') || name.endsWith('-')) return false;
  // No leading or trailing underscore either — those would look weird as a
  // skill id and aren't what the spec's example "humanize-ai-text" shows.
  return true;
}

// ---------------------------------------------------------------------------
// Payload extraction
// ---------------------------------------------------------------------------

interface ExtractedSkillMd {
  relPath: string;        // always 'SKILL.md' (we normalize case for dedupe)
  content: string;
  bytes: number;
}

interface ExtractedPayload {
  files: Array<{ relPath: string; content: string; bytes: number }>;
  errors: SkillValidationError[];
  /** Top-level folder segment, if a folder payload's files share one root. */
  folderName?: string;
  /**
   * True when stage-1 attempted to push more than MAX_ERRORS errors. The
   * `too_many_errors` sentinel is emitted by `finalize()` on the public
   * result, but downstream code in stage 2 needs to know not to bother
   * doing further work (e.g. don't try to parse a SKILL.md that we already
   * know is malformed).
   */
  overflowed: boolean;
}

function addError(errors: SkillValidationError[], err: SkillValidationError, overflow: { tooMany: boolean }): void {
  if (errors.length >= MAX_ERRORS) {
    overflow.tooMany = true;
    return;
  }
  errors.push(err);
}

function extractFilePayload(
  payload: Extract<SkillUploadPayload, { kind: 'file' }>,
  maxFileBytes: number
): ExtractedPayload {
  const errors: SkillValidationError[] = [];
  const overflow = { tooMany: false };
  const files: Array<{ relPath: string; content: string; bytes: number }> = [];

  // filename check first — invalid_filename (field=structure) is structural
  // and should be reported alongside other issues. We DO NOT return early:
  // we still try to decode the body so we can surface yaml/field errors in
  // the same pass (the renderer wants all errors at once).
  let filenameOk = true;
  if (!payload.filename || !payload.filename.toLowerCase().endsWith('.md')) {
    addError(errors, {
      field: 'structure',
      code: 'invalid_filename',
      message: `Filename must end in .md (got '${payload.filename}').`,
    }, overflow);
    filenameOk = false;
  }

  // Path-traversal check applies to the filename too — if it contains a
  // separator it could be trying to escape.
  if (/[\\/]/.test(payload.filename) || payload.filename.includes('..')) {
    addError(errors, {
      field: 'structure',
      code: 'path_traversal',
      message: `Filename '${payload.filename}' contains invalid path characters.`,
    }, overflow);
    filenameOk = false;
  }

  let text: string;
  let bytes: number;
  try {
    const decoded = decodeBase64ToUtf8(payload.contentBase64);
    text = decoded.text;
    bytes = decoded.bytes;
  } catch (e) {
    addError(errors, {
      field: 'structure',
      code: 'invalid_base64',
      message: 'File payload base64 could not be decoded.',
    }, overflow);
    return { files, errors, overflowed: overflow.tooMany };
  }

  if (bytes === 0) {
    addError(errors, {
      field: 'structure',
      code: 'empty_payload',
      message: 'File payload is empty.',
    }, overflow);
    return { files, errors, overflowed: overflow.tooMany };
  }

  if (bytes > maxFileBytes) {
    addError(errors, {
      field: 'size',
      code: 'oversized_file',
      message: `File '${payload.filename}' is ${bytes} bytes (limit ${maxFileBytes}).`,
    }, overflow);
    // Continue so yaml-level errors still surface if applicable.
  }

  // Even if the filename is bad, still add the file under a normalized
  // path so downstream frontmatter parsing can run. If the filename is
  // garbage we substitute 'SKILL.md' so the parser can still find it.
  const relPath = filenameOk
    ? payload.filename.replace(/\\/g, '/').replace(/^\/+/, '')
    : 'SKILL.md';
  files.push({ relPath, content: text, bytes });
  return { files, errors, overflowed: overflow.tooMany };
}

function extractFolderPayload(
  payload: Extract<SkillUploadPayload, { kind: 'folder' }>,
  maxFileBytes: number,
  maxTotalBytes: number
): ExtractedPayload {
  const errors: SkillValidationError[] = [];
  const overflow = { tooMany: false };
  const files: Array<{ relPath: string; content: string; bytes: number }> = [];

  if (!payload.files || payload.files.length === 0) {
    addError(errors, {
      field: 'structure',
      code: 'empty_payload',
      message: 'Folder payload contains no files.',
    }, overflow);
    return { files, errors, overflowed: overflow.tooMany };
  }

  // Path-traversal / structural integrity pass.
  for (const f of payload.files) {
    if (hasInvalidPath(f.path)) {
      addError(errors, {
        field: 'structure',
        code: 'path_traversal',
        message: `Folder payload contains an invalid path ('${f.path}').`,
      }, overflow);
      // Don't continue — if any path is bad, refuse the whole payload.
      return { files, errors, overflowed: overflow.tooMany };
    }
  }

  // Decode every file, accumulating bytes.
  let totalBytes = 0;
  const topLevelSegments = new Set<string>();
  for (const f of payload.files) {
    const relPath = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const firstSeg = relPath.split('/')[0];
    if (firstSeg) topLevelSegments.add(firstSeg);
    let text: string;
    let bytes: number;
    try {
      const decoded = decodeBase64ToUtf8(f.contentBase64);
      text = decoded.text;
      bytes = decoded.bytes;
    } catch (e) {
      addError(errors, {
        field: 'structure',
        code: 'invalid_base64',
        message: `File '${relPath}' base64 could not be decoded.`,
      }, overflow);
      continue;
    }

    if (bytes > maxFileBytes) {
      addError(errors, {
        field: 'size',
        code: 'oversized_file',
        message: `File '${relPath}' is ${bytes} bytes (limit ${maxFileBytes}).`,
      }, overflow);
      continue;
    }

    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      addError(errors, {
        field: 'size',
        code: 'oversized_payload',
        message: `Folder payload exceeds ${maxTotalBytes} bytes.`,
      }, overflow);
      // No point accumulating further.
      return { files, errors, overflowed: overflow.tooMany };
    }

    files.push({ relPath, content: text, bytes });
  }

  // If every file shares the same top-level segment (e.g. `my-skill/SKILL.md`,
  // `my-skill/references/foo.md`) use it as `folderName` so the fallbackId
  // for SKILL.md's missing `name:` field matches the on-disk folder name
  // and round-trips cleanly through SkillsManager.loadUserSkills().
  const folderName = topLevelSegments.size === 1 ? [...topLevelSegments][0] : undefined;

  // Locate SKILL.md (case-insensitive, must end with `/SKILL.md` or be exactly
  // `SKILL.md` at root, must be unique). When the user drops a folder, paths
  // come in like `my-skill/SKILL.md`; when they drop loose files, paths are
  // just `SKILL.md`. Both must be accepted.
  const skillMdLocs = files.filter(f => {
    const lower = f.relPath.toLowerCase();
    return lower === 'skill.md' || lower.endsWith('/skill.md');
  });
  if (skillMdLocs.length === 0) {
    addError(errors, {
      field: 'structure',
      code: 'missing_skill_md',
      message: 'Folder payload must contain a SKILL.md file (at any depth).',
    }, overflow);
    // Early-return: without a SKILL.md, stage 2 has nothing to parse.
    // Returning here also prevents a duplicate `missing_skill_md` from being
    // emitted later in stage 2. Clear `files` so the validator's stage-2
    // gate (`extracted.files.length === 0`) fires and short-circuits —
    // otherwise we could land in stage 2 with references/assets dangling
    // behind a missing SKILL.md, which is not useful UX.
    return { files: [], errors, overflowed: overflow.tooMany };
  }
  if (skillMdLocs.length > 1) {
    addError(errors, {
      field: 'structure',
      code: 'duplicate_skill_md',
      message: `Folder payload contains ${skillMdLocs.length} SKILL.md entries (case-insensitive).`,
    }, overflow);
    // Early-return for symmetry with `missing_skill_md` — a duplicate
    // SKILL.md is a structural corruption the user must fix; partial
    // parsing of references/assets behind a corrupt SKILL.md is not
    // useful UX.
    return { files: [], errors, overflowed: overflow.tooMany, folderName };
  }

  return { files, errors, overflowed: overflow.tooMany, folderName };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateSkillPayload(
  payload: SkillUploadPayload,
  opts: ValidateSkillOptions = {}
): SkillValidationResult {
  // Top-level null/malformed-payload guard. The IPC contract says we always
  // return a `SkillValidationResult`; a thrown TypeError would surface as an
  // unhandled IPC rejection in the renderer.
  if (!payload || (payload.kind !== 'file' && payload.kind !== 'folder')) {
    return {
      ok: false,
      errors: [{
        field: 'structure',
        code: 'invalid_payload',
        message: `Payload must be {kind: 'file', ...} or {kind: 'folder', ...} (got kind='${payload?.kind ?? 'unknown'}').`,
      }],
    };
  }

  const builtinIds = opts.builtinIds ?? DEFAULT_BUILTIN_SKILL_IDS;
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxInstructionsPreview = opts.maxInstructionsPreview ?? DEFAULT_MAX_INSTRUCTIONS_PREVIEW;
  const existingIds = opts.existingIds;

  const errors: SkillValidationError[] = [];
  const overflow = { tooMany: false };

  // ---- Stage 1: extract bytes + structural sanity -------------------------
  const extracted = payload.kind === 'file'
    ? extractFilePayload(payload, maxFileBytes)
    : extractFolderPayload(payload, maxFileBytes, maxTotalBytes);

  errors.push(...extracted.errors);
  if (extracted.overflowed) overflow.tooMany = true;

  // We proceed to stage 2 unless extraction left us with NO usable files.
  // Other errors (invalid_filename, invalid_base64) can co-exist with
  // content-level findings — the renderer wants them all at once.
  if (extracted.files.length === 0) {
    return finalize(errors, overflow);
  }

  // ---- Stage 2: locate SKILL.md and parse frontmatter ---------------------
  let skillMd: ExtractedSkillMd | undefined;
  let totalBytes = 0;
  for (const f of extracted.files) {
    totalBytes += f.bytes;
    // Accept SKILL.md at any depth, e.g. `SKILL.md` (root), `my-folder/SKILL.md`
    // (user dropped a folder), `References/SKILL.md` (unusual but valid).
    // The duplicate check in stage 1 already ensured case-insensitive uniqueness.
    const lower = f.relPath.toLowerCase();
    if (lower === 'skill.md' || lower.endsWith('/skill.md')) {
      skillMd = { relPath: 'SKILL.md', content: f.content, bytes: f.bytes };
    }
  }

  // For a `file` payload the user uploaded a single .md (the renderer
  // strips its folder wrapper) — treat it as the SKILL.md regardless of
  // its actual filename, so `a.md`, `my-skill.md`, etc. all work.
  if (!skillMd && payload.kind === 'file' && extracted.files.length === 1) {
    const only = extracted.files[0];
    skillMd = { relPath: 'SKILL.md', content: only.content, bytes: only.bytes };
  }

  if (!skillMd) {
    // Folder payload without SKILL.md should have been flagged above;
    // single-file payloads always have their content as SKILL.md.
    addError(errors, {
      field: 'structure',
      code: 'missing_skill_md',
      message: 'No SKILL.md content found in payload.',
    }, overflow);
    return finalize(errors, overflow);
  }

  // Compute fallbackId once so both the permissive missing_name check AND
  // the strict parse use the same value. Matches SkillsManager.loadUserSkills()
  // behavior: a folder's top-level segment is the fallback when `name:` is
  // absent; otherwise we use the generic 'skill' placeholder.
  const fallbackId = payload.kind === 'folder'
    ? (extracted.folderName ?? 'skill')
    : 'skill';

  // First do a permissive parse so we can inspect the raw metadata. This
  // lets us emit SPECIFIC errors (missing_name vs missing_description vs
  // missing_instructions) instead of one generic "invalid skill" error.
  // SkillsManager's parseFrontmatter silently coerces an empty `name:` to
  // fallbackId; here we ONLY flag missing_name if both the raw `name:` AND
  // the fallbackId produce an empty slug — otherwise the fallback is good
  // enough and the user shouldn't see a missing_name error.
  let rawMetadata: Record<string, string>;
  let rawBody: string;
  try {
    const raw = parseFrontmatterRaw(skillMd.content);
    rawMetadata = raw.metadata;
    rawBody = raw.body;
  } catch (e) {
    const msg = (e as Error).message || 'Invalid skill markdown';
    if (msg.includes('Missing YAML frontmatter')) {
      addError(errors, {
        field: 'yaml',
        code: 'missing_yaml',
        message: 'SKILL.md is missing the YAML frontmatter block (--- ... ---).',
      }, overflow);
    } else {
      addError(errors, {
        field: 'yaml',
        code: 'missing_yaml',
        message: msg,
      }, overflow);
    }
    return finalize(errors, overflow);
  }

  const rawName = (rawMetadata.name || '').trim();
  if (!rawName) {
    // Folder payloads may legitimately omit `name:` and rely on the folder
    // name as the identifier (matching SkillsManager.loadUserSkills's
    // fallback). For FILE payloads, however, the fallback would be the
    // generic `'skill'` — accepting that silently would mean every file
    // upload with no `name:` installs as id=`skill` and overwrites
    // previous uploads. Always require an explicit `name:` for file payloads.
    if (payload.kind === 'file' || !slugify(fallbackId)) {
      addError(errors, {
        field: 'name',
        code: 'missing_name',
        message: 'Skill `name:` is missing or empty.',
      }, overflow);
    }
  }

  if (!rawMetadata.description || !rawMetadata.description.trim()) {
    addError(errors, {
      field: 'description',
      code: 'missing_description',
      message: 'Skill `description:` is missing or empty.',
    }, overflow);
  }

  if (!rawBody || !rawBody.trim()) {
    addError(errors, {
      field: 'instructions',
      code: 'missing_instructions',
      message: 'SKILL.md body is empty (no instructions after frontmatter).',
    }, overflow);
  }

  if (errors.length > 0) {
    return finalize(errors, overflow);
  }

  // Now do the strict parse so we get the slug id. `fallbackId` was computed
  // earlier (right before the permissive parse) so both passes use the same
  // value.
  let parsed: { id: string; name: string; description: string; instructions: string };
  try {
    parsed = parseFrontmatter(skillMd.content, fallbackId);
  } catch (e) {
    // The permissive checks above should have caught every throw path; if
    // we got here something unexpected happened. Surface it as yaml/structure.
    const msg = (e as Error).message || 'Invalid skill markdown';
    addError(errors, {
      field: 'yaml',
      code: 'missing_yaml',
      message: msg,
    }, overflow);
    return finalize(errors, overflow);
  }

  // ---- Stage 3: per-field semantic validation ----------------------------
  // Name presence (parseFrontmatter already requires `id`, but a name like
  // "   " might slugify to empty even though it was provided).
  if (!parsed.name || !parsed.name.trim()) {
    addError(errors, {
      field: 'name',
      code: 'missing_name',
      message: 'Skill `name:` is missing or empty.',
    }, overflow);
  }

  // Description presence.
  if (!parsed.description) {
    addError(errors, {
      field: 'description',
      code: 'missing_description',
      message: 'Skill `description:` is missing or empty.',
    }, overflow);
  }

  // Instructions presence.
  if (!parsed.instructions || !parsed.instructions.trim()) {
    addError(errors, {
      field: 'instructions',
      code: 'missing_instructions',
      message: 'SKILL.md body is empty (no instructions after frontmatter).',
    }, overflow);
  }

  // Kebab-case round-trip (skip if name is missing — that's a different error).
  if (parsed.name && parsed.name.trim()) {
    if (!isStrictKebabCase(parsed.name)) {
      addError(errors, {
        field: 'name',
        code: 'name_not_kebab_case',
        message: `Skill name '${parsed.name}' must be kebab-case (lowercase letters, digits, '-' or '_', no leading/trailing dashes).`,
      }, overflow);
    }
  }

  // Builtin collision.
  if (builtinIds.has(parsed.id)) {
    addError(errors, {
      field: 'name_collision',
      code: 'name_collision_builtin',
      message: `Skill id '${parsed.id}' is reserved by a built-in skill.`,
      conflictingId: parsed.id,
    }, overflow);
  }

  // Existing-ids collision. Note: for the `file` payload kind, the caller
  // is previewing a brand-new upload — it should not include the new skill's
  // own id in `existingIds`. We do NOT auto-exclude it here because in
  // `folder` re-install scenarios the caller may explicitly include it.
  if (existingIds && existingIds.has(parsed.id)) {
    addError(errors, {
      field: 'name_collision',
      code: 'name_collision_existing',
      message: `Skill id '${parsed.id}' is already installed.`,
      conflictingId: parsed.id,
    }, overflow);
  }

  if (errors.length > 0) {
    return finalize(errors, overflow);
  }

  // ---- Stage 4: build preview -------------------------------------------
  const counts = { reference: 0, asset: 0, script: 0, other: 0 };
  const fileTree: string[] = [];
  for (const f of extracted.files) {
    // For a single-file upload the on-disk name is ALWAYS `SKILL.md`
    // (regardless of the user's original filename), because that is the
    // exact name SkillsManager.loadUserSkills() reads. Reflect that in the
    // preview's fileTree so the user sees the real installed name AND the
    // installer's write loop (which iterates fileTree) targets SKILL.md.
    const displayPath = payload.kind === 'file' ? 'SKILL.md' : f.relPath;
    fileTree.push(displayPath);
    // SKILL.md itself is `other` for accounting purposes.
    const klass = classifyPath(displayPath);
    counts[klass] += 1;
  }
  // Case-insensitive sort.
  fileTree.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const previewBody = parsed.instructions.trim();
  let instructionsPreview: string;
  if (previewBody.length <= maxInstructionsPreview) {
    instructionsPreview = previewBody;
  } else {
    instructionsPreview = previewBody.slice(0, maxInstructionsPreview) + '…';
  }

  return {
    ok: true,
    preview: {
      id: parsed.id,
      name: parsed.name,
      description: parsed.description,
      instructionsPreview,
      referenceCount: counts.reference,
      assetCount: counts.asset,
      scriptCount: counts.script,
      otherCount: counts.other,
      totalBytes,
      fileTree,
      sourceFolderName: extracted.folderName,
    },
  };
}

function finalize(errors: SkillValidationError[], overflow: { tooMany: boolean }): SkillValidationResult {
  if (overflow.tooMany && errors.length >= MAX_ERRORS) {
    // `addError` caps at MAX_ERRORS by setting overflow.tooMany=true and
    // dropping subsequent pushes, so we hit this branch once the FIRST
    // MAX_ERRORS errors have already filled the array. We append a sentinel
    // so the renderer can show "more errors existed, first 25 shown" rather
    // than silently truncating.
    errors.push({
      field: 'structure',
      code: 'too_many_errors',
      message: `Validation produced more than the ${MAX_ERRORS}-error cap; further errors were suppressed.`,
    });
  }
  return { ok: false, errors };
}