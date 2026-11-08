// LLMHelper.forceRestartOllama stopped whatever held Ollama's port with
// `lsof -t -i:11434` + `kill -9`:
//  - on Windows neither command exists, so a wedged daemon was never stopped;
//  - `lsof -i` also lists the CLIENTS connected to the port (Natively itself,
//    other apps), and every one of them was killed.
// ollamaPortProcess.ts finds only the listener, only when it is Ollama, never
// this process, on both platforms. Both branches run here on fake command output.
//
// Run: node scripts/build-electron.js && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/OllamaPortProcess2026_10_21.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const {
  ollamaPidsListeningOn, stopOllamaPid, parseLsofListeners, parseNetstatListeners, parseTasklistImageName,
} = require(path.join(repoRoot, 'dist-electron/electron/services/ollamaPortProcess.js'));

function fakeRun(outputs) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    const key = Object.keys(outputs).find((k) => [file, ...args].join(' ').startsWith(k));
    if (key === undefined) throw new Error(`unexpected command: ${file} ${args.join(' ')}`);
    return outputs[key];
  };
  return { run, calls };
}

test('macOS: only the Ollama listener is returned, never this process or another app', async () => {
  // -sTCP:LISTEN already drops connected clients; the name and self checks are
  // the second line of defence.
  const lsof = 'p4242\ncollama\np777\ncnode\np100\ncNatively Helper\n';
  const { run, calls } = fakeRun({ lsof: lsof });
  assert.deepEqual(await ollamaPidsListeningOn(11434, { platform: 'darwin', run, selfPid: 100 }), [4242]);
  assert.deepEqual(calls[0], ['lsof', '-nP', '-iTCP:11434', '-sTCP:LISTEN', '-Fpc']);
  const self = fakeRun({ lsof: 'p55\ncollama\n' });
  assert.deepEqual(await ollamaPidsListeningOn(11434, { platform: 'darwin', run: self.run, selfPid: 55 }), [], 'never this process');
  assert.deepEqual(parseLsofListeners(''), []);
});

test('macOS: stopping is a direct SIGKILL, no shell', async () => {
  const killed = [];
  await stopOllamaPid(4242, { platform: 'darwin', kill: (pid) => killed.push(pid) });
  assert.deepEqual(killed, [4242]);
});

const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012
  TCP    127.0.0.1:11434        0.0.0.0:0              LISTENING       6120
  TCP    127.0.0.1:11434        127.0.0.1:52011        ESTABLISHED     6120
  TCP    127.0.0.1:52011        127.0.0.1:11434        ESTABLISHED     9001
  TCP    [::]:11434             [::]:0                 ABHÖREN         6120
  TCP    127.0.0.1:111434       0.0.0.0:0              LISTENING       5
`;

test('Windows: the listener comes from netstat in any display language, clients and look-alike ports are not', () => {
  assert.deepEqual(parseNetstatListeners(NETSTAT, 11434), [6120]);
  assert.deepEqual(parseNetstatListeners(NETSTAT, 135), [1012]);
  assert.equal(parseTasklistImageName('"ollama.exe","6120","Console","1","512,000 K"\r\n'), 'ollama.exe');
  assert.equal(parseTasklistImageName('INFO: No tasks are running which match the specified criteria.'), null);
});

test('Windows: an Ollama listener is stopped with its children; another program on the port is left alone', async () => {
  const ollama = fakeRun({ 'netstat -ano -p TCP': NETSTAT, 'tasklist /FI PID eq 6120': '"ollama.exe","6120","Console","1","512 K"' });
  assert.deepEqual(await ollamaPidsListeningOn(11434, { platform: 'win32', run: ollama.run, selfPid: 1 }), [6120]);
  const other = fakeRun({ 'netstat -ano -p TCP': NETSTAT, 'tasklist /FI PID eq 6120': '"python.exe","6120","Console","1","512 K"' });
  assert.deepEqual(await ollamaPidsListeningOn(11434, { platform: 'win32', run: other.run, selfPid: 1 }), []);

  const stop = fakeRun({ taskkill: 'SUCCESS' });
  await stopOllamaPid(6120, { platform: 'win32', run: stop.run });
  assert.deepEqual(stop.calls, [['taskkill', '/PID', '6120', '/T', '/F']]);
});

test('an unsupported OS is refused, not run through another platform', async () => {
  await assert.rejects(ollamaPidsListeningOn(11434, { platform: 'linux', run: async () => '' }), /Unsupported platform: linux/);
  await assert.rejects(stopOllamaPid(1, { platform: 'linux' }), /Unsupported platform: linux/);
});

test('forceRestartOllama uses it; the old lsof/kill -9 is gone', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/LLMHelper.ts'), 'utf8');
  const fn = src.slice(src.indexOf('public async forceRestartOllama()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /ollamaPidsListeningOn\(port\)/);
  assert.match(body, /await stopOllamaPid\(pid\)/);
  const code = body.replace(/\/\/.*$/gm, '');
  assert.equal(/lsof|kill -9|execAsync/.test(code), false);
});
