import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDefenceConfig } from '../../../dist-electron/electron/defence/config.js';

test('CBA live defaults use current providers and promote retrievalTopK to three',()=>{
  const config=loadDefenceConfig({PROJECT_ID:'cba-import-candidate-ranking',RETRIEVAL_TOP_K:'1'});
  assert.equal(config.stt.baseUrl,'https://api.groq.com/openai/v1');
  assert.equal(config.stt.model,'whisper-large-v3-turbo');
  assert.equal(config.llm.baseUrl,'https://api.deepseek.com');
  assert.equal(config.llm.model,'deepseek-v4-flash');
  assert.equal(config.llm.thinking,false);
  assert.equal(config.retrievalTopK,3);
  assert.equal(config.retrievalTopKAdjusted,true);
});

test('companion-only listener settings are parsed independently',()=>{
  const config=loadDefenceConfig({DEFENCE_PUBLIC_MODE:'companion-only',DEFENCE_COMPANION_HOST:'127.0.0.1',DEFENCE_COMPANION_PORT:'5432',DEFENCE_COMPANION_PUBLIC_URL:'https://defence.example.test/'});
  assert.equal(config.publicMode,'companion-only');
  assert.equal(config.companionHost,'127.0.0.1');
  assert.equal(config.companionPort,5432);
  assert.equal(config.companionPublicUrl,'https://defence.example.test');
});

test('question merge silence waits longer than packet-level VAD silence',()=>{
  const config=loadDefenceConfig({VAD_SILENCE_MS:'650',QUESTION_MERGE_SILENCE_MS:'1600'});
  assert.equal(config.input.vad.silenceMs,650);
  assert.equal(config.input.vad.questionMergeSilenceMs,1600);
  assert.ok(config.input.vad.questionMergeSilenceMs>config.input.vad.silenceMs);
});
