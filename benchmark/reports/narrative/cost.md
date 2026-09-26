**Why Luna is not cheaper here.** Per million tokens:
- **Input:** Luna $0.20, vs DeepSeek $0.15 off-peak / $0.30 peak.
- **Output:** Luna $1.20, vs DeepSeek $0.60 off-peak / $1.20 peak.

This workload spends most of its money on output (~28-30k output vs ~60-65k input tokens per summary), so Luna at `none` costs about the same as DeepSeek during DeepSeek's peak window and ~1.8× DeepSeek's off-peak price. Weighted by the weekly peak share (20.8%), the current config costs **$0.032 per summary ($32k per million summaries)**. Luna comes to $44k (low), $49k (none), $50k (medium) and $228k (max) per million.

Luna `none` is not cheaper than `low`: Luna low produced slightly *less* output in total. Its tiny reasoning budget (~0.7k tokens) was more than offset by ~3k fewer visible output tokens.

**Assumptions.**
- List prices only (no batch discounts, no negotiated rates).
- Cold cache (every meeting unique).
- DeepSeek peak/off-peak weighted by hours, assuming uniform traffic. Natively's real traffic shape would move the DeepSeek number between $0.027 (all off-peak) and $0.054 (all peak).
- Luna `cache_write_tokens` are billed as normal input.

**As billed in this benchmark**, with cache hits and all runs in DeepSeek off-peak hours: $0.024 per summary for the current config.

**Pricing-tier caveat: OpenAI Flex.** OpenAI also sells Luna under Flex processing (`service_tier: "flex"`, supported on the Responses API) and the Batch API. Both are exactly half price: $0.10 input / $0.01 cached / $0.60 output. Applying that to the measured token usage:

| Luna at Flex rates | $/summary | vs current DS (blended) | vs DS off-peak | $/1M summaries |
|---|---|---|---|---|
| none | $0.0243 | 0.75× | 0.91× | $24.3k |
| low | $0.0221 | 0.68× | 0.83× | $22.1k |
| medium | $0.0249 | 0.77× | 0.93× | $25.0k |
| max | $0.1140 | 3.52× | 4.26× | $114.0k |

So Luna none/low/medium on Flex would be **23-32% cheaper than the current config at blended DeepSeek pricing, and 7-17% cheaper than DeepSeek off-peak.** That saving comes with three costs:
- **Latency:** Flex was **not measured** here (no OpenAI credits remained). OpenAI documents it as slower, with occasional resource unavailability, on a path that is already 95-107 s p50 against 41 s.
- **Quality:** the 5.8-6.7 pp fact-retention deficit is unchanged.
- **Batch:** the 24-hour Batch API does not fit post-meeting notes a user opens right after the call.

Flex is the only way Luna meets the "cheaper" requirement, and not by the "significantly cheaper" margin while quality is lower.

**Total provider spend** for all benchmark runs was about $12.45 (DeepSeek ≈ $2.37, OpenAI ≈ $10.08).
