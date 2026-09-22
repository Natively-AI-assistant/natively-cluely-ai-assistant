**Input tokens are 5-14× the transcript size.** The ~6,500-char chunk system prompt (mode sections, density rules, grounding rules, JSON shape) is re-sent for every chunk. The polish, follow-up and title prompts then carry the extracted notes, which are themselves large.

**Cached tokens** (~14-17k per summary) come mostly from benchmark repeats and shared prompt prefixes. Real meetings would cache less, so cost below is priced cold.

**Output is dominated by chunk extraction JSON** (~28k tokens per summary for the current config).

**Reasoning spend per summary:**
- **Luna:** none 0; low ~0.7k; medium ~2k; max ~121k. Max spends 2.2× more reasoning than visible output.
- **DeepSeek thinking:** ~28k.

**Repair calls** (~1.8-2.2 per summary) are mostly polish re-tries after the "no new tokens" gate rejects the first polish. Chunk-JSON repairs are rare (0-0.12 per run).
