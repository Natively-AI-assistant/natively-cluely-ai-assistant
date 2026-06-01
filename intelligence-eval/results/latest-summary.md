# Intelligence E2E — Latest Summary

Run: iteration-001
Mode: deterministic routing+grounding proxy (no live LLM keys); latency = real deterministic-stage wall-clock

## Headline

- Total tests: 100
- Passed: 100
- Failed: 0
- Overall accuracy: 100.0%
- Critical tests: 22/22 ✅
- Release gate (≥99 pass AND all critical pass): PASS ✅

## By mode

| Mode | Pass | Total | Accuracy |
|------|-----:|------:|---------:|
| manual_input | 47 | 47 | 100.0% |
| what_to_answer | 53 | 53 | 100.0% |

## By profile

| Profile | Pass | Total | Accuracy |
|---------|-----:|------:|---------:|
| backend-engineer | 10 | 10 | 100.0% |
| ml-engineer | 10 | 10 | 100.0% |
| product-manager | 10 | 10 | 100.0% |
| sales-development-rep | 10 | 10 | 100.0% |
| ui-ux-designer | 10 | 10 | 100.0% |
| data-analyst | 10 | 10 | 100.0% |
| devops-sre | 10 | 10 | 100.0% |
| customer-success-manager | 10 | 10 | 100.0% |
| cybersecurity-analyst | 10 | 10 | 100.0% |
| founder-ceo-bd | 10 | 10 | 100.0% |

## By pattern

| Pattern | Pass | Total | Accuracy |
|---------|-----:|------:|---------:|
| approach | 3 | 3 | 100.0% |
| behavioral | 3 | 3 | 100.0% |
| context_isolation | 9 | 9 | 100.0% |
| experience_manual | 2 | 2 | 100.0% |
| follow_up | 9 | 9 | 100.0% |
| followup | 1 | 1 | 100.0% |
| identity_interviewer | 2 | 2 | 100.0% |
| identity_manual | 10 | 10 | 100.0% |
| interviewer_intro | 8 | 8 | 100.0% |
| jd_alignment | 10 | 10 | 100.0% |
| metrics_guard | 2 | 2 | 100.0% |
| metrics_manual | 1 | 1 | 100.0% |
| negotiation | 9 | 9 | 100.0% |
| persona | 1 | 1 | 100.0% |
| process | 1 | 1 | 100.0% |
| projects_interviewer | 2 | 2 | 100.0% |
| projects_manual | 8 | 8 | 100.0% |
| regression_projects | 1 | 1 | 100.0% |
| skill | 2 | 2 | 100.0% |
| skills | 6 | 6 | 100.0% |
| unknown | 10 | 10 | 100.0% |

## Latency (deterministic-stage wall-clock, ms)

| Metric | Value | Target | Status |
|--------|------:|-------:|:------:|
| Manual first-token p50 | 0.045 | <1000 | ✅ |
| Manual first-token p95 | 0.39 | <2000 | ✅ |
| What-to-answer first-token p50 | 0.054 | <3000 | ✅ |
| What-to-answer first-token p95 | 0.804 | <5000 | ✅ |
| What-to-answer extraction p95 | 0.23 | <500 | ✅ |
| Total response p50 | 0.052 | — | — |
| Total response p95 | 0.451 | — | — |

## Failures

None.

## How to rerun

```bash
node scripts/build-electron.js                                   # compile production TS → dist-electron
node intelligence-eval/scripts/generate-fixtures.mjs             # (re)build the 10 canonical fixtures
node intelligence-eval/scripts/generate-test-cases.mjs           # (re)build the 100 cases
node intelligence-eval/scripts/run-intelligence-e2e.ts           # run + grade (exits non-zero if gate fails)
node intelligence-eval/scripts/write-reports.mjs                 # regenerate these reports
```
