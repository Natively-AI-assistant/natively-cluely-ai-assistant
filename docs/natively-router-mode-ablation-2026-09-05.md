# With intent versus without, on real conversation, 2026-09-05

Every earlier test in this campaign used isolated questions. This one uses
continuous conversation across eight modes, because context accumulates in a
real session and that is where the classifier is most handicapped: tiers 1 and 2
see only the newest line while the model receiving their verdict sees the whole
transcript.

Fixtures are auto-captions of real recorded conversations, one per mode, used
locally. They are not written by hand. A transcript written by the person
testing a hypothesis is shaped by that hypothesis, and this campaign has already
been burned by it once: a hand written set of coding questions gave "no
classifier" 5 of 6 on code delivery where the real corpus gave it 3 of 6.

Each other-party turn is generated twice against identical accumulated history,
once with the real three-tier classifier's answer shape injected and once with
none, then judged blind in randomised order.

## Result

    mode                  with   without
    sales                   13         5
    call-center             11         7
    technical-interview      8        10
    team-meet                8        10
    general                  8        10
    looking-for-work         7        11
    lecture                  4         7
    seminar                  5        13
    TOTAL                   64        73

47 percent against 53 percent over 137 turns. Close to a wash.

## Do not read the per mode column too hard

At 18 turns a 13 to 5 split arises from a fair coin about 5 percent of the time,
and eight modes were tested. One or two extremes is what chance produces at that
scale. Sales and seminar pointing in opposite directions is consistent with
noise rather than with a mode specific effect, and nothing here establishes one.

## The first run of this test was wrong

It reported 51 to 84 and a clean story: the classifier winning only in the mode
its taxonomy was built for. That was a harness defect.

Tier 3 selects interviewer lines with `l.includes('[INTERVIEWER')`. Production
builds its transcript with `formatTranscriptForLLM`, which emits
`[INTERVIEWER]: text`, so the tier works as designed. The harness emitted
`[OTHER]` and `[USER]`, the filter matched nothing, the last interviewer line
was the empty string, `''.length < 50` was trivially true, and tier 3 returned
`follow_up`. It did so on 45 percent of turns against a measured production rate
of 0.2 percent.

Three modes flipped direction when the format was corrected. The earlier
narrative is withdrawn.

This is the third time in this campaign that a harness format defect produced a
confident wrong number: the production baseline read the same marker wrongly,
DeBERTa was ruled out on an fp16 NaN, and now this. Each failure was silent and
each number looked plausible. The common cause is reconstructing what production
feeds a component instead of reading the function that feeds it.

## What it means

The classifier performs about the same as no classifier on real continuous
conversation. That is a weaker claim than the isolated question test supported,
where no classifier won 22 to 10, and it supersedes it: continuous conversation
is the real input.

Deleting it is still the right call, but on complexity grounds rather than
because it actively harms. A component measuring indistinguishable from nothing
does not earn 121 MB, a worker thread, a poison sentinel and 52 ms of latency.

## Untested

Recruiting. Two sourcing attempts returned advice monologues rather than real
two party screening calls, and the segmentation produced four turns. Marked
untested with the reason rather than substituted with something written for the
purpose.

Windows. Everything here is macOS.

## Limits

One judge, from the same model family that generated the answers, so self
preference cannot be excluded. The judging criterion names usefulness while
speaking, which favours brevity by construction. 18 turns per mode, one run per
condition, no human judged any of it.
