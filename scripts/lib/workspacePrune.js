'use strict';

/**
 * Prune rules for Matt-skill local artifacts.
 *
 * Tiers (safe → aggressive):
 *   1. ephemeral — always-safe junk (debug/smoke/archive/refs/run debris)
 *   2. aged-workspace — old _workspace skill run dirs (not active grill ledger)
 *   3. aged-features — old .scratch/<feature>/ trees (opt-in; design tracker)
 *
 * Git-tracked paths are skipped unless includeTracked=true.
 */

const DEFAULTS = {
  workspaceDays: 14,
  featureDays: 30,
  includeTracked: false,
  features: false,
};

/** Relative path prefixes always considered ephemeral (any age). */
const EPHEMERAL_GLOBS = [
  '.scratch/*/debug',
  '.scratch/*/smoke',
  '_workspace/grill-with-docs/archive',
  '_workspace/grill-with-docs/refs',
  '_workspace/code-review',
  '_workspace/doc-review',
  '_workspace/slop-cop',
  '_workspace/address-pr-comments',
  '_workspace/experiments',
];

/** Active grill ledger files — never auto-delete (resume continuity). */
const GRILL_KEEP = new Set([
  '_workspace/grill-with-docs/00_code_patterns.md',
  '_workspace/grill-with-docs/00_context.md',
  '_workspace/grill-with-docs/00_memory.md',
  '_workspace/grill-with-docs/01_question_log.md',
  '_workspace/grill-with-docs/.current-topic',
]);

function toPosix(p) {
  return String(p).split('\\').join('/');
}

function daysSince(mtimeMs, nowMs) {
  return (nowMs - mtimeMs) / 86_400_000;
}

// Match rel against a simple star-segment glob (e.g. .scratch/*/debug).
function matchesGlob(relPosix, glob) {
  const g = toPosix(glob).replace(/\/+$/, '');
  const r = toPosix(relPosix);
  if (r === g || r.startsWith(g + '/')) return true;
  const gParts = g.split('/');
  const rParts = r.split('/');
  if (rParts.length < gParts.length) return false;
  for (let i = 0; i < gParts.length; i++) {
    if (gParts[i] !== '*' && gParts[i] !== rParts[i]) return false;
  }
  return true;
}

function isEphemeral(relPosix) {
  return EPHEMERAL_GLOBS.some((g) => matchesGlob(relPosix, g));
}

function isGrillKeep(relPosix) {
  const r = toPosix(relPosix);
  if (GRILL_KEEP.has(r)) return true;
  // Keep implement/.current-run pointer if present
  if (r === '_workspace/implement/.current-run') return true;
  return false;
}

/**
 * @param {{
 *   entries: Array<{ rel: string, kind: 'file'|'dir', mtimeMs: number, tracked?: boolean }>,
 *   nowMs?: number,
 *   workspaceDays?: number,
 *   featureDays?: number,
 *   includeTracked?: boolean,
 *   features?: boolean,
 * }} opts
 * @returns {{ delete: string[], keep: Array<{ rel: string, reason: string }> }}
 */
function planPrune(opts) {
  const nowMs = opts.nowMs ?? Date.now();
  const workspaceDays = opts.workspaceDays ?? DEFAULTS.workspaceDays;
  const featureDays = opts.featureDays ?? DEFAULTS.featureDays;
  const includeTracked = opts.includeTracked ?? DEFAULTS.includeTracked;
  const features = opts.features ?? DEFAULTS.features;

  const deleteSet = new Set();
  const keep = [];

  const entries = (opts.entries || []).map((e) => ({
    ...e,
    rel: toPosix(e.rel).replace(/^\.\//, ''),
  }));

  // Sort deepest paths first so we prefer deleting leaves; callers may rm -rf roots.
  const byDepthDesc = [...entries].sort(
    (a, b) => b.rel.split('/').length - a.rel.split('/').length,
  );

  for (const e of byDepthDesc) {
    const { rel, mtimeMs, tracked } = e;
    if (!rel.startsWith('.scratch/') && !rel.startsWith('_workspace/')) {
      keep.push({ rel, reason: 'out-of-scope' });
      continue;
    }
    if (isGrillKeep(rel)) {
      keep.push({ rel, reason: 'grill-ledger' });
      continue;
    }
    if (tracked && !includeTracked) {
      keep.push({ rel, reason: 'git-tracked' });
      continue;
    }

    const age = daysSince(mtimeMs, nowMs);

    if (isEphemeral(rel)) {
      deleteSet.add(rel);
      continue;
    }

    // Aged _workspace skill run dirs (implement/<run>, etc.) — not the grill keep set.
    if (rel.startsWith('_workspace/')) {
      // Top-level skill folders under _workspace (except grill-with-docs active files).
      const parts = rel.split('/');
      // _workspace/<skill>/...
      if (parts.length >= 2 && age >= workspaceDays) {
        // Never wipe the entire grill-with-docs dir via age — only archive/refs (ephemeral).
        if (parts[1] === 'grill-with-docs') {
          keep.push({ rel, reason: 'active-grill-workspace' });
          continue;
        }
        deleteSet.add(rel);
        continue;
      }
      keep.push({ rel, reason: 'workspace-fresh' });
      continue;
    }

    // .scratch/<feature>/...
    if (features && rel.startsWith('.scratch/')) {
      const parts = rel.split('/');
      if (parts.length >= 2 && age >= featureDays) {
        deleteSet.add(rel);
        continue;
      }
      keep.push({ rel, reason: 'feature-fresh-or-disabled' });
      continue;
    }

    keep.push({ rel, reason: 'feature-prune-disabled' });
  }

  // Collapse: if a parent dir is deleted, drop children from the list for cleaner output.
  const deletes = [...deleteSet].sort();
  const collapsed = [];
  for (const rel of deletes) {
    if (collapsed.some((parent) => rel === parent || rel.startsWith(parent + '/'))) {
      continue;
    }
    // Prefer deleting the shallowest matching ephemeral/feature root when all siblings go.
    collapsed.push(rel);
  }

  // Second pass: promote to feature root when every file under .scratch/X is marked delete.
  if (features) {
    const featureRoots = new Map(); // feature -> { total, deleting }
    for (const e of entries) {
      const m = e.rel.match(/^\.scratch\/([^/]+)/);
      if (!m) continue;
      const feat = m[1];
      const slot = featureRoots.get(feat) || { total: 0, deleting: 0, mtimeMs: 0 };
      slot.total += 1;
      slot.mtimeMs = Math.max(slot.mtimeMs, e.mtimeMs);
      if (deleteSet.has(e.rel) || collapsed.some((p) => e.rel === p || e.rel.startsWith(p + '/'))) {
        slot.deleting += 1;
      }
      featureRoots.set(feat, slot);
    }
    for (const [feat, slot] of featureRoots) {
      if (
        slot.total > 0 &&
        slot.deleting === slot.total &&
        daysSince(slot.mtimeMs, nowMs) >= featureDays
      ) {
        const root = '.scratch/' + feat;
        const next = collapsed.filter((p) => p !== root && !p.startsWith(root + '/'));
        next.push(root);
        collapsed.length = 0;
        collapsed.push(...next.sort());
      }
    }
  }

  // Collapse children under selected parents again.
  const finalDeletes = [];
  for (const rel of collapsed.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
    if (finalDeletes.some((parent) => rel.startsWith(parent + '/'))) continue;
    finalDeletes.push(rel);
  }

  return { delete: finalDeletes, keep };
}

module.exports = {
  DEFAULTS,
  EPHEMERAL_GLOBS,
  GRILL_KEEP,
  planPrune,
  matchesGlob,
  isEphemeral,
  isGrillKeep,
  toPosix,
  daysSince,
};
