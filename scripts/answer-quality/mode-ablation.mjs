#!/usr/bin/env node
// With-intent versus without-intent, on real continuous conversation, per mode.
//
// The mode matters because the classifier's eight labels are a technical
// interview taxonomy applied everywhere. `dsa_problem` and `optimization_probe`
// mean nothing in a sales call or a lecture, so if the taxonomy is the defect
// the campaign claims, the damage should be largest away from interviews.
//
// Fixtures are real captioned conversations, used locally only.
import fs from 'node:fs'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const API='http://127.0.0.1:8788';
const repoRoot=path.resolve('../..');
const KEY=fs.readFileSync(path.join(repoRoot,'.env'),'utf8').split('\n').find(l=>l.startsWith('NATIVELY_API_KEY=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
process.resourcesPath ||= path.join(repoRoot,'resources');
const IC=await import(pathToFileURL(path.join(repoRoot,'dist-electron/electron/llm/IntentClassifier.js')).href);

const ROLE={'technical-interview':['INTERVIEWER','a candidate in a technical interview'],
 'looking-for-work':['INTERVIEWER','a candidate in a job interview'],
 'sales':['PROSPECT','a salesperson on a live call'],
 'team-meet':['COLLEAGUE','a participant in a team meeting'],
 'lecture':['PROFESSOR','a student in a lecture'],
 'seminar':['AUDIENCE','a presenter taking audience questions'],
 'call-center':['CUSTOMER','a support agent on a live call'],
 'general':['OTHER','someone in a live conversation']};
const MAX_TURNS=Number(process.env.MAX_TURNS||18);

async function chat(content){
  const r=await fetch(`${API}/v1/chat`,{method:'POST',headers:{'Content-Type':'application/json','x-natively-key':KEY},
    body:JSON.stringify({messages:[{role:'user',content}]})});
  if(!r.ok) throw new Error(String(r.status));
  return (await r.json()).content ?? '';
}
// Markers match formatTranscriptForLLM exactly: [INTERVIEWER]: and [ME]:.
const gen=(hist,q,shape,who)=>chat(`You are helping ${who}. They read your answer off a screen while speaking, so it must be usable out loud.

CONVERSATION SO FAR:
${hist.join('\n')}

The other person just said: "${q}"${shape?`\n\nANSWER SHAPE: ${shape}`:''}

Give them what to say.`);

const results={};
for(const [mode,[other,who]] of Object.entries(ROLE)){
  const f=path.join('transcripts',`${mode}.turns.txt`);
  if(!fs.existsSync(f)){ results[mode]={skipped:'no fixture'}; continue; }
  const lines=fs.readFileSync(f,'utf8').split('\n').map(l=>l.trim()).filter(Boolean);
  const hist=[]; const rows=[]; let done=0;
  for(const line of lines){
    const m=new RegExp(`^(${other}|USER):\\s*(.+)$`,'i').exec(line);
    if(!m) continue;
    const [,w,text]=m;
    if(w.toUpperCase()!==other){ hist.push(`[ME]: ${text}`); continue; }
    if(done>=MAX_TURNS){ hist.push(`[INTERVIEWER]: ${text}`); continue; }
    let res; try{ res=await IC.classifyIntent(text,hist.join('\n'),done); }catch{ res={intent:'general',confidence:0.5,answerShape:''}; }
    try{
      const a=await gen(hist,text,res.answerShape,who);
      const b=await gen(hist,text,null,who);
      rows.push({q:text,intent:res.intent,with:a,without:b});
      done++;
    }catch{}
    hist.push(`[INTERVIEWER]: ${text}`);
  }
  // blind pairwise
  let W=0,O=0,T=0;
  for(const r of rows){
    const flip=Math.random()<0.5; const [X,Y]=flip?[r.without,r.with]:[r.with,r.without];
    try{
      const v=(await chat(`Someone is in a live conversation reading this off a screen while speaking. The other person said: "${r.q}"

ANSWER 1:
${X.slice(0,2000)}

ANSWER 2:
${Y.slice(0,2000)}

Which helps more in that live moment? Consider correctness and usability while talking. Reply exactly: 1, 2, or TIE.`)).trim().toUpperCase();
      const win=v.startsWith('1')?(flip?'without':'with'):v.startsWith('2')?(flip?'with':'without'):'tie';
      if(win==='with')W++; else if(win==='without')O++; else T++;
    }catch{}
  }
  const intents={}; for(const r of rows) intents[r.intent]=(intents[r.intent]||0)+1;
  results[mode]={turns:rows.length,with:W,without:O,tie:T,intents,
    meanWith:Math.round(rows.reduce((a,r)=>a+r.with.length,0)/(rows.length||1)),
    meanWithout:Math.round(rows.reduce((a,r)=>a+r.without.length,0)/(rows.length||1))};
  console.log(`${mode.padEnd(22)} turns=${String(rows.length).padStart(3)}  with=${String(W).padStart(3)} without=${String(O).padStart(3)} tie=${T}   chars ${results[mode].meanWith}/${results[mode].meanWithout}`);
  fs.writeFileSync(path.join('transcripts',`${mode}.answers.json`),JSON.stringify(rows,null,2));
}
fs.writeFileSync('mode-results.json',JSON.stringify(results,null,2));
const tot=Object.values(results).filter(r=>r.turns);
console.log(`\nTOTAL  with=${tot.reduce((a,r)=>a+r.with,0)}  without=${tot.reduce((a,r)=>a+r.without,0)}  tie=${tot.reduce((a,r)=>a+r.tie,0)}`);
