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
  // Classify on what the error says, never on its stack: every frame of an error
  // thrown inside the library names node_modules/@huggingface/transformers/...
  // transformers.node.cjs, and the install path (a username, a folder named
  // "timeout") would otherwise decide the reason. The stack stays in `message`.
  const said = error instanceof Error ? `${error.message} ${(error as NodeJS.ErrnoException).code ?? ''}` : message;
  const lower = said.toLowerCase();

  if (lower.includes('onnxruntime-common') || lower.includes('@huggingface/transformers')) {
    return { reason: 'module-missing', recoverable: false, message };
  }
  if (lower.includes('onnxruntime-node') || lower.includes('onnxruntime_binding') || /\.node(?![\w.])/.test(lower) || lower.includes('err_dlopen_failed')) {
    return { reason: 'native-addon-missing', recoverable: false, message };
  }
  // onnxruntime's own load errors name no package: "Load model from <path>
  // failed:... File doesn't exist" and "Protobuf parsing failed." (corrupt file).
  if (lower.includes('local_files_only') || lower.includes('no such file') || lower.includes('not found') || lower.includes('missing')
    || lower.includes("doesn't exist") || lower.includes('protobuf parsing failed') || lower.includes('load model from')) {
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
