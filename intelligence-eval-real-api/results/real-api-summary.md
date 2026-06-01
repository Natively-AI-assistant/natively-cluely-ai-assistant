# Real API Natively Intelligence E2E Report


Endpoint: `https://api.natively.software/v1/chat`
API key: len=52:natively_sk_**** (redacted)

Total tests: 100
Passed: 100
Failed: 0
Overall accuracy: 100.0%

Real API usage:
- Real API sessions created: 100
- Real streaming responses: 71
- Provider-backed responses: 71
- Deterministic fast-path responses: 29
- Mock/stub responses detected: 0

Critical tests: 22/22

Latency (real, ms):
- Manual factual p50/p95 first useful token: 0.12/0.474
- Manual LLM p50/p95 first useful token: 5710.438/8658.241
- What-to-answer p50/p95 first useful token: 4559.322/8806.715
- What-to-answer extraction p95: 1.044
- Total response p50/p95: 5734.443/9314.07

Top failures:
none

Context pollution findings:
1. none

Provider/network bottlenecks:
1. First-useful-token is dominated by provider prefill (model: gemini-3.5-flash)
2. Network RTT to https://api.natively.software/v1/chat
3. n/a

Release gate: PASS
