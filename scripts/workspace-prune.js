#!/usr/bin/env node
'use strict';

/**
 * Prune Matt-skill local artifacts under `.scratch/` and `_workspace/`.
 *
 * Usage:
 *   node scripts/workspace-prune.js              # ephemeral only (safe)
 *   node scripts/workspace-prune.js --dry-run
 *   node scripts/workspace-prune.js --features   # also drop old .scratch/<feature>
 *   node scripts/workspace-prune.js --workspace-days 7 --feature-days 21
 *   node scripts/workspace-prune.js --include-tracked
 *
 * Automation:
 *   npm run workspace:prune           # safe ephemeral
 *   npm run workspace:prune:features  # + aged feature trees
 *   husky post-merge runs ephemeral prune quietly
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const {
  DEFAULTS,
  planPrune,
  toPosix,
} = require('./lib/workspacePrune');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    features: false,
    includeTracked: false,
    workspaceDays: DEFAULTS.workspaceDays,
    featureDays: DEFAULTS.featureDays,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--features') opts.features = true;
    else if (a === '--include-tracked') opts.includeTracked = true;
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--workspace-days') opts.workspaceDays = Number(argv[++i]);
    else if (a === '--feature-days') opts.featureDays = Number(argv[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function listTrackedUnder(roots) {
  try {
    const out = execSync('git ls-files -z -- .scratch _workspace', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const set = new Set(
      out
        .split('\0')
        .filter(Boolean)
        .map((p) => toPosix(p)),
    );
    return set;
  } catch {
    return new Set();
  }
}

function walk(dir, relBase, entries) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === '.DS_Store') continue;
    const abs = path.join(dir, name);
    const rel = toPosix(path.join(relBase, name));
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      entries.push({ rel, kind: 'dir', mtimeMs: st.mtimeMs });
      walk(abs, rel, entries);
    } else if (st.isFile()) {
      entries.push({ rel, kind: 'file', mtimeMs: st.mtimeMs });
    }
  }
}

function collectEntries() {
  const entries = [];
  for (const root of ['.scratch', '_workspace']) {
    const abs = path.join(repoRoot, root);
    if (!fs.existsSync(abs)) continue;
    walk(abs, root, entries);
  }
  const tracked = listTrackedUnder();
  for (const e of entries) {
    e.tracked = tracked.has(e.rel);
  }
  return entries;
}

function rmPath(rel) {
  const abs = path.join(repoRoot, rel);
  fs.rmSync(abs, { recursive: true, force: true });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: node scripts/workspace-prune.js [options]

  --dry-run, -n          Print plan only
  --features             Also prune aged .scratch/<feature>/ trees
  --workspace-days N     Age gate for _workspace runs (default ${DEFAULTS.workspaceDays})
  --feature-days N       Age gate for .scratch features (default ${DEFAULTS.featureDays})
  --include-tracked      Allow deleting git-tracked paths
  --quiet, -q            Only print summary / deletes
`);
    process.exit(0);
  }

  const entries = collectEntries();
  const plan = planPrune({
    entries,
    features: opts.features,
    includeTracked: opts.includeTracked,
    workspaceDays: opts.workspaceDays,
    featureDays: opts.featureDays,
  });

  if (!opts.quiet) {
    console.log(
      `[workspace-prune] entries=${entries.length} delete=${plan.delete.length}` +
        ` features=${opts.features} dryRun=${opts.dryRun}`,
    );
  }

  if (plan.delete.length === 0) {
    if (!opts.quiet) console.log('[workspace-prune] nothing to prune');
    return;
  }

  for (const rel of plan.delete) {
    if (opts.dryRun) {
      console.log(`  would delete  ${rel}`);
    } else {
      rmPath(rel);
      console.log(`  deleted       ${rel}`);
    }
  }

  if (!opts.quiet && opts.dryRun) {
    console.log('[workspace-prune] dry-run complete (no changes)');
  }
}

main();
