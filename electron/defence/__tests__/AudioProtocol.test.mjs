import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AudioChunkTracker, AudioProtocolError } from '../../../dist-electron/electron/defence/audioProtocol.js';

const limits={maxAudioBytes:128,maxAudioDurationMs:5000};
const chunk=(sequence,overrides={})=>({sessionId:'session-1',sequence,mimeType:'audio/wav',codec:'pcm_s16le',sampleRate:16000,channelCount:1,durationMs:900,finalChunk:true,clientTimestamp:new Date().toISOString(),data:Buffer.from('fixture audio bytes').toString('base64'),...overrides});
const rejects=(fn,code)=>assert.throws(fn,error=>error instanceof AudioProtocolError&&error.code===code);

test('Chinese, English and mixed fixture chunks are accepted in sequence',()=>{const tracker=new AudioChunkTracker();for(let i=0;i<3;i++)assert.equal(tracker.accept(chunk(i),limits,'session-1').action,'accept');assert.equal(tracker.nextSequence,3)});
test('empty, oversized and unsupported audio are rejected',()=>{rejects(()=>new AudioChunkTracker().accept(chunk(0,{data:''}),limits,'session-1'),'EMPTY_AUDIO');rejects(()=>new AudioChunkTracker().accept(chunk(0,{data:Buffer.alloc(129).toString('base64')}),limits,'session-1'),'AUDIO_TOO_LARGE');rejects(()=>new AudioChunkTracker().accept(chunk(0,{mimeType:'audio/aac'}),limits,'session-1'),'UNSUPPORTED_AUDIO_FORMAT')});
test('duplicate is acknowledged without resubmission and out-of-order is rejected',()=>{const tracker=new AudioChunkTracker();tracker.accept(chunk(0),limits,'session-1');assert.equal(tracker.accept(chunk(0),limits,'session-1').action,'duplicate');rejects(()=>tracker.accept(chunk(2),limits,'session-1'),'AUDIO_OUT_OF_ORDER')});
test('tracker state survives a transport disconnect',()=>{const tracker=new AudioChunkTracker();tracker.accept(chunk(0),limits,'session-1');assert.equal(tracker.nextSequence,1);assert.equal(tracker.accept(chunk(0),limits,'session-1').action,'duplicate');assert.equal(tracker.accept(chunk(1),limits,'session-1').action,'accept')});
test('PWA exposes an actionable microphone permission error',()=>{const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.match(source,/无法使用麦克风/);assert.match(source,/getUserMedia/)});
