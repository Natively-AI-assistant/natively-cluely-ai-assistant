// scripts/e2e-sd-interview-sim.js
//
// T1 Electron fixture-interviewer matrix for sd-interview-sim (ticket 04).
//
// Boots a REAL Electron binary against a throwaway userData dir (same pattern
// as e2e-sd-requirements-gate). Additive — does NOT replace Requirements-gate
// e2e ownership and does NOT use benchmark-sd-grounding as the matrix runner.
//
// Default: stubbed SUT via SdInterviewSimRunner ($0 live API).
// Scenarios: gate→advance + post-gate probe under scripts/fixtures/sd-interview-sim/.
//
// Skip (exit 0): when dist-electron SessionTracker is missing (build not run).
//
// Run:
//   npm run build:electron
//   npm run e2e:sd-interview-sim
//   # or: NATIVELY_E2E=1 ./node_modules/.bin/electron scripts/e2e-sd-interview-sim.js
//
// CI: schedule / workflow_dispatch only — NEVER pull_request
//   (see .github/workflows/build-smoke.yml job sd-interview-sim-e2e).
//
// Do NOT use ELECTRON_RUN_AS_NODE — DatabaseManager / app.getPath need real Electron.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const distSession = path.join(distRoot, 'SessionTracker.js');

function skip(msg) {
  console.log(`[sd-interview-sim-e2e] SKIP — ${msg}`);
  process.exit(0);
}

if (!fs.existsSync(distRoot) || !fs.existsSync(distSession)) {
  skip(
    `dist-electron missing SessionTracker (need ${path.relative(repoRoot, distSession)}). ` +
      `Run: npm run build:electron`,
  );
}

// Must set before requiring electron.app for scripted runs.
process.env.NATIVELY_E2E = process.env.NATIVELY_E2E || '1';

const { app } = require('electron');
const {
  loadMatrixFixtures,
  runCoreMatrix,
} = require('./lib/sd-interview-sim/matrix.js');
const { writeCorpusBundle, resolveCorpusDir } = require('./lib/sd-interview-sim/corpus.js');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-sd-interview-sim-e2e-'));
app.setPath('userData', tmpUserData);

function resolveGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  await app.whenReady();

  const sessionMod = require(distSession);
  const SessionTracker = sessionMod.SessionTracker || sessionMod.default;
  if (!SessionTracker) {
    throw new Error('SessionTracker not exported from dist — rebuild electron');
  }

  const session = new SessionTracker();
  const fixtures = loadMatrixFixtures();
  const corpusDir = resolveCorpusDir({
    corpusDir: process.env.SD_INTERVIEW_SIM_CORPUS_DIR || undefined,
    repoRoot,
  });

  console.log(
    `[sd-interview-sim-e2e] NATIVELY_E2E=${process.env.NATIVELY_E2E} ` +
      `userData=${tmpUserData} scenarios=${fixtures.length} sut=stub corpus=${corpusDir}`,
  );

  const results = await runCoreMatrix({
    sessionTracker: session,
    provenance: { git_sha: resolveGitSha(), tier: 'T1' },
    writeBundle: (bundle, fixture) => {
      try {
        const written = writeCorpusBundle(bundle, {
          corpusDir,
          filename: `${fixture.id}-${bundle.run_id}.json`,
        });
        console.log(`[sd-interview-sim-e2e] wrote ${written.path}`);
      } catch (err) {
        console.warn(
          `[sd-interview-sim-e2e] corpus write skipped: ${err?.message || err}`,
        );
      }
    },
  });

  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(
        `PASS  ${result.id}  end_reason=${result.outcome.end_reason}  ` +
          `(${(result.notes || []).join('; ')})`,
      );
    } else {
      failed += 1;
      console.log(`FAIL  ${result.id}  :: ${result.failures.join('; ')}`);
    }
  }

  console.log(`\n[sd-interview-sim-e2e] ${results.length - failed}/${results.length} pass`);
  process.exitCode = failed === 0 ? 0 : 1;
}

function cleanup() {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

main()
  .catch((e) => {
    console.error('[sd-interview-sim-e2e] FATAL', e?.message || e);
    process.exitCode = 2;
  })
  .finally(() => {
    cleanup();
    try {
      const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
      app.exit(code);
    } catch {
      process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
    }
  });
