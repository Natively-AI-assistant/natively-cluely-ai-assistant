import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadDefenceConfig } from '../../../dist-electron/electron/defence/config.js';
import { encodeMonoPcmWav, WindowsVadSegmenter } from '../../../dist-electron/electron/defence/windowsAudioCapture.js';
import { SourceArbiter, audioFingerprintSimilarity, transcriptSimilarity } from '../../../dist-electron/electron/defence/sourceArbiter.js';

function speechFrame(amplitude = 12_000) {
  const frame = Buffer.alloc(640);
  for (let offset = 0; offset < frame.length; offset += 2) frame.writeInt16LE(amplitude, offset);
  return frame;
}

test('process loopback and iPhone output-only remain the safe production defaults', () => {
  const config = loadDefenceConfig({});
  assert.equal(config.input.mode, 'windows-audio');
  assert.equal(config.input.source, 'specific-process-loopback');
  assert.equal(config.input.dualSource.enabled, false);
  assert.equal(config.input.scenario, 'remote-interview');
  assert.equal(config.input.iphoneOutputOnly, true);
  assert.equal(config.storeAudio, false);
  assert.ok(config.input.vad.silenceMs >= 500 && config.input.vad.silenceMs <= 800);
});

test('output-only PWA exits before requesting microphone permission', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const startFunction = source.slice(source.indexOf('async function start()'), source.indexOf('async function stop()'));
  assert.ok(startFunction.indexOf("if(diagnostics.iphoneOutputOnly)throw") >= 0);
  assert.ok(startFunction.indexOf("if(diagnostics.iphoneOutputOnly)throw") < startFunction.indexOf('getUserMedia'));
  assert.match(source, /classList\.toggle\('hidden',outputOnly\)/);
});

test('mono PCM is encoded as a valid 16 kHz WAV', () => {
  const wav = encodeMonoPcmWav(Buffer.alloc(640));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
});

test('many PCM frames produce one final utterance and repeated audio is suppressed', () => {
  const config = loadDefenceConfig({ VAD_MIN_SPEECH_MS: '300', VAD_SILENCE_MS: '600', VAD_RMS_THRESHOLD: '0.01' });
  const segmenter = new WindowsVadSegmenter(config.input.vad, 'system-loopback', 'remote-process', 'system:test');
  const utterances = []; const duplicates = [];
  segmenter.on('utterance', value => utterances.push(value));
  segmenter.on('duplicate', value => duplicates.push(value));
  const audio = Buffer.concat([...Array(20).fill(0).map(() => speechFrame()), Buffer.alloc(640 * 30)]);
  segmenter.push(audio, performance.now());
  segmenter.push(audio, performance.now() + 1_000);
  assert.equal(utterances.length, 1);
  assert.equal(duplicates.length, 1);
  assert.ok(utterances[0].speechMs >= 300);
  assert.equal(utterances[0].finalizationLatencyMs, 600);
  assert.equal(utterances[0].source, 'system-loopback');
  assert.equal(utterances[0].sourceType, 'remote-process');
  assert.ok(utterances[0].qpcEndMs >= utterances[0].qpcStartMs);
});

function segment(sourceType, start, fingerprint, source = sourceType === 'remote-process' ? 'specific-process-loopback' : 'windows-microphone') {
  return { wav: Buffer.alloc(44), pcmBytes: 0, durationMs: 900, speechMs: 700, captureLatencyMs: 20, finalizationLatencyMs: 600, source, sourceType, sourceId: `${sourceType}:test`, qpcStartMs: start, qpcEndMs: start + 900, energyFingerprint: fingerprint };
}

test('remote interview keeps process audio and suppresses microphone echo before STT', () => {
  const config = loadDefenceConfig({ INPUT_MODE: 'dual-process-and-microphone', DUAL_SOURCE_ENABLED: 'true', AUDIO_SCENARIO: 'remote-interview' });
  const arbiter = new SourceArbiter(config.input);
  const remote = segment('remote-process', 1_000, [.1, .4, .2, .7, .3]);
  const microphone = segment('local-microphone', 1_250, [.04, .16, .08, .28, .12]);
  assert.equal(arbiter.decideAudio(remote, true).allowStt, true);
  const decision = arbiter.decideAudio(microphone, true);
  assert.equal(decision.allowStt, false);
  assert.equal(decision.echoDuplicateSuppressed, true);
  assert.equal(arbiter.getDiagnostics().processSttRequests, 1);
  assert.equal(arbiter.getDiagnostics().microphoneSttRequests, 0);
});

test('scenario rules allow in-person microphone and hybrid non-overlapping questions', () => {
  const config = loadDefenceConfig({ AUDIO_SCENARIO: 'in-person-defence' }); const arbiter = new SourceArbiter(config.input);
  assert.equal(arbiter.decideAudio(segment('remote-process', 1_000, [.2, .1, .4]), true).allowStt, false);
  assert.equal(arbiter.decideAudio(segment('local-microphone', 3_000, [.5, .1, .2]), true).allowStt, true);
  arbiter.setScenario('hybrid');
  assert.equal(arbiter.decideAudio(segment('remote-process', 10_000, [.1, .7, .2]), true).allowStt, true);
  assert.equal(arbiter.decideAudio(segment('local-microphone', 14_000, [.7, .2, .4]), true).allowStt, true);
});

test('audio and bilingual transcript similarity thresholds detect duplicates', () => {
  assert.ok(audioFingerprintSimilarity([.1, .5, .2, .8], [.04, .2, .08, .32]) > .99);
  assert.ok(transcriptSimilarity('How does your ranking model work?', 'how does your ranking model work') >= .8);
});
