# DeepSeek vs Gemini Raw-Model Benchmark Report

## Quality by category (mean of correctness+completeness+actionability, max 15)

| Model | Category | Mean Score | Prompts |
|---|---|---|---|
| deepseek-v4-flash | general | 14.60 | 35 |
| deepseek-v4-flash | meeting | 14.34 | 35 |
| deepseek-v4-flash | recruiting | 14.26 | 35 |
| deepseek-v4-flash | sales | 13.91 | 35 |
| deepseek-v4-flash | technical-interview | 14.57 | 35 |
| gemini-3.1-flash-lite | general | 14.11 | 35 |
| gemini-3.1-flash-lite | meeting | 13.23 | 35 |
| gemini-3.1-flash-lite | recruiting | 12.51 | 35 |
| gemini-3.1-flash-lite | sales | 12.91 | 35 |
| gemini-3.1-flash-lite | technical-interview | 12.46 | 35 |
| gemini-3.6-flash | general | 14.31 | 35 |
| gemini-3.6-flash | meeting | 14.23 | 35 |
| gemini-3.6-flash | recruiting | 12.29 | 35 |
| gemini-3.6-flash | sales | 13.00 | 35 |
| gemini-3.6-flash | technical-interview | 13.63 | 35 |

## Coding pass rate by difficulty

| Model | Difficulty | Pass Rate | Problems |
|---|---|---|---|
| deepseek-v4-flash | easy | 100.0% | 15 |
| deepseek-v4-flash | hard | 100.0% | 14 |
| deepseek-v4-flash | medium | 97.6% | 14 |
| gemini-3.1-flash-lite | easy | 100.0% | 15 |
| gemini-3.1-flash-lite | hard | 100.0% | 14 |
| gemini-3.1-flash-lite | medium | 98.0% | 14 |
| gemini-3.6-flash | easy | 100.0% | 15 |
| gemini-3.6-flash | hard | 100.0% | 14 |
| gemini-3.6-flash | medium | 98.0% | 14 |

## Latency and cost

| Model | p50 ms | p95 ms | Total cost $ | Avg cost/call $ |
|---|---|---|---|---|
| deepseek-v4-flash | 3699 | 9665 | 0.0192 | 0.000110 |
| gemini-3.1-flash-lite | 1314 | 2463 | 0.0422 | 0.000241 |
| gemini-3.6-flash | 3951 | 6678 | 0.2099 | 0.001199 |

## Contested pairs (closest score margins — recommend manual review)

- meeting-001 (margin: 0.00)
- meeting-005 (margin: 0.00)
- meeting-006 (margin: 0.00)
- meeting-007 (margin: 0.00)
- meeting-008 (margin: 0.00)
- meeting-010 (margin: 0.00)
- meeting-011 (margin: 0.00)
- meeting-012 (margin: 0.00)
- meeting-013 (margin: 0.00)
- meeting-015 (margin: 0.00)
- meeting-017 (margin: 0.00)
- meeting-018 (margin: 0.00)
- meeting-019 (margin: 0.00)
- meeting-020 (margin: 0.00)
- meeting-021 (margin: 0.00)
- meeting-022 (margin: 0.00)
- meeting-023 (margin: 0.00)
- meeting-024 (margin: 0.00)
- meeting-025 (margin: 0.00)
- meeting-026 (margin: 0.00)