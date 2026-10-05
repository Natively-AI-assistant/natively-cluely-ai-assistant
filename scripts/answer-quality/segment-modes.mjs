#!/usr/bin/env node
// Segment each mode's raw caption text into speaker turns and style it as the
// STT actually emits: lowercase, no punctuation. The disfluencies are left
// exactly as spoken, because they are the point.
import fs from 'node:fs'; import path from 'node:path';
const API='http://127.0.0.1:8788';
const KEY=fs.readFileSync('../../.env','utf8').split('\n').find(l=>l.startsWith('NATIVELY_API_KEY=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');

// Who the OTHER party is, per mode. Natively's asymmetry: in recruiting the
// user is the interviewer, so the system channel is the candidate.
const OTHER={'technical-interview':'INTERVIEWER','looking-for-work':'INTERVIEWER','sales':'PROSPECT',
  'recruiting':'CANDIDATE','team-meet':'COLLEAGUE','lecture':'PROFESSOR','seminar':'AUDIENCE',
  'call-center':'CUSTOMER','general':'OTHER'};

async function chat(content){
  const r=await fetch(`${API}/v1/chat`,{method:'POST',headers:{'Content-Type':'application/json','x-natively-key':KEY},
    body:JSON.stringify({messages:[{role:'user',content}]})});
  return (await r.json()).content ?? '';
}

for(const [mode,other] of Object.entries(OTHER)){
  const raw=path.join('transcripts',`${mode}.raw.txt`);
  if(!fs.existsSync(raw)){ console.log(mode,'MISSING'); continue; }
  const words=fs.readFileSync(raw,'utf8').split(' ');
  // Cap the work: 4500 words is plenty of turns per mode.
  const chunks=[]; for(let i=0;i<Math.min(words.length,4500);i+=900) chunks.push(words.slice(i,i+900).join(' '));
  const outLines=[];
  for(const c of chunks){
    const p=`This is an auto-transcribed real ${mode.replace('-',' ')} conversation. Split it into speaker turns between ${other} and USER. Output ONLY lines "${other}: <text>" or "USER: <text>". Keep the exact wording including every hesitation, filler and false start. Skip intro narration, ads and sponsor reads.\n\n${c}`;
    try{ outLines.push(await chat(p)); }catch{}
  }
  const re=new RegExp(`^(${other}|USER):`,'i');
  const turns=outLines.join('\n').split('\n').map(l=>l.trim()).filter(l=>re.test(l))
    .map(l=>{ const [w,t]=l.split(/:(.+)/); 
      const s=(t||'').toLowerCase().replace(/[.,!?;:"()\[\]]/g,'').replace(/\s+/g,' ').trim();
      return s.split(' ').length>=3 ? `${w.toUpperCase()}: ${s}` : null; }).filter(Boolean);
  fs.writeFileSync(path.join('transcripts',`${mode}.turns.txt`), turns.join('\n')+'\n');
  const nOther=turns.filter(t=>t.startsWith(other)).length;
  console.log(`${mode.padEnd(22)} ${String(turns.length).padStart(4)} turns  (${nOther} ${other.toLowerCase()})`);
}
