# SD routing LLM parallel + sticky exclusions

We need ≥99.99% correct `system_design_answer` detection on a versioned interviewer-intention corpus so speakable Delivery Framework runs when the interviewer means system design — including fuzzy phrasing regex misses. ADR 0004’s leftover-only hybrid never shipped an LLM path and sticky promoted negotiation/identity/meeting-admin. We adopt **parallel** SD-intention classification (promote-only, fail closed) beside the deterministic front door, tighten sticky exclusions, and gate everything in `evals/sd-routing` (mocked intention + trials).

**Status:** accepted  
**Supersedes:** ADR 0004

## Considered options

1. **Keep leftover-only hybrid (ADR 0004 as written)** — rejected; unimplemented leftover + user wants classifier help on every turn.
2. **LLM-only primary** — rejected; loses cheap high-precision false-friend vetoes and clear regex hits.
3. **Parallel promote + sticky exclusions (chosen)** — regex front door + always-on intention result; promote misses at ≥0.75; never demote regex SD; sticky excludes nego/identity/meeting-admin.

## Consequences

- Amend glossary: prefer **SD route LLM parallel**; keep hybrid as historical alias.
- `planAnswer` accepts optional `sdIntention`; sync `classifySdIntention` covers Tier A openers until/alongside SLM inject.
- Sticky promote skips negotiation / identity / general_meeting admin types.
- Eval runner supports injected `sdIntention` + classifier-dependent trials; fuzzy graduates into regression when green.
- No soft-clarify answerType; timeout → no promote.
