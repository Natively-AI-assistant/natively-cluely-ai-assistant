import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createDefenceRuntime, DefenceServer, isAdminRequestAllowed } from '../../../dist-electron/electron/defence/server.js';

const providerNone={provider:'none',apiKey:'',baseUrl:'',model:'',timeoutMs:1000,maxRetries:0};
const wsSession=(url,token)=>new Promise((resolve,reject)=>{const socket=new WebSocket(`${url.replace('http','ws')}/api/defence/live?token=${encodeURIComponent(token)}`);const timer=setTimeout(()=>{socket.terminate();reject(Error('websocket timeout'))},2000);socket.once('message',raw=>{clearTimeout(timer);resolve({socket,message:JSON.parse(raw.toString())})});socket.once('error',error=>{clearTimeout(timer);reject(error)})});
test('admin policy allows loopback and blocks simulated non-loopback clients',()=>{assert.equal(isAdminRequestAllowed('127.0.0.1',true),true);assert.equal(isAdminRequestAllowed('::1',true),true);assert.equal(isAdminRequestAllowed('192.168.1.25',true),false);assert.equal(isAdminRequestAllowed('192.168.1.25',false),true)});

test('high-entropy pairing is one-time; invalid and revoked sessions are rejected', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'defence-server-'));await fs.writeFile(path.join(root,'README.md'),'# Demo\nThis project implements a local evidence index.\n');
  const projectsConfigPath=path.join(root,'projects.json');const indexPath=path.join(root,'.defence-index');
  await fs.writeFile(projectsConfigPath,JSON.stringify({version:1,activeProjectId:'demo-project',projects:[{projectId:'demo-project',displayName:'Demo project',sourcePath:root,indexPath}]}));
  const config={host:'127.0.0.1',port:0,adminLocalOnly:true,tls:{enabled:false,certPath:'',keyPath:''},projectId:'demo-project',projectDisplayName:'Demo project',projectsConfigPath,projectSourcePath:root,indexPath,stt:{...providerNone,language:'auto'},llm:{...providerNone},search:{provider:'none',apiKey:'',baseUrl:''},pairingTtlMs:300000,sessionRetentionDays:7,storeAudio:false,storeTranscripts:true,maxUploadBytes:1024*1024,maxAudioBytes:1024*1024,maxAudioDurationMs:5000};
  const server=new DefenceServer(config);const info=await server.listen();t.after(async()=>{await server.close();await fs.rm(root,{recursive:true,force:true})});const base=info.urls[0];
  const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.config.capabilities.localRetrieval,true);assert.equal(health.config.adminLocalOnly,true);
  const indexed=await fetch(base+'/api/project/index',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());assert.equal(indexed.indexedNew,2);assert.equal(indexed.eligibleTotal,2);
  const projects=await fetch(base+'/api/projects').then(r=>r.json());assert.equal(projects.activeProjectId,'demo-project');assert.equal(projects.projects[0].displayName,'Demo project');
  const selected=await fetch(base+'/api/projects/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:'demo-project'})}).then(r=>r.json());assert.equal(selected.projectId,'demo-project');assert.equal(selected.indexPath,indexPath);
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

test('companion-only proxy exposes PWA and authenticated session routes but never admin or project APIs',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'defence-companion-'));await fs.writeFile(path.join(root,'README.md'),'# CBA\nTop-K scouting shortlist decision support.\n');
  const baseConfig={host:'127.0.0.1',port:0,publicMode:'companion-only',companionHost:'127.0.0.1',companionPort:0,companionPublicUrl:'https://companion.example.test',adminLocalOnly:true,tls:{enabled:false,certPath:'',keyPath:''},projectId:'cba-import-candidate-ranking',projectDisplayName:'CBA',projectsConfigPath:path.join(root,'projects.json'),projectSourcePath:root,indexPath:path.join(root,'.index'),retrievalTopK:3,retrievalTopKAdjusted:false,stt:{...providerNone,language:'auto'},llm:{...providerNone,thinking:false},search:{provider:'none',apiKey:'',baseUrl:''},pairingTtlMs:300000,sessionRetentionDays:7,storeAudio:false,storeTranscripts:true,maxUploadBytes:1024*1024,maxAudioBytes:1024*1024,maxAudioDurationMs:5000};
  const runtime=createDefenceRuntime(),admin=new DefenceServer(baseConfig,'full',runtime),companion=new DefenceServer(baseConfig,'companion',runtime);const adminInfo=await admin.listen(),companionInfo=await companion.listen();
  const proxy=http.createServer((req,res)=>{const upstream=http.request({host:'127.0.0.1',port:companionInfo.port,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-for':'203.0.113.44'}},response=>{res.writeHead(response.statusCode||502,response.headers);response.pipe(res)});req.pipe(upstream)});await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const proxyPort=proxy.address().port,publicBase=`http://127.0.0.1:${proxyPort}`,adminBase=adminInfo.urls[0],companionBase=companionInfo.urls[0];
  t.after(async()=>{await Promise.all([admin.close(),companion.close(),new Promise(resolve=>proxy.close(resolve))]);await fs.rm(root,{recursive:true,force:true})});
  assert.equal((await fetch(publicBase+'/')).status,200);const publicHealth=await fetch(publicBase+'/api/health').then(r=>r.json());assert.equal(publicHealth.config.adminNotExposed,true);assert.equal(JSON.stringify(publicHealth).includes(root),false);assert.equal((await fetch(publicBase+'/admin')).status,404);assert.equal((await fetch(publicBase+'/api/project/index',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);assert.equal((await fetch(publicBase+'/api/project/sources')).status,404);assert.equal((await fetch(publicBase+'/api/projects')).status,404);
  await assert.rejects(()=>wsSession(companionBase,'unpaired-token'));
  const pairing=await fetch(adminBase+'/api/pairing/create',{method:'POST'}).then(r=>r.json());assert.match(pairing.pairUrl,/^https:\/\/companion\.example\.test\//);const verify=await fetch(publicBase+'/api/pairing/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pairing.id,secret:pairing.secret})});assert.equal(verify.status,200);const auth=await verify.json();
  const headers={Authorization:`Bearer ${auth.token}`};assert.equal((await fetch(publicBase+'/api/defence/session/'+auth.sessionId,{headers})).status,200);assert.equal((await fetch(publicBase+'/api/defence/session/'+auth.sessionId,{method:'DELETE',headers})).status,200);await assert.rejects(()=>wsSession(companionBase,auth.token));
});
