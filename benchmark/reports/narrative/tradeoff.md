**At standard OpenAI pricing, current DeepSeek beats Luna none, low and medium on all three axes at once.** It is cheaper (Luna costs 1.37-1.54× more), faster (Luna's p50 is 2.3-2.6× longer) and retains more facts (+5.8 to +6.7 pp, significant). At OpenAI Flex pricing, Luna none/low/medium become 23-32% cheaper, but still slower (Flex adds latency, not measured here) and less accurate. The trade becomes about 25% lower cost for ~6 pp less fact retention and more than 2× the latency.

Only two configurations score higher than the current one on quality, and neither difference is statistically significant with this corpus:

| Upgrade over current | Δ fact retention | Extra cost | Extra latency (p50) | Production deadline breaches |
|---|---|---|---|---|
| DeepSeek V4.1 Flash, thinking ON | +1.5 pp [−2.8, +5.1] | 1.87× | 2.75× (114 s) | 29/33 runs |
| GPT-5.6 Luna max | +2.8 pp [−0.8, +7.3] (8 conversations) | 7.05× | 14.5× (598 s) | 20/20 runs |

If Natively later decides a few points of retention are worth paying for, DeepSeek-thinking is the far cheaper and faster way to get them. Neither is justified by this data for a high-volume default.
