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

// The cache lives on globalThis, NOT at module scope, for the same reason the
// ModesManager active-mode snapshot does: esbuild inlines this module into
// every main-process entry bundle that imports it (12 dist files), and each
// inlined copy is its own module scope. The running app loads only main.js, so
// this is latent there — but any harness/eval/test process that co-loads two
// dist-electron bundles gets a writer copy (the settings IPC) and reader copies
// (engine-bridge for WTA/assist/manual-answer) whose module-level `cached`
// never see each other's writes. Both call-site comments promise "read per
// turn so a Settings change applies to the very next answer"; a process-wide
// slot is what makes that promise true in every runtime.
const CACHE_KEY = '__nativelyAnswerPolicyStoreCacheV1__';
interface PolicyCache { cached: Record<string, AnswerPolicy> | null; cachedDir: string | null }
function cacheSlot(): PolicyCache {
  const g = globalThis as unknown as Record<string, unknown>;
  let slot = g[CACHE_KEY] as PolicyCache | undefined;
  if (!slot) { slot = { cached: null, cachedDir: null }; g[CACHE_KEY] = slot; }
  return slot;
}

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
  const slot = cacheSlot();
  const d = resolveDir(dir);
  if (slot.cached && slot.cachedDir === d) return slot.cached;
  slot.cachedDir = d;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(dir), 'utf8'));
    // Validate on read: only the two legal values survive. Anything else in the
    // file (hand-edited, older schema) is dropped rather than flowing into
    // groundingFor() as a surprise third state.
    const next: Record<string, AnswerPolicy> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (v === 'use_references_when_relevant' || v === 'only_answer_from_references') next[k] = v;
    }
    slot.cached = next;
  } catch { slot.cached = {}; }
  return slot.cached;
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
  cacheSlot().cached = map;
}

/** Test seam: drop the cache so a fresh dir is re-read. */
export function _resetAnswerPolicyStoreForTest(): void {
  const slot = cacheSlot();
  slot.cached = null; slot.cachedDir = null;
}
