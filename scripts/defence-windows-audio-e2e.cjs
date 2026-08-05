const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { WebSocket } = require('ws');
const { chromium } = require('@playwright/test');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, '.defence-data', 'windows-audio-test');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const captureOnly = process.argv.includes('--capture-only');
const dualSource = process.argv.includes('--dual');
const scenarioArgument = process.argv.find(value => value.startsWith('--scenario='))?.split('=', 2)[1] || 'remote-interview';
if (!['remote-interview', 'in-person-defence', 'hybrid'].includes(scenarioArgument)) throw new Error(`Unsupported audio scenario: ${scenarioArgument}`);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function fixturePage(control = false, requestedTracks = []) {
  const allowedTracks = new Set(['zh.wav', 'en.wav', 'mixed.wav', 'control.wav']);
  const tracks = requestedTracks.filter(track => allowedTracks.has(track));
  if (!tracks.length) tracks.push(...(control ? ['control.wav'] : ['zh.wav', 'en.wav', 'mixed.wav']));
  const title = control ? 'Non-target control audio' : 'CBA Windows process-loopback target';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head><body>
<h1>${title}</h1><button id="play" type="button">Play verified audio</button>
<p id="status">loading media</p><audio id="audio" preload="auto"></audio>
<script>
const tracks = ${JSON.stringify(tracks)};
const audio = document.getElementById('audio'); const button = document.getElementById('play'); const status = document.getElementById('status');
const context = new AudioContext(); const source = context.createMediaElementSource(audio); const analyser = context.createAnalyser();
analyser.fftSize = 2048; source.connect(analyser); analyser.connect(context.destination); const samples = new Float32Array(analyser.fftSize);
let trackIndex = 0; let startedAt = 0; let raf = 0;
window.playbackState = { mediaLoaded: false, clickReceived: false, playPromiseResolved: false, playEvent: false, currentTimeAdvancing: false, rmsActive: false, maxRms: 0, playbackVerified: false, track: tracks[0], error: null };
function loadTrack() { audio.src = tracks[trackIndex]; audio.load(); window.playbackState.track = tracks[trackIndex]; }
audio.addEventListener('loadeddata', () => { window.playbackState.mediaLoaded = audio.readyState >= 2; status.textContent = 'ready — click Play'; });
audio.addEventListener('playing', () => { window.playbackState.playEvent = true; startedAt = audio.currentTime; status.textContent = 'playing ' + tracks[trackIndex]; });
function observe() { analyser.getFloatTimeDomainData(samples); let square = 0; for (const value of samples) square += value * value; const rms = Math.sqrt(square / samples.length); window.playbackState.maxRms = Math.max(window.playbackState.maxRms, rms); window.playbackState.rmsActive ||= rms > 0.001; window.playbackState.currentTimeAdvancing ||= !audio.paused && audio.currentTime > startedAt + 0.15; window.playbackState.playbackVerified = window.playbackState.mediaLoaded && window.playbackState.clickReceived && window.playbackState.playPromiseResolved && window.playbackState.playEvent && window.playbackState.currentTimeAdvancing && window.playbackState.rmsActive && !audio.paused && !audio.ended && audio.readyState >= 2 && audio.volume > 0 && !audio.muted; raf = requestAnimationFrame(observe); }
audio.addEventListener('ended', () => { if (++trackIndex < tracks.length) { loadTrack(); audio.addEventListener('canplay', () => audio.play().catch(error => { window.playbackState.error = error.message; }), { once: true }); } else { status.textContent = 'complete'; cancelAnimationFrame(raf); } });
button.addEventListener('click', async () => { window.playbackState.clickReceived = true; button.disabled = true; try { await context.resume(); await audio.play(); window.playbackState.playPromiseResolved = true; observe(); } catch (error) { window.playbackState.error = error.message; status.textContent = 'playback failed: ' + error.message; } });
loadTrack();
</script></body></html>`;
}
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
    const requestUrl = new URL(request.url, 'http://localhost');
    const name = path.basename(requestUrl.pathname);
    if (!allowed.has(name)) { response.writeHead(404).end(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', name.endsWith('.wav') ? 'audio/wav' : 'text/html; charset=utf-8');
    if (name === 'index.html' || name === 'control.html') { response.end(fixturePage(name === 'control.html', requestUrl.searchParams.get('tracks')?.split(',') || [])); return; }
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
      debuggerSocket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `({url:location.href,title:document.title,status:document.querySelector('#status')?.textContent||null,playbackState:window.playbackState||null,audio:Array.from(document.querySelectorAll('audio')).map(a=>({paused:a.paused,ended:a.ended,currentTime:a.currentTime,duration:a.duration,readyState:a.readyState,volume:a.volume,muted:a.muted,error:a.error?.message||null}))})`, returnByValue: true } }));
    });
    debuggerSocket.close();
    return { connected: true, pageFound: true, ...result.result?.result?.value };
  } catch (error) { return { connected: false, error: error.message }; }
}
async function verifyBrowserPlayback(debugPort, expectedPath) {
  let browser;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); break; }
    catch (error) { if (attempt === 29) throw error; await sleep(100); }
  }
  const pages = browser.contexts().flatMap(context => context.pages());
  const page = pages.find(candidate => { try { return new URL(candidate.url()).pathname === expectedPath; } catch { return false; } });
  if (!page) { await browser.close(); throw new Error(`Browser fixture page ${expectedPath} was not found`); }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.playbackState?.mediaLoaded === true && document.querySelector('audio')?.readyState >= 2);
  const playButton = page.getByRole('button', { name: 'Play verified audio', exact: true });
  if (await playButton.count() !== 1) { await browser.close(); throw new Error('Explicit Play button was not unique'); }
  await playButton.click();
  await page.waitForFunction(() => window.playbackState?.playbackVerified === true);
  const state = await page.evaluate(() => { const audio = document.querySelector('audio'); return { ...window.playbackState, paused: audio.paused, ended: audio.ended, currentTime: audio.currentTime, duration: audio.duration, readyState: audio.readyState, volume: audio.volume, muted: audio.muted }; });
  const verified = state.mediaLoaded && state.clickReceived && state.playPromiseResolved && state.playEvent && state.currentTimeAdvancing && state.rmsActive && state.maxRms > 0.001 && !state.paused && !state.ended && state.currentTime > 0 && state.readyState >= 2 && state.volume > 0 && !state.muted;
  if (!verified) { await browser.close(); throw new Error(`Browser playback verification failed: ${JSON.stringify(state)}`); }
  return { browser, page, state, verified };
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
  config.input.mode = dualSource ? 'dual-process-and-microphone' : 'windows-audio'; config.input.source = dualSource ? 'dual-process-and-microphone' : 'specific-process-loopback'; config.input.scenario = scenarioArgument; config.input.iphoneOutputOnly = true;
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
  let targetBrowser; let controlBrowser; let targetController; let controlController; let socket;
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
    const targetQuery = scenarioArgument === 'hybrid' ? '?tracks=en.wav' : '';
    const controlQuery = scenarioArgument === 'in-person-defence' ? '?tracks=en.wav' : scenarioArgument === 'hybrid' ? '?tracks=zh.wav' : '';
    targetBrowser = launchChrome('target-profile', `${fixtureServer.origin}/index.html${targetQuery}`, 9333);
    controlBrowser = launchChrome('control-profile', `${fixtureServer.origin}/control.html${controlQuery}`, 9334);
    await sleep(500);
    if (targetBrowser.exitCode !== null) throw new Error('Target Chrome exited before capture started');
    if (scenarioArgument !== 'in-person-defence') {
      targetController = await verifyBrowserPlayback(9333, '/index.html');
      if (!targetController.verified) throw new Error('Target playback was not verified; process capture is blocked');
    }
    config.input.processId = targetBrowser.pid; config.input.processName = 'chrome.exe';
    await server.startWindowsInput();
    if (scenarioArgument === 'hybrid') {
      await targetController.page.waitForFunction(() => document.querySelector('audio')?.ended === true);
      await sleep(1_000);
    }
    controlController = await verifyBrowserPlayback(9334, '/control.html');
    const initialBrowserState = { target: await inspectChrome(9333), control: await inspectChrome(9334) };

    const expectedQuestions = scenarioArgument === 'in-person-defence' ? 1 : scenarioArgument === 'hybrid' ? 2 : 3;
    const deadline = Date.now() + (dualSource || !captureOnly ? 75_000 : 42_000);
    while (Date.now() < deadline) {
      const finals = messages.filter(message => message.type === 'transcript' && message.final).length;
      const answers = messages.filter(message => message.type === 'full_answer').length;
      if (finals >= expectedQuestions && (!dualSource && captureOnly || answers >= expectedQuestions)) break;
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
      return hintIndex > finalizedIndex && (captureOnly && !dualSource || (answerIndex > hintIndex && evidenceIndex > answerIndex));
    });
    const answerQuestionIds = answers.map(messageQuestionId);
    const singleGeneration = new Set(answerQuestionIds).size === answerQuestionIds.length;
    const diagnostics = answers.map(message => message.answer?.diagnostics || {});
    const runtimeCounts = server.getWindowsInputDiagnostics() || {};
    const processFinalized = finalizedEvents.filter(message => message.source === 'remote-process').length;
    const microphoneFinalized = finalizedEvents.filter(message => message.source === 'local-microphone').length;
    const exactGenerationCount = finalizedEvents.length === expectedQuestions && answers.length === expectedQuestions && runtimeCounts.finalizedQuestionCount === expectedQuestions && runtimeCounts.generationCount === expectedQuestions;
    const remoteValid = scenarioArgument !== 'remote-interview' || (processFinalized === expectedQuestions && microphoneFinalized === 0 && runtimeCounts.processActiveAudioChunks > 0 && runtimeCounts.microphoneActiveAudioChunks > 0 && runtimeCounts.echoDuplicatesSuppressed > 0 && runtimeCounts.microphoneSttRequests === 0 && !/purple elephant|control phrase/i.test(targetText) && /purple elephant|control phrase/i.test(systemText));
    const inPersonValid = scenarioArgument !== 'in-person-defence' || (processFinalized === 0 && microphoneFinalized === expectedQuestions && runtimeCounts.processActiveAudioChunks === 0 && runtimeCounts.microphoneActiveAudioChunks > 0 && runtimeCounts.processSttRequests === 0 && runtimeCounts.microphoneSttRequests > 0);
    const hybridValid = scenarioArgument !== 'hybrid' || (processFinalized >= 1 && microphoneFinalized >= 1 && runtimeCounts.processActiveAudioChunks > 0 && runtimeCounts.microphoneActiveAudioChunks > 0 && runtimeCounts.processSttRequests > 0 && runtimeCounts.microphoneSttRequests > 0);
    const dualStreamValid = !dualSource || (runtimeCounts.processAudioChunks > 0 && runtimeCounts.microphoneAudioChunks > 0 && exactGenerationCount && remoteValid && inPersonValid && hybridValid);
    const processTranscripts = messages.filter(message => message.type === 'transcript' && message.sourceType === 'remote-process').map(message => message.text);
    const microphoneTranscripts = messages.filter(message => message.type === 'transcript' && message.sourceType === 'local-microphone').map(message => message.text);
    const report = {
      status: finalMessages.length >= expectedQuestions && wssOrderValid && singleGeneration && dualStreamValid && (!dualSource && captureOnly || exactGenerationCount) ? 'SUCCESS' : 'FAILED',
      captureMode: config.input.source, audioScenario: config.input.scenario, targetProcess: { name: 'chrome.exe', pid: targetBrowser.pid, includeProcessTree: true },
      targetAudioCaptured: processFinalized > 0,
      nonTargetAudioExcluded: scenarioArgument !== 'remote-interview' || !/purple elephant|control phrase/i.test(targetText),
      systemLoopbackControl: scenarioArgument === 'remote-interview' ? /purple elephant|control phrase/i.test(systemText) : systemActiveAudioChunkCount > 0,
      silentSystemFallback: false,
      targetTranscripts, processTranscripts, microphoneTranscripts, systemTranscripts,
      counts: { ...runtimeCounts, partialTranscripts: messages.filter(message => message.type === 'transcript' && !message.final).length, finalTranscripts: finalMessages.length, finalizedQuestions: finalizedEvents.length, generations: answers.length },
      wssOrderValid, singleGeneration,
      systemCapture: { audioChunkCount: systemAudioChunkCount, activeAudioChunkCount: systemActiveAudioChunkCount, maxRms: systemMaxRms },
      browserPlayback: { target: targetController?.state || null, control: controlController.state, verified: scenarioArgument === 'in-person-defence' ? controlController.verified : targetController.verified && controlController.verified },
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
    try { await targetController?.browser.close(); } catch {}
    try { await controlController?.browser.close(); } catch {}
    terminateTree(targetBrowser); terminateTree(controlBrowser);
    await server.close();
    await new Promise(resolve => fixtureServer.server.close(resolve));
  }
})().catch(error => { console.error(JSON.stringify({ status: 'FAILED', error: error.message })); process.exitCode = 1; });
