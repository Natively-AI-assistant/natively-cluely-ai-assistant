// electron/context-intelligence/policies/answer-policy-store.ts
//
// Persistence for the ONE user-facing grounding control (§6).
//
// A choice that is stored but never read is the unwired-architecture disease
// this mission documents (F1/F9/F10), so this store exists only because the
// consumers do: `decide()` honours `userAnswerPolicy`, and the wired surfaces
// read the store per turn. Keep it that way — do not add fields here ahead of a
// consumer.
//
// Storage is a single small JSON file in userData rather than a DB column: the
// modes table is versioned by migration (v25 at time of writing) and a
// per-mode UI preference does not justify a schema bump. The file is read
// lazily and cached; writes are atomic (tmp + rename) so a crash mid-write
// cannot corrupt every mode's choice.
//
// Keys are the mode's UNIQUE id when one exists (two custom modes share a
// templateType but never an id), falling back to templateType for the built-in
// singletons.

import * as fs from 'fs';
import * as path from 'path';
import type { AnswerPolicy } from './answer-policy';

const FILE_NAME = 'context-intelligence-answer-policy.json';

let cached: Record<string, AnswerPolicy> | null = null;
let cachedDir: string | null = null;

function resolveDir(explicitDir?: string): string {
  if (explicitDir) return explicitDir;
  // Test isolation first — the same variable every harness in this repo uses —
  // then Electron userData, then a scratch fallback for bare-node contexts.
  if (process.env.NATIVELY_TEST_USERDATA) return process.env.NATIVELY_TEST_USERDATA;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app?.getPath) return app.getPath('userData');
  } catch { /* not in electron */ }
  return process.cwd();
}

function filePath(dir?: string): string {
  return path.join(resolveDir(dir), FILE_NAME);
}

function load(dir?: string): Record<string, AnswerPolicy> {
  const d = resolveDir(dir);
  if (cached && cachedDir === d) return cached;
  cachedDir = d;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(dir), 'utf8'));
    // Validate on read: only the two legal values survive. Anything else in the
    // file (hand-edited, older schema) is dropped rather than flowing into
    // groundingFor() as a surprise third state.
    cached = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (v === 'use_references_when_relevant' || v === 'only_answer_from_references') cached[k] = v;
    }
  } catch { cached = {}; }
  return cached;
}

/** The user's stored choice for a mode, or null when they never made one. */
export function getStoredAnswerPolicy(modeKey: string, dir?: string): AnswerPolicy | null {
  if (!modeKey) return null;
  return load(dir)[modeKey] ?? null;
}

/** Persist a choice; null clears it back to the mode default. */
export function setStoredAnswerPolicy(modeKey: string, policy: AnswerPolicy | null, dir?: string): void {
  if (!modeKey) return;
  const map = { ...load(dir) };
  if (policy === null) delete map[modeKey];
  else map[modeKey] = policy;
  const target = filePath(dir);
  const tmp = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
  fs.renameSync(tmp, target);
  cached = map;
}

/** Test seam: drop the cache so a fresh dir is re-read. */
export function _resetAnswerPolicyStoreForTest(): void {
  cached = null; cachedDir = null;
}
