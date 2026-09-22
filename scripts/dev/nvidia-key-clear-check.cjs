/**
 * One NVIDIA key backs both the chat provider and speech recognition. Clearing
 * it from AI Providers used to leave sttProvider on 'nvidia_nim' with nothing
 * to authenticate with, so the pipeline fell through to GoogleSTT and
 * transcription stopped mid-meeting with no user-visible cause.
 *
 * Pins the decision the handler now makes, lifted from the real source so the
 * test cannot drift from it.
 */
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(__dirname,'../..');
let failures=0;
const check=(n,ok,d='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok)failures++;};

const src=fs.readFileSync(path.join(ROOT,'electron/ipcHandlers.ts'),'utf8');
const i=src.indexOf("safeHandle('set-nvidia-nim-api-key'");
const body=src.slice(i, src.indexOf("safeHandle('set-litellm-config'", i));
check('handler exists', i>0);

// The exact predicate the handler uses.
const m=/const sttWasNvidia =\s*([^;]+);/.exec(body);
check('clear-detection predicate is present', !!m, m && m[1].trim());
const predicate = m[1];
const evaluate=(key,stt)=>{
  const normalizedKey=key.trim();
  const cm={ getSttProvider:()=>stt };
  return eval(predicate.replace(/cm\.getSttProvider\(\)/g,'cm.getSttProvider()'));
};
check('clearing while NVIDIA is the speech provider  -> flips', evaluate('', 'nvidia_nim')===true);
check('clearing while ANOTHER provider is active     -> no change', evaluate('', 'deepgram')===false);
check('clearing while speech already off             -> no change', evaluate('', 'none')===false);
check('SETTING a key while NVIDIA is active          -> no change', evaluate('nvapi-abc', 'nvidia_nim')===false);
check('ROTATING a key while NVIDIA is active         -> no change', evaluate('nvapi-xyz', 'nvidia_nim')===false);
check('whitespace-only key counts as a clear         -> flips', evaluate('   ', 'nvidia_nim')===true);

// Ordering and reporting.
const flipAt=body.indexOf("cm.setSttProvider('none')");
const reconfigAt=body.indexOf('reconfigureSttProvider');
check('provider is switched off BEFORE the pipeline reconfigures', flipAt>0 && flipAt<reconfigAt,
  `flip@${flipAt} reconfigure@${reconfigAt}`);
check('the outcome is reported to the renderer', /sttProviderCleared: sttWasNvidia/.test(body));

// The confirm dialog warns before the click.
const ui=fs.readFileSync(path.join(ROOT,'src/components/settings/AIProvidersSettings.tsx'),'utf8');
check('remove-key dialog warns when speech shares the key',
  /alsoDisablesSpeech[\s\S]{0,220}Speech recognition uses this same key/.test(ui));
check('the warning is conditional, not shown for every provider',
  /pendingConfirm\.provider === 'nvidia_nim' && activeSttProvider === 'nvidia_nim'/.test(ui));

console.log(failures?`\n${failures} check(s) FAILED`:'\nall checks passed');
process.exit(failures?1:0);
