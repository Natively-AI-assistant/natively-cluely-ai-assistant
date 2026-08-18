// Nemotron's encoder graph requires 3 cache tensors as input, threaded from the
// previous call's `*_next` outputs (empty/zero on the first chunk of a segment).
// Shapes are read from the live session's inputMetadata rather than hardcoded —
// see docs/superpowers/plans/nemotron-tensor-shapes.md (Task 1) for the concrete
// values this was verified against (cache_last_channel: [1,24,56,1024],
// cache_last_time: [1,24,1024,8], cache_last_channel_len: [1]); if the export
// changes, this code adapts automatically instead of silently running with
// stale hardcoded dims — a shape mismatch at session.run() throws loudly, while
// a plausible-but-wrong hardcoded shape would pass ORT's type-check silently.
import { Tensor, InferenceSession } from 'onnxruntime-node';

export interface NemotronCacheState {
  cache_last_channel: Tensor;
  cache_last_time: Tensor;
  cache_last_channel_len: Tensor;
}

const CACHE_FIELDS = ['cache_last_channel', 'cache_last_time', 'cache_last_channel_len'] as const;

function concreteDims(shape: ReadonlyArray<number | string>): number[] {
  // Symbolic dims (strings, e.g. "batch") are always batch=1 for this
  // single-stream real-time engine — this app never batches multiple audio
  // streams through one Nemotron session.
  return shape.map((d) => (typeof d === 'number' ? d : 1));
}

function zeroTensor(type: Tensor.Type, dims: number[]): Tensor {
  const count = dims.reduce((a, b) => a * b, 1);
  if (type === 'int64') return new Tensor('int64', new BigInt64Array(count), dims);
  return new Tensor('float32', new Float32Array(count), dims);
}

export function createZeroCacheState(encoderSession: InferenceSession): NemotronCacheState {
  const byName = new Map(encoderSession.inputMetadata.map((m) => [m.name, m]));
  const state = {} as NemotronCacheState;
  for (const field of CACHE_FIELDS) {
    const meta = byName.get(field);
    if (!meta || !meta.isTensor) {
      throw new Error(`Nemotron encoder graph is missing expected cache input '${field}'`);
    }
    state[field] = zeroTensor(meta.type, concreteDims(meta.shape));
  }
  return state;
}

// Note the asymmetry with createZeroCacheState: that function throws loudly
// when a declared input is missing, but this one does a plain index lookup —
// a renamed/missing `*_next` output here yields `undefined` silently. This
// matches the brief's exact interface, but a future caller (Task 7's engine)
// should know: a missing output here surfaces downstream as a confusing
// InferenceSession.run() feed-validation error, not a clear error at this
// call site.
export function nextCacheState(outputs: Record<string, Tensor>): NemotronCacheState {
  return {
    cache_last_channel: outputs['cache_last_channel_next'],
    cache_last_time: outputs['cache_last_time_next'],
    cache_last_channel_len: outputs['cache_last_channel_len_next'],
  };
}
