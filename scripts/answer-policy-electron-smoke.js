// scripts/answer-policy-electron-smoke.js
//
// Runs the Answer-policy V3 path inside a REAL Electron main process.
//
// Everything else in this batch runs under plain node (or ELECTRON_RUN_AS_NODE,
// which is still Node — `require('electron')` yields no `app` there). That
// leaves one thing unverified: the modules resolve `userData` through
// `electron.app.getPath('userData')`, a call that only exists in a genuine main
// process. answer-policy-store.js and contracts/flag.js BOTH depend on it, and
// both fall back silently when it is missing — so a bug there would be
// invisible to every other test in this repo.
//
// This script therefore asserts the things that can ONLY be checked here:
//   1. app.getPath('userData') resolves, and the answer-policy store round-trips
//      through the REAL userData directory with no NATIVELY_TEST_USERDATA
//      override;
//   2. a stored choice is honoured by buildV3Prompt on the very next turn
//      (the "read per turn" promise both call sites make);
//   3. option 1 does not deny and option 2 does;
//   4. no path in the composed prompt is platform-derived.
//
// Cross-platform: uses app.getPath + path.join only. The same script is the
// Windows verification when someone can run it there — it has no macOS-specific
// branch, and it prints process.platform so the report can name what ran.
//
// Usage:  npx electron scripts/answer-policy-electron-smoke.js

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const dist = path.join(repoRoot, 'dist-electron', 'electron', 'context-intelligence');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { console.log(`  PASS  ${label}`); } else { failures += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};

const REFUSALS = [
  /cannot be answered from the available material/i,
  /do not answer it from general knowledge/i,
  /do not answer from general knowledge as though it were sourced/i,
  /do not invent a template or example answer/i,
  /switching to a profile-enabled mode/i,
  /has NO reference material attached, so there was nothing to search/i,
  /say plainly what is not covered/i,
];

app.whenReady().then(async () => {
  console.log(`[electron-smoke] platform=${process.platform} arch=${process.arch} electron=${process.versions.electron}`);

  // (1) The real userData path — the thing plain node cannot exercise.
  //     Deliberately NOT setting NATIVELY_TEST_USERDATA: the point is to prove
  //     the electron branch of settingsPath()/resolveDir() works.
  delete process.env.NATIVELY_TEST_USERDATA;
  const userData = app.getPath('userData');
  ok(typeof userData === 'string' && userData.length > 0, 'app.getPath("userData") resolves', userData);
  ok(path.isAbsolute(userData), 'userData is an absolute path', userData);

  const store = require(path.join(dist, 'policies', 'answer-policy-store.js'));
  const flag = require(path.join(dist, 'contracts', 'flag.js'));
  process.env[flag.CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1';

  // Preserve whatever the developer actually has selected — this writes to the
  // REAL profile directory, so it must put it back.
  const MODE = 'looking-for-work';
  const previous = store.getStoredAnswerPolicy(MODE);
  console.log(`[electron-smoke] userData=${userData}`);
  console.log(`[electron-smoke] preserving existing choice for ${MODE}: ${previous ?? '(none)'}`);

  try {
    // (2) Round-trip through the real directory.
    store.setStoredAnswerPolicy(MODE, 'use_references_when_relevant');
    ok(store.getStoredAnswerPolicy(MODE) === 'use_references_when_relevant',
      'answer policy round-trips through the real userData dir');
    const onDisk = path.join(userData, 'context-intelligence-answer-policy.json');
    ok(fs.existsSync(onDisk), 'the policy file is written where app.getPath says', onDisk);

    const { buildV3Prompt } = require(path.join(dist, 'orchestration', 'engine-bridge.js'));
    const emptyRetrieval = { async retrieve() { return { evidence: [], attempts: [] }; } };
    const ask = (question, attached = 0) => buildV3Prompt({
      surface: 'manual-chat', question, modeTemplateType: MODE, modeUniqueId: MODE,
      attachedSourceCount: attached, attachedFileNames: attached ? ['ref.pdf'] : [],
      profileSourceCount: 0, retrieval: emptyRetrieval,
      scope: { sessionId: `electron-smoke-${question.length}-${attached}` },
    });

    // (3a) Option 1 — no refusal, on both the fresh and attached branches.
    for (const attached of [0, 1]) {
      for (const q of ['Should I negotiate my salary?', 'What do you think about remote work?',
        "Give me an example answer for 'Why do you want this role?'"]) {
        const r = await ask(q, attached);
        if (!r) { failures += 1; console.log(`  FAIL  buildV3Prompt returned null for "${q}"`); continue; }
        const hit = REFUSALS.find((re) => re.test(`${r.system}\n${r.user}`));
        ok(!hit, `option 1 / attached=${attached} / "${q.slice(0, 38)}" is not refused`, hit ? String(hit) : '');
      }
    }

    // (3b) Option 2 — the stored choice must flip behaviour on the NEXT turn,
    //      with no restart. This is the per-turn read both call sites promise.
    store.setStoredAnswerPolicy(MODE, 'only_answer_from_references');
    const strict = await ask('Should I negotiate my salary?', 1);
    ok(!!strict && REFUSALS.some((re) => re.test(`${strict.system}\n${strict.user}`)),
      'option 2 refuses on the very next turn (no restart)');

    // (4) No platform-derived text reached the prompt.
    const sample = await ask('What do you think about remote work?', 0);
    ok(!/darwin|win32|C:\\\\|\/Applications|%APPDATA%/i.test(`${sample.system}\n${sample.user}`),
      'the composed prompt carries no platform-specific path or marker');
  } finally {
    store.setStoredAnswerPolicy(MODE, previous);
    console.log(`[electron-smoke] restored ${MODE} to: ${store.getStoredAnswerPolicy(MODE) ?? '(none)'}`);
  }

  console.log(`\n[electron-smoke] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} on ${process.platform}`);
  app.exit(failures === 0 ? 0 : 1);
}).catch((e) => {
  console.error('[electron-smoke] fatal', e);
  app.exit(2);
});
