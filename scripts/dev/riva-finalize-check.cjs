/**
 * Reproduces the "STT reconnecting" the overlay showed mid-meeting.
 *
 * The renderer calls finalizeMicSTT() on every "Answer Now". finalize() used to
 * call stream.end(), which for Riva ENDS the recognition session — so the next
 * mic chunk threw ERR_STREAM_WRITE_AFTER_END and the server's end-of-call woke
 * the reconnect ladder. Both symptoms are asserted gone here, and stop() is
 * asserted to still really close.
 */
const path=require('path'); const fs=require('fs'); const os=require('os');
const Module=require('module'); const esbuild=require('esbuild');
const loader=require('@grpc/proto-loader');
const ROOT=path.resolve(__dirname,'../..');
let failures=0;
const check=(n,ok,d='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok)failures++;};

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'riva-fin-'));
const outFile=path.join(tmp,'electron','NvidiaNimStreamingSTT.js');
esbuild.buildSync({entryPoints:[path.join(ROOT,'electron/audio/NvidiaNimStreamingSTT.ts')],
  outfile:outFile,bundle:true,platform:'node',format:'cjs',target:'node20',
  external:['@grpc/grpc-js','@grpc/proto-loader','electron'],logLevel:'error'});
fs.mkdirSync(path.join(tmp,'electron','audio'),{recursive:true});
fs.copyFileSync(path.join(ROOT,'electron/audio/riva_asr.proto'),path.join(tmp,'electron','audio','riva_asr.proto'));

const streams=[];
const grpcStub={
  Metadata:class{add(){}}, credentials:{createSsl:()=>({})},
  loadPackageDefinition: () => {
    class RivaSpeechRecognition {
      streamingRecognize() {
        const h = {};
        const s = {
          h, writes: [], ended: false,
          on: (e, cb) => { h[e] = cb; },
          // A real grpc ClientWritableStream throws exactly this after end().
          write(o) {
            if (s.ended) { const e = new Error('write after end'); e.code = 'ERR_STREAM_WRITE_AFTER_END'; throw e; }
            s.writes.push(o);
          },
          end() { s.ended = true; },
          cancel() {},
        };
        streams.push(s);
        return s;
      }
    }
    return { nvidia: { riva: { asr: { RivaSpeechRecognition } } } };
  },
};
const realLoad=Module._load;
Module._load=function(r,p,m){ if(r==='@grpc/grpc-js')return grpcStub;
  if(r==='@grpc/proto-loader')return loader; return realLoad.call(this,r,p,m); };
const {NvidiaNimStreamingSTT}=require(outFile);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const stt=new NvidiaNimStreamingSTT('k','nemotron-asr-streaming');
  const errors=[]; stt.on('error',e=>errors.push(e.message||String(e)));
  stt.setSampleRate(16000); stt.start();
  stt.write(Buffer.alloc(640));
  const before=streams[0].writes.filter(w=>w.audioContent).length;
  check('audio flowing before Answer Now', before===1, `${before} frames`);

  // ── The user presses "Answer Now" ──
  stt.finalize();
  check('finalize does NOT close the session', streams[0].ended===false);

  // Mic keeps running, as it does in a real meeting.
  stt.write(Buffer.alloc(640)); stt.write(Buffer.alloc(640));
  const after=streams[0].writes.filter(w=>w.audioContent).length;
  check('audio still flows after Answer Now', after===3, `${after} frames`);
  check('no ERR_STREAM_WRITE_AFTER_END surfaced', !errors.some(e=>/write after end/i.test(e)), errors.join('|')||'no errors');
  check('no error raised to the user at all', errors.length===0, errors.join('|')||'none');

  await sleep(1300);
  check('no spurious reconnect — still one stream', streams.length===1, `${streams.length} streams`);

  // Repeated presses must stay harmless.
  stt.finalize(); stt.finalize();
  stt.write(Buffer.alloc(640));
  await sleep(1300);
  check('repeated Answer Now presses stay harmless', streams.length===1 && errors.length===0,
    `${streams.length} streams, ${errors.length} errors`);

  // ── A write that genuinely fails must still recover, not raise ──
  streams[0].ended=true;                    // simulate the peer half-closing
  stt.write(Buffer.alloc(640));
  check('a genuinely dead stream raises no user-facing error', errors.length===0, errors.join('|')||'none');
  await sleep(1300);
  check('a genuinely dead stream DOES reconnect', streams.length===2, `${streams.length} streams`);

  // ── stop() must still really end it ──
  stt.stop();
  check('stop() ends the live stream', streams[1].ended===true);
  const n=streams.length; await sleep(1300);
  check('stop() queues no reconnect', streams.length===n, `${streams.length} vs ${n}`);

  Module._load=realLoad;
  fs.rmSync(tmp,{recursive:true,force:true});
  console.log(failures?`\n${failures} check(s) FAILED`:'\nall checks passed');
  process.exit(failures?1:0);
})();
