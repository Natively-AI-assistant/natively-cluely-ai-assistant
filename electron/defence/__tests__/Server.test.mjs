import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { DefenceServer, isAdminRequestAllowed } from '../../../dist-electron/electron/defence/server.js';

const providerNone={provider:'none',apiKey:'',baseUrl:'',model:'',timeoutMs:1000,maxRetries:0};
const wsSession=(url,token)=>new Promise((resolve,reject)=>{const socket=new WebSocket(`${url.replace('http','ws')}/api/defence/live?token=${encodeURIComponent(token)}`);const timer=setTimeout(()=>{socket.terminate();reject(Error('websocket timeout'))},2000);socket.once('message',raw=>{clearTimeout(timer);resolve({socket,message:JSON.parse(raw.toString())})});socket.once('error',error=>{clearTimeout(timer);reject(error)})});
test('admin policy allows loopback and blocks simulated non-loopback clients',()=>{assert.equal(isAdminRequestAllowed('127.0.0.1',true),true);assert.equal(isAdminRequestAllowed('::1',true),true);assert.equal(isAdminRequestAllowed('192.168.1.25',true),false);assert.equal(isAdminRequestAllowed('192.168.1.25',false),true)});

test('high-entropy pairing is one-time; invalid and revoked sessions are rejected', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'defence-server-'));await fs.writeFile(path.join(root,'README.md'),'# Demo\nThis project implements a local evidence index.\n');
  const config={host:'127.0.0.1',port:0,adminLocalOnly:true,tls:{enabled:false,certPath:'',keyPath:''},projectSourcePath:root,indexPath:path.join(root,'.defence-index'),stt:{...providerNone,language:'auto'},llm:{...providerNone},search:{provider:'none',apiKey:'',baseUrl:''},pairingTtlMs:300000,sessionRetentionDays:7,storeAudio:false,storeTranscripts:true,maxUploadBytes:1024*1024,maxAudioBytes:1024*1024,maxAudioDurationMs:5000};
  const server=new DefenceServer(config);const info=await server.listen();t.after(async()=>{await server.close();await fs.rm(root,{recursive:true,force:true})});const base=info.urls[0];
  const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.config.capabilities.localRetrieval,true);assert.equal(health.config.adminLocalOnly,true);
  const indexed=await fetch(base+'/api/project/index',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());assert.equal(indexed.indexedNew,1);assert.equal(indexed.eligibleTotal,1);
  const pairing=await fetch(base+'/api/pairing/create',{method:'POST'}).then(r=>r.json());assert.ok(pairing.secret.length>=22);assert.match(pairing.qrDataUrl,/^data:image\/png;base64,/);
  const invalid=await fetch(base+'/api/pairing/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pairing.id,secret:'wrong'})});assert.equal(invalid.status,401);
  const verify=()=>fetch(base+'/api/pairing/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pairing.id,secret:pairing.secret})});
  const first=await verify();assert.equal(first.status,200);const auth=await first.json();assert.ok(auth.token);assert.equal((await verify()).status,401);
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`};
  assert.equal((await fetch(base+'/api/defence/session/'+auth.sessionId,{headers:{Authorization:'Bearer invalid-token'}})).status,401);
  assert.equal((await fetch(base+'/api/defence/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  const answer=await fetch(base+'/api/defence/answer',{method:'POST',headers,body:JSON.stringify({question:'What project evidence index is implemented?'})});assert.equal(answer.status,200);const data=await answer.json();assert.equal(data.evidence[0].path,'README.md');assert.ok(data.questionId&&data.generationId);
  await assert.rejects(()=>wsSession(base,'invalid-token'));
  const live=await wsSession(base,auth.token);assert.equal(live.message.type,'session');assert.equal(live.message.answers.length,1);live.socket.close();
  const reconnected=await wsSession(base,auth.token);assert.equal(reconnected.message.answers.length,1);assert.equal(reconnected.message.nextAudioSequence,0);reconnected.socket.close();
  assert.equal((await fetch(base+'/api/defence/session/'+auth.sessionId,{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(base+'/api/defence/session/'+auth.sessionId,{headers})).status,401);
  assert.equal((await fetch(base+'/manifest.webmanifest')).status,200);
});
