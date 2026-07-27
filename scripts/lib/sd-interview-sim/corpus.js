// scripts/lib/sd-interview-sim/corpus.js
//
// File-based corpus I/O for SD interview sim transcript bundles.
// Path convention (repo-relative, gitignored): traces/sd-interview-sim/
// Separate from meeting DB — never writes product persistence.

'use strict';

const fs = require('fs');
const path = require('path');
const { writeCorpusDigest } = require('./digest');

/** Repo-relative corpus directory. Contents are gitignored; see .gitignore. */
const CORPUS_DIR_RELATIVE = 'traces/sd-interview-sim';

const REDACTED = '[REDACTED]';

/** Object keys whose entire value is replaced (credential-shaped fields). */
const SECRET_KEY_RE =
  /^(authorization|x-natively-key|x-trial-token|api[_-]?key|.*(?:secret|password|token).*)$/i;

/** Obvious secret substrings in free text. */
const SECRET_VALUE_PATTERNS = [
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi,
  /\b(?:GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|CLAUDE_API_KEY|GROQ_API_KEY|API_KEY)\s*[=:]\s*\S+/gi,
];

/**
 * @param {string} text
 * @returns {string}
 */
function redactString(text) {
  let out = String(text);
  for (const re of SECRET_VALUE_PATTERNS) {
    // Reset lastIndex for global regexes reused across calls.
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  return out;
}

/**
 * Deep-clone value while redacting key-like secrets and credential fields.
 * Does not mutate the input.
 *
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
function redactSecrets(value, key = '') {
  if (typeof value === 'string') {
    if (key && SECRET_KEY_RE.test(key)) return REDACTED;
    return redactString(value);
  }
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  const out = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(childKey)) {
      out[childKey] = REDACTED;
    } else {
      out[childKey] = redactSecrets(child, childKey);
    }
  }
  return out;
}

/**
 * Resolve corpus directory. Prefer explicit `corpusDir` (tests / callers);
 * otherwise join `repoRoot` or `process.cwd()` with CORPUS_DIR_RELATIVE.
 *
 * @param {{ corpusDir?: string, repoRoot?: string }} [opts]
 * @returns {string}
 */
function resolveCorpusDir(opts = {}) {
  if (opts.corpusDir) return opts.corpusDir;
  const root = opts.repoRoot || process.cwd();
  return path.join(root, CORPUS_DIR_RELATIVE);
}

/**
 * Serialize a finalize()'d bundle to the corpus dir after redaction,
 * and write a paired review digest (`*.digest.md`).
 *
 * @param {object} bundle
 * @param {{ corpusDir?: string, repoRoot?: string, filename?: string, skipDigest?: boolean }} [opts]
 * @returns {{ path: string, digestPath?: string | null, bundle: object }}
 */
function writeCorpusBundle(bundle, opts = {}) {
  const dir = resolveCorpusDir(opts);
  fs.mkdirSync(dir, { recursive: true });

  const redacted = /** @type {object} */ (redactSecrets(bundle));
  const runId = typeof redacted.run_id === 'string' && redacted.run_id
    ? redacted.run_id
    : 'unknown';
  const filename = opts.filename || `${runId}.json`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');

  let digestPath = null;
  if (opts.skipDigest !== true) {
    digestPath = writeCorpusDigest(redacted, { jsonPath: filePath }).path;
  }

  return { path: filePath, digestPath, bundle: redacted };
}

/**
 * Keep the newest `keepCount` `*.json` runs in `corpusDir`; delete older ones
 * and their paired `*.digest.md` files. Sorted by mtime (newest first).
 * Non-json entries are ignored (except paired digests of deleted JSON).
 *
 * @param {string} corpusDir
 * @param {number} keepCount
 * @returns {{ kept: string[], deleted: string[] }}
 */
function retainLastN(corpusDir, keepCount) {
  if (!Number.isInteger(keepCount) || keepCount < 0) {
    throw new Error('retainLastN keepCount must be a non-negative integer');
  }
  if (!fs.existsSync(corpusDir)) {
    return { kept: [], deleted: [] };
  }

  const entries = fs
    .readdirSync(corpusDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const full = path.join(corpusDir, name);
      const stat = fs.statSync(full);
      return { name, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));

  const kept = entries.slice(0, keepCount).map((e) => e.name);
  const deleted = [];
  for (const entry of entries.slice(keepCount)) {
    const jsonFull = path.join(corpusDir, entry.name);
    fs.unlinkSync(jsonFull);
    deleted.push(entry.name);

    const digestName = entry.name.replace(/\.json$/i, '.digest.md');
    const digestFull = path.join(corpusDir, digestName);
    if (fs.existsSync(digestFull)) {
      fs.unlinkSync(digestFull);
      deleted.push(digestName);
    }
  }
  return { kept, deleted };
}

module.exports = {
  CORPUS_DIR_RELATIVE,
  redactSecrets,
  resolveCorpusDir,
  writeCorpusBundle,
  retainLastN,
};
