# Every question refused when the mode's default source is not loaded, 2026-09-05

Found while driving the real engine for the router work, in technical-interview
mode with no résumé uploaded. A plain interviewer question came back as

    This mode only answers from your uploaded material, so I'm not pulling
    from your résumé here. Switch to a mode that enables that source and I'll
    use it.

with no provider call. Not one question. Every question, on every turn, for as
long as no résumé is attached. The same holds for looking-for-work, because both
modes seed the `profile_only` authority.

## Where it actually was

I first placed this in V3, because the V3 trace on those turns read
`answerability=NONE`. That was wrong. V3 never composed the turn at all; the
refusal fired before it, in `electron/llm/turnSourceDecision.ts`.

`resolveTurnSourceDecision` decides which sources a turn may consume. With NO
explicit request in the question, `defaultDecision()` looked only at whether the
mode's default source was loaded. Absent, it returned
`outcome: 'source_unavailable', owner: 'clarify'` with the reason
`default_profile_unavailable`. `resolveSourceOwnership` maps that outcome to
`shouldClarifyInsteadOfProfile`, and the engine's clarification short-circuit,
gated on `contextOsPropertyValidation`, which has defaulted to true since
2026-08-30, emitted the "switch modes to use your résumé" text.

So a question that asked for nothing was refused for lack of a source it never
requested.

## Why it contradicted the rest of the system

The module's own header lists four invariants. The second says an EXPLICIT
unavailable source fails closed and is not silently downgraded. Nothing in the
four covers the default source being absent when nothing was asked for, and the
fail-closed behaviour was applied to that case by omission.

The kernel disagrees with it in writing. `KernelProfileOnlyNeverClarifies`
pins `profile_only` with no facts to `sourceOwner=profile`, not clarify, with the
note "retrieval layer handles empty". The legacy `resolveSourceOwnership`
switch does the same. Two resolvers, one of them refusing.

The seven other built-in modes seed `reference_files_primary` and would have
hit the same branch as `default_reference_files_unavailable`. They escaped only
because `refusalPolicy.clarificationIsActionable` returns false for a reference
bound mode with zero files, so the short-circuit was skipped and the legacy path
answered. The two profile modes had no such guard.

## The fix

Invariant 5, added to the header and implemented in `defaultDecision()`: an
absent DEFAULT source with no explicit request answers from what remains on a
non-strict authority. Nothing private was asked for, so answering from the live
transcript and open knowledge widens nothing. The decision is `outcome:
'default'`, the owner stays the mode's default owner so the answer keeps the
candidate's voice, `allowedEvidenceKinds` carries only what exists and is not
private, and nothing is required.

Strict authorities are untouched. `reference_files_only`,
`reference_files_plus_transcript` and `transcript_only` still fail closed, which
is invariant 3 and is the point of them. Explicitly requested but unavailable
sources still fail closed, which is invariant 2, and a test pins that it
survived.

## Verified

Six new tests in `TurnSourceDecision2026_07_15.test.mjs`, including the two
that pin invariants 2 and 3 still hold. Nine source authority suites green.

On the real engine, technical-interview with no profile: four of four
interviewer turns now dispatch, all composed by V3, where four of four were
refused before. looking-for-work confirmed the same way.

Wide suite: 8,687 passing, 4 failing, and the four are exactly the known red
names recorded at the campaign baseline, listed in full with no cutoff.

## Not fixed here

The engine's candidate-profile gate treats `outcome: 'default'` with an empty
`allowedEvidenceKinds` as "profile allowed", so the résumé orchestrator may still
run on these turns. It has no résumé to read, so this is a no-op today, and the
`general_mixed` branch has behaved this way all along. It is a correctness gap
rather than a leak, and it is recorded rather than changed.

Windows untested. Every run here is macOS.
