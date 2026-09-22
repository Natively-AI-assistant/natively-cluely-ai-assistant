# Three vision chain defects from the code review, 2026-09-06

All three sat in commit e079cd4a. Each was reproduced against the tree before
it was changed.

## The budget was not binding on any cloud rung

`VisionProviderFallbackChain` armed a per attempt AbortController and awaited
`provider.invoke()`. Of the providers behind `runVisionRequest` only Natively
receives `{signal, timeoutMs}`; OpenAI, Claude, Groq, LiteLLM, NIM, Gemini and
custom take neither. So the timer aborted a controller nobody listened to and
the await waited on the provider's own timeout, sixty seconds for OpenAI and
none at all for Gemini, Groq, LiteLLM or NIM.

The existing test for this case passed because its fake provider listened for
abort and rejected itself, which is the one thing the real providers do not do.
A provider that is deaf to the signal and never settles, run against the
unfixed chain under a six second test timeout, timed out. That is the
reproduction.

The chain now races the invocation against its own abort. A late result from
the orphaned request is discarded, and the catch already maps an aborted signal
to `errorClass: 'timeout'`, so the ledger is finally recording what happened.

## Manual chat kept the text deadline for screenshots

e079cd4a moved What to Answer to `totalHardTimeoutMs({ isVisionTurn })` for
screenshot turns, because the vision chain's measured first token p50 is 5.6
seconds and max 11.6, and the 7000ms text deadline was aborting roughly half of
healthy vision turns. Manual chat, the surface where a user attaches a
screenshot deliberately, was left on 7000ms.

It now takes the vision aware ceiling when images are attached and keeps the
answer type deadline otherwise. The phone mirror site the review also named
passes `undefined` for images on every call, so it has no vision turns and is
unchanged.

## Error prose was committed as a first token

LLMHelper's streaming generators yield their failures for non abort errors
rather than throwing: "Error: Custom Provider returned HTTP 500", "Error
streaming from custom provider.", "Error: Failed to stream from Ollama". The
commit gate accepted any non empty first chunk, so a provider that had failed
outright was committed, had a fabricated TTFT recorded, was marked healthy so no
later rung was tried, and in manual chat the error string was painted as the
answer.

The gate now treats exactly those three shapes as the pre commit failure they
are, anchored at the start of the chunk and kept narrow so an answer that
mentions errors still commits. The message is rethrown intact so the status
code reaches the failure classifier and the next rung is tried.

The deeper fix, generators that throw instead of yielding prose, would change
every consumer of those streams and is not taken here.

## Verified

ScreenUnderstandingBudget 8 of 8 with the deaf provider case, VisionStreamFallback
41 of 41 with the prose cases, ManualChatVisionDeadline 2 of 2. Typecheck via
`npm run typecheck:electron`. Wide suite figures are in the commit.

macOS only.
