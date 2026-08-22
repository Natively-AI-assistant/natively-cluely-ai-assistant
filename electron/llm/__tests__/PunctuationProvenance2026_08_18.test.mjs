// electron/llm/__tests__/PunctuationProvenance2026_08_18.test.mjs
//
// WTA audit 2026-08-18 (.audit/wta-audit.md F9 groundwork): no transcript
// turn records whether its STT provider even emits punctuation, yet question
// detection scores a missing '?' as negative evidence (extractor confidence
// 0.95 with mark+lead vs 0.4 without). Only Deepgram (smart_format) and
// Google (enableAutomaticPunctuation) request punctuation; the local models
// emit it model-inherently; Soniox/OpenAI/ElevenLabs/NativelyPro/REST
// providers do not guarantee it. MRDA research: stripping punctuation+casing
// roughly DOUBLES dialogue-act segmentation error, so the scorer must know
// which condition it is in.
//
// This is the additive groundwork: a pure provider→PunctuationSource map plus
// optional punctuationSource/sttProvider fields carried on TranscriptSegment
// and ContextItem through SessionTracker. Scoring changes come later (Phase
// 3) once the benchmark has punctuation-stripped provider-simulation cases.
// Raw text is untouched — provenance is metadata only.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/', p)).href;

const { punctuationSourceFor } = await import(dist('llm/punctuationProvenance.js'));
const { SessionTracker } = await import(dist('SessionTracker.js'));

describe('punctuationSourceFor: provider capability map', () => {
  const cases = [
    // Providers that request/emit punctuation → provider_final / provider_interim
    ['deepgram', true, 'provider_final'],
    ['deepgram', false, 'provider_interim'],
    ['google', true, 'provider_final'],
    ['google', false, 'provider_interim'],
    // REVISED after live shadow session A (2026-08-20). This pair originally
    // expected provider_final/provider_interim on the reasoning that Whisper
    // output is "model-punctuated". Live measurement falsified it: across 28
    // interviewer turns LocalWhisper emitted '.' or ',' on 15 (54%) but a '?'
    // on only 3 (11%). Question detection keys on question marks specifically,
    // so the punctuating stamp suppressed clause recovery and pushed 20 of 28
    // presses to 0.3 — under the 0.6 grounding gate, résumé dropped.
    ['local-whisper', true, 'unavailable'],
    ['local-whisper', false, 'unavailable'],
    // Providers with unconfigured/unguaranteed punctuation → unavailable
    // (scoring must treat a missing '?' as NEUTRAL for these, never negative)
    ['soniox', true, 'unavailable'],
    ['soniox', false, 'unavailable'],
    ['openai', true, 'unavailable'],
    ['elevenlabs', true, 'unavailable'],
    ['natively', true, 'unavailable'],
    ['groq', true, 'unavailable'],
    ['azure', true, 'unavailable'],
    ['ibmwatson', true, 'unavailable'],
    // Unknown providers fail safe to unavailable
    ['some-future-provider', true, 'unavailable'],
    ['', true, 'unavailable'],
  ];
  for (const [provider, isFinal, expected] of cases) {
    test(`(${JSON.stringify(provider)}, final=${isFinal}) → ${expected}`, () => {
      assert.equal(punctuationSourceFor(provider, isFinal), expected);
    });
  }
});

describe('SessionTracker carries provenance through to both stores', () => {
  test('addTranscript preserves punctuationSource + sttProvider on contextItems and fullTranscript', () => {
    const session = new SessionTracker();
    session.handleTranscript({
      speaker: 'interviewer',
      text: 'why did you choose kafka',
      timestamp: Date.now(),
      final: true,
      confidence: 1.0,
      origin: 'stt',
      sttProvider: 'soniox',
      punctuationSource: 'unavailable',
    });
    const items = session.getContext(60);
    assert.equal(items.length, 1);
    assert.equal(items[0].punctuationSource, 'unavailable');
    assert.equal(items[0].sttProvider, 'soniox');
    const full = session.getFullTranscript();
    assert.equal(full[full.length - 1].punctuationSource, 'unavailable');
    assert.equal(full[full.length - 1].sttProvider, 'soniox');
  });

  test('segments without provenance still store (legacy writers unaffected)', () => {
    const session = new SessionTracker();
    session.handleTranscript({
      speaker: 'user',
      text: 'i built an analytics pipeline for that',
      timestamp: Date.now(),
      final: true,
      origin: 'stt',
    });
    const items = session.getContext(60);
    assert.equal(items.length, 1);
    assert.equal(items[0].punctuationSource, undefined);
  });
});
