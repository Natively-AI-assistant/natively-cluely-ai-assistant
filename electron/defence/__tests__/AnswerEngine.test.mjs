import test from 'node:test';
import assert from 'node:assert/strict';
import { AnswerEngine } from '../../../dist-electron/electron/defence/answerEngine.js';
import { tokenize, vectorize } from '../../../dist-electron/electron/defence/projectIndexer.js';

const config = { host:'127.0.0.1',port:0,adminLocalOnly:true,tls:{enabled:false,certPath:'',keyPath:''},projectSourcePath:'.',indexPath:'.',stt:{provider:'none',apiKey:'',baseUrl:'',model:'',language:'auto',timeoutMs:1000,maxRetries:0},llm:{provider:'none',apiKey:'',baseUrl:'',model:'',timeoutMs:1000,maxRetries:0},search:{provider:'none',apiKey:'',baseUrl:''},pairingTtlMs:300000,sessionRetentionDays:7,storeAudio:false,storeTranscripts:true,maxUploadBytes:1024,maxAudioBytes:1024,maxAudioDurationMs:5000 };
const text='The retrieval pipeline uses hybrid keyword and vector search. Tests verify source file paths and line ranges.';
const tokens=tokenize(text);
const manifest={version:1,projectRoot:'.',files:{'retrieval.md':{hash:'x',chunkIds:['1'],indexedAt:'now'}},chunks:[{id:'1',sourceType:'project',path:'retrieval.md',title:'Retrieval',lineStart:1,lineEnd:2,excerpt:text,content:text,status:'IMPLEMENTED',score:0,fileHash:'x',indexedAt:'now',tokens,vector:vectorize(tokens)}]};
const settings={inputLanguage:'auto',outputLanguage:'follow',answerDepth:'standard',searchMode:'off'};

test('grounded English answer cites project evidence without APIs', async()=>{const answer=await new AnswerEngine(config).answer('How do you prove retrieval quality?',manifest,settings);assert.equal(answer.noEvidence,false);assert.equal(answer.evidence[0].path,'retrieval.md');assert.match(answer.spokenAnswer,/project evidence/i)});
test('project question with no evidence refuses to fabricate',async()=>{const answer=await new AnswerEngine(config).answer('这个项目的生产吞吐量是多少？',{...manifest,files:{},chunks:[]},settings);assert.equal(answer.noEvidence,true);assert.match(answer.spokenAnswer,/没有足够证据/)});
test('search off remains usable and never requires a provider',async()=>{const answer=await new AnswerEngine(config).answer('What is the latest industry benchmark?',manifest,settings);assert.deepEqual(answer.externalSources,[])});
