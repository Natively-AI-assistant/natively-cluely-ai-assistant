import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DefenceServer } from '../../../dist-electron/electron/defence/server.js';

test('pairing is one-time and authenticated API survives missing provider keys', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'defence-server-'));await fs.writeFile(path.join(root,'README.md'),'# Demo\nThis project implements a local evidence index.\n');
  const config={host:'127.0.0.1',port:0,projectSourcePath:root,indexPath:path.join(root,'.defence-index'),stt:{provider:'none',apiKey:'',baseUrl:'',model:'',language:'auto'},llm:{provider:'none',apiKey:'',baseUrl:'',model:''},search:{provider:'none',apiKey:'',baseUrl:''},pairingTtlMs:300000,sessionRetentionDays:7,storeAudio:false,storeTranscripts:true,maxUploadBytes:1024*1024,maxAudioBytes:1024*1024};
  const server=new DefenceServer(config);const info=await server.listen();t.after(async()=>{await server.close();await fs.rm(root,{recursive:true,force:true})});const base=info.urls[0];
  const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.config.capabilities.localRetrieval,true);assert.equal(health.config.capabilities.llm,false);
  const indexed=await fetch(base+'/api/project/index',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());assert.equal(indexed.added,1);
  const pairing=await fetch(base+'/api/pairing/create',{method:'POST'}).then(r=>r.json());
  const verify=()=>fetch(base+'/api/pairing/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pairing.id,code:pairing.code})});
  const first=await verify();assert.equal(first.status,200);const auth=await first.json();assert.ok(auth.token);
  const reused=await verify();assert.equal(reused.status,401);
  const unauth=await fetch(base+'/api/defence/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'What does it implement?'})});assert.equal(unauth.status,401);
  const answer=await fetch(base+'/api/defence/answer',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`},body:JSON.stringify({question:'What project evidence index is implemented?'})});assert.equal(answer.status,200);const data=await answer.json();assert.equal(data.evidence[0].path,'README.md');
  const manifest=await fetch(base+'/manifest.webmanifest');assert.equal(manifest.status,200);
});
