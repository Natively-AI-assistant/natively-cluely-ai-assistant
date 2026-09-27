| Requirement | DS Flash current | DS Flash thinking | Luna max | Luna medium | Luna low | Luna none |
|---|---|---|---|---|---|---|
| ≥70% of DS V4.1 Flash capability (screen) | baseline | pass | pass (103% of current retention) | pass (94%) | pass (93%) | pass (94%) |
| Significantly cheaper than DS V4.1 Flash (standard pricing) | baseline | **fail** (1.87×) | **fail** (7.05×) | **fail** (1.54×) | **fail** (1.37×) | **fail** (1.50×) |
| …at OpenAI Flex pricing (latency unmeasured, slower) | — | — | fail (3.52×) | marginal (0.77×) | marginal (0.68×) | marginal (0.75×) |
| Normal summary latency (~8 s good; 10-15 s acceptable; 20 s tolerable for long; 30 s+ undesirable) | fails target (41 s p50; 24 s short, 65 s very long) | fail (114 s) | **clear fail** (598 s; ~10 min) | fail (107 s) | fail (95 s) | fail (98 s) |
| Quality more important than a few seconds | — | ≈ current | ≈ current or slightly better | **worse** (−6.0 pp) | **worse** (−6.7 pp) | **worse** (−5.8 pp) |
| High volume ($ per 1M summaries) | $32k | $60k | $228k | $50k | $44k | $49k |
| Works with production deadlines as deployed | yes (0/33 breaches) | no (29/33) | no (20/20) | no (33/33) | no (33/33) | no (33/33) |

**Configurations that clearly fail the stated requirements:**
- **Luna max:** 7× cost, ~10 minutes per summary.
- **Luna medium, low and none:** each is more expensive, slower and less accurate than the current config.

The 70% capability screen is not the binding constraint. Every configuration passes it; cost and latency eliminate Luna. On OpenAI Flex, Luna low/none/medium would clear the cost bar by 23-32% (7-17% vs DeepSeek off-peak), but they would still be slower than today (Flex latency unmeasured) and retain 5.8-6.7 pp fewer facts. The saving buys a quality loss, not a like-for-like replacement.
