# Live answer benchmark (opt-in, real models)

Drives the REAL app pipeline and scores what the overlay would show. Built for the
2026-09-29 live-answer-contract investigation; see the report linked from that work.

| Surface | How it is driven |
|---|---|
| `hotkey` (Cmd+Enter) | `__e2e__:reset-session` → `__e2e__:inject-transcript {speaker:'interviewer'}` → `generateWhatToSay()` with **no** question, exactly like the button. Token batches are timed (first token, first 1.5 s). |
| `typed` | `__e2e__:manual-ask` — the real `gemini-chat-stream` handler (the overlay's typed box). |
| `wta` | `__e2e__:ask` without `hotkey` — the **auto-answer planner** path, not Cmd+Enter. |

Setup (never your real profile):

```sh
NATIVELY_E2E=1 npm run dev:agent          # isolated instance, writes ./agent-browser.json
node tests/live-answer/run.mjs <label> bench --surfaces=hotkey,typed --n=2 \
     --models=gemini-3.1-flash-lite,deepseek-flash
node tests/live-answer/context.mjs <label>             # résumé / transcript scenarios
node --experimental-strip-types tests/live-answer/report.mjs tests/live-answer/results/<label>.jsonl --full
```

Keys come from `.env` (`GEMINI_API_KEY`, `DEEPSEEK_API_KEY`) and are set into the isolated
profile over CDP; delete `.agent/userdata` afterwards — it then holds them.

The scorer (`evaluate.mjs`) is a PROXY: coaching wording, labels, headings/bullets, quoted
scripts, follow-up offers, hand-backs, disclaimer openers, invented shared context and
unrealistic commitments. It cannot judge truth — read the answers.

Traps: rebuilding `dist-electron` while the app runs does not change already-loaded
modules (restart before measuring); the same question twice in a row on the auto-answer
path returns `noDecision` (samples are interleaved for that reason).
