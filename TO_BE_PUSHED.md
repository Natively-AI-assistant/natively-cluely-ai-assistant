# TO BE PUSHED

Reminder: there is a local commit on `main` that has **not been pushed** yet.

## The commit

- **Hash:** `ee3b2fd7cccc8b9e9f2830010c6199274da71121`
- **Branch:** `main` (local is ahead of `origin/main`)
- **Subject:** `fix(meeting): app self-terminated after starting a meeting / during a call`

## What it fixes

The app killed itself ~100s after starting a meeting (and during Zoom/Meet
screen-share). Root cause: `reader.cancel()` in `electron/LLMHelper.ts` returns
a Promise that rejects with `AbortError` when a stream is aborted; the old sync
`try/catch` could not catch it, so it hit `unhandledRejection` and 5-in-60s
tripped the crash-loop guard. Fix attaches `.catch()` to `reader.cancel()`.

Files:
- `electron/LLMHelper.ts` (the one-line fix)
- `electron/llm/__tests__/StreamReaderCancelUnhandledRejection2026_09_11.test.mjs` (regression pin)

## To push later

```bash
git push origin main
```

Note: `git status` shows `main` is ahead of `origin/main` by 3 commits, so
pushing sends this fix plus the 2 earlier local commits. Confirm those are all
intended to go up before pushing:

```bash
git log origin/main..main --oneline
```

Not yet pushed as of 2026-09-12.
