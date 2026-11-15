// Soniox and ElevenLabs BYOK sessions ask for the current models.
//
// 2026-11-12. Soniox stt-rt-v5 is deprecated (removed 2026-12-15) and
// ElevenLabs Scribe v2 is superseded by v3, at the same prices. The model ids
// now live once in sttModelCatalog.ts; these read what the compiled classes
// would actually send, plus a source check that no call site hardcodes an id.
//
// Live-checked the same day with the app's own config (Soniox endpoint tuning
// level 2 / 0.3 / 1500 ms; ElevenLabs sample_rate + commit_strategy=vad +
// vad_silence_threshold_secs=0.8) on es/en/de fixtures: no errors, same
// transcripts and language tags, same commit timing.
//
// Platform: no platform branch in any of this — one run covers darwin and win32.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/SttFixedModels2026_11_12.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const distDir = path.resolve(repoRoot, 'dist-electron/electron/audio');
const load = (f) => require(path.join(distDir, f));
const src = (f) => fs.readFileSync(path.join(repoRoot, f), 'utf8');

describe('fixed STT models', () => {
  const cat = load('sttModelCatalog.js');

  test('the catalogue names the current models', () => {
    assert.equal(cat.SONIOX_RT_MODEL, 'stt-rt-v6');
    assert.equal(cat.ELEVENLABS_RT_MODEL, 'scribe_v3_live');
    assert.equal(cat.ELEVENLABS_BATCH_MODEL, 'scribe_v3');
  });

  test('a Soniox session asks for SONIOX_RT_MODEL, with the endpoint tuning kept', () => {
    const { SonioxStreamingSTT } = load('SonioxStreamingSTT.js');
    const frame = new SonioxStreamingSTT('k').buildConfigFrame();
    assert.equal(frame.model, 'stt-rt-v6');
    assert.equal(frame.endpoint_latency_adjustment_level, 2);
    assert.equal(frame.endpoint_sensitivity, 0.3);
    assert.equal(frame.max_endpoint_delay_ms, 1500);
  });

  test('ElevenLabs batch transcription asks for ELEVENLABS_BATCH_MODEL', () => {
    const { RestSTT } = load('RestSTT.js');
    const stt = new RestSTT('elevenlabs', 'k');
    assert.equal(stt.config.model, 'scribe_v3');
    stt.setRecognitionLanguage?.('spanish');
    assert.equal(stt.config.model, 'scribe_v3', 'a language change rebuilds the config with the same model');
  });

  test('no call site hardcodes a Soniox or Scribe model id', () => {
    const el = src('electron/audio/ElevenLabsStreamingSTT.ts');
    assert.match(el, /\?model_id=\$\{ELEVENLABS_RT_MODEL\}&/, 'the realtime URL reads the catalogue');
    for (const f of [
      'electron/audio/ElevenLabsStreamingSTT.ts',
      'electron/audio/RestSTT.ts',
      'electron/audio/SonioxStreamingSTT.ts',
      'electron/ipcHandlers.ts',
    ]) {
      const s = src(f);
      assert.doesNotMatch(s, /model(_id)?[:=]\s*'(stt-rt-v\d|scribe_v\d)/, `${f} has no hardcoded model id`);
      assert.doesNotMatch(s, /model_id=scribe_v\d/, `${f} has no hardcoded model id in a URL`);
    }
  });
});
