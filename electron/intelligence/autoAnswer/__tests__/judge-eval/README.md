# Judge eval sets — NOT replay fixtures

These files score the **judge prompt** against candidates captured from real
meetings. They deliberately live outside `../fixtures/`, which `replay.mjs`
loads wholesale as conversation fixtures — a judge set in there crashes every
replay test with `events is not iterable`.

Run them (real model, real API key, never part of `npm test`):

    node electron/intelligence/autoAnswer/__tests__/judgeEval.mjs            # every set here
    node electron/intelligence/autoAnswer/__tests__/judgeEval.mjs <file>     # just one

Each entry is one candidate the engine actually sent to the judge: its text,
the hot-window context, the ask already answered at that moment, and whether
it carries a not-yet-answered ask (`expect`).

| set | source | shape |
|---|---|---|
| `wordle-coding-round.json` | youtube 5xf4_Kx7azg 0:00-2:10 (recorded meeting fd28a1af) | single channel — a video played through speakers, so the video's candidate is on the interviewer channel |
| `google-mock-interview.json` | youtube 46dZH7LDbf8 from 1:50 | dual channel — interviewer on system audio, candidate on the mic, as production receives it |

Baseline at the time of writing: wordle 1.000/1.000, interview 0.750/1.000 with
one documented false fire (a candidate cut mid-phrase, reachable only in the
pessimistic per-final segmentation). Any prompt edit should hold these or
explain the trade.

## Regression gate (nightly)

    npm run test:auto-answer:judge-gate              # every set, 3 passes, Natively rung
    node electron/intelligence/autoAnswer/__tests__/judgeEvalGate.mjs --update-floors

`judgeEvalGate.mjs` averages several passes per set and compares precision and
recall with `../judge-eval-floors.json` (per provider; baseline mean minus
0.035, about one case). Exit 0 = at or above every floor, 1 = a set regressed
(the flipped case numbers are printed), 2 = the run itself failed (no key, or
more than 5% of calls errored — that measures the network, not the judge).
It runs one call at a time: at 6 in flight the Natively rung exceeded
natively-api's 120 requests/minute and 10% of calls came back rate-limited.
Re-baseline with `--update-floors` only after a deliberate prompt or model
change, and say why in the commit.
