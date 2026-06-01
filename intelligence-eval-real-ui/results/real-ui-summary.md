# Natively Real UI Intelligence E2E Report

Run metadata:
- Date: 2026-06-01
- App version: 2.7.0
- Platform: darwin-arm64
- Provider/model: natively /v1/chat
- Real UI used: yes
- Real API used: yes
- Mock responses detected: 0

Accuracy:
- Total tests: 20
- Passed: 18
- Failed: 2
- Overall accuracy: 90.0%
- Critical tests: 5/5

Latency (real UI-observed, ms):
- Avg first useful token: 6300.545
- p50 / p95 / p99 / max first useful token: 7625.705 / 10674.034 / 10674.034 / 10674.034
- Manual p50/p95 first useful token: 7625.705 / 10674.034
- What-to-answer p50/p95 first useful token: 0 / 0
- p50 / p95 / max total response: 7622.063 / 27122.985 / 27122.985

Cost:
- Total eval cost: $0.002
- Average cost/test: $0
- Cost wasted on failed tests: $0

Slowest tests:
1. PM-008 — 10674.034ms
2. PM-005 — 8376.587ms
3. ML-008 — 8227.897ms
4. PM-003 — 7937.699ms
5. ML-003 — 7625.705ms

Most expensive tests:
1. PM-008 — $0
2. PM-005 — $0
3. PM-004 — $0
4. PM-003 — $0
5. PM-007 — $0

Failed tests:
1. ML-005 [jd_alignment] — empty_answer
2. ML-009 [unknown] — missing_not_admitted:exact model accuracy

Release gate: FAIL
