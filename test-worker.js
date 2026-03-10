const { Worker, isMainThread, parentPort } = require('worker_threads');
if (isMainThread) {
  const worker = new Worker(__filename);
  worker.on('message', m => console.log('Main got:', m));
  worker.on('error', e => console.error('Worker error:', e));
  worker.on('exit', code => console.log('Worker exited:', code));
} else {
  try {
    const NativeModule = require('natively-audio');
    parentPort.postMessage('Loaded natively-audio successfully in worker!');
    process.exit(0);
  } catch (e) {
    parentPort.postMessage('Failed to load: ' + e.message);
  }
}
