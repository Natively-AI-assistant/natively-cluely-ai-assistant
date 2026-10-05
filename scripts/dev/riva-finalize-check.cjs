/**
 * "Answer Now" (finalizeMicSTT) has to do two things at once, and the first two
 * attempts each got one of them:
 *
 *   stream.end()  -> the final arrived, but the session was dead afterwards:
 *                    ERR_STREAM_WRITE_AFTER_END on the next mic chunk and
 *                    "STT reconnecting" in the overlay.
 *   no-op         -> no errors, and NO TRANSCRIPTS AT ALL. Riva has no flush
 *                    control and the mic sends keepalive frames rather than
 *                    real silence, so its endpointing never fires by itself.
 *
 * The stream is now ROTATED: end the call so the server flushes its final, and
 * open a replacement in the same breath. This pins both halves — the final still
 * arrives AND the session survives — plus the absence of the reconnect noise.
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
  const heard=[]; stt.on('transcript',t=>heard.push(t));
  stt.setSampleRate(16000); stt.start();
  stt.write(Buffer.alloc(640));
  check('one stream before Answer Now', streams.length===1, `${streams.length}`);
  check('audio reaches it', streams[0].writes.filter(w=>w.audioContent).length===1);

  // ── "Answer Now" ──
  const first=streams[0];
  stt.finalize();
  check('the call is closed so the server flushes', first.ended===true);
  check('a REPLACEMENT stream is opened immediately', streams.length===2, `${streams.length} streams`);
  check('the replacement got the recognition config',
    streams[1].writes.some(w=>w.streamingConfig), JSON.stringify(streams[1].writes[0]||{}).slice(0,60));

  // THE POINT OF THE WHOLE FIX: the flushed final still reaches the app.
  first.h.data({results:[{alternatives:[{transcript:'hi hi what is up',confidence:0.9}],isFinal:true}]});
  check('the flushed FINAL still reaches the listener', heard.length===1 && heard[0].isFinal===true, JSON.stringify(heard));

  // The closed call completing must not look like a dropped stream.
  first.h.end();
  await sleep(1300);
  check('closing the old call schedules NO reconnect', streams.length===2, `${streams.length} streams`);
  check('no error surfaced to the user', errors.length===0, errors.join('|')||'none');

  // Session survives: audio after the press goes to the replacement.
  stt.write(Buffer.alloc(640)); stt.write(Buffer.alloc(640));
  const onNew=streams[1].writes.filter(w=>w.audioContent).length;
  check('audio keeps flowing after Answer Now', onNew===2, `${onNew} frames on the replacement`);
  check('still no ERR_STREAM_WRITE_AFTER_END', !errors.some(e=>/write after end/i.test(e)), errors.join('|')||'none');

  // Pressing it repeatedly rotates once each, and stays quiet.
  stt.finalize(); stt.finalize();
  await sleep(1300);
  check('repeated presses rotate once each', streams.length===4, `${streams.length} streams`);
  check('repeated presses stay error-free', errors.length===0, errors.join('|')||'none');
  stt.write(Buffer.alloc(640));
  check('newest stream is the live one', streams[3].writes.filter(w=>w.audioContent).length===1);

  // ── A genuinely dead stream must still recover ──
  const live=streams[3];
  live.ended=true;                    // peer half-closed under us
  stt.write(Buffer.alloc(640));
  check('a real drop raises no user-facing error', errors.length===0, errors.join('|')||'none');
  await sleep(1300);
  check('a real drop DOES reconnect', streams.length===5, `${streams.length} streams`);

  // ── stop() is still a real close ──
  stt.stop();
  check('stop() ends the live stream', streams[4].ended===true);
  const n=streams.length; await sleep(1300);
  check('stop() queues no reconnect', streams.length===n, `${streams.length} vs ${n}`);
  check('finalize() after stop() is inert', (stt.finalize(), streams.length===n), `${streams.length}`);

  Module._load=realLoad;
  fs.rmSync(tmp,{recursive:true,force:true});
  console.log(failures?`\n${failures} check(s) FAILED`:'\nall checks passed');
  process.exit(failures?1:0);
})();
