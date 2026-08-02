const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { WebSocket } = require('ws');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, '.defence-data', 'windows-audio-test');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const captureOnly = process.argv.includes('--capture-only');
const dualSource = process.argv.includes('--dual');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function launchChrome(profileName, url, debugPort) {
  if (!fs.existsSync(chromePath)) throw new Error(`Chrome is unavailable at ${chromePath}`);
  const profile = path.join(fixtureDir, profileName);
  fs.mkdirSync(profile, { recursive: true });
  return spawn(chromePath, [
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-mode', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${debugPort}`,
    '--window-position=-32000,-32000', '--window-size=800,600',
    url,
  ], { stdio: 'ignore', windowsHide: true });
}
function startFixtureServer() {
  const allowed = new Set(['index.html', 'control.html', 'zh.wav', 'en.wav', 'mixed.wav', 'control.wav']);
  const server = http.createServer((request, response) => {
    const name = path.basename(new URL(request.url, 'http://localhost').pathname);
    if (!allowed.has(name)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', name.endsWith('.wav') ? 'audio/wav' : 'text/html; charset=utf-8');
    fs.createReadStream(path.join(fixtureDir, name)).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}
async function inspectChrome(debugPort) {
  try {
    const pages = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json());
    const page = pages.find(item => item.type === 'page');
    if (!page?.webSocketDebuggerUrl) return { connected: true, pageFound: false };
    const debuggerSocket = await openSocket(page.webSocketDebuggerUrl);
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome evaluation timeout')), 3000);
      debuggerSocket.once('message', raw => { clearTimeout(timer); resolve(JSON.parse(raw.toString())); });
      debuggerSocket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `({url:location.href,title:document.title,status:document.querySelector('#status')?.textContent||null,testState:window.testState||null,audio:Array.from(document.querySelectorAll('audio')).map(a=>({paused:a.paused,ended:a.ended,currentTime:a.currentTime,duration:a.duration,error:a.error?.message||null}))})`, returnByValue: true } }));
    });
    debuggerSocket.close();
    return { connected: true, pageFound: true, ...result.result?.result?.value };
  } catch (error) { return { connected: false, error: error.message }; }
}
function terminateTree(child) {
  if (!child?.pid) return;
  try { execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }); } catch {}
}
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    socket.once('open', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

(async () => {
  const { loadDefenceConfig } = require(path.join(root, 'dist-electron', 'electron', 'defence', 'config.js'));
  const { DefenceServer } = require(path.join(root, 'dist-electron', 'electron', 'defence', 'server.js'));
  const { WindowsVadSegmenter } = require(path.join(root, 'dist-electron', 'electron', 'defence', 'windowsAudioCapture.js'));
  const { SttProvider } = require(path.join(root, 'dist-electron', 'electron', 'defence', 'providers.js'));
  const native = require(path.join(root, 'native-module'));
  const config = loadDefenceConfig(process.env);
  config.host = '127.0.0.1'; config.port = 0; config.publicMode = 'full';
  config.input.mode = dualSource ? 'dual-process-and-microphone' : 'windows-audio'; config.input.source = dualSource ? 'dual-process-and-microphone' : 'specific-process-loopback'; config.input.scenario = 'remote-interview'; config.input.iphoneOutputOnly = true;
  if (!config.stt.apiKey) throw new Error('STT provider is not configured');
  if (!captureOnly && !config.llm.apiKey) throw new Error('LLM provider is not configured');

  const server = new DefenceServer(config);
  const fixtureServer = await startFixtureServer();
  const systemSegments = [];
  const systemVad = new WindowsVadSegmenter(config.input.vad, 'system-loopback', 'remote-process', 'system:control');
  systemVad.on('utterance', segment => systemSegments.push(segment));
  const systemCapture = new native.SystemAudioCapture(null);
  const systemErrors = [];
  let systemAudioChunkCount = 0; let systemActiveAudioChunkCount = 0; let systemMaxRms = 0;
  function pcmRms(chunk) { let sum = 0; const samples = Math.floor(chunk.length / 2); for (let offset = 0; offset + 1 < chunk.length; offset += 2) { const value = chunk.readInt16LE(offset) / 32768; sum += value * value; } return samples ? Math.sqrt(sum / samples) : 0; }
  systemCapture.start((error, chunk) => { if (error) systemErrors.push(error.message); else if (chunk?.length) { const value = pcmRms(chunk); systemAudioChunkCount++; systemMaxRms = Math.max(systemMaxRms, value); if (value >= config.input.vad.rmsThreshold) systemActiveAudioChunkCount++; systemVad.push(chunk, performance.now()); } });
  let targetBrowser; let controlBrowser; let socket;
  const messages = [];
  try {
    const info = await server.listen(); const base = info.urls[0];
    const manifest = path.join(config.indexPath, 'manifest.json');
    if (!fs.existsSync(manifest)) await fetch(`${base}/api/project/index`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const pairing = await fetch(`${base}/api/pairing/create`, { method: 'POST' }).then(response => response.json());
    const auth = await fetch(`${base}/api/pairing/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pairing.id, secret: pairing.secret }) }).then(response => response.json());
    socket = await openSocket(`${base.replace('http', 'ws')}/api/defence/live?token=${encodeURIComponent(auth.token)}`);
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));

    // Give endpoint loopback time to initialize before either browser speaks.
    await sleep(6500);
    targetBrowser = launchChrome('target-profile', `${fixtureServer.origin}/index.html`, 9333);
    controlBrowser = launchChrome('control-profile', `${fixtureServer.origin}/control.html`, 9334);
    await sleep(800);
    if (targetBrowser.exitCode !== null) throw new Error('Target Chrome exited before capture started');
    config.input.processId = targetBrowser.pid; config.input.processName = 'chrome.exe';
    await server.startWindowsInput();
    await sleep(2500);
    const initialBrowserState = { target: await inspectChrome(9333), control: await inspectChrome(9334) };

    const deadline = Date.now() + (captureOnly ? 42_000 : 65_000);
    while (Date.now() < deadline) {
      const finals = messages.filter(message => message.type === 'transcript' && message.final).length;
      const answers = messages.filter(message => message.type === 'full_answer').length;
      if (captureOnly ? finals >= 3 : answers >= 3) break;
      await sleep(250);
    }
    await sleep(1500);
    systemCapture.stop(); systemVad.flush();
    const stt = new SttProvider(config.stt);
    const systemTranscripts = [];
    for (const segment of systemSegments) systemTranscripts.push(await stt.transcribe(segment.wav, 'audio/wav'));
    const targetTranscripts = messages.filter(message => message.type === 'transcript').map(message => message.text);
    const targetText = targetTranscripts.join(' '); const systemText = systemTranscripts.join(' ');
    const finalMessages = messages.filter(message => message.type === 'transcript' && message.final);
    const answers = messages.filter(message => message.type === 'full_answer');
    const hints = messages.filter(message => message.type === 'fast_hint');
    const finalizedEvents = messages.filter(message => message.type === 'question_finalized');
    const evidenceEvents = messages.filter(message => message.type === 'evidence');
    const messageQuestionId = message => message.questionId || message.hint?.questionId || message.answer?.questionId;
    const wssOrderValid = finalizedEvents.every(finalized => {
      const finalizedIndex = messages.indexOf(finalized); const questionId = finalized.questionId;
      const hintIndex = messages.findIndex((message, index) => index > finalizedIndex && message.type === 'fast_hint' && messageQuestionId(message) === questionId);
      const answerIndex = messages.findIndex((message, index) => index > hintIndex && message.type === 'full_answer' && messageQuestionId(message) === questionId);
      const evidenceIndex = messages.findIndex((message, index) => index > answerIndex && message.type === 'evidence' && messageQuestionId(message) === questionId);
      return hintIndex > finalizedIndex && (captureOnly || (answerIndex > hintIndex && evidenceIndex > answerIndex));
    });
    const answerQuestionIds = answers.map(messageQuestionId);
    const singleGeneration = new Set(answerQuestionIds).size === answerQuestionIds.length;
    const diagnostics = answers.map(message => message.answer?.diagnostics || {});
    const report = {
      status: finalMessages.length >= 3 && !/purple elephant|control phrase/i.test(targetText) && /purple elephant|control phrase/i.test(systemText) && wssOrderValid && singleGeneration && (captureOnly || answers.length >= 3) ? 'SUCCESS' : 'FAILED',
      captureMode: config.input.source, audioScenario: config.input.scenario, targetProcess: { name: 'chrome.exe', pid: targetBrowser.pid, includeProcessTree: true },
      targetAudioCaptured: finalMessages.length >= 3,
      nonTargetAudioExcluded: !/purple elephant|control phrase/i.test(targetText),
      systemLoopbackControl: /purple elephant|control phrase/i.test(systemText),
      silentSystemFallback: false,
      targetTranscripts, systemTranscripts,
      counts: { ...server.getWindowsInputDiagnostics(), partialTranscripts: messages.filter(message => message.type === 'transcript' && !message.final).length, finalTranscripts: finalMessages.length, finalizedQuestions: finalizedEvents.length, generations: answers.length },
      wssOrderValid, singleGeneration,
      systemCapture: { audioChunkCount: systemAudioChunkCount, activeAudioChunkCount: systemActiveAudioChunkCount, maxRms: systemMaxRms },
      browserState: { initial: initialBrowserState, final: { target: await inspectChrome(9333), control: await inspectChrome(9334) } },
      latencyMs: diagnostics.map(item => ({ capture: item.windowsCaptureMs, speechEndToVadFinal: item.questionFinalizationMs, stt: item.sttLatencyMs, retrieval: item.retrievalMs, fastHint: item.fastHintMs, llmFirstResponse: item.llmFirstResponseMs, fullAnswer: item.fullAnswerMs, llmTotal: item.llmTotalMs })),
      evidenceCounts: answers.map(message => message.answer?.evidence?.length || 0),
      systemErrors,
      rawAudioPersisted: false,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'SUCCESS' ? 0 : 1;
  } finally {
    try { socket?.close(); } catch {}
    try { systemCapture.stop(); } catch {}
    terminateTree(targetBrowser); terminateTree(controlBrowser);
    await server.close();
    await new Promise(resolve => fixtureServer.server.close(resolve));
  }
})().catch(error => { console.error(JSON.stringify({ status: 'FAILED', error: error.message })); process.exitCode = 1; });
