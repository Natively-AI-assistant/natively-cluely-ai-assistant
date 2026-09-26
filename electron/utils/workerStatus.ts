export type WorkerStatusBackend = 'onnx' | 'regex' | 'none';

export type WorkerStatusReason =
  | 'ready'
  | 'module-missing'
  | 'model-missing'
  | 'native-addon-missing'
  | 'memory-pressure'
  | 'gate-refused'
  | 'init-timeout'
  | 'unknown';

export type LocalWorkerStatus =
  | { type: 'ready'; backend: 'onnx'; modelPath?: string }
  | { type: 'degraded'; backend: WorkerStatusBackend; reason: WorkerStatusReason; message: string; recoverable: boolean }
  | { type: 'failed'; backend: WorkerStatusBackend; reason: WorkerStatusReason; message: string; recoverable: boolean };

export function classifyWorkerFailure(error: unknown): { reason: WorkerStatusReason; recoverable: boolean; message: string } {
  const message = error instanceof Error ? (error.stack || error.message) : String(error || 'unknown worker failure');
  const lower = message.toLowerCase();

  if (lower.includes('onnxruntime-common') || lower.includes('@huggingface/transformers')) {
    return { reason: 'module-missing', recoverable: false, message };
  }
  if (lower.includes('onnxruntime-node') || lower.includes('onnxruntime_binding') || lower.includes('.node')) {
    return { reason: 'native-addon-missing', recoverable: false, message };
  }
  if (lower.includes('local_files_only') || lower.includes('no such file') || lower.includes('not found') || lower.includes('missing')) {
    return { reason: 'model-missing', recoverable: false, message };
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return { reason: 'init-timeout', recoverable: true, message };
  }
  if (lower.includes('memory') || lower.includes('allocation') || lower.includes('arena')) {
    return { reason: 'memory-pressure', recoverable: true, message };
  }

  return { reason: 'unknown', recoverable: true, message };
}

export function statusMessage(status: LocalWorkerStatus): string {
  if (status.type === 'ready') return 'ONNX worker ready';
  return status.message;
}
