// scripts/lib/sd-interview-sim/lessonIngest.js
//
// Pure helpers for resolving / walking LESSON dirs (T2 full-loop SPEC 08).
// Electron ingest I/O stays in the CLI boot path.

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve hellointerview LESSON directory (same priority as grounding bench).
 * @param {{ repoRoot: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {string|null}
 */
function resolveLessonsDir(opts) {
  const env = opts.env || process.env;
  const repoRoot = opts.repoRoot;
  const envDir = (env.SD_LESSONS_DIR || '').trim();
  if (envDir && fs.existsSync(envDir)) return envDir;
  const repoLessons = path.join(repoRoot, 'lessons', 'hellointerview-system-design');
  if (fs.existsSync(repoLessons)) return repoLessons;
  const fixtures = path.join(repoRoot, 'scripts', 'fixtures', 'sd-grounding-lessons');
  if (fs.existsSync(fixtures)) return fixtures;
  return null;
}

/**
 * Whether live T2 should ingest LESSONS (default on; opt-out via env).
 * @param {NodeJS.ProcessEnv} [env]
 */
function shouldIngestLessonsForT2(env = process.env) {
  const raw = (env.SD_INTERVIEW_SIM_T2_INGEST_LESSONS || '').trim();
  if (raw === '0' || /^false$/i.test(raw)) return false;
  return true;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkLessonFiles(dir) {
  const results = [];
  if (!dir || !fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkLessonFiles(full));
    else if (/\.(md|txt)$/i.test(entry.name) && entry.name !== 'README.md') {
      results.push(full);
    }
  }
  return results;
}

module.exports = {
  resolveLessonsDir,
  shouldIngestLessonsForT2,
  walkLessonFiles,
};
