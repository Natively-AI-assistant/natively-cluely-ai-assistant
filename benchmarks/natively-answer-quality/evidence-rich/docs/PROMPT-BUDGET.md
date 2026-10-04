# Prompt budget: what it is today, and a proposed token-aware policy (2026-10-04)

**Nothing here is implemented.** This is the proposal the limits work points to; each step needs its own
pre-registered rule and benchmark before it touches main.

## Today (measured on main efc126a9)
There is no total prompt budget. Each source has its own cap and nothing gives way to anything else:

| Part | Size seen at runtime | Cap |
|---|---|---|
| System prompt (rules, persona, mode, language) | 23,037–26,881 chars ≈ 5,000–5,800 provider tokens | none |
| Question (typed) | any size; 400,000 chars sent | none (but altered: §3 of the tests doc) |
| Spoken window | ≤ 2,400 chars | 2,400 chars |
| Older speech (retrieved) | 1 window, usually the question's own | BM25 floor 0.2 of best |
| History | up to ~25,000 chars at 80 turns | 9,600 + 9,600 chars (+ recall 4,000, screens 16,000) |
| Reference evidence | whole files ≤ 12,000 est. tokens (≈ 50,000 chars), else 3–5 chunks ≈ 7,000 chars | per-mode evidence tokens |
| Profile | whole ≤ 6,000 est. tokens (≈ 31,000 chars), else passages | 6,000 |
| Instructions | ≤ 8,000 chars | 8,000 |
| Output | ≤ 16,000 chars shown | 16,000 chars (`max_tokens` 65,536 never binds) |

Typical request: 7,000–16,000 provider tokens. Largest benchmark request ≈ 16,000. Provider window 1,048,576.
The binding limits are all internal, and all are fixed sizes in chars or chars/4 — none is set by the model's window.

## Order of loss under pressure (today)
1. Older speech (past 2,400 chars) — first, at ~90 seconds of talk; retrieval rarely brings it back.
2. Reference content above 12,000 est. tokens — a cliff from "whole" to 3–5 chunks.
3. Lower-ranked evidence items past the per-mode budget.
4. History: full → condensed → dropped, oldest first (only after many turns; 80 turns still kept all facts).
5. Never cut on cloud models: system prompt, question, instructions.

## Proposed policy (for measurement, not for landing as is)
1. **Count real tokens, not chars/4**, at least for the switches (whole pack, whole profile): a cheap
   per-script estimate (CJK ≈ 1.6 chars/token, Latin ≈ 4, digits/JSON ≈ 2.7) measured in §6 would make the 12,000
   switch mean the same thing in every language.
2. **One request budget derived from the model**, e.g. min(model window × 0.5, a latency budget), with fixed
   reservations: system prompt, question, instructions, output. Sources fill the rest by priority:
   question > instructions > current speech > reference/profile evidence > history > older speech.
3. **Whole-file threshold from the budget, not a constant.** With DeepSeek's window, 12,000 is not a capacity limit;
   the reason to keep a threshold is first-word latency and cost. Measure answer quality AND first-word time at
   12k / 24k / 48k before choosing (Evin: "the point of natively is to answer fast").
4. **Speech window by tokens, with retrieval that works.** Fix the live-transcript scoring first (exclude the
   question's own utterance from the BM25 normalisation; stem), then decide whether 2,400 chars needs to grow.
5. **Instrumentation first:** per request, record user_input_chars, transcript chars before/after the window,
   reference chunks indexed / candidates / selected / packed, PI tokens, history chars, system chars, provider
   prompt tokens (from usage — AgentRouter's Anthropic-style `input_tokens + cache_read_input_tokens`), output
   tokens, and every truncation event with stage, source, before, after, reason. Today only the V3 trace and the
   dev-only prompt recorder exist; no streaming path asks for usage on the OpenAI-style route.
