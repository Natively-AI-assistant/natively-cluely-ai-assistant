# Meeting-overlay memory harness

Measures how far back the meeting overlay remembers, in the **real app**
against the **real model**, so a fix can be compared with a reference level.

## Run

```sh
NATIVELY_E2E=1 NATIVELY_TEST_TRANSCRIPT_INJECTION=1 npm run dev:agent   # isolated app, own CDP port
node tests/meeting-memory/live-memory-harness.mjs <scenario> --reps 2 --label <name> [--mode technical-interview]
node tests/meeting-memory/summarize.mjs <name>                          # tables for every run with that label
```

The harness only attaches over CDP (`agent-browser.json`); it never launches
Electron. Both env vars gate test-only hooks that do not exist in a packaged
build. `__e2e__:memory-probe` returns the V3 conversation ring and the last
composed prompts, so every lost fact can be traced to "never reached the
prompt" or "reached it and was not used".

For credentials, copy `credentials.enc`, `credentials.provenance.json`,
`license.enc`, `natively-preferences-secure.json`, `Local State` and
`settings.json` from the real profile into `.agent/userdata` (a plain spawn
decrypts them; nothing is written back). Set `ambientChatEnabled: true` there
so a meeting starts without mic/screen permission prompts.

## Scenarios

| scenario | what it measures |
|---|---|
| `typed` | 13 typed turns in a live meeting (transcript flowing, JIT index comes online mid-run); 5 unguessable facts, each probed once at a set distance |
| `typed-quiet` | same, no transcript — isolates the chat ring from meeting-scope drift |
| `typed-wta` | same, with what-to-answer turns interleaved (one shared ring) |
| `typed-long` | 32 typed turns (~an hour of use); facts at turns 1-3 and 16, probed at 29-32 |
| `wta-followup` | what-to-answer, then a follow-up about it after a real 110 s gap |
| `hour` | 60 min of backdated meeting speech, facts at minutes 2/20/45; typed and what-to-answer probes in SEPARATE meetings |
| `interview` | a live interview, both channels (mic = `user`, system audio = `interviewer`); details said aloud 13-29 min earlier; interviewer follow-ups answered by what-to-answer with no typed question |

Scoring is lexical: `recalled` needs the fact and no denial phrase; `denied`
wins even when the answer quotes the fact ("Q-47 isn't something you've
established"). Hand-check a sample — the regexes miss in both directions.

`results/` is gitignored (raw files carry whole prompts); the reference numbers
live in `BASELINE.md`.
