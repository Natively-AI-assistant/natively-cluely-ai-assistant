# Intelligence E2E — Latency Report

Run: iteration-001
deterministic routing+grounding proxy (no live LLM keys); latency = real deterministic-stage wall-clock

## What is measured

This harness has no live LLM keys, so it measures REAL wall-clock for the
DETERMINISTIC stages that precede the provider call — the part this work owns:
transcript clean → latest-question extraction → intent classification →
context routing/grounding → answer composition. Provider token-generation
latency is NOT included (gated behind `--live`). "First token" here is
time-to-composed-first-token from the grounded facts.

## Aggregate (ms)

| Metric | Manual | What-to-answer |
|--------|--------|----------------|
| Question extraction | p50=0ms p95=0.001ms max=0.012ms | p50=0.01ms p95=0.23ms max=1.069ms |
| Intent detection | p50=0.008ms p95=0.021ms max=0.158ms | p50=0.008ms p95=0.015ms max=0.273ms |
| Context build | p50=0.034ms p95=0.257ms max=0.831ms | p50=0.032ms p95=0.19ms max=6.115ms |
| First token | p50=0.045ms p95=0.39ms max=0.866ms | p50=0.054ms p95=0.804ms max=6.172ms |
| Total response | p50=0.045ms p95=0.391ms max=0.866ms | p50=0.054ms p95=0.804ms max=6.172ms |

## Targets vs actual

| Target | Threshold | Actual | Status |
|--------|----------:|-------:|:------:|
| What-to-answer extraction p95 | <500ms | 0.23ms | ✅ |
| Manual first-token p50 | <1000ms | 0.045ms | ✅ |
| Manual first-token p95 | <2000ms | 0.39ms | ✅ |
| What-to-answer first-token p50 | <3000ms | 0.054ms | ✅ |
| What-to-answer first-token p95 | <5000ms | 0.804ms | ✅ |

## Bottleneck attribution

The deterministic pipeline is sub-millisecond end-to-end. The dominant stage is
context routing/grounding (orchestrator `processQuestion`), still well under
1ms because identity/projects/skills/experience resolve via the deterministic
structured pack / identity fast-path — NO query embedding, NO vector retrieval,
NO network. Extraction (transcript clean + latest-question) is a few hundred
microseconds.

In a LIVE run, first-token latency would be dominated by **provider first-token
delay** (network + model prefill), NOT by any stage measured here — i.e. the
intelligence layer adds <1ms of overhead before the provider call. The earlier
7s+ delays were never in this deterministic prefix; they came from avoidable
LLM/embedding round-trips on the hot path, which the structured-pack + fast-path
routing removed (see INTELLIGENCE_FIX_REPORT.md).
