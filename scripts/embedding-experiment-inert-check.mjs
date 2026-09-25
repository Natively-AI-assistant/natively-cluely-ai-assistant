#!/usr/bin/env node
// scripts/embedding-experiment-inert-check.mjs
//
// R&D ONLY. Proves the bake-off seam is INERT on a production launch.
//
// The whole experiment rests on one safety claim: with
// NATIVELY_EMBEDDING_EXPERIMENT unset, LocalEmbeddingProvider behaves exactly
// as it did before the seam existed. That claim is worth executing rather than
// asserting, because everything else in docs/local-embedding-benchmark.md is
// predicated on production being untouched.
//
// It also checks the fail-loud property: an UNKNOWN experiment key must throw,
// not silently fall back to MiniLM, or a typo in a benchmark script would
// produce a full set of baseline numbers labelled as a candidate.
//
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-experiment-inert-check.mjs
import path from 'path'; import os from 'os'; import Module from 'module';
const REPO='/Users/evin/natively-cluely-ai-assistant';
const realLoad=Module._load;
Module._load=function(r){ if(r==='electron') return {app:{isPackaged:false,getAppPath:()=>REPO,getPath:()=>os.tmpdir()}}; return realLoad.apply(this,arguments); };
delete process.env.NATIVELY_EMBEDDING_EXPERIMENT;
delete process.env.NATIVELY_LOCAL_MODELS_PATH;
const {LocalEmbeddingProvider}=await import(path.join(REPO,'dist-electron/electron/rag/providers/LocalEmbeddingProvider.js'));
const {resolveEmbeddingExperiment}=await import(path.join(REPO,'dist-electron/electron/rag/embeddingExperiments.js'));

const exp = resolveEmbeddingExperiment();
const p = new LocalEmbeddingProvider();
// Since 2026-09-22 the bundled default is multilingual-e5-small
// (electron/rag/bundledLocalEmbedding.ts). With the experiment env var unset the
// provider must be EXACTLY that model, in EXACTLY the production space key.
const checks = [
  ['resolveEmbeddingExperiment() === null', exp === null],
  ["name === 'local'", p.name === 'local'],
  ['dimensions === 384', p.dimensions === 384],
  ["model === 'Xenova/multilingual-e5-small'", p.model === 'Xenova/multilingual-e5-small'],
  ["space === 'local:xenova/multilingual-e5-small:384'", p.space === 'local:xenova/multilingual-e5-small:384'],
];
// The bundled model is ASYMMETRIC: embedQuery must apply "query: " and
// embedBatch "passage: ", so the same text must NOT produce the same vector.
// Identical vectors here would mean the prefixes silently stopped applying —
// a retrieval regression that reads as a model quality problem.
const v1 = await p.embedQuery('free tier limits');
const v2 = await p.embed('free tier limits');
checks.push(['embedQuery !== embed (asymmetric: query:/passage: prefixes applied)', v1.some((x,i)=>x!==v2[i])]);
checks.push(['vector width is 384', v1.length === 384 && v2.length === 384]);
let bad=0;
for(const [n,ok] of checks){ if(!ok) bad++; console.log((ok?'OK   ':'FAIL ')+n); }
// And an unknown key must THROW rather than silently produce baseline numbers
process.env.NATIVELY_EMBEDDING_EXPERIMENT='typo-model';
let threw=false; try{ resolveEmbeddingExperiment(); }catch{ threw=true; }
console.log((threw?'OK   ':'FAIL ')+'unknown key throws instead of falling back to MiniLM');
if(!threw) bad++;
console.log(bad===0?'\nPRODUCTION DEFAULT OK: env var unset -> bundled multilingual-e5-small, prefixes applied.':'\n'+bad+' FAILURES');
await p.dispose?.(); process.exit(bad?1:0);
