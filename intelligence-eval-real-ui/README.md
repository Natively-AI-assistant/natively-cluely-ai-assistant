# Real UI Intelligence E2E (Playwright Electron)

Drives the **real Natively desktop app** through Playwright's Electron API and
evaluates Profile Intelligence as a user actually experiences it: upload resume/JD
through the UI, set custom context + persona, inject a meeting transcript, press
the real **"What to answer?"** button, type manual questions, and grade the real
**streamed, DOM-visible** answers. Records latency, cost, accuracy, context usage,
screenshots, videos, traces, network.

This is the release-validation layer. Backend-only (`intelligence-eval/`) and
API-only (`intelligence-eval-real-api/`) evals are necessary but not sufficient —
they don't prove the UI saves/passes context or renders streamed answers.

## Run

```bash
export NATIVELY_TEST_API_KEY="<your-Pro-entitled-test-key>"   # never committed/logged
node scripts/build-electron.js                                 # build the real main process
node intelligence-eval-real-ui/scripts-generate-fixtures.mjs   # (re)generate fixture text files

# Full eval (runner — launches app, loads 10 profiles via UI, runs 100 cases):
NATIVELY_TEST_API_KEY="$NATIVELY_TEST_API_KEY" npm run eval:intelligence:ui
#   --profiles=backend-engineer,ml-engineer   subset
#   --max=20                                  cap cases (smoke)

# Or via Playwright spec files (focused real-UI specs):
npm run test:intelligence:ui            # headless
npm run test:intelligence:ui:headed     # watch it drive the real app
npm run test:intelligence:ui:debug      # PWDEBUG inspector
npm run test:intelligence:ui:report     # open last HTML report
```

## Preconditions (the suite fails loudly, never fabricates)
- `NATIVELY_TEST_API_KEY` set, and its plan includes **Pro** (Profile Intelligence
  is genuinely Pro-gated — see REAL_UI_TESTING_APPROACH.md).
- `dist-electron` built.
- A GUI window-server session (Electron windows must open).

## Layout
- `helpers/` — launch, auth (real Pro activation), profile/resume/JD/custom/persona
  loaders (real UI), transcript injector (real IPC), what-to-answer + manual drivers,
  streaming response observer (DOM-verified), latency/cost/network recorders, grader,
  secret-redactor, report-writer.
- `fixtures/<profile>/` — real text files for the 10 synthetic profiles.
- `test-cases/real-ui-100-e2e.json` — the same 100 cases as the backend eval (unmodified).
- `tests/*.spec.ts` — Playwright specs (manual, what-to-answer, context-isolation, latency, cost).
- `run-real-ui-e2e.ts` — the orchestrating runner that writes all reports.
- `results/` — iteration JSON + 6 markdown reports + screenshots/videos/traces/network.

## Honesty notes
See `REAL_UI_TESTING_APPROACH.md`. The only stubs are the OS file picker
(Playwright can't click a native dialog) and the app's own test-gated
`test-inject-transcript` IPC. Nothing bypasses the intelligence layer, the prompt
builder, or the provider. Cost is `estimated` (SSE has no usage field). The API
key never reaches disk (only a `natively_sk_****` fingerprint).
