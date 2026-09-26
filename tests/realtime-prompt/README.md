# Real-time prompt — end-to-end harnesses

The mode "Real-time prompt" (`Mode.customContext`) was ignored at seven independent
points between the Modes editor and the model (see `electron/llm/userInstructionContract.ts`).
Unit tests could not see most of them; these harnesses are what did.

| Script | What is real | What is replaced | Network | Run |
|---|---|---|---|---|
| `e2e-wiring.cjs` | DatabaseManager (temp dir), ModesManager API, IntelligenceEngine, WhatToAnswerLLM, V3 composer, validator/repair | the provider call | no | `npm run test:realtime-prompt` |
| `e2e-typed-chat.cjs` | DatabaseManager, ModesManager API, `LLMHelper.streamChat` | provider dispatch | no | `npm run test:realtime-prompt` |
| `live-e2e.cjs` | all of the above; a REAL model answers the engine's exact prompt, then the engine post-processes that answer | the transport | **yes** (keys from `.env`) | `npm run test:realtime-prompt:live` |
| `drive-running-app.mjs` | the running app: renderer API → IPC handlers → configured provider | nothing | yes | manual, below |
| `overlay-display-check.mjs` | the same, inside a real meeting; reads the overlay window's DOM + screenshot | nothing | yes | manual, below |

`e2e-wiring.cjs` runs twice: V3 on (default) and `--v3=0` (legacy / promptSystemV2 fallback).
They run under Electron-as-Node because the database needs Electron's native-module ABI;
plain `node` fails with `ERR_DLOPEN_FAILED`. Every script uses its own temp user-data dir.

## Driving the real app (manual)

Never drive your real profile. Copy the credential files into a throwaway directory and
launch a SECOND instance on its own ports (Safe Storage is keyed to the binary, so the copy decrypts):

```sh
ISO="$(mktemp -d)"            # PowerShell: $ISO = New-Item -ItemType Directory (Join-Path $env:TEMP natively-iso)
# copy from the real userData dir (macOS: ~/Library/Application Support/natively,
# Windows: %APPDATA%\natively): credentials.enc, credentials.provenance.json, settings.json,
# license.enc, natively-preferences-secure.json, "Local State"
npm run build && npm run build:electron
NODE_ENV=production npx electron --inspect=9367 . --user-data-dir="$ISO" --remote-debugging-port=9366

node tests/realtime-prompt/drive-running-app.mjs             # typed chat, real IPC handler
node tests/realtime-prompt/drive-running-app.mjs --overlay   # live what-to-say engine path
node tests/realtime-prompt/overlay-display-check.mjs         # STARTS A MEETING (mic + system audio)
```

Afterwards quit that instance and delete `$ISO` — it holds a copy of your credentials.
Verified this way on macOS (2026-09-21). Not yet run on Windows.

## Reading a failing turn in the app log

`[UserInstructions]` — one line per V3 turn: `delivered`, what was resolved (length, language,
layout, structure), whether the app's own length line stood down, how many grounding-attack /
self-claimed-experience sentences were removed. The prompts themselves sit under `*Prompt`
keys and are only printed at debug log level `full`.
`[UserInstructions] output` — coding turns: the resolved coding format and whether repair fired.
`delivered: false` on a mode that HAS a prompt means the gate dropped it.
