const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const binaryPath = path.join(root, 'native-module', 'index.win32-x64-msvc.node');
const native = require(path.join(root, 'native-module'));

function binaryArchitecture(file) {
  const bytes = fs.readFileSync(file);
  const pe = bytes.readInt32LE(60);
  const machine = bytes.readUInt16LE(pe + 4);
  return ({ 0x8664: 'x64', 0x14c: 'x86', 0xaa64: 'arm64' })[machine] || `0x${machine.toString(16)}`;
}

function exitedPid() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.ComSpec, ['/d', '/c', 'exit', '0'], { windowsHide: true });
    child.once('error', reject);
    child.once('exit', () => resolve(child.pid));
  });
}

function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

(async () => {
  let invalidPidError = '';
  try { new native.WindowsProcessAudioCapture(0, true); } catch (error) { invalidPidError = error.message; }
  const deadPid = await exitedPid();
  let exitedPidError = '';
  try { new native.WindowsProcessAudioCapture(deadPid, true); } catch (error) { exitedPidError = error.message; }
  let accessDeniedError = '';
  try { new native.WindowsProcessAudioCapture(4, true); } catch (error) { accessDeniedError = error.message; }

  const capture = new native.WindowsProcessAudioCapture(process.pid, true);
  const asyncErrors = [];
  const callback = error => { if (error) asyncErrors.push(error.message); };
  capture.start(callback); await pause(300); capture.stop();
  capture.start(callback); await pause(300); capture.stop();

  const stat = fs.statSync(binaryPath);
  const report = {
    status: invalidPidError && exitedPidError && /access|denied|unavailable|拒绝访问/i.test(accessDeniedError) && asyncErrors.length === 0 ? 'SUCCESS' : 'FAILED',
    binary: {
      path: path.relative(root, binaryPath),
      sha256: crypto.createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex').toUpperCase(),
      architecture: binaryArchitecture(binaryPath),
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    },
    node: { version: process.version, napi: process.versions.napi, arch: process.arch },
    apiExported: typeof native.WindowsProcessAudioCapture === 'function',
    invalidPidStructuredError: Boolean(invalidPidError),
    exitedPidStructuredError: Boolean(exitedPidError),
    accessDeniedStructuredError: Boolean(accessDeniedError),
    repeatStartStop: asyncErrors.length === 0,
    asyncErrors,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'SUCCESS' ? 0 : 1;
})().catch(error => { console.error(JSON.stringify({ status: 'FAILED', error: error.message })); process.exitCode = 1; });
