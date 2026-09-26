# Nemotron 3.5 ASR — Execution Provider (EP) support findings

Task 11, Step 3. Recorded against the real downloaded model at
`/tmp/nemotron-inspect` (encoder.onnx/.data, decoder.onnx/.data,
joint.onnx/.data — the exact 9-file layout `NEMOTRON_REQUIRED_FILES`
expects), using `onnxruntime-node` directly (no app code), on this
session's machine: macOS (Darwin 25.4.0), Apple Silicon.

## Spike script (exact, as run)

```js
const { InferenceSession } = require('onnxruntime-node');
(async () => {
  for (const ep of ['coreml', 'cpu']) {
    for (const graph of ['encoder.onnx', 'decoder.onnx', 'joint.onnx']) {
      try {
        const s = await InferenceSession.create('/tmp/nemotron-inspect/' + graph, { executionProviders: [ep] });
        console.log(ep, graph, 'OK');
        await s.release();
      } catch (e) {
        console.log(ep, graph, 'FAILED:', e.message);
      }
    }
  }
})();
```

## Raw output

```
[W:onnxruntime coreml_execution_provider.cc GetCapability] CoreMLExecutionProvider::GetCapability,
  number of partitions supported by CoreML: 369  number of nodes in the graph: 1891  number of nodes supported by CoreML: 971
[W:onnxruntime session_state.cc VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the
  preferred execution providers which may or may not have a negative impact on performance.
coreml encoder.onnx OK

[W:onnxruntime coreml_execution_provider.cc GetCapability] CoreMLExecutionProvider::GetCapability,
  number of partitions supported by CoreML: 3  number of nodes in the graph: 13  number of nodes supported by CoreML: 4
[W:onnxruntime session_state.cc VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the
  preferred execution providers which may or may not have a negative impact on performance.
coreml decoder.onnx OK

[W:onnxruntime session_state.cc VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the
  preferred execution providers which may or may not have a negative impact on performance.
coreml joint.onnx OK

cpu encoder.onnx OK
cpu decoder.onnx OK
cpu joint.onnx OK
```

## Findings

**All six session-creation calls succeeded (coreml × 3 graphs, cpu × 3
graphs).** This is a pleasant surprise relative to the design doc's
expectation that CPU-only was the likely outcome — CoreML did NOT reject
any of the three graphs outright.

However, "session creation succeeded" is not the same as "fully CoreML
accelerated" — the CoreML EP's own `GetCapability` log lines show it only
claims a **subset** of each graph's nodes, with the remainder silently
falling back to CPU ops within the same session (ONNX Runtime's normal
hybrid-EP graph partitioning, not an error):

| Graph | Total nodes | CoreML-claimed nodes | CoreML coverage |
|---|---|---|---|
| encoder.onnx | 1891 | 971 | ~51% |
| decoder.onnx | 13 | 4 | ~31% |
| joint.onnx | (not logged — session_state warning fired but no `GetCapability` partition-count line was printed for this graph in the captured output, meaning either 0 or all nodes were CoreML-assignable; not distinguished by the available log line) | — | unknown |

The encoder (by far the largest and most latency-relevant graph, 1891
nodes) is only ~51% covered by CoreML — the rest of its ops execute on
CPU inside the same session. This is a materially different claim from
"the encoder runs on CoreML" — it runs as a **mixed CoreML/CPU graph**.
Actual latency impact of that partial split was **not measured** in this
spike (the spike only checks session-creation success, per the brief's
scope for Step 3) — a real throughput/latency comparison of `['coreml']`
vs `['cpu']` sessions on real audio would be needed before treating CoreML
as a real acceleration path for this model, not just "doesn't crash."

`nemotronEngine.ts`'s `createSessionWithFallback()` already requests
`executionProviders` from the caller and falls back to `['cpu']` on any
session-creation failure — since CoreML session creation does NOT fail
here, that fallback path is never exercised for this model on this
hardware; whatever EP list the caller passes for `['coreml', ...]`-style
requests would actually attempt CoreML with the above partial-coverage
behavior, not silently skip to CPU.

## Windows / DirectML

**Not executed in this session — there is no Windows environment
available here.** Per the task brief, this is stated explicitly rather
than speculated about: no DirectML EP support claim, positive or
negative, is made for Nemotron's three graphs. This remains an open item
requiring physical Windows verification before DirectML is assumed to
work (or assumed not to work) for this model.
